// Bundled into app.js (Function.toString). The Owner Sports section: NBA,
// NFL and Pick Builder pages. Everything is read from and saved through the
// gated /api/auth/me?sports=... route; no stored record is written into the
// page or browser storage. The browser keeps two things: the chosen time zone
// for the Today / Tomorrow boards (localStorage) and the unsaved Pick Builder
// draft the owner is typing (sessionStorage, gone when the tab closes).
export function sportsFactory(host, doc, options) {
  const TZ_KEY = 'stonks-sports-tz-v1';
  const DRAFT_KEY = 'stonks-sports-draft-v1';
  const BUILDER = 'sports-pick-builder';
  const MAX_PICKS = 6;
  const OPERATOR_NAMES = { prizepicks: 'PrizePicks', betr: 'Betr', other: 'Other app' };
  const state = { status: null, pending: null, error: null, page: null, bound: {}, leagues: {}, draft: null };
  const pb = {
    evaluation: null, evalErr: null, evalSeq: 0, evalTimer: null, saving: false, msg: null, prefill: null,
    journal: null, journalErr: null, journalAll: false, settleOpen: null, confirmWithdraw: null, revising: null, reviseErr: null,
    add: { sport: 'nba', query: '', results: null, searchErr: null, playerId: null, player: null, playerErr: null, msg: null },
  };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const leagueOf = (page) => page === 'sports-nba' ? 'nba' : page === 'sports-nfl' ? 'nfl' : null;
  const root = (page) => doc.getElementById(page + '-root');
  const part = (page, name) => root(page)?.querySelector('[data-sp-part="' + name + '"]') || null;
  const STAT_LABELS = {
    passing_yards: 'Passing yards', receptions: 'Receptions', completions: 'Completions', attempts: 'Pass attempts',
    targets: 'Targets', carries: 'Carries', rushing_yards: 'Rushing yards', receiving_yards: 'Receiving yards',
    touchdowns: 'Rush + catch TDs', points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: '3-pointers made', minutes: 'Minutes',
    pra: 'Points + rebounds + assists', steals: 'Steals', blocks: 'Blocks',
  };
  const SHORT = {
    passing_yards: 'Pass yds', receptions: 'Rec', completions: 'Cmp', attempts: 'Att', targets: 'Tgt', carries: 'Car',
    rushing_yards: 'Rush yds', receiving_yards: 'Rec yds', touchdowns: 'TD', points: 'Pts', rebounds: 'Reb', assists: 'Ast', threes: '3PM', minutes: 'Min',
    pra: 'PRA', steals: 'Stl', blocks: 'Blk',
  };
  const label = (st) => STAT_LABELS[st] || st;
  const lgOf = (src) => (src && src.sport) || '';
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

  // The one request path. A body makes it a POST (Pick Builder); a refused
  // request carries the server's own short reason as err.detail.
  function api(op, params, body) {
    let url = '/api/auth/me?sports=' + encodeURIComponent(op);
    Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') url += '&' + k + '=' + encodeURIComponent(params[k]); });
    const init = { credentials: 'same-origin', cache: 'no-store' };
    if (body) { init.method = 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return host.fetch(url, init).then((res) => res.json().catch(() => null).then((data) => {
      const reason = data && typeof data.error === 'string' ? data.error : '';
      if (res.status === 401 || (res.status === 403 && (!body || /unavailable for this session/.test(reason)))) throw Object.assign(new Error('signed-out'), { code: 'auth' });
      if (res.status === 404 && !body) throw Object.assign(new Error('not found'), { code: 'missing' });
      if (!res.ok) throw Object.assign(new Error(reason || 'HTTP ' + res.status), { status: res.status, detail: reason });
      if (!data || data.schema_version !== 1) throw new Error('Unexpected Sports response');
      return data;
    }));
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
      ['Seasons stored', src.seasons && src.seasons.length ? escape(src.seasons.map((y) => (lgOf(src) === 'nba' ? y + '–' + String(y + 1).slice(2) : y)).join(', ')) : '—'],
    ];
    if (src.latest_game_date) rows.push(['Latest game stored', escape(fmtDay(src.latest_game_date))]);
    if (counts && Number.isFinite(counts.player_games)) rows.push(['Stored', escape(Number(counts.games || 0).toLocaleString('en-US') + ' games, ' + Number(counts.player_games).toLocaleString('en-US') + ' player games')]);
    rows.push(['Refresh', escape(src.refresh)], ['Terms', escape(src.license)]);
    return '<div class="sp-source"><h3>Data</h3><dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (src.message ? '<p class="sp-note">' + escape(src.message) + '</p>' : '') + '</div>';
  }

  const MODEL_STATUS = { validated: 'Passed the check', experimental: 'Experimental' };
  const qualityBadge = (q) => '<span class="sp-q sp-q-' + escape(q) + '">' + escape(MODEL_STATUS[q] || q) + '</span>';
  function modelCard(src) {
    const M = src.model;
    if (!M) return src.state === 'not_connected' ? '' : '<div class="sp-source sp-model"><h3>Model check</h3><p class="sp-muted">The forecasts have not been fitted yet; the next daily data run fits them.</p></div>';
    const b3 = (x) => (x == null ? '—' : x.toFixed(3));
    const rows = Object.keys(M.stats).map((st) => {
      const v = M.stats[st], B = v.brier || {};
      return '<li><div class="sp-model-head"><b>' + escape(label(st)) + '</b>' + qualityBadge(v.status) + '</div>' +
        (v.test_n ? '<span>' + Number(v.test_n).toLocaleString('en-US') + ' later games held out' + (v.split_date ? ' (from ' + escape(fmtDay(v.split_date)) + ' ' + escape(v.split_date.slice(0, 4)) + ')' : '') +
          '. Score (lower is better): model <b>' + b3(B.model) + '</b>, last-10 hit rate ' + b3(B.last10_hit_rate) + ', plain average ' + b3(B.plain_average) +
          '. Chances off by ' + (v.ece == null ? '—' : (v.ece * 100).toFixed(1) + ' points') + ' on average.</span>' : '<span class="sp-muted">' + escape(v.reason || 'Not enough past games to check yet.') + '</span>') +
        (v.status !== 'validated' && v.test_n && v.reason ? '<span class="sp-muted">Why experimental: ' + escape(v.reason) + '.</span>' : '') + '</li>';
    }).join('');
    const links = (M.links || []).filter((l) => l.test_pairs > 0 || l.status === 'validated');
    const linkRows = links.length ? '<p class="sp-label">Same-game links</p><ul class="sp-model-list">' + links.map((l) => {
      const bc = l.both_cleared || {};
      return '<li><div class="sp-model-head"><b>' + escape(linkName(l.stats, l.relation)) + '</b>' + qualityBadge(l.status) + '</div><span>Link ' + signedLink(l.link) + '. ' +
        (l.test_pairs ? Number(l.test_pairs).toLocaleString('en-US') + ' later pairs: both cleared ' + pct(bc.observed) + ', link said ' + pct(bc.copula) + ', unrelated said ' + pct(bc.independent) + '.' : '') + '</span>' +
        (l.status !== 'validated' && l.reason ? '<span class="sp-muted">Why experimental: ' + escape(l.reason) + '.</span>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    return '<div class="sp-source sp-model"><h3>Model check</h3><ul class="sp-model-list">' + rows + '</ul>' + linkRows +
      '<p class="sp-note">Each stat is forecast from games before the day it was played, then scored on the later games it never saw. To pass it needs 300+ games, a better score than both simple baselines, and chances off by 3 points or less. Past lines are not stored, so each check uses the player’s last-10 average as a stand-in line. Fitted on ' +
      escape((M.seasons || []).map((y) => (lgOf(src) === 'nba' ? y + '–' + String(y + 1).slice(2) : y)).join(', ') || 'stored seasons') + ' · ' + escape(M.model_version) + '.</p></div>';
  }

  function statList(stats) {
    return '<div class="sp-stats"><h3>Stats for picks</h3><ul>' + stats.map((st) =>
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
        return '<tr><td><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button>' + (p.out_last_game ? ' <span class="sp-out">out last game</span>' : '') + '</td><td>' + escape(p.position || '') + '</td>' +
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
    const F = P.forecast, G = P.next_game;
    let forecast = '';
    if (G && F) {
      const fr = P.stats.map((st) => {
        const f = F.forecasts[st] || {};
        if (f.status !== 'ok') return '<tr><td>' + escape(label(st)) + '</td><td colspan="3" class="sp-muted">' + escape(modelReason(f, lg)) + '</td></tr>';
        return '<tr><td>' + escape(label(st)) + ' ' + qualityBadge(f.quality) + '</td><td class="sp-n"><b>' + escape(Number(f.mean).toFixed(1)) + '</b></td><td class="sp-n">' + escape(f.low) + ' – ' + escape(f.high) + '</td><td class="sp-lines">' +
          (f.lines || []).map((x) => '<span>' + escape(x.threshold) + ' <b>' + pct(x.over) + '</b></span>').join('') + '</td></tr>';
      }).join('');
      const any = P.stats.map((st) => F.forecasts[st]).find((f) => f && f.status === 'ok');
      forecast = '<h5>Model forecast for the next game</h5><p class="sp-muted sp-fc-game">' + (F.home ? 'vs ' : '@ ') + team(F.opponent) + ' · ' + escape(fmtWhen(G.start_utc, zone())) + '</p>' +
        '<div class="sp-table-wrap"><table class="sp-table sp-fc" data-nosort><thead><tr><th>Stat</th><th class="sp-n">Expected</th><th class="sp-n">80% range</th><th>Chance of the over at each line</th></tr></thead><tbody>' + fr + '</tbody></table></div>' +
        (any ? '<p class="sp-note">Built from ' + escape(any.games) + ' stored games: about ' + escape(any.expected_opportunity) + ' ' + escape(any.unit) + ' expected' + (any.regular_role ? '' : ' (a smaller role than the check covers, so it stays experimental)') +
          ', opponent factor ' + escape(any.opponent_factor) + ', ' + (F.home ? 'home' : 'away') + '. Model fitted on games through ' + escape(any.as_of_date ? fmtDay(any.as_of_date) + ' ' + any.as_of_date.slice(0, 4) : '—') + '. A forecast, not a promise: injuries, rest and role changes are not in the data.</p>' : '');
    } else if (G) forecast = '<h5>Model forecast for the next game</h5><p class="sp-muted">The model has not been fitted yet.</p>';
    const log = P.games.length ? '<div class="sp-table-wrap"><table class="sp-table sp-log"><thead><tr><th>Date</th><th>Game</th>' + (lg === 'nba' ? '<th class="sp-n">Min</th>' : '') +
      logCols.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') + '</tr></thead><tbody>' +
      P.games.map((r) => '<tr' + (r.played ? '' : ' class="sp-dnp"') + '><td>' + escape(fmtDay(r.date)) + ' <span class="sp-muted">' + escape(String(r.date).slice(0, 4)) + '</span></td><td>' + (r.home ? 'vs ' : '@ ') + team(r.opponent) +
        (r.week != null ? ' <span class="sp-muted">' + (r.season_type === 'POST' ? 'playoffs' : 'wk ' + escape(r.week)) + '</span>' : '') + (r.played ? '' : ' <span class="sp-muted">did not play' + (r.dnp_reason ? ': ' + escape(String(r.dnp_reason).toLowerCase()) : '') + '</span>') + '</td>' +
        (lg === 'nba' ? '<td class="sp-n">' + num(r.minutes) + '</td>' : '') +
        logCols.map((st) => '<td class="sp-n">' + num(r.stats[st]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'
      : '<p class="sp-muted">No games stored for this player.</p>';
    return '<div class="sp-panel" data-sp-panel="player"><div class="sp-panel-head"><h4>' + escape(P.player.name) + ' <span>' + escape([P.player.position, P.player.team ? String(P.player.team).toUpperCase() : null].filter(Boolean).join(' · ')) + '</span></h4>' +
      '<button type="button" class="sp-close" data-sp-close="player" aria-label="Close player">×</button></div>' +
      forecast + '<h5>Add a pick</h5>' + pickFormHtml(lg, P, 'league') +
      '<h5>Averages over ' + num(P.total_games) + ' stored games</h5>' + summary +
      '<h5>Game log' + (P.total_games > P.games.length ? ' (latest ' + P.games.length + ')' : '') + '</h5>' + log +
      '<p class="sp-note">' + (lg === 'nba'
        ? 'Games the player missed are listed as did not play and left out of the averages.'
        : 'Games where the player recorded no stat are not in the provider’s file, so they are missing here, not counted as zero.') + '</p></div>';
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
        : 'The daily hoopR job has not written its first records yet.'));
    return dayStrip(s) + '<div class="sp-grid"><div class="sp-board"><h3>Games</h3>' + board + '</div>' +
      '<aside class="sp-side">' + sourceCard(src, tz) + modelCard(src) + statList(s.stats[lg] || []) + '</aside></div>' +
      '<p class="sp-foot">Private research for the two owners. No sportsbook is connected, nothing is placed, and no AI model is called by this page.</p>';
  }

  // ---- Pick Builder: draft ---------------------------------------------------
  function blankDraft(keep) {
    return { legs: [], operator: (keep && keep.operator) || 'prizepicks', format: (keep && keep.format) || 'power', stake: keep && keep.stake > 0 ? keep.stake : 10, payouts: {}, note: '' };
  }
  function draft() {
    if (state.draft) return state.draft;
    let d = null;
    try { d = JSON.parse(host.sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) {}
    state.draft = d && Array.isArray(d.legs) ? Object.assign(blankDraft(), d, { legs: d.legs.slice(0, MAX_PICKS), payouts: d.payouts && typeof d.payouts === 'object' ? d.payouts : {} }) : blankDraft();
    return state.draft;
  }
  function saveDraft() {
    try { host.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft())); } catch (_) {}
  }
  // A shared link (?entry=...) from Claude or ChatGPT replaces the draft once,
  // then leaves the address bar. It never carries chances.
  function applyPrefill() {
    let raw = null;
    try { raw = new URLSearchParams(host.location.search).get('entry'); } catch (_) {}
    if (!raw) return;
    try {
      const u = new URL(host.location.href);
      u.searchParams.delete('entry');
      host.history.replaceState(host.history.state, '', u.pathname + u.search + u.hash);
    } catch (_) {}
    const decoded = options.decodePrefill ? options.decodePrefill(raw) : null;
    if (!decoded) { pb.prefill = 'bad'; return; }
    const d = blankDraft(draft());
    if (decoded.operator) d.operator = decoded.operator;
    d.format = decoded.format;
    if (decoded.stake) d.stake = decoded.stake;
    d.payouts = decoded.payouts;
    d.legs = decoded.legs.map((l) => Object.assign({}, l, { probability: null, probability_source: null }));
    state.draft = d;
    saveDraft();
    pb.prefill = 'ok'; pb.evaluation = null; pb.msg = null;
  }
  function draftBody() {
    const d = draft(), n = d.legs.length, payouts = {};
    Object.keys(d.payouts || {}).forEach((k) => {
      const v = d.payouts[k];
      if (v === '' || v == null) return;
      if (d.format === 'power' ? Number(k) === n : Number(k) <= n) payouts[k] = Number(v);
    });
    return {
      legs: d.legs.map((l) => ({ sport: l.sport, player_id: l.player_id, game_id: l.game_id, stat: l.stat, side: l.side, threshold: l.threshold, probability: l.probability, probability_source: l.probability_source })),
      operator: d.operator, format: d.format, stake: d.stake, payouts, note: d.note,
    };
  }
  function money(v) { return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function signedMoney(v) { return (v > 0 ? '+$' : v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  function pct(p) { return p == null ? '—' : (p * 100).toFixed(p > 0 && p < 0.1 ? 2 : 1) + '%'; }
  function joinList(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
  function sideWord(side) { return side === 'under' ? 'under' : 'over'; }
  function matchupText(m) { const p = String(m || '').split('@'); return p.length === 2 ? team(p[0]) + ' at ' + team(p[1]) : escape(m || ''); }

  // ---- Pick Builder: adding a pick -------------------------------------------
  // One form for both places a pick starts: a player on the NBA / NFL page, or
  // the Pick Builder's own player search. A pick attaches to the team's next
  // stored game that has not started.
  function pickFormHtml(sport, P, where) {
    const g = P.next_game, name = P.player.name;
    if (!g) return '<p class="sp-muted">No upcoming game is stored for ' + escape(name) + '’s team yet, so a pick cannot be attached.</p>';
    const stats = ((state.status && state.status.stats[sport]) || []).filter((st) => st.enabled);
    return '<div class="sp-pickform" data-sp-pickform="' + escape(where) + '">' +
      '<p class="sp-pick-game">Next game: ' + team(g.away_team) + ' at ' + team(g.home_team) + ' · ' + (g.time_tbd ? escape(fmtDay(g.local_date)) + ', time TBD' : escape(fmtWhen(g.start_utc, zone()))) + '</p>' +
      '<div class="sp-pick-row">' +
      '<label class="sp-field"><span>Stat</span><select name="stat">' + stats.map((st) => '<option value="' + escape(st.id) + '">' + escape(st.label) + '</option>').join('') + '</select></label>' +
      '<label class="sp-field"><span>Side</span><select name="side"><option value="over">Over</option><option value="under">Under</option></select></label>' +
      '<label class="sp-field sp-line-field"><span>Line</span><input name="line" type="number" min="0" max="1000" step="0.5" inputmode="decimal" placeholder="24.5"></label>' +
      '<button type="button" class="sp-btn" data-sp-addpick>' + (where === 'league' ? 'Add to Pick Builder' : 'Add to entry') + '</button></div>' +
      '<p class="sp-pick-msg" data-sp-pick-msg aria-live="polite"></p></div>';
  }
  function addPickFrom(form, P, sport) {
    const msg = form.querySelector('[data-sp-pick-msg]');
    const say = (html, bad) => { if (msg) { msg.innerHTML = html; msg.className = 'sp-pick-msg' + (bad ? ' sp-bad' : ''); } };
    const g = P && P.next_game;
    if (!g) return false;
    const stat = form.querySelector('[name="stat"]').value, side = form.querySelector('[name="side"]').value;
    const lineRaw = form.querySelector('[name="line"]').value, line = Number(lineRaw);
    if (lineRaw === '' || !Number.isFinite(line) || line < 0 || line > 1000 || Math.round(line * 2) !== line * 2) { say('Enter the line as a whole or half number, like 24.5.', true); return false; }
    const d = draft();
    if (d.legs.length >= MAX_PICKS) { say('An entry has at most 6 picks.', true); return false; }
    const clash = d.legs.find((l) => l.sport === sport && l.player_id === P.player.player_id && l.stat === stat);
    if (clash) { say('That player and stat is already in the entry.', true); return false; }
    d.legs.push({
      sport, player_id: P.player.player_id, player_name: P.player.name, team: P.player.team || null,
      game_id: g.game_id, matchup: g.away_team + '@' + g.home_team, game_start_utc: g.start_utc,
      stat, side, threshold: line, probability: null, probability_source: null,
    });
    d.payouts = {};
    saveDraft();
    form.querySelector('[name="line"]').value = '';
    const n = d.legs.length;
    say(where(form) === 'league'
      ? 'Added. The entry has ' + n + ' pick' + (n === 1 ? '' : 's') + '. <button type="button" class="sp-link" data-sp-goto="' + BUILDER + '">Open Pick Builder</button>'
      : 'Added as pick ' + n + '.');
    return true;
  }
  function where(form) { return form.getAttribute('data-sp-pickform'); }

  function addHtml() {
    const A = pb.add;
    return '<div class="sp-add"><div class="sp-add-row">' +
      '<label class="sp-field"><span>League</span><select data-sp-add-sport><option value="nba"' + (A.sport === 'nba' ? ' selected' : '') + '>NBA</option><option value="nfl"' + (A.sport === 'nfl' ? ' selected' : '') + '>NFL</option></select></label>' +
      '<label class="sp-find"><span>Player</span><input type="search" data-sp-add-search autocomplete="off" spellcheck="false" placeholder="Name, at least 2 letters" value="' + escape(A.query) + '"></label></div>' +
      '<div data-sp-part="add-results" aria-live="polite">' + addResultsHtml() + '</div>' +
      '<div data-sp-part="add-form">' + addFormHtml() + '</div></div>';
  }
  function addResultsHtml() {
    const A = pb.add;
    if (A.searchErr) return errorBox(A.searchErr, 'add-search');
    if (!A.results) return '';
    if (!A.results.players.length) return '<p class="sp-muted">No stored player matches “' + escape(A.query) + '”.</p>';
    return '<ul class="sp-results">' + A.results.players.map((p) =>
      '<li><button type="button" class="sp-link" data-sp-add-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button> <span class="sp-muted">' +
      escape([p.position, p.team ? String(p.team).toUpperCase() : null].filter(Boolean).join(' · ')) + '</span></li>').join('') + '</ul>';
  }
  function addFormHtml() {
    const A = pb.add;
    if (!A.playerId) return '';
    if (A.playerErr) return errorBox(A.playerErr, 'add-player');
    if (!A.player) return '<p class="sp-loading">Loading player…</p>';
    return '<div class="sp-add-pick"><h4>' + escape(A.player.player.name) + ' <span>' + escape([A.player.player.position, A.player.player.team ? String(A.player.player.team).toUpperCase() : null].filter(Boolean).join(' · ')) + '</span></h4>' +
      pickFormHtml(A.sport, A.player, 'builder') + '</div>';
  }
  let addTimer = null;
  function addSearch(q) {
    const A = pb.add;
    A.query = q;
    host.clearTimeout(addTimer);
    if (q.trim().length < 2) { A.results = null; A.searchErr = null; paint(BUILDER, 'add-results', ''); return; }
    const sport = A.sport;
    addTimer = host.setTimeout(() => {
      api('players', { sport, q }).then((data) => { if (A.query === q && A.sport === sport) { A.results = data; A.searchErr = null; } }, (err) => { if (A.query === q) A.searchErr = err; })
        .then(() => { if (state.page === BUILDER && A.query === q) paint(BUILDER, 'add-results', addResultsHtml()); });
    }, 250);
  }
  function addOpenPlayer(id) {
    const A = pb.add, sport = A.sport;
    A.playerId = id; A.player = null; A.playerErr = null; A.results = null;
    paint(BUILDER, 'add-results', ''); paint(BUILDER, 'add-form', addFormHtml());
    api('player', { sport, id }).then((data) => { if (A.playerId === id) A.player = data; }, (err) => { if (A.playerId === id) A.playerErr = err; })
      .then(() => { if (state.page === BUILDER && A.playerId === id) paint(BUILDER, 'add-form', addFormHtml()); });
  }

  // ---- Pick Builder: the entry ---------------------------------------------------
  function evalLeg(i) {
    const ev = pb.evaluation, l = draft().legs[i], e = ev && ev.legs && ev.legs[i];
    return e && l && e.player_id === l.player_id && e.game_id === l.game_id && e.stat === l.stat && e.side === l.side && Number(e.threshold) === Number(l.threshold) ? e : null;
  }
  // A history rate can be copied only from 5+ games and only when it is not
  // 0% or 100%: a tiny or one-sided sample is shown, never offered as a chance.
  const MIN_RATE_GAMES = 5;
  function rateOf(c) {
    if (!c || c.games < MIN_RATE_GAMES || c.hits === 0 || c.hits === c.games) return null;
    return Math.min(99, Math.max(1, Math.round((c.hits / c.games) * 100)));
  }
  function modelReason(m, lg) {
    const r = m && m.reason;
    if (r === 'too_few_games') return 'Model: fewer than 5 stored games with this stat.';
    if (r === 'position') return 'Model: ' + (lg === 'nfl' ? 'passing yards are modeled for quarterbacks, receptions for receivers, tight ends and running backs.' : 'not modeled for this player.');
    if (r === 'team') return 'Model: the player is not on either team in this game by the stored logs.';
    if (r === 'no_model') return 'Model: not fitted yet.';
    return 'Model: no forecast for this pick.';
  }
  function modelLineHtml(i, e) {
    const m = e.model;
    if (!m || m.status !== 'ok') return '<span class="sp-model-line sp-muted">' + escape(modelReason(m, e.sport)) + '</span>';
    const S = m.sensitivity || {};
    const push = m.push > 0 ? ' · push ' + pct(m.push) : '';
    return '<span class="sp-model-line">Model: <b>' + pct(m.probability) + '</b> ' + sideWord(e.side) + ' ' + escape(e.threshold) + push + ' ' + qualityBadge(m.quality) +
      ' · expects ' + escape(Number(m.mean).toFixed(1)) + ' (80% range ' + escape(m.low) + '–' + escape(m.high) + ') on ' + escape(m.expected_opportunity) + ' ' + escape(m.unit) +
      ' · ' + escape(m.unit) + ' 10% lower: ' + pct(S.opportunity_down_10) + ', 10% higher: ' + pct(S.opportunity_up_10) + '</span>' +
      (m.probability > 0.005 && m.probability < 0.995 ? '<span class="sp-hist-use"><button type="button" class="sp-chip" data-sp-usemodel="' + i + '" data-prob="' + escape(m.probability) + '">Use ' + Math.round(m.probability * 100) + '% (model)</button></span>' : '');
  }
  function histHtml(i) {
    const e = evalLeg(i);
    if (!e) return pb.evalErr ? '' : '<span class="sp-muted">Checking history…</span>';
    const h = e.history;
    if (!h.all.games) return '<span class="sp-muted">No stored games before this one.</span>' + modelLineHtml(i, e);
    const c = (name, x) => name + ' <b>' + x.hits + '/' + x.games + '</b>';
    const pushes = h.all.pushes ? ' <span class="sp-muted">(' + h.all.pushes + ' push' + (h.all.pushes === 1 ? '' : 'es') + ')</span>' : '';
    const use = (key, name) => { const r = rateOf(h[key]); return r == null ? '' : '<button type="button" class="sp-chip" data-sp-usehist="' + i + '" data-rate="' + r + '">Use ' + r + '% (' + name + ')</button>'; };
    const uses = use('last10', 'last 10') + use('all', 'all stored');
    return '<span class="sp-hist-line">Cleared ' + sideWord(e.side) + ' ' + escape(e.threshold) + ' before this game: ' + c('last 5', h.last5) + ' · ' + c('last 10', h.last10) + ' · ' + c('all stored', h.all) + pushes + '</span>' +
      (uses ? '<span class="sp-hist-use">' + uses + '</span>' : h.all.games < MIN_RATE_GAMES ? '<span class="sp-muted">Too few games to copy a rate.</span>' : '') + modelLineHtml(i, e);
  }
  const SOURCE_TEXT = { history: 'from history', model: 'from model', owner: 'typed' };
  function legHtml(l, i) {
    const nameShown = l.player_name || l.player_id;
    return '<li class="sp-leg" data-sp-leg="' + i + '"><div class="sp-leg-head"><span class="sp-leg-name"><i>' + (i + 1) + '</i>' + escape(nameShown) +
      (l.team ? ' <span>' + team(l.team) + '</span>' : '') + '</span>' +
      '<button type="button" class="sp-close" data-sp-remove="' + i + '" aria-label="Remove pick ' + (i + 1) + '">×</button></div>' +
      '<p class="sp-leg-game">' + escape(String(l.sport).toUpperCase()) + ' · ' + (l.matchup ? matchupText(l.matchup) : 'game ' + escape(l.game_id)) + (l.game_start_utc ? ' · ' + escape(fmtWhen(l.game_start_utc, zone())) : '') + '</p>' +
      '<div class="sp-leg-line"><span class="sp-leg-stat">' + escape(label(l.stat)) + '</span>' +
      '<select data-sp-leg-side aria-label="Over or under for pick ' + (i + 1) + '"><option value="over"' + (l.side === 'over' ? ' selected' : '') + '>Over</option><option value="under"' + (l.side === 'under' ? ' selected' : '') + '>Under</option></select>' +
      '<input data-sp-leg-line type="number" min="0" max="1000" step="0.5" inputmode="decimal" value="' + escape(l.threshold) + '" aria-label="Line for pick ' + (i + 1) + '">' +
      '<label class="sp-chance"><span>Your chance</span><input data-sp-leg-chance type="number" min="1" max="99" step="1" inputmode="numeric" value="' + (l.probability != null ? Math.round(l.probability * 100) : '') + '" aria-label="Your chance for pick ' + (i + 1) + ', percent"><i>%</i></label>' +
      '<span class="sp-src" data-sp-src>' + (SOURCE_TEXT[l.probability_source] || (l.probability != null ? 'typed' : '')) + '</span></div>' +
      '<div class="sp-hist" data-sp-hist="' + i + '">' + histHtml(i) + '</div></li>';
  }
  function legsHtml() {
    const d = draft();
    const banner = pb.prefill === 'ok' ? '<p class="sp-banner">Filled in from a shared link. Check every pick, line and payout against your app before saving.</p>'
      : pb.prefill === 'bad' ? '<p class="sp-banner sp-bad">The shared link could not be read, so nothing was filled in.</p>' : '';
    if (!d.legs.length) return banner + emptyBox('No picks yet.', 'Add 1 to 6 picks below, or from a player on the NBA and NFL pages.');
    return banner + '<ol class="sp-legs">' + d.legs.map(legHtml).join('') + '</ol>' + '<div data-sp-part="use-all">' + useAllHtml() + '</div>' +
      '<p class="sp-note">History rates show how often the player cleared this line in stored games; they ignore minutes, opponent and role. The model reads minutes or targets, the opponent and home or away, and is checked on past games (see the Model check on the NBA and NFL pages). Neither knows about injuries or news. The chance you enter is yours.</p>';
  }
  function useAllHtml() {
    const d = draft(), ready = d.legs.filter((l, i) => { const e = evalLeg(i); return e && e.model && e.model.status === 'ok'; }).length;
    return ready > 1 ? '<button type="button" class="sp-btn" data-sp-usemodel-all>Use the model’s chance for ' + (ready === d.legs.length ? 'every pick' : 'the ' + ready + ' picks it covers') + '</button>' : '';
  }
  function settingsHtml() {
    const d = draft();
    const opt = (v, text, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + text + '</option>';
    return '<div class="sp-settings">' +
      '<label class="sp-field"><span>App</span><select data-sp-operator>' + Object.keys(OPERATOR_NAMES).map((k) => opt(k, OPERATOR_NAMES[k], d.operator)).join('') + '</select></label>' +
      '<label class="sp-field"><span>Entry type</span><select data-sp-format>' + opt('power', 'Power: every pick must hit', d.format) + opt('flex', 'Flex: pays with some misses', d.format) + '</select></label>' +
      '<label class="sp-field"><span>Paper stake</span><span class="sp-money"><i>$</i><input data-sp-stake type="number" min="0.01" max="100000" step="0.01" inputmode="decimal" value="' + escape(d.stake) + '"></span></label></div>';
  }
  function payoutsHtml() {
    const d = draft(), n = d.legs.length;
    if (!n) return '';
    const ks = d.format === 'power' ? [n] : [n, n - 1, n - 2].filter((k) => k >= 1);
    return '<div class="sp-payouts"><p class="sp-label">Payout from your app</p><div class="sp-payout-row">' + ks.map((k) =>
      '<label class="sp-field"><span>' + (n === 1 ? 'Pick hits' : k === n ? 'All ' + n + ' hit' : k + ' of ' + n + ' hit') + '</span><span class="sp-money"><input data-sp-payout="' + k + '" type="number" min="0" max="100000" step="0.01" inputmode="decimal" value="' + escape(d.payouts[k] ?? '') + '"><i>×</i></span></label>').join('') + '</div>' +
      '<p class="sp-note">Type the multiplier your app shows for this exact entry, stake included (3× on $10 pays back $30).' + (d.format === 'flex' ? ' Leave a row empty if it pays nothing.' : '') + ' Payouts clear when the picks or entry type change.</p></div>';
  }
  function evalHtml() {
    const d = draft();
    if (!d.legs.length) return '';
    if (pb.evalErr) {
      const text = pb.evalErr.code === 'auth' ? 'Your Owner session has ended.' : pb.evalErr.detail || 'The entry could not be checked.';
      return '<div class="sp-eval sp-eval-bad"><b>' + escape(text) + '</b>' + (pb.evalErr.detail ? '' : ' <button type="button" class="sp-retry" data-sp-retry="evaluate">Try again</button>') + '</div>';
    }
    const ev = pb.evaluation;
    if (!ev) return '<div class="sp-eval"><p class="sp-muted">Checking the entry…</p></div>';
    const E = ev.evaluation, n = ev.legs.length, warn = [];
    ev.warnings.forEach((w) => warn.push(escape(w) + '.'));
    if (ev.locked) warn.push('A game in this entry has started. Paper picks are saved before the games.');
    ev.same_game.forEach((g) => warn.push('Picks ' + joinList(g.legs.map((i) => String(i + 1))) + ' are from the same game. Their results move together, so ' +
      (E.status === 'joint_estimate' ? 'they are priced with how such picks moved together in past games (below).' : 'they are priced only when every pair has a measured link.')));
    const be = E.breakeven_probability != null ? '<p>Breakeven: all ' + n + ' must hit together at least <b>' + pct(E.breakeven_probability) + '</b> of the time to pay back the stake on average.</p>' : '';
    let body = '';
    if (E.status === 'needs_payout') {
      const first = String(E.problems[0] || '');
      body = '<p><b>' + escape(first.charAt(0).toUpperCase() + first.slice(1)) + '.</b></p>' + be;
    } else if (E.status === 'not_calculated') {
      body = be + '<p class="sp-muted">No chance of all of them hitting is shown. ' + escape(E.detail || 'Picks from one game need a measured link between them.') + '</p>';
    } else if (E.status === 'needs_probabilities') {
      body = be + '<p class="sp-muted">Enter your chance for every pick to see the expected value.</p>';
    } else if (E.status === 'joint_estimate') {
      body = jointHtml(ev, E, n);
    } else {
      const tile = (name, value, sub) => '<div class="sp-tile"><span>' + name + '</span><b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
      const tiles = [
        tile('All ' + n + ' hit', pct(E.joint_probability), 'if the picks are independent'),
        tile('Possible range', pct(E.bounds.low) + ' – ' + pct(E.bounds.high), 'under any link between picks'),
        E.breakeven_probability != null ? tile('Breakeven', pct(E.breakeven_probability), 'all ' + n + ' hit') : '',
        tile('Expected back', money(E.expected_gross), 'on ' + money(ev.stake) + ' paper'),
        tile('Expected profit', '<span class="' + (E.expected_net > 0 ? 'sp-pos' : E.expected_net < 0 ? 'sp-neg' : '') + '">' + signedMoney(E.expected_net) + '</span>', (E.expected_roi > 0 ? '+' : '') + (E.expected_roi * 100).toFixed(1) + '% return'),
      ].join('');
      const dist = ev.format === 'flex' ? '<p class="sp-dist">Chance of each result: ' + E.distribution.map((p, k) => ({ p, k })).reverse().map((x) => x.k + ' hit ' + pct(x.p)).join(' · ') + '</p>' : '';
      const fromHistory = ev.legs.some((l) => l.probability_source === 'history');
      body = '<div class="sp-tiles">' + tiles + '</div>' + dist +
        '<p class="sp-note">Independence baseline: it assumes no pick affects another, using the chances entered above' + (fromHistory ? ' (some copied from history rates)' : '') + '. A starting point, not a forecast.</p>';
    }
    return '<div class="sp-eval">' + (warn.length ? '<ul class="sp-warn">' + warn.map((w) => '<li>' + w + '</li>').join('') + '</ul>' : '') + body + '</div>';
  }
  // Same-game estimate: the measured links between picks from one game,
  // priced with the chances entered above (lib/sports/joint.mjs).
  const RELATION_TEXT = { same_player: 'one player', teammate: 'teammates', opponent: 'opponents' };
  function linkName(stats, relation) {
    return (stats[0] === stats[1] ? label(stats[0]) : label(stats[0]) + ' and ' + label(stats[1]).toLowerCase()) + ', ' + RELATION_TEXT[relation];
  }
  const signedLink = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
  function jointHtml(ev, E, n) {
    const tile = (name, value, sub) => '<div class="sp-tile"><span>' + name + '</span><b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    const netRange = E.expected_net_range ? signedMoney(E.expected_net_range.low) + ' to ' + signedMoney(E.expected_net_range.high) + ' across the range' : null;
    const tiles = [
      tile('All ' + n + ' hit', pct(E.joint_probability), 'same-game estimate ' + qualityBadge(E.quality)),
      tile('Range', pct(E.range.low) + ' – ' + pct(E.range.high), 'from how sure each link is'),
      tile('If unrelated', pct(E.independent_probability), 'chances multiplied'),
      E.breakeven_probability != null ? tile('Breakeven', pct(E.breakeven_probability), 'all ' + n + ' hit') : '',
      tile('Expected back', money(E.expected_gross), 'on ' + money(ev.stake) + ' paper'),
      tile('Expected profit', '<span class="' + (E.expected_net > 0 ? 'sp-pos' : E.expected_net < 0 ? 'sp-neg' : '') + '">' + signedMoney(E.expected_net) + '</span>', netRange || ((E.expected_roi > 0 ? '+' : '') + (E.expected_roi * 100).toFixed(1) + '% return')),
    ].join('');
    const dist = ev.format === 'flex' ? '<p class="sp-dist">Chance of each result: ' + E.distribution.map((p, k) => ({ p, k })).reverse().map((x) => x.k + ' hit ' + pct(x.p)).join(' · ') + '</p>' : '';
    const links = '<ul class="sp-links">' + E.links.map((l) => '<li><b>Picks ' + (l.legs[0] + 1) + ' and ' + (l.legs[1] + 1) + '</b><span>' + escape(linkName(l.stats, l.relation)) + '</span>' +
      '<span class="sp-link-val">link ' + signedLink(l.link) + ' <i>(95%: ' + signedLink(l.low) + ' to ' + signedLink(l.high) + ')</i></span>' + qualityBadge(l.status) + '</li>').join('') + '</ul>';
    const why = E.quality === 'validated' ? '' : '<p class="sp-muted">Experimental: ' + escape(E.quality_reason || 'a link has not passed its check') + '.</p>';
    return '<div class="sp-tiles">' + tiles + '</div>' + dist + '<p class="sp-label">How these picks moved together in past games</p>' + links + why +
      '<p class="sp-note">The link runs from −1 to +1: above 0 means the two results went up and down together, 0 means unrelated. It is measured on the model’s misses in stored games (' + escape(E.as_of_date ? 'through ' + fmtDay(E.as_of_date) + ' ' + E.as_of_date.slice(0, 4) : 'stored seasons') +
      ') and applied to the chances entered above, in ' + Number(E.simulation.draws).toLocaleString('en-US') + ' simulated games (seed ' + escape(E.simulation.seed) + ').' + (E.simulation.adjusted ? ' The links did not fit together exactly, so they were pulled slightly toward 0.' : '') + ' Picks from different games are treated as unrelated.</p>';
  }
  function canSave() {
    const ev = pb.evaluation;
    return !pb.saving && draft().legs.length > 0 && !!ev && !pb.evalErr && ev.evaluation.status !== 'needs_payout' && !ev.locked;
  }
  function saveHtml() {
    const d = draft();
    return '<div class="sp-save"' + (d.legs.length ? '' : ' hidden') + '><label class="sp-field sp-note-field"><span>Note (optional)</span><input data-sp-note maxlength="500" value="' + escape(d.note) + '" placeholder="Why this entry"></label>' +
      '<div class="sp-save-row"><button type="button" class="sp-btn sp-btn-primary" data-sp-save' + (canSave() ? '' : ' disabled') + '>' + (pb.saving ? 'Saving…' : 'Save paper pick') + '</button>' +
      '<button type="button" class="sp-btn" data-sp-clear>Clear entry</button></div></div>';
  }
  function saveMsgHtml() {
    return pb.msg ? '<p class="sp-pick-msg' + (pb.msg.ok ? '' : ' sp-bad') + '">' + escape(pb.msg.text) + '</p>' : '';
  }
  function paintEntry() {
    paint(BUILDER, 'legs', legsHtml());
    paint(BUILDER, 'payouts', payoutsHtml());
    paint(BUILDER, 'eval', evalHtml());
    paint(BUILDER, 'save', saveHtml());
    paint(BUILDER, 'save-msg', saveMsgHtml());
  }
  // After a check: refresh the parts that do not hold the cursor. The picks
  // list is repainted only when a pick from a shared link gets its name.
  function paintChecked(namesFilled) {
    if (namesFilled) paint(BUILDER, 'legs', legsHtml());
    else {
      draft().legs.forEach((_, i) => { const el = root(BUILDER)?.querySelector('[data-sp-hist="' + i + '"]'); if (el) el.innerHTML = histHtml(i); });
      paint(BUILDER, 'use-all', useAllHtml());
    }
    paint(BUILDER, 'eval', evalHtml());
    const btn = root(BUILDER)?.querySelector('[data-sp-save]');
    if (btn) btn.disabled = !canSave();
  }
  function scheduleEval(delay) {
    host.clearTimeout(pb.evalTimer);
    pb.evaluation = null;
    const btn = root(BUILDER)?.querySelector('[data-sp-save]');
    if (btn) btn.disabled = true;
    pb.evalTimer = host.setTimeout(runEval, delay == null ? 350 : delay);
  }
  function runEval() {
    const d = draft(), seq = ++pb.evalSeq;
    pb.evalErr = null;
    if (!d.legs.length) { pb.evaluation = null; if (state.page === BUILDER) paintChecked(false); return; }
    api('evaluate', null, draftBody()).then((data) => {
      if (seq !== pb.evalSeq) return;
      pb.evaluation = data;
      let filled = false;
      data.legs.forEach((e, i) => {
        const l = d.legs[i];
        if (l && l.player_id === e.player_id && l.game_id === e.game_id && !l.player_name) {
          Object.assign(l, { player_name: e.player_name, team: e.team, matchup: e.matchup, game_start_utc: e.game_start_utc });
          filled = true;
        }
      });
      if (filled) saveDraft();
      if (state.page === BUILDER) paintChecked(filled);
    }, (err) => {
      if (seq !== pb.evalSeq) return;
      pb.evaluation = null; pb.evalErr = err;
      if (state.page === BUILDER) paintChecked(false);
    });
  }
  function saveEntry() {
    if (!canSave()) return;
    pb.saving = true; pb.msg = null;
    paint(BUILDER, 'save', saveHtml()); paint(BUILDER, 'save-msg', '');
    api('save-entry', null, draftBody()).then(() => {
      state.draft = blankDraft(draft());
      saveDraft();
      pb.evaluation = null; pb.prefill = null;
      pb.msg = { ok: true, text: 'Saved to the paper journal. It is graded from the final stats after the games.' };
      loadJournal();
    }, (err) => {
      pb.msg = { ok: false, text: err.code === 'auth' ? 'Your Owner session has ended. Sign in again, then save.' : err.detail || 'The entry could not be saved. Try again.' };
    }).then(() => {
      pb.saving = false;
      if (state.page === BUILDER) paintEntry();
    });
  }

  // ---- Pick Builder: paper journal ------------------------------------------------
  const RESULT_TEXT = { win: 'Hit', loss: 'Missed', push: 'Push', void: 'Void' };
  const OUTCOME_TEXT = { win: 'Won', loss: 'Lost', partial: 'Partly paid', refund: 'Stake back' };
  function payoutText(e) {
    const n = e.legs.length;
    const keys = Object.keys(e.payouts).map(Number).sort((a, b) => b - a);
    return keys.map((k) => escape(e.payouts[k]) + '× ' + (k === n ? (n === 1 ? 'if it hits' : 'all ' + n + ' hit') : k + ' of ' + n)).join(' · ');
  }
  function legResultHtml(l) {
    if (l.result) {
      const actual = l.actual != null ? ' · ' + escape(l.actual) : '';
      const why = l.result === 'void' ? (l.game_status === 'final' ? ' · did not play' : ' · game ' + escape(l.game_status)) : '';
      return '<span class="sp-res sp-res-' + escape(l.result) + '">' + RESULT_TEXT[l.result] + actual + why + '</span>';
    }
    const started = Date.parse(l.game_start_utc) <= Date.now();
    return '<span class="sp-res">' + (started ? (l.sport === 'nfl' && l.game_status === 'final' ? 'No stat in the final file' : 'Waiting for the final stats') : 'Not started') + '</span>';
  }
  function badgeHtml(st) {
    if (st.state === 'settled') return '<span class="sp-badge sp-badge-' + escape(st.outcome) + '">' + escape(OUTCOME_TEXT[st.outcome] || st.outcome) + '</span>';
    const text = { pending: 'Open', review: 'Needs your payout', withdrawn: 'Withdrawn' }[st.state] || st.state;
    return '<span class="sp-badge sp-badge-' + escape(st.state) + '">' + escape(text) + '</span>';
  }
  function savedEvalText(E) {
    if (!E) return '';
    if (E.status === 'independence_baseline') return 'At save: ' + pct(E.joint_probability) + ' all hit (independence baseline), expected ' + signedMoney(E.expected_net) + '.';
    if (E.status === 'joint_estimate') return 'At save: ' + pct(E.joint_probability) + ' all hit (same-game estimate, ' + (E.quality === 'validated' ? 'passed the check' : 'experimental') + '), expected ' + signedMoney(E.expected_net) + '.';
    if (E.status === 'not_calculated') return 'At save: same-game picks, not priced.';
    if (E.status === 'needs_probabilities') return 'At save: no chances entered' + (E.breakeven_probability != null ? '; breakeven ' + pct(E.breakeven_probability) : '') + '.';
    return '';
  }
  function entryActionsHtml(e) {
    const id = e.entry_id, acts = e.actions || [], busy = pb.revising === id;
    let out = '';
    if (acts.indexOf('settle') >= 0) {
      out += pb.settleOpen === id
        ? '<div class="sp-settle"><label class="sp-field"><span>The app paid back</span><span class="sp-money"><i>$</i><input data-sp-settle-gross type="number" min="0" step="0.01" inputmode="decimal"></span></label>' +
          '<label class="sp-field"><span>Note (optional)</span><input data-sp-settle-note maxlength="300"></label>' +
          '<button type="button" class="sp-btn sp-btn-primary" data-sp-settle-save="' + escape(id) + '"' + (busy ? ' disabled' : '') + '>Save payout</button><button type="button" class="sp-btn" data-sp-settle-cancel>Cancel</button></div>'
        : '<button type="button" class="sp-btn" data-sp-settle="' + escape(id) + '">' + (e.settlement.manual ? 'Correct the payout' : 'Enter what the app paid') + '</button>';
    }
    if (acts.indexOf('withdraw') >= 0) {
      out += pb.confirmWithdraw === id
        ? '<span class="sp-confirm">Withdraw this entry? <button type="button" class="sp-btn" data-sp-withdraw-yes="' + escape(id) + '"' + (busy ? ' disabled' : '') + '>Withdraw</button><button type="button" class="sp-btn" data-sp-withdraw-no>Keep it</button></span>'
        : '<button type="button" class="sp-btn" data-sp-withdraw="' + escape(id) + '">Withdraw (saved by mistake)</button>';
    }
    const err = pb.reviseErr && pb.reviseErr.id === id ? '<p class="sp-pick-msg sp-bad">' + escape(pb.reviseErr.text) + '</p>' : '';
    return out || err ? '<div class="sp-entry-actions">' + out + '</div>' + err : '';
  }
  function entryCardHtml(e) {
    const st = e.settlement;
    const legs = e.legs.map((l) => '<li><span>' + escape(l.player_name || l.player_id) + ' · ' + escape(label(l.stat)) + ' ' + sideWord(l.side) + ' ' + escape(l.threshold) +
      ' <span class="sp-muted">' + matchupText(l.matchup) + (l.model && l.model.status === 'ok' ? ' · model ' + pct(l.model.probability) : '') + (l.probability != null ? ' · used ' + pct(l.probability) + (l.probability_source ? ' ' + escape(SOURCE_TEXT[l.probability_source] || '') : '') : '') + '</span></span>' + legResultHtml(l) + '</li>').join('');
    const money2 = st.state === 'settled' ? '<p class="sp-entry-money">Paid back ' + money(st.gross) + ' · <b class="' + (st.net > 0 ? 'sp-pos' : st.net < 0 ? 'sp-neg' : '') + '">' + signedMoney(st.net) + '</b>' + (st.manual ? ' <span class="sp-muted">entered by hand' + (st.note ? ': ' + escape(st.note) : '') + '</span>' : '') + '</p>'
      : st.state === 'review' ? '<p class="sp-entry-money">' + escape(st.reason || 'Enter what the app paid.') + '</p>' : '';
    return '<li class="sp-entry' + (st.state === 'withdrawn' ? ' is-withdrawn' : '') + '" data-sp-entry="' + escape(e.entry_id) + '"><div class="sp-entry-head"><span>' + escape(fmtWhen(e.created_utc, zone())) + ' · ' + escape(OPERATOR_NAMES[e.operator] || e.operator) + ' · ' + (e.format === 'flex' ? 'Flex' : 'Power') + ' · ' + money(e.stake) + ' paper</span>' + badgeHtml(st) + '</div>' +
      '<p class="sp-entry-pay">' + payoutText(e) + '</p><ul class="sp-entry-legs">' + legs + '</ul>' + money2 +
      (savedEvalText(e.evaluation) ? '<p class="sp-note">' + escape(savedEvalText(e.evaluation)) + '</p>' : '') +
      (e.note ? '<p class="sp-entry-note">' + escape(e.note) + '</p>' : '') +
      (e.mine ? '' : '<p class="sp-muted">Saved by the other owner.</p>') + entryActionsHtml(e) + '</li>';
  }
  function journalHtml() {
    if (pb.journalErr) return errorBox(pb.journalErr, 'journal');
    if (!pb.journal) return '<p class="sp-loading">Loading the journal…</p>';
    const J = pb.journal, S = J.summary;
    if (!J.entries.length) return emptyBox('No paper picks saved yet.', 'Saved entries are graded here from the final stats.');
    const tile = (name, value, sub) => '<div class="sp-tile"><span>' + name + '</span><b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    const tiles = '<div class="sp-tiles">' +
      tile('Entries', escape(S.entries), S.pending + ' open' + (S.review ? ', ' + S.review + ' need a payout' : '')) +
      tile('Settled', escape(S.settled), S.wins + ' won') +
      tile('Paper profit', '<span class="' + (S.net > 0 ? 'sp-pos' : S.net < 0 ? 'sp-neg' : '') + '">' + signedMoney(S.net) + '</span>', S.roi == null ? 'nothing settled yet' : (S.roi > 0 ? '+' : '') + (S.roi * 100).toFixed(1) + '% on ' + money(S.staked)) +
      (S.priced_settled ? tile('Expected at save', signedMoney(S.expected_net_settled), 'on the ' + S.priced_settled + ' settled entr' + (S.priced_settled === 1 ? 'y' : 'ies') + ' with chances') : '') + '</div>';
    const C = J.calibration || {};
    const check = (name, x) => x && x.picks ? '<li><b>' + name + '</b> ' + x.picks + ' settled pick' + (x.picks === 1 ? '' : 's') + ': average chance ' + pct(x.mean_chance) + ', hit ' + pct(x.hit_rate) + ', score ' + x.brier.toFixed(3) + '</li>' : '';
    const calib = check('Model chances', C.model) + check('Chances used', C.used);
    const calibHtml = calib ? '<ul class="sp-calib">' + calib + '</ul><p class="sp-note">Score is the average squared miss (lower is better; always guessing 50% scores 0.250). Pushes and voids are left out. A few dozen picks say little.</p>' : '';
    const shown = pb.journalAll ? J.entries : J.entries.slice(0, 30);
    return tiles + calibHtml + '<ul class="sp-entries">' + shown.map(entryCardHtml).join('') + '</ul>' +
      (shown.length < J.entries.length ? '<button type="button" class="sp-btn" data-sp-journal-all>Show all ' + J.entries.length + ' entries</button>' : '');
  }
  function loadJournal() {
    pb.journalErr = null;
    api('journal').then((data) => { pb.journal = data; }, (err) => { pb.journalErr = err; })
      .then(() => { if (state.page === BUILDER) paint(BUILDER, 'journal', journalHtml()); });
  }
  function revise(body) {
    pb.revising = body.entry_id; pb.reviseErr = null;
    paint(BUILDER, 'journal', journalHtml());
    api('revise-entry', null, body).then(() => {
      pb.settleOpen = null; pb.confirmWithdraw = null;
      loadJournal();
    }, (err) => {
      pb.reviseErr = { id: body.entry_id, text: err.code === 'auth' ? 'Your Owner session has ended.' : err.detail || 'That could not be saved. Try again.' };
    }).then(() => { pb.revising = null; if (state.page === BUILDER) paint(BUILDER, 'journal', journalHtml()); });
  }

  function builderHtml(s) {
    const steps = [
      ['Add picks', 'Add 1 to 6 player picks here or from a player on the NBA and NFL pages: stat, over or under, and the line.'],
      ['Enter the payout', 'Type the payout your app shows for this exact entry, power or flex. The site never guesses one.'],
      ['Check the odds', 'Each pick shows how often the player cleared the line before and the model’s chance. Enter your own chance or copy one to see the expected value; picks from one game are flagged.'],
      ['Save a paper pick', 'Save before the games start. The journal grades it from the final stats.'],
      ['Screenshots', 'Send a slip screenshot to Claude or ChatGPT; it can open this page with the picks filled in for you to check and save.'],
    ];
    return dayStrip(s) + '<div class="sp-grid"><div class="sp-board">' +
      '<h3>Add a pick</h3><div data-sp-part="add">' + addHtml() + '</div>' +
      '<h3 class="sp-gap">Entry</h3><div data-sp-part="legs">' + legsHtml() + '</div>' + settingsHtml() +
      '<div data-sp-part="payouts">' + payoutsHtml() + '</div>' +
      '<div data-sp-part="eval" aria-live="polite">' + evalHtml() + '</div>' +
      '<div data-sp-part="save">' + saveHtml() + '</div><div data-sp-part="save-msg" aria-live="polite">' + saveMsgHtml() + '</div></div>' +
      '<aside class="sp-side"><h3>How it works</h3><ol class="sp-steps">' + steps.map((st) => '<li><b>' + escape(st[0]) + '</b><span>' + escape(st[1]) + '</span></li>').join('') + '</ol></aside></div>' +
      '<section class="sp-journal"><h3>Paper journal</h3><div data-sp-part="journal" aria-live="polite">' + journalHtml() + '</div></section>' +
      '<p class="sp-foot">Paper picks only. No sportsbook login, no API, no automatic bets and no AI model is called by this page.</p>';
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
      const t = event.target;
      if (t.closest('[data-sp-zone]')) {
        saveZone(t.value);
        state.status = null;
        Object.keys(state.leagues).forEach((k) => { state.leagues[k].board = null; });
        load(page, true);
        return;
      }
      if (page !== BUILDER) return;
      const d = draft();
      const legEl = t.closest('[data-sp-leg]');
      if (t.matches('[data-sp-leg-side]') && legEl) {
        const l = d.legs[Number(legEl.getAttribute('data-sp-leg'))];
        if (l) { l.side = t.value; clearChance(legEl, l); saveDraft(); scheduleEval(); }
      } else if (t.matches('[data-sp-operator]')) { d.operator = t.value; saveDraft(); scheduleEval(); }
      else if (t.matches('[data-sp-format]')) { d.format = t.value; d.payouts = {}; saveDraft(); paint(BUILDER, 'payouts', payoutsHtml()); scheduleEval(); }
      else if (t.matches('[data-sp-add-sport]')) {
        const A = pb.add;
        A.sport = t.value; A.results = null; A.playerId = null; A.player = null;
        paint(BUILDER, 'add-results', ''); paint(BUILDER, 'add-form', '');
        if (A.query.trim().length >= 2) addSearch(A.query);
      }
    });
    el.addEventListener('input', (event) => {
      const t = event.target;
      const box = t.closest('[data-sp-search]');
      if (box && lg) { search(page, lg, box.value); return; }
      if (page !== BUILDER) return;
      const d = draft();
      const legEl = t.closest('[data-sp-leg]');
      const l = legEl ? d.legs[Number(legEl.getAttribute('data-sp-leg'))] : null;
      if (t.matches('[data-sp-add-search]')) addSearch(t.value);
      else if (t.matches('[data-sp-leg-line]') && l) { l.threshold = t.value === '' ? '' : Number(t.value); clearChance(legEl, l); saveDraft(); scheduleEval(); }
      else if (t.matches('[data-sp-leg-chance]') && l) {
        const v = Number(t.value);
        l.probability = t.value !== '' && v >= 1 && v <= 99 ? Math.round(v) / 100 : null;
        l.probability_source = l.probability == null ? null : 'owner';
        const src = legEl.querySelector('[data-sp-src]');
        if (src) src.textContent = l.probability == null ? '' : 'typed';
        saveDraft(); scheduleEval();
      } else if (t.matches('[data-sp-stake]')) { d.stake = t.value === '' ? null : Number(t.value); saveDraft(); scheduleEval(); }
      else if (t.matches('[data-sp-payout]')) { d.payouts[t.getAttribute('data-sp-payout')] = t.value === '' ? '' : Number(t.value); saveDraft(); scheduleEval(); }
      else if (t.matches('[data-sp-note]')) { d.note = t.value; saveDraft(); }
    });
    el.addEventListener('click', (event) => {
      const t = event.target;
      const retry = t.closest('[data-sp-retry]');
      if (retry) {
        const what = retry.getAttribute('data-sp-retry');
        const L = lg ? league(lg) : null;
        if (what === 'board' && L) { paint(page, 'board', '<p class="sp-loading">Loading games…</p>'); loadBoard(page, lg); }
        else if (what === 'game' && L) openGame(page, lg, L.gameId);
        else if (what === 'player' && L) openPlayer(page, lg, L.playerId);
        else if (what === 'search' && L) search(page, lg, L.query);
        else if (what === 'journal') { paint(BUILDER, 'journal', '<p class="sp-loading">Loading the journal…</p>'); loadJournal(); }
        else if (what === 'evaluate') scheduleEval(0);
        else if (what === 'add-search') addSearch(pb.add.query);
        else if (what === 'add-player') addOpenPlayer(pb.add.playerId);
        else load(page, true);
        return;
      }
      const goto = t.closest('[data-sp-goto]');
      if (goto) { if (options.go) options.go(goto.getAttribute('data-sp-goto')); return; }
      const addBtn = t.closest('[data-sp-addpick]');
      if (addBtn) {
        const form = addBtn.closest('[data-sp-pickform]');
        const fromBuilder = where(form) === 'builder';
        const P = fromBuilder ? pb.add.player : lg && league(lg).player;
        if (form && P && addPickFrom(form, P, fromBuilder ? pb.add.sport : lg) && fromBuilder) {
          pb.msg = null; pb.prefill = null;
          paintEntry(); scheduleEval(0);
        }
        return;
      }
      if (page === BUILDER) { builderClick(t); return; }
      const game = t.closest('[data-sp-game]');
      if (game && lg) { openGame(page, lg, game.getAttribute('data-sp-game')); return; }
      const player = t.closest('[data-sp-player]');
      if (player && lg) { openPlayer(page, lg, player.getAttribute('data-sp-player')); return; }
      const close = t.closest('[data-sp-close]');
      if (close && lg) {
        const L = league(lg);
        if (close.getAttribute('data-sp-close') === 'game') { L.gameId = null; L.game = null; paint(page, 'game', ''); paint(page, 'board', boardHtml(lg)); }
        else { L.playerId = null; L.player = null; paint(page, 'player', ''); }
      }
    });
  }
  function clearChance(legEl, l) {
    l.probability = null; l.probability_source = null;
    const input = legEl.querySelector('[data-sp-leg-chance]'), src = legEl.querySelector('[data-sp-src]');
    if (input) input.value = '';
    if (src) src.textContent = '';
  }
  // The model's own number is kept exactly, so the saved pick can say "from model".
  function useModel(i, p) {
    const l = draft().legs[i], legEl = root(BUILDER)?.querySelector('[data-sp-leg="' + i + '"]');
    if (!l || !(p > 0 && p < 1)) return;
    l.probability = p; l.probability_source = 'model';
    if (legEl) {
      legEl.querySelector('[data-sp-leg-chance]').value = String(Math.round(p * 100));
      legEl.querySelector('[data-sp-src]').textContent = SOURCE_TEXT.model;
    }
  }
  function builderClick(t) {
    const d = draft();
    const hit = (sel) => t.closest(sel);
    let b;
    if ((b = hit('[data-sp-add-player]'))) { addOpenPlayer(b.getAttribute('data-sp-add-player')); return; }
    if ((b = hit('[data-sp-remove]'))) {
      d.legs.splice(Number(b.getAttribute('data-sp-remove')), 1);
      d.payouts = {}; saveDraft(); pb.msg = null;
      paintEntry(); scheduleEval(0);
      return;
    }
    if ((b = hit('[data-sp-usehist]'))) {
      const legEl = b.closest('[data-sp-leg]'), l = d.legs[Number(b.getAttribute('data-sp-usehist'))];
      const r = Number(b.getAttribute('data-rate'));
      if (l && legEl && r >= 1 && r <= 99) {
        l.probability = r / 100; l.probability_source = 'history';
        legEl.querySelector('[data-sp-leg-chance]').value = String(r);
        legEl.querySelector('[data-sp-src]').textContent = 'from history';
        saveDraft(); scheduleEval(0);
      }
      return;
    }
    if ((b = hit('[data-sp-usemodel]'))) {
      const i = Number(b.getAttribute('data-sp-usemodel'));
      useModel(i, Number(b.getAttribute('data-prob')));
      saveDraft(); scheduleEval(0);
      return;
    }
    if (hit('[data-sp-usemodel-all]')) {
      d.legs.forEach((l, i) => { const e = evalLeg(i); if (e && e.model && e.model.status === 'ok') useModel(i, e.model.probability); });
      saveDraft(); scheduleEval(0);
      return;
    }
    if (hit('[data-sp-save]')) { saveEntry(); return; }
    if (hit('[data-sp-clear]')) {
      state.draft = blankDraft(d); saveDraft();
      pb.evaluation = null; pb.evalErr = null; pb.msg = null; pb.prefill = null; pb.evalSeq++;
      paintEntry();
      return;
    }
    if (hit('[data-sp-journal-all]')) { pb.journalAll = true; paint(BUILDER, 'journal', journalHtml()); return; }
    if ((b = hit('[data-sp-settle]'))) { pb.settleOpen = b.getAttribute('data-sp-settle'); pb.confirmWithdraw = null; pb.reviseErr = null; paint(BUILDER, 'journal', journalHtml()); const i = root(BUILDER)?.querySelector('[data-sp-settle-gross]'); if (i) i.focus(); return; }
    if (hit('[data-sp-settle-cancel]')) { pb.settleOpen = null; paint(BUILDER, 'journal', journalHtml()); return; }
    if ((b = hit('[data-sp-settle-save]'))) {
      const box = b.closest('.sp-settle');
      const gross = box.querySelector('[data-sp-settle-gross]').value, note = box.querySelector('[data-sp-settle-note]').value;
      if (gross === '' || !(Number(gross) >= 0)) { pb.reviseErr = { id: b.getAttribute('data-sp-settle-save'), text: 'Enter the total the app paid back, from $0.' }; paint(BUILDER, 'journal', journalHtml()); return; }
      revise({ entry_id: b.getAttribute('data-sp-settle-save'), action: 'settle', gross: Number(gross), note });
      return;
    }
    if ((b = hit('[data-sp-withdraw]'))) { pb.confirmWithdraw = b.getAttribute('data-sp-withdraw'); pb.settleOpen = null; pb.reviseErr = null; paint(BUILDER, 'journal', journalHtml()); return; }
    if (hit('[data-sp-withdraw-no]')) { pb.confirmWithdraw = null; paint(BUILDER, 'journal', journalHtml()); return; }
    if ((b = hit('[data-sp-withdraw-yes]'))) { revise({ entry_id: b.getAttribute('data-sp-withdraw-yes'), action: 'withdraw' }); }
  }

  function load(page, force) {
    state.page = page;
    bind(page);
    if (page === BUILDER && options.owner()) { applyPrefill(); pb.evaluation = null; pb.evalErr = null; }
    render(page);
    if (!options.owner()) return;
    fetchStatus(force).then((s) => {
      render(page);
      const lg = leagueOf(page);
      if (lg && s.sources[lg] && s.sources[lg].state !== 'not_connected' && (force || !league(lg).board)) loadBoard(page, lg);
      if (page === BUILDER) {
        loadJournal();
        if (draft().legs.length) scheduleEval(0);
      }
    }, () => render(page));
  }

  return { load };
}
