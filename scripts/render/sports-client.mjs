// Bundled into app.js (Function.toString). The Owner Sports section: NBA,
// NFL and Pick Builder pages. Everything is read from the gated
// /api/auth/me?sports=... route; nothing private is written into the page or
// browser storage. The only thing kept in localStorage is the viewer's chosen
// time zone for the Today / Tomorrow boards.
export function sportsFactory(host, doc, options) {
  const TZ_KEY = 'stonks-sports-tz-v1';
  const state = { status: null, pending: null, error: null, page: null, bound: {}, leagues: {} };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const leagueOf = (page) => page === 'sports-nba' ? 'nba' : page === 'sports-nfl' ? 'nfl' : null;
  const root = (page) => doc.getElementById(page + '-root');
  const part = (page, name) => root(page)?.querySelector('[data-sp-part="' + name + '"]') || null;
  const STAT_LABELS = {
    passing_yards: 'Passing yards', receptions: 'Receptions', completions: 'Completions', attempts: 'Pass attempts',
    targets: 'Targets', carries: 'Carries', rushing_yards: 'Rushing yards', receiving_yards: 'Receiving yards',
    touchdowns: 'Rush + catch TDs', points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: '3-pointers made', minutes: 'Minutes',
  };
  const SHORT = {
    passing_yards: 'Pass yds', receptions: 'Rec', completions: 'Cmp', attempts: 'Att', targets: 'Tgt', carries: 'Car',
    rushing_yards: 'Rush yds', receiving_yards: 'Rec yds', touchdowns: 'TD', points: 'Pts', rebounds: 'Reb', assists: 'Ast', threes: '3PM', minutes: 'Min',
  };
  const label = (st) => STAT_LABELS[st] || st;
  const team = (t) => escape(String(t || '').toUpperCase());
  const num = (v) => (v == null ? '—' : escape(String(v)));
  const league = (lg) => state.leagues[lg] || (state.leagues[lg] = { board: null, boardErr: null, game: null, gameId: null, gameErr: null, results: null, query: '', player: null, playerId: null, playerErr: null });

  function savedZone() {
    try { return host.localStorage.getItem(TZ_KEY) || ''; } catch (_) { return ''; }
  }
  function saveZone(tz) {
    try { host.localStorage.setItem(TZ_KEY, tz); } catch (_) {}
  }
  function fmtDay(dateStr) {
    try {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
    } catch (_) { return dateStr; }
  }
  function fmtWhen(iso, tz) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); }
    catch (_) { return iso; }
  }
  function fmtTime(iso, tz) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); }
    catch (_) { return iso; }
  }
  function zone() { return state.status?.window?.time_zone || savedZone() || 'America/Los_Angeles'; }

  function api(op, params) {
    let url = '/api/auth/me?sports=' + encodeURIComponent(op);
    Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') url += '&' + k + '=' + encodeURIComponent(params[k]); });
    return host.fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then((res) => {
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('signed-out'), { code: 'auth' });
      if (res.status === 404) throw Object.assign(new Error('not found'), { code: 'missing' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then((data) => {
      if (!data || data.schema_version !== 1) throw new Error('Unexpected Sports response');
      return data;
    });
  }

  function fetchStatus(force) {
    if (state.pending) return state.pending;
    if (state.status && !force) return Promise.resolve(state.status);
    const tz = savedZone();
    state.error = null;
    state.pending = api('status', { tz }).then((data) => {
      if (!data.window || !data.sources) throw new Error('Unexpected Sports response');
      state.status = data;
      return data;
    }).catch((err) => { state.error = err; throw err; })
      .finally(() => { state.pending = null; });
    return state.pending;
  }

  function zonePicker(s) {
    const current = s.window.time_zone;
    const zones = s.time_zones.slice();
    if (!zones.some((z) => z.id === current)) zones.push({ id: current, label: current });
    return '<label class="sp-zone">Day boundary <select data-sp-zone>' +
      zones.map((z) => '<option value="' + escape(z.id) + '"' + (z.id === current ? ' selected' : '') + '>' + escape(z.label) + ' time</option>').join('') +
      '</select></label>';
  }

  function dayStrip(s) {
    const w = s.window;
    return '<div class="sp-days" role="group" aria-label="Active days">' +
      '<span class="sp-day"><b>Today</b> ' + escape(fmtDay(w.today)) + '</span>' +
      '<span class="sp-day"><b>Tomorrow</b> ' + escape(fmtDay(w.tomorrow)) + '</span>' +
      zonePicker(s) + '</div>';
  }

  function sourceCard(src, tz) {
    const connected = src.state !== 'not_connected';
    const stateText = { ok: 'Up to date', degraded: 'Partly updated', failed: 'Last update failed', unknown: 'Unknown', not_connected: 'Not connected yet' }[src.state] || 'Unknown';
    const counts = src.counts && typeof src.counts === 'object' ? src.counts : null;
    const rows = [
      ['Source', '<a href="' + escape(src.url) + '" target="_blank" rel="noopener noreferrer">' + escape(src.provider) + '</a>'],
      ['Status', '<span class="sp-state sp-state-' + escape(src.state) + '">' + escape(stateText) + '</span>'],
      ['Last good update', connected ? escape(fmtWhen(src.last_success_utc, tz)) : '—'],
      ['Seasons stored', src.seasons && src.seasons.length ? escape(src.seasons.join(', ')) : '—'],
    ];
    if (counts && Number.isFinite(counts.player_games)) rows.push(['Stored', escape(Number(counts.games || 0).toLocaleString('en-US') + ' games, ' + Number(counts.player_games).toLocaleString('en-US') + ' player games')]);
    rows.push(['Refresh', escape(src.refresh)], ['Terms', escape(src.license)]);
    return '<div class="sp-source"><h3>Data</h3><dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (src.message ? '<p class="sp-note">' + escape(src.message) + '</p>' : '') + '</div>';
  }

  function statList(stats) {
    return '<div class="sp-stats"><h3>Stats covered</h3><ul>' + stats.map((st) =>
      '<li class="' + (st.enabled ? 'sp-on' : 'sp-later') + '">' + escape(st.label) + (st.enabled ? '' : ' <span>later</span>') + '</li>').join('') + '</ul></div>';
  }

  function emptyBox(title, text) {
    return '<div class="sp-empty"><b>' + escape(title) + '</b>' + (text ? '<p>' + text + '</p>' : '') + '</div>';
  }
  function errorBox(err, retry) {
    if (err && err.code === 'auth') return emptyBox('Your Owner session has ended.', '<a href="/welcome.html">Sign in again</a>');
    return emptyBox('This could not be loaded.', '<button type="button" class="sp-retry" data-sp-retry="' + escape(retry) + '">Try again</button>');
  }

  // ---- Games board -------------------------------------------------------
  function gameStatus(g, tz) {
    if (g.status === 'final') {
      const homeWon = g.home_score > g.away_score, awayWon = g.away_score > g.home_score;
      return '<span class="sp-final">Final <b class="' + (awayWon ? 'sp-win' : '') + '">' + num(g.away_score) + '</b>–<b class="' + (homeWon ? 'sp-win' : '') + '">' + num(g.home_score) + '</b></span>';
    }
    if (g.status === 'postponed' || g.status === 'canceled') return '<span class="sp-muted">' + (g.status === 'postponed' ? 'Postponed' : 'Canceled') + '</span>';
    if (Date.parse(g.start_utc) <= Date.now()) return '<span class="sp-muted">Started · result after the next refresh</span>';
    return '<span class="sp-muted">' + (g.week != null ? (g.season_type === 'POST' ? 'Playoffs' : 'Week ' + escape(g.week)) : '') + '</span>';
  }
  function gameRow(g, tz, selected) {
    return '<li><button type="button" class="sp-game' + (selected ? ' is-on' : '') + '" data-sp-game="' + escape(g.game_id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="sp-time">' + (g.time_tbd ? 'Time TBD' : escape(fmtTime(g.start_utc, tz))) + '</span>' +
      '<span class="sp-match">' + team(g.away_team) + ' <i>at</i> ' + team(g.home_team) + '</span>' +
      '<span class="sp-gstat">' + gameStatus(g, tz) + '</span></button></li>';
  }
  function boardHtml(lg) {
    const L = league(lg), tz = zone();
    if (L.boardErr) return errorBox(L.boardErr, 'board');
    if (!L.board) return '<p class="sp-loading">Loading games…</p>';
    const games = L.board.games || [];
    if (!games.length) {
      const next = L.board.next_game;
      return emptyBox('No ' + lg.toUpperCase() + ' games today or tomorrow.', next ? 'Next game: ' + team(next.away_team) + ' at ' + team(next.home_team) + ', ' + escape(fmtWhen(next.start_utc, tz)) + '.' : 'No later games are stored yet.');
    }
    const groups = [['today', 'Today'], ['tomorrow', 'Tomorrow']];
    return groups.map(([day, name]) => {
      const list = games.filter((g) => g.day === day);
      return '<div class="sp-day-group"><h4>' + name + ' <span>' + escape(fmtDay(L.board.window[day])) + '</span></h4>' +
        (list.length ? '<ul class="sp-games">' + list.map((g) => gameRow(g, tz, g.game_id === L.gameId)).join('') + '</ul>' : '<p class="sp-muted sp-none">No games.</p>') + '</div>';
    }).join('');
  }

  // ---- One game ----------------------------------------------------------
  function gamePanelHtml(lg) {
    const L = league(lg);
    if (!L.gameId) return '';
    if (L.gameErr) return errorBox(L.gameErr, 'game');
    if (!L.game) return '<p class="sp-loading">Loading players…</p>';
    const g = L.game.game;
    const teams = [g.away_team, g.home_team].map((t) => {
      const info = L.game.teams[t] || { players: [] };
      const rows = info.players.map((p) => {
        const s = p.summaries[p.main_stat] || {};
        return '<tr><td><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button></td><td>' + escape(p.position || '') + '</td>' +
          '<td>' + escape(SHORT[p.main_stat] || p.main_stat) + '</td><td class="sp-n">' + num(s.last5) + '</td><td class="sp-n">' + num(s.last10) + '</td><td class="sp-n">' + num(s.games) + '</td></tr>';
      }).join('');
      return '<div class="sp-team"><h5>' + team(t) + (t === g.home_team ? ' <span>home</span>' : '') + '</h5>' +
        (rows ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Player</th><th>Pos</th><th>Stat</th><th class="sp-n">Last 5</th><th class="sp-n">Last 10</th><th class="sp-n">Games</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="sp-muted">No player games stored for this team this season.</p>') + '</div>';
    }).join('');
    return '<div class="sp-panel" data-sp-panel="game"><div class="sp-panel-head"><h4>' + team(g.away_team) + ' at ' + team(g.home_team) + '</h4>' +
      '<button type="button" class="sp-close" data-sp-close="game" aria-label="Close game">×</button></div>' +
      '<p class="sp-note">Players each team used in its last three games this season, with their averages before this game. Select a name for the full game log.</p>' +
      '<div class="sp-teams">' + teams + '</div></div>';
  }

  // ---- Player search and game log ---------------------------------------
  function resultsHtml(lg) {
    const L = league(lg);
    if (L.searchErr) return errorBox(L.searchErr, 'search');
    if (!L.results) return '';
    if (!L.results.players.length) return '<p class="sp-muted">No stored player matches “' + escape(L.query) + '”.</p>';
    return '<ul class="sp-results">' + L.results.players.map((p) =>
      '<li><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button> <span class="sp-muted">' +
      escape([p.position, p.team ? String(p.team).toUpperCase() : null, p.last_season].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>';
  }
  function playerPanelHtml(lg) {
    const L = league(lg);
    if (!L.playerId) return '';
    if (L.playerErr) return errorBox(L.playerErr, 'player');
    if (!L.player) return '<p class="sp-loading">Loading game log…</p>';
    const P = L.player, cols = P.stats.concat(P.context_stats);
    const summary = '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Stat</th><th class="sp-n">Last 5</th><th class="sp-n">Last 10</th><th class="sp-n">All stored</th><th class="sp-n">Median</th><th class="sp-n">Low – high</th><th class="sp-n">Games</th></tr></thead><tbody>' +
      cols.map((st) => {
        const s = P.summaries[st] || {};
        return '<tr' + (P.stats.indexOf(st) >= 0 ? ' class="sp-key"' : '') + '><td>' + escape(label(st)) + '</td><td class="sp-n">' + num(s.last5) + '</td><td class="sp-n">' + num(s.last10) + '</td><td class="sp-n">' + num(s.average) +
          '</td><td class="sp-n">' + num(s.median) + '</td><td class="sp-n">' + (s.games ? num(s.low) + ' – ' + num(s.high) : '—') + '</td><td class="sp-n">' + num(s.games) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    const logCols = cols.filter((st) => st !== 'minutes');
    const log = P.games.length ? '<div class="sp-table-wrap"><table class="sp-table sp-log"><thead><tr><th>Date</th><th>Game</th>' + (lg === 'nba' ? '<th class="sp-n">Min</th>' : '') +
      logCols.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') + '</tr></thead><tbody>' +
      P.games.map((r) => '<tr' + (r.played ? '' : ' class="sp-dnp"') + '><td>' + escape(fmtDay(r.date)) + ' <span class="sp-muted">' + escape(String(r.date).slice(0, 4)) + '</span></td><td>' + (r.home ? 'vs ' : '@ ') + team(r.opponent) +
        (r.week != null ? ' <span class="sp-muted">' + (r.season_type === 'POST' ? 'playoffs' : 'wk ' + escape(r.week)) + '</span>' : '') + (r.played ? '' : ' <span class="sp-muted">did not play</span>') + '</td>' +
        (lg === 'nba' ? '<td class="sp-n">' + num(r.minutes) + '</td>' : '') +
        logCols.map((st) => '<td class="sp-n">' + num(r.stats[st]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      : '<p class="sp-muted">No games stored for this player.</p>';
    return '<div class="sp-panel" data-sp-panel="player"><div class="sp-panel-head"><h4>' + escape(P.player.name) + ' <span>' + escape([P.player.position, P.player.team ? String(P.player.team).toUpperCase() : null].filter(Boolean).join(' · ')) + '</span></h4>' +
      '<button type="button" class="sp-close" data-sp-close="player" aria-label="Close player">×</button></div>' +
      '<h5>Averages over ' + num(P.total_games) + ' stored games</h5>' + summary +
      '<h5>Game log' + (P.total_games > P.games.length ? ' (latest ' + P.games.length + ')' : '') + '</h5>' + log +
      '<p class="sp-note">Games where the player recorded no stat are not in the provider’s file, so they are missing here, not counted as zero.</p></div>';
  }

  function leagueHtml(s, lg) {
    const src = s.sources[lg], tz = s.window.time_zone;
    const name = lg.toUpperCase();
    const connected = src.state !== 'not_connected';
    const board = connected
      ? '<div data-sp-part="board" aria-live="polite">' + boardHtml(lg) + '</div><div data-sp-part="game">' + gamePanelHtml(lg) + '</div>' +
        '<div class="sp-search"><h3>Players</h3><label class="sp-find"><span>Find a player</span><input type="search" data-sp-search autocomplete="off" spellcheck="false" placeholder="Name, at least 2 letters" value="' + escape(league(lg).query) + '"></label>' +
        '<div data-sp-part="results" aria-live="polite">' + resultsHtml(lg) + '</div></div><div data-sp-part="player">' + playerPanelHtml(lg) + '</div>'
      : emptyBox('No ' + name + ' games loaded yet.', escape(lg === 'nfl'
        ? 'The daily nflverse job has not written its first records yet.'
        : 'A later update connects NBA game logs (hoopR and other free sources) and adds CSV import for your own files.'));
    return dayStrip(s) + '<div class="sp-grid"><div class="sp-board"><h3>Games</h3>' + board + '</div>' +
      '<aside class="sp-side">' + sourceCard(src, tz) + statList(s.stats[lg] || []) + '</aside></div>' +
      '<p class="sp-foot">Private research for the two owners. No sportsbook is connected, nothing is placed, and no AI model is called by this page.</p>';
  }

  function builderHtml(s) {
    const steps = [
      ['Add picks', 'Add 1 to 6 player picks from the NBA and NFL pages, or type them in: player, stat, over or under, and the line.'],
      ['Enter the payout', 'Type the payout your app shows for this exact entry (power or flex). The site never guesses a payout from the number of picks.'],
      ['See the odds', 'Each pick gets a chance of hitting from the player’s history. Picks from the same game are flagged, because they move together.'],
      ['Save a paper pick', 'Save the entry before the games start. After the games it is graded from the final stats, and the journal keeps your record.'],
      ['Screenshots', 'Send a slip screenshot to Claude or ChatGPT; it reads the picks and opens this page with them filled in for you to check and save.'],
    ];
    return dayStrip(s) + '<ol class="sp-steps">' + steps.map((st) => '<li><b>' + escape(st[0]) + '</b><span>' + escape(st[1]) + '</span></li>').join('') + '</ol>' +
      '<div class="sp-empty"><b>The Pick Builder arrives in a later update.</b><p>This page is reserved for it now so the section, its access and its storage are in place first.</p></div>' +
      '<p class="sp-foot">Paper picks only. No sportsbook login, no API and no automatic bets.</p>';
  }

  function paint(page, name, html) {
    const el = part(page, name);
    if (el) el.innerHTML = html;
  }

  function render(page) {
    const el = root(page);
    if (!el) return;
    if (!options.owner()) { el.innerHTML = emptyBox('Owner sign-in required.'); return; }
    if (state.error && !state.status) {
      const auth = state.error.code === 'auth';
      el.innerHTML = '<div class="sp-empty"><b>' + (auth ? 'Your Owner session has ended.' : 'The Sports data could not be loaded.') + '</b>' +
        (auth ? '<p><a href="/welcome.html">Sign in again</a></p>' : '<p><button type="button" class="sp-retry" data-sp-retry="status">Try again</button></p>') + '</div>';
      return;
    }
    if (!state.status) { el.textContent = 'Loading…'; return; }
    el.innerHTML = page === 'sports-pick-builder' ? builderHtml(state.status) : leagueHtml(state.status, leagueOf(page));
  }

  function loadBoard(page, lg) {
    const L = league(lg);
    L.boardErr = null;
    api('board', { sport: lg, tz: zone() }).then((data) => { L.board = data; }, (err) => { L.boardErr = err; })
      .then(() => { if (state.page === page) paint(page, 'board', boardHtml(lg)); });
  }
  function openGame(page, lg, id) {
    const L = league(lg);
    L.gameId = id; L.game = null; L.gameErr = null;
    paint(page, 'game', gamePanelHtml(lg)); paint(page, 'board', boardHtml(lg));
    api('game', { sport: lg, id }).then((data) => { if (L.gameId === id) L.game = data; }, (err) => { if (L.gameId === id) L.gameErr = err; })
      .then(() => { if (state.page === page && L.gameId === id) paint(page, 'game', gamePanelHtml(lg)); });
  }
  function openPlayer(page, lg, id) {
    const L = league(lg);
    L.playerId = id; L.player = null; L.playerErr = null;
    paint(page, 'player', playerPanelHtml(lg));
    const el = part(page, 'player');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    api('player', { sport: lg, id }).then((data) => { if (L.playerId === id) L.player = data; }, (err) => { if (L.playerId === id) L.playerErr = err; })
      .then(() => { if (state.page === page && L.playerId === id) paint(page, 'player', playerPanelHtml(lg)); });
  }
  let searchTimer = null;
  function search(page, lg, q) {
    const L = league(lg);
    L.query = q;
    host.clearTimeout(searchTimer);
    if (q.trim().length < 2) { L.results = null; L.searchErr = null; paint(page, 'results', ''); return; }
    searchTimer = host.setTimeout(() => {
      api('players', { sport: lg, q }).then((data) => { if (L.query === q) { L.results = data; L.searchErr = null; } }, (err) => { if (L.query === q) L.searchErr = err; })
        .then(() => { if (state.page === page && L.query === q) paint(page, 'results', resultsHtml(lg)); });
    }, 250);
  }

  function bind(page) {
    const el = root(page);
    if (!el || state.bound[page]) return;
    state.bound[page] = true;
    const lg = leagueOf(page);
    el.addEventListener('change', (event) => {
      const sel = event.target.closest('[data-sp-zone]');
      if (!sel) return;
      saveZone(sel.value);
      state.status = null;
      Object.keys(state.leagues).forEach((k) => { state.leagues[k].board = null; });
      load(page, true);
    });
    el.addEventListener('input', (event) => {
      const box = event.target.closest('[data-sp-search]');
      if (box && lg) search(page, lg, box.value);
    });
    el.addEventListener('click', (event) => {
      const retry = event.target.closest('[data-sp-retry]');
      if (retry) {
        const what = retry.getAttribute('data-sp-retry');
        const L = lg ? league(lg) : null;
        if (what === 'board' && L) { paint(page, 'board', '<p class="sp-loading">Loading games…</p>'); loadBoard(page, lg); }
        else if (what === 'game' && L) openGame(page, lg, L.gameId);
        else if (what === 'player' && L) openPlayer(page, lg, L.playerId);
        else if (what === 'search' && L) search(page, lg, L.query);
        else load(page, true);
        return;
      }
      const game = event.target.closest('[data-sp-game]');
      if (game && lg) { openGame(page, lg, game.getAttribute('data-sp-game')); return; }
      const player = event.target.closest('[data-sp-player]');
      if (player && lg) { openPlayer(page, lg, player.getAttribute('data-sp-player')); return; }
      const close = event.target.closest('[data-sp-close]');
      if (close && lg) {
        const L = league(lg);
        if (close.getAttribute('data-sp-close') === 'game') { L.gameId = null; L.game = null; paint(page, 'game', ''); paint(page, 'board', boardHtml(lg)); }
        else { L.playerId = null; L.player = null; paint(page, 'player', ''); }
      }
    });
  }

  function load(page, force) {
    state.page = page;
    bind(page);
    render(page);
    if (!options.owner()) return;
    fetchStatus(force).then((s) => {
      render(page);
      const lg = leagueOf(page);
      if (lg && s.sources[lg] && s.sources[lg].state !== 'not_connected' && (force || !league(lg).board)) loadBoard(page, lg);
    }, () => render(page));
  }

  return { load };
}
