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
  const LOG_ROWS = 40;
  const OPERATOR_NAMES = { prizepicks: 'PrizePicks', betr: 'Betr', sportsbook: 'Sportsbook', kalshi: 'Kalshi', other: 'Other app' };
  // Apps that price each bet with odds (a parlay), not a pick'em payout table.
  const ODDS_APPS = ['sportsbook', 'kalshi'];
  const state = { status: null, pending: null, error: null, page: null, bound: {}, leagues: {}, draft: null };
  const pb = {
    evaluation: null, evalErr: null, evalSeq: 0, evalTimer: null, saving: false, msg: null, prefill: null,
    journal: null, journalErr: null, journalAll: false, settleOpen: null, confirmWithdraw: null, revising: null, reviseErr: null,
    add: { mode: 'player', sport: 'nba', query: '', results: null, searchErr: null, playerId: null, player: null, playerErr: null, msg: null,
      board: null, boardErr: null, boardSeq: 0, gameId: null, game: null, gameErr: null, gb: null, gbMsg: null },
  };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const leagueOf = (page) => page === 'sports-nba' ? 'nba' : page === 'sports-nfl' ? 'nfl' : null;
  const root = (page) => doc.getElementById(page + '-root');
  const part = (page, name) => root(page)?.querySelector('[data-sp-part="' + name + '"]') || null;
  // Stat names, short column heads and groups come from the one catalog in
  // lib/sports/schema.mjs (SPORTS_STATS), passed in by app-js.mjs.
  const CATALOG = (options && options.statCatalog) || {};
  const STAT_SETS = [['main', 'Main'], ['combo', 'Combos'], ['more', 'More']];
  const STAT_LABELS = { minutes: 'Minutes', team_margin: 'Team margin', team_points: 'Team points', game_total: 'Game total' }, SHORT = { minutes: 'Min' }, STAT_GROUP = { minutes: 'main' };
  Object.keys(CATALOG).forEach((lg) => (CATALOG[lg] || []).forEach((st) => { STAT_LABELS[st.id] = st.label; SHORT[st.id] = st.short; STAT_GROUP[st.id] = st.group; }));
  const statGroup = (st) => STAT_GROUP[st] || 'more';
  const inSet = (st, set) => set === 'all' || statGroup(st) === set;
  const SET_CHOICES = STAT_SETS.concat([['all', 'All']]);
  const label = (st) => STAT_LABELS[st] || st;
  const lgOf = (src) => (src && src.sport) || '';
  const team = (t) => escape(String(t || '').toUpperCase());
  const num = (v) => (v == null ? '—' : escape(String(v)));
  const league = (lg) => state.leagues[lg] || (state.leagues[lg] = {
    board: null, boardErr: null, game: null, gameId: null, gameErr: null, results: null, query: '', player: null, playerId: null, playerErr: null,
    props: null, propsErr: null, propsSeq: 0, boardSeq: 0, propsPending: false, propsTimer: null, propsMsg: '', propsNote: '', record: null, recordErr: null, recordSeq: 0,
    recordExportPending: false, recordExportErr: null, nbaPairs: {},
    view: 'games', gameStat: '', logAll: false, logSet: 'main',
    chart: { stat: null, n: 10, kind: 'bars', line: '' },
    leaders: { data: null, err: null, key: null, cache: {}, season: null, window: 'season', sort: null, dir: 'desc', team: '', group: '', min: null, all: false, mode: 'table', set: 'main' },
    teams: { data: null, err: null, key: null, cache: {}, season: null, stat: null, side: 'against', sort: 'win_pct', dir: 'desc', mode: 'table' },
  });

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
  function fmtClock(iso, tz) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso)); }
    catch (_) { return iso; }
  }
  function zone() { return state.status?.window?.time_zone || savedZone() || 'America/Los_Angeles'; }

  // The one request path. A body makes it a POST (Pick Builder); a refused
  // request carries the server's own short reason as err.detail.
  function api(op, params, body, binary) {
    let url = '/api/auth/me?sports=' + encodeURIComponent(op);
    Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') url += '&' + k + '=' + encodeURIComponent(params[k]); });
    const init = { credentials: 'same-origin', cache: 'no-store' };
    if (body) { init.method = 'POST'; init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return host.fetch(url, init).then((res) => {
      if (binary && res.ok) { if (!res.headers.get('content-type')?.includes('application/gzip')) throw new Error('Unexpected research download'); return res.blob(); }
      return res.json().catch(() => null).then((data) => {
      const reason = data && typeof data.error === 'string' ? data.error : '';
      if (res.status === 401 || (res.status === 403 && (!body || /unavailable for this session/.test(reason)))) throw Object.assign(new Error('signed-out'), { code: 'auth' });
      if (res.status === 404 && !body) throw Object.assign(new Error('not found'), { code: 'missing' });
      if (!res.ok) throw Object.assign(new Error(reason || 'HTTP ' + res.status), { status: res.status, detail: reason });
      if (!data || data.schema_version !== 1) throw new Error('Unexpected Sports response');
      return data;
    }); });
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

  function dayStrip(s, extra) {
    const w = s.window;
    return '<div class="sp-days" role="group" aria-label="Active days">' +
      '<span class="sp-day"><b>Today</b> ' + escape(fmtDay(w.today)) + '</span>' +
      '<span class="sp-day"><b>Tomorrow</b> ' + escape(fmtDay(w.tomorrow)) + '</span>' +
      zonePicker(s) + (extra || '') + '</div>';
  }

  // Compact status chip beside the active days; the full Data card sits
  // folded in the side column.
  const DATA_STATE_TEXT = { ok: 'Up to date', degraded: 'Partly updated', failed: 'Last update failed', unknown: 'Unknown', not_connected: 'Not connected yet' };
  function dataChip(src, tz) {
    if (!src) return '';
    const connected = src.state !== 'not_connected';
    const parts = [escape(DATA_STATE_TEXT[src.state] || 'Unknown')];
    if (src.seasons && src.seasons.length) parts.push(escape(src.seasons.map((y) => (lgOf(src) === 'nba' ? y + '–' + String(y + 1).slice(2) : y)).join(', ')) + ' seasons');
    if (src.latest_game_date) parts.push('latest game ' + escape(fmtDay(src.latest_game_date)));
    const title = connected ? 'Last good update ' + fmtWhen(src.last_success_utc, tz) : 'Not connected yet';
    return '<span class="sp-data-chip sp-state-' + escape(src.state) + '" title="' + escape(title) + '"><i aria-hidden="true"></i>' + parts.join(' · ') + '</span>';
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
    return '<details class="sp-source sp-source-fold"' + (src.state === 'ok' ? '' : ' open') + '><summary><h3>Data source</h3></summary><dl>' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>' +
      (src.message ? '<p class="sp-note">' + escape(src.message) + '</p>' : '') + '</details>';
  }

  // Calibration (reliability) chart: each dot is a band of forecasts, placed
  // at what the model said (across) against how often it happened (up). On
  // the diagonal = honest chances; dot size = games in the band.
  function reliabilitySvg(bins, name) {
    const pts = (bins || []).filter((b) => b && b.n > 0 && Number.isFinite(b.p) && Number.isFinite(b.y));
    if (pts.length < 2) return '';
    const S = 132, P = 16;
    const x = (v) => P + v * (S - 2 * P), y = (v) => S - P - v * (S - 2 * P);
    const maxN = Math.max(...pts.map((b) => b.n));
    const p1 = (v) => Math.round(v * 100) + '%';
    const hov = pts.map((b) => ({ x: x(b.p), y: y(b.y), label: 'Model said ' + p1(b.p) + '\nHappened ' + p1(b.y) + '\n' + Number(b.n).toLocaleString('en-US') + ' games' }));
    const grid = [0, 0.5, 1].map((t) => '<line class="sp-ch-grid" x1="' + x(0) + '" x2="' + x(1) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>').join('');
    const dots = pts.map((b) => {
      const r = 2.5 + 4.5 * Math.sqrt(b.n / maxN);
      const off = Math.abs(b.p - b.y);
      return '<circle class="sp-rel-dot' + (off > 0.05 ? ' is-off' : '') + '" cx="' + x(b.p).toFixed(1) + '" cy="' + y(b.y).toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    }).join('');
    return '<figure class="sp-rel"><svg class="sp-rel-svg" viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '" role="img" aria-label="' + escape(name + ' calibration: ' + pts.map((b) => 'said ' + p1(b.p) + ', happened ' + p1(b.y)).join('; ')) + '"' + hoverAttr(hov) + '>' +
      grid + '<line class="sp-rel-diag" x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(1) + '" y2="' + y(1) + '"/>' + dots +
      '<text class="sp-ch-axis" x="' + x(0) + '" y="' + (S - 3) + '">0%</text><text class="sp-ch-axis" x="' + x(1) + '" y="' + (S - 3) + '" text-anchor="end">Said 100%</text>' +
      '<text class="sp-ch-axis" x="2" y="' + (y(1) + 3) + '">100%</text></svg><figcaption>Dots on the line: the chances were honest.</figcaption></figure>';
  }
  const MODEL_STATUS = { validated: 'Passed the check', experimental: 'Experimental' };
  const qualityBadge = (q) => '<span class="sp-q sp-q-' + escape(q) + '">' + escape(MODEL_STATUS[q] || q) + '</span>';
  // The same held-out games scored at the PrizePicks line really posted
  // (stored from 2026-11-11 on). Counts toward passing at 300+.
  function realLinesHtml(r, b3) {
    if (!r || !r.n) return '';
    const B = r.brier || {};
    return '<span>At real PrizePicks lines: ' + Number(r.n).toLocaleString('en-US') + ' game' + (r.n === 1 ? '' : 's') + (r.enough ? '' : ' (counts toward passing at 300)') +
      '. Score: model <b>' + b3(B.model) + '</b>, last-10 hit rate ' + b3(B.last10_hit_rate) + ', coin flip ' + b3(B.even) + '.</span>';
  }
  // The game inputs each stat may use (sports-model-4): on only where they
  // beat leaving them out on later games.
  const FACTOR_NAME = { game_lines: 'Game spread and total', snap_trend: 'Snap share trend' };
  function factorsHtml(f, b3) {
    if (!f) return '';
    return Object.keys(f).filter((k) => FACTOR_NAME[k]).map((k) => {
      const x = f[k];
      return '<span class="sp-muted">' + FACTOR_NAME[k] + ': ' + (x.applied ? 'on. It beat leaving it out on later games' + (x.brier_with != null && x.brier_without != null ? ' (' + x.brier_with.toFixed(4) + ' with, ' + x.brier_without.toFixed(4) + ' without)' : '')
        : 'off; ' + escape(String(x.why || 'not tested yet').replace(/; not used$/, ''))) + '.</span>';
    }).join('');
  }
  function modelCard(src) {
    const M = src.model;
    if (!M) return src.state === 'not_connected' ? '' : '<div class="sp-source sp-model"><h3>Model check</h3><p class="sp-muted">The forecasts have not been fitted yet; the next daily data run fits them.</p></div>';
    const b3 = (x) => (x == null ? '—' : x.toFixed(3));
    // One folded row per stat: the verdict and score in the summary, the
    // detail and calibration chart inside (a dozen stats per league).
    const rows = Object.keys(M.stats).map((st) => {
      const v = M.stats[st], B = v.brier || {};
      const best = [B.last10_hit_rate, B.plain_average].filter((x) => x != null);
      const score = v.test_n && B.model != null ? '<span class="sp-model-score">' + b3(B.model) + (best.length ? ' <span class="sp-muted">vs ' + b3(Math.min(...best)) + '</span>' : '') + '</span>' : '';
      return '<li><details class="sp-model-stat" data-sp-model-stat="' + escape(st) + '"><summary><span class="sp-model-name">' + escape(label(st)) + '</span><span class="sp-model-verdict">' + score + qualityBadge(v.status) + '</span></summary><div class="sp-model-body">' +
        (v.test_n ? '<span>' + Number(v.test_n).toLocaleString('en-US') + ' later games held out' + (v.split_date ? ' (from ' + escape(fmtDay(v.split_date)) + ' ' + escape(v.split_date.slice(0, 4)) + ')' : '') +
          '. Score (lower is better): model <b>' + b3(B.model) + '</b>, last-10 hit rate ' + b3(B.last10_hit_rate) + ', plain average ' + b3(B.plain_average) +
          '. Chances off by ' + (v.ece == null ? '—' : (v.ece * 100).toFixed(1) + ' points') + ' on average.</span>' : '<span class="sp-muted">' + escape(v.reason || 'Not enough past games to check yet.') + '</span>') +
        (v.status !== 'validated' && v.test_n && v.reason ? '<span class="sp-muted">Why experimental: ' + escape(v.reason) + '.</span>' : '') +
        (v.recalibration ? '<span class="sp-muted">Recalibration: ' + (v.recalibration.applied ? 'on (it beat the raw chances on held-out games)' : 'off; ' + escape(v.recalibration.why || 'raw chances kept')) + '.</span>' : '') +
        (v.early_season && v.early_season.n >= 30 && v.early_season.bias != null ? '<span class="sp-muted">First games of a season (' + Number(v.early_season.n).toLocaleString('en-US') + ' held out): forecasts ran ' + escape(Math.abs(v.early_season.bias)) + (v.early_season.bias > 0 ? ' high' : ' low') + ' on average.</span>' : '') +
        (v.teammates_out ? '<span class="sp-muted">Teammates out: ' + (v.teammates_out.applied ? 'on. The forecast rises when regulars are listed Out or Doubtful (it beat no adjustment on held-out games)' : 'off; ' + escape(v.teammates_out.why || 'no lift measured')) + '.</span>' : '') +
        factorsHtml(v.factors, b3) +
        realLinesHtml(v.real_lines, b3) +
        reliabilitySvg(v.reliability, label(st)) + '</div></details></li>';
    }).join('');
    const passed = Object.values(M.stats).filter((v) => v.status === 'validated').length, total = Object.keys(M.stats).length;
    const links = (M.links || []).filter((l) => l.test_pairs > 0 || l.status === 'validated');
    const linksPassed = links.filter((l) => l.status === 'validated').length;
    // Same-game links: a count up front, the list folded (NBA measures 200+).
    const linkRows = links.length ? '<details class="sp-model-links"><summary>Same-game links: ' + linksPassed + ' of ' + links.length + ' passed</summary><ul class="sp-model-list">' + links.map((l) => {
      const bc = l.both_cleared || {};
      return '<li><div class="sp-model-head"><b>' + escape(linkName(l.stats, l.relation)) + '</b>' + qualityBadge(l.status) + '</div><span>Link ' + signedLink(l.link) + '. ' +
        (l.test_pairs ? Number(l.test_pairs).toLocaleString('en-US') + ' later pairs: both cleared ' + pct(bc.observed) + ', link said ' + pct(bc.copula) + ', unrelated said ' + pct(bc.independent) + '.' : '') + '</span>' +
        (l.status !== 'validated' && l.reason ? '<span class="sp-muted">Why experimental: ' + escape(l.reason) + '.</span>' : '') + '</li>';
    }).join('') + '</ul></details>' : '';
    return '<div class="sp-source sp-model"><h3>Model check</h3><p class="sp-model-tally">' + passed + ' of ' + total + ' stats passed. Tap a stat for its check; the score is the model’s against the better simple baseline (lower is better).</p><ul class="sp-model-list">' + rows + '</ul>' + linkRows +
      '<p class="sp-note">Each stat is forecast from games before the day it was played, then scored on the later games it never saw. To pass it needs 300+ games, a better score than both simple baselines, and chances off by 3 points or less. The check uses the player’s last-10 average as a stand-in line; since November 11, 2026 every PrizePicks line the props scan sees is also stored, and once 300 held-out games have a real line the model must beat both baselines there too. Fitted on ' +
      escape((M.seasons || []).map((y) => (lgOf(src) === 'nba' ? y + '–' + String(y + 1).slice(2) : y)).join(', ') || 'stored seasons') + ' · ' + escape(M.model_version) + '.</p></div>';
  }

  function statList(stats) {
    return '<div class="sp-stats"><h3>Stats</h3>' + STAT_SETS.map(([g, name]) => {
      const list = stats.filter((st) => st.group === g);
      return list.length ? '<p class="sp-label">' + escape(name) + '</p><ul>' + list.map((st) =>
        '<li class="' + (st.model ? 'sp-on' : '') + '">' + escape(st.label) + (st.model ? ' <span>forecast</span>' : '') + '</li>').join('') + '</ul>' : '';
    }).join('') + '<p class="sp-note">Every stat has averages, charts, hit rates and the Pick Builder. The marked ones also get a model forecast; the rest are history only.</p></div>';
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
    const week = g.week != null ? (g.season_type === 'POST' ? 'Playoffs' : 'Week ' + escape(g.week)) : '';
    return '<span class="sp-muted">' + [week, boardLines(g.game_lines), teamWinHtml(g)].filter(Boolean).join(' · ') + '</span>';
  }
  // "SEA −6.5 · O/U 40.5" on an upcoming game's row.
  function boardLines(gl) {
    if (!gl || !isFinite(gl.total)) return '';
    const m = Math.abs(gl.home_margin);
    return '<span class="sp-glines" title="Spread and total (' + escape(gl.source === 'nflverse' ? 'nflverse' : 'sportsbooks’ median') + ')">' + (gl.favorite ? team(gl.favorite) + ' −' + escape(m) : 'PK') + ' · O/U ' + escape(gl.total) + '</span>';
  }
  const nbaPct = (p) => p == null ? '—' : (p * 100).toFixed(1) + '%';
  function nbaComparisonHtml(p) {
    const M = p.market, R = p.role;
    if (!M) return '';
    const american = (n) => n > 0 ? '+' + n : String(n);
    const rows = (M.books || []).map((b) => { const q = b.lower_quote, opposite = b.upper_quote;
      return '<tr><td>' + escape(b.book) + '</td><td>' + num(q.threshold) + (opposite && opposite.threshold !== q.threshold ? '–' + num(opposite.threshold) : '') + '</td><td>' + escape(american(q.sides.over.price)) + ' / ' + escape(american(q.sides.under.price)) + '</td><td>' + (b.method === 'exact' ? '' : '≥') + nbaPct(b.low) + '</td><td>' + escape(fmtTime(q.observed_utc, zone())) + (q.sides.over.book_updated_at ? '<br>Book: ' + escape(fmtTime(q.sides.over.book_updated_at, zone())) : '') + '</td></tr>'; }).join('');
    return '<h4>Sportsbook comparison</h4><p class="sp-note">' + escape(M.reason || M.note) + '</p>' +
      (M.movement?.watch ? '<p class="sp-note"><b>Repricing watch:</b> ' + M.movement.later_operators + ' reference operators changed their price after this PrizePicks selection. ' + escape(M.movement.note) + '</p>' : '') +
      (rows ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Book</th><th>Ref. line</th><th>More / Less price</th><th>Fair ' + (p.side === 'over' ? 'More' : 'Less') + '</th><th>Received</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
      (R?.projected_minutes != null ? '<h4>Minutes & role scenario</h4><p>' + num(R.projected_minutes) + ' minutes; historical range ' + num(R.minutes_range.low) + '–' + num(R.minutes_range.high) + '. Scenario ' + escape(label(p.stat).toLowerCase()) + ': ' + num(R.scenario_stat_mean) + '.</p><p class="sp-note">Usage ' + num(R.usage_pct) + '% · possessions proxy: team ' + num(R.possessions_proxy?.team) + ', opponent ' + num(R.possessions_proxy?.opponent) + '.</p><p class="sp-note">' + escape(R.note) + ' Starting lineup unconfirmed.</p>' +
        R.absence_splits.map((a) => '<p class="sp-note">' + escape(a.name) + ' out: ' + a.observed_without_games + ' measured DNP games; ' + num(a.without_minutes) + ' player minutes in that split.</p>').join('') : '');
  }
  function nbaPairHtml(G, P) {
    const L = league('nba'), d = L.nbaPairs[G.game_id] || (L.nbaPairs[G.game_id] = { value: '', seq: 0 });
    if (d.snapshot !== G.research_snapshot_id) { d.snapshot = G.research_snapshot_id; d.result = null; d.error = null; d.seq++; d.pending = false; }
    const S = d.result?.screen || G.pair, enabled = P.research_tracking?.state === 'ok' && G.research_snapshot_id && G.picks.length === 2;
    const stateName = S?.state === 'positive_screen' ? 'Experimental screen passes' : S?.state === 'payout_needed' ? 'Research pair · payout needed' : 'Pass · no verified edge';
    return '<section class="sp-nba-pair" data-sp-pair-game="' + escape(G.game_id) + '"><h4>' + stateName + '</h4><p class="sp-note">' + escape(S?.reason || 'Not enough market evidence.') + '</p>' +
      (S?.low != null ? '<p>Pair estimate range: <b>' + nbaPct(S.low) + '–' + nbaPct(S.high) + '</b>. ' + (S.method === 'copula_sensitivity' ? 'Includes measured same-game links.' : 'Uses bounds without assuming independent outcomes.') + '</p>' : '') +
      '<p class="sp-note">Market estimates and role scenarios are experimental. Quote ranges are not confidence intervals. Enter the actual total payout shown for these two players; no payout is assumed.</p>' +
      '<label>Actual 2-pick total payout (×) <input type="number" min="1.01" max="100" step="0.01" inputmode="decimal" data-sp-nba-payout="' + escape(G.game_id) + '" placeholder="e.g. 3" value="' + escape(d.value) + '"></label>' +
      '<p><button type="button" class="sp-btn" data-sp-nba-evaluate="' + escape(G.game_id) + '"' + (!enabled || d.pending ? ' disabled' : '') + '>Evaluate pair</button> <button type="button" class="sp-btn" data-sp-nba-save="' + escape(G.game_id) + '"' + (!enabled || d.pending || G.paper_pair_saved || d.result?.saved ? ' disabled' : '') + '>Save paper pair</button></p>' +
      '<div data-sp-pair-result role="status">' + (d.error ? '<p>' + escape(d.error) + '</p>' : d.result ? '<p>Entered payout ' + num(S.payout_multiplier) + '×; break-even ' + nbaPct(S.breakeven_probability) + '. Estimated net return: ' + nbaPct(S.return_per_unit.low) + ' to ' + nbaPct(S.return_per_unit.high) + '.</p>' : '') +
      (G.paper_pair_saved || d.result?.saved ? '<p>Paper pair saved' + (G.paper_pair_payout != null ? ' at ' + num(G.paper_pair_payout) + '×' : '') + '. Its original players, line and entered payout stay fixed.</p>' : '') + '</div>' +
      (!enabled ? '<p class="sp-note">' + escape(P.research_tracking?.message || 'Complete evidence is not ready for pair evaluation.') + '</p>' : '<p><button type="button" class="sp-link" data-sp-nba-export="' + escape(G.game_id) + '" data-sp-nba-season="' + G.season + '">Download complete research</button></p>') + '</section>';
  }
  function evaluateNBAPair(page, gameId, save) {
    const L = league('nba'), G = L.props?.games.find((g) => g.game_id === gameId), d = L.nbaPairs[gameId];
    if (!G || !d || d.pending) return;
    const snapshot = G.research_snapshot_id, seq = ++d.seq; d.pending = true; d.error = null;
    const repaint = () => { if (state.page === page && L.view === 'games') paint(page, 'board', boardHtml('nba')); };
    repaint();
    api('nba-pair', null, { sport: 'nba', game_id: gameId, season: G.season, snapshot_id: snapshot, payout_multiplier: d.value === '' ? null : Number(d.value), save })
      .then((data) => { if (d.seq === seq && L.props?.games.find((g) => g.game_id === gameId)?.research_snapshot_id === snapshot) { d.result = data; if (data.saved) { G.paper_pair_saved = true; G.paper_pair_payout = data.entry?.payout_multiplier; L.record = null; } } },
        (err) => { if (d.seq === seq) d.error = err.detail || 'Pair evaluation could not be completed.'; })
      .then(() => { if (d.seq === seq) { d.pending = false; repaint(); } });
  }
  async function exportNBAResearch(page, gameId, season) {
    const L = league('nba');
    try {
      const blob = await api('nba-research', { sport: 'nba', id: gameId, season }, null, true);
      if (!options.owner()) return;
      const url = host.URL.createObjectURL(blob), a = doc.createElement('a'); a.href = url; a.download = 'nba-research-' + gameId + '.json.gz'; a.click(); host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
    } catch (err) { L.propsMsg = err.message; L.recordExportErr = err.message; if (state.page === page) paint(page, 'view', viewHtml('nba')); }
  }
  function propsHeader(lg) {
    const L = league(lg), P = L.props;
    const refresh = '<button type="button" class="sp-link" data-sp-props-refresh data-own-feedback' + (L.propsPending ? ' disabled aria-busy="true"' : '') + '>' + (L.propsPending ? 'Refreshing lines & injuries…' : 'Refresh lines & injuries') + '</button>' +
      (L.propsNote && !L.propsPending ? ' <span class="sp-note" role="status">' + escape(L.propsNote) + '</span>' : '');
    if (L.propsErr) return '<div class="sp-props-status">The prop analysis could not be loaded. ' + refresh + '</div>';
    if (!P) return '<div class="sp-props-status">Checking PrizePicks lines and player availability… ' + refresh + '</div>';
    const S = P.sources;
    return '<div class="sp-props-status"><b>' + (lg === 'nba' ? 'NBA market research · one player from each team' : 'Best 2 player props per game') + '</b><p>' +
      (S.lines.state === 'ok' ? escape(S.lines.count + ' current standard selections checked · lines read ' + fmtClock(S.lines.fetched_utc || P.generated_utc, zone())) : escape(S.lines.message || 'Line feed unavailable.')) + '</p>' +
      '<p><a href="https://prop-line.com/odds-api/book/prizepicks" target="_blank" rel="noopener noreferrer">PrizePicks via PropLine</a> · <a href="https://www.espn.com/' + lg + '/injuries" target="_blank" rel="noopener noreferrer">ESPN injuries</a>' +
      (S.injuries.observed_utc ? ' · report ' + escape(fmtTime(S.injuries.observed_utc, zone())) : ' · injury report unavailable') + '</p>' + refresh +
      (lg === 'nba' ? '<p class="sp-note">' + escape(S.reference?.state === 'ok' ? S.reference.count + ' fresh two-way reference quotes checked. At least three operators are needed per prop.' : S.reference?.message || 'Sportsbook comparisons unavailable; research only.') + '</p>' : '') +
      '<p class="sp-note">' + (lg === 'nba' ? 'NBA candidates compare PrizePicks with sportsbook prices and current role context. The estimates are experimental. ' : 'Ranks combine recent form, workload, opponent defense, splits, rest and availability. A rank score is not a win chance. ') + 'Each pair needs one player from each team; uncovered slots stay open. Refreshes every 2 minutes while this page is visible.</p>' +
      '<p class="sp-note">' + escape(P.tracking?.state === 'ok' ? 'Track record saves the first pair per game. Live rankings can change; the recorded lines and reasoning stay fixed.' : P.tracking?.message || 'Recording status unavailable.') + ' <button type="button" class="sp-link" data-sp-view="record">View prop track record</button></p>' +
      (L.propsMsg ? '<p role="status">' + escape(L.propsMsg) + ' <button type="button" class="sp-link" data-sp-goto="' + BUILDER + '">Open Pick Builder</button></p>' : '') + '</div>';
  }
  function propsForGame(lg, g) {
    const L = league(lg), P = L.props;
    if (g.status !== 'scheduled' || Date.parse(g.start_utc) <= Date.now()) return '';
    if (L.propsErr) return '<p class="sp-prop-empty">Prop analysis unavailable.</p>';
    if (!P) return '<p class="sp-prop-empty">Checking props…</p>';
    if (Date.parse(P.expires_utc) <= Date.now()) return '<p class="sp-prop-empty">This analysis expired. Refresh lines and injuries.</p>';
    const G = P.games.find((v) => v.game_id === g.game_id);
    if (!G) return '<p class="sp-prop-empty">No analysis for this game yet.</p>';
    const picks = (G.picks || []).map((p, i) => '<article class="sp-prop"><div class="sp-prop-title"><span class="sp-prop-number">' + (i + 1) + '</span><div><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.player_name) + '</button>' +
      '<strong>' + (p.side === 'over' ? 'More' : 'Less') + ' than ' + num(p.threshold) + ' ' + escape(label(p.stat).toLowerCase()) + '</strong></div><span class="sp-prop-score">' + (lg === 'nba' && p.market?.low != null ? 'Market ≥' + nbaPct(p.market.low) : 'Rank ' + num(p.rank_score) + '/100') + '<small>' + (lg === 'nba' ? (p.market?.book_count || 0) + ' books · estimate' : p.basis === 'model_and_history' ? 'Model + history' : 'History only') + '</small></span></div>' +
      '<p class="sp-note">' + team(p.team) + ' vs ' + team(p.opponent) + ' · cleared ' + p.last10.hits + '/' + p.last10.games + ' last 10 · line checked ' + escape(fmtTime(p.observed_utc, zone())) + '</p>' +
      '<details><summary>Why this pick</summary>' + (lg === 'nba' ? nbaComparisonHtml(p) : '') + '<dl>' + p.evidence.map((e) => '<dt>' + escape(e.label) + '</dt><dd>' + escape(e.text) + '</dd>').join('') + '</dl><p class="sp-note">History through ' + escape(p.latest_game_date) + '. ' + (p.model ? 'Model through ' + escape(p.model.as_of_date) + '.' : 'This stat has no current fitted forecast; the rank uses historical evidence.') + '</p></details>' +
      '<button type="button" class="sp-btn" data-sp-prop-add="' + escape(g.game_id) + '" data-sp-prop-index="' + i + '">Add to Pick Builder</button></article>').join('');
    const availability = (G.availability || []).length ? '<details class="sp-prop-injuries"><summary>Players in / out & injury reports (' + G.availability.length + ')</summary><ul>' + G.availability.map((p) => '<li><b>' + escape(p.name) + '</b> · ' + team(p.team) + ' · ' + escape(p.status) + '<p>' + escape(p.detail) + (p.report_utc ? ' (' + escape(fmtWhen(p.report_utc, zone())) + ')' : '') + '</p></li>').join('') + '</ul></details>' : '';
    return '<div class="sp-props">' + picks + (lg === 'nba' ? nbaPairHtml(G, P) : '') + (G.message ? '<p class="sp-prop-empty">' + escape(G.message) + '</p>' : '') + availability +
      (picks ? '<p class="sp-note">Individual picks. Same-game outcomes are linked; use Pick Builder to evaluate an entry with its actual payout.</p>' : '') + '</div>';
  }
  function gameRow(g, tz, selected, lg) {
    return '<li><button type="button" class="sp-game' + (selected ? ' is-on' : '') + '" data-sp-game="' + escape(g.game_id) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
      '<span class="sp-time">' + (g.time_tbd ? 'Time TBD' : escape(fmtTime(g.start_utc, tz))) + '</span>' +
      '<span class="sp-match">' + team(g.away_team) + ' <i>at</i> ' + team(g.home_team) + '</span>' +
      '<span class="sp-gstat">' + gameStatus(g, tz) + '</span></button>' + propsForGame(lg, g) + '</li>';
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
    return propsHeader(lg) + groups.map(([day, name]) => {
      const list = games.filter((g) => g.day === day);
      return '<div class="sp-day-group"><h4>' + name + ' <span>' + escape(fmtDay(L.board.window[day])) + '</span></h4>' +
        (list.length ? '<ul class="sp-games">' + list.map((g) => gameRow(g, tz, g.game_id === L.gameId, lg)).join('') + '</ul>' : '<p class="sp-muted sp-none">No games.</p>') + '</div>';
    }).join('');
  }

  // ---- One game ----------------------------------------------------------
  function gamePanelHtml(lg) {
    const L = league(lg);
    if (!L.gameId) return '';
    if (L.gameErr) return errorBox(L.gameErr, 'game');
    if (!L.game) return '<p class="sp-loading">Loading players…</p>';
    const g = L.game.game;
    const all = (L.game.stats || []).concat(L.game.context_stats || []);
    const pick = all.indexOf(L.gameStat) >= 0 ? L.gameStat : '';
    const teams = [g.away_team, g.home_team].map((t) => {
      const info = L.game.teams[t] || { players: [] };
      const opp = t === g.home_team ? g.away_team : g.home_team;
      // Every NBA player's main stat is points: name it once in the team
      // heading instead of a column, so the table fits beside the board.
      const mains = info.players.map((p) => p.main_stat).filter((st, i, a) => a.indexOf(st) === i);
      const one = !pick && mains.length === 1 ? mains[0] : '';
      const statCol = !pick && !one;
      const rows = info.players.map((p) => {
        const st = pick || p.main_stat, s = p.summaries[st] || {}, vs = p.vs_opp;
        const vsCell = vs && vs.values && vs.values[st] != null
          ? '<td class="sp-n" title="' + escape(label(st) + ' against ' + String(opp).toUpperCase() + ', ' + vs.games + ' game' + (vs.games === 1 ? '' : 's') + ' this season and last') + '">' + num(vs.values[st]) + ' <small class="sp-muted">' + vs.games + 'g</small></td>'
          : '<td class="sp-n sp-muted">—</td>';
        return '<tr><td class="sp-pl"><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button>' + (p.out_last_game ? ' <span class="sp-out">out last game</span>' : '') + '</td><td>' + escape(p.position || '') + '</td>' +
          (statCol ? '<td>' + escape(SHORT[st] || st) + '</td>' : '') + '<td class="sp-spark-cell">' + sparkSvg((p.recent || {})[st], p.name + ' ' + label(st).toLowerCase() + ', last ' + ((p.recent || {})[st] || []).length + ' games') + '</td>' +
          '<td class="sp-n">' + num(s.last5) + '</td><td class="sp-n">' + num(s.last10) + '</td><td class="sp-n">' + num(s.average) + '</td>' + vsCell + '<td class="sp-n">' + num(s.high) + '</td><td class="sp-n">' + num(s.games) + '</td></tr>';
      }).join('');
      return '<div class="sp-team"><h5>' + team(t) + (t === g.home_team ? ' <span>home</span>' : '') + (one && rows ? ' <span>· ' + escape(label(one).toLowerCase()) + '</span>' : '') + '</h5>' +
        (rows ? '<div class="sp-table-wrap"><table class="sp-table sp-game-table" data-ts-key="sp-game-' + escape(lg) + '"><thead><tr><th>Player</th><th>Pos</th>' + (statCol ? '<th>Stat</th>' : '') + '<th data-nosort>Last 10 games</th><th class="sp-n">Last 5</th><th class="sp-n">Last 10</th><th class="sp-n">Season</th><th class="sp-n" title="Average against ' + team(opp) + ' this season and last, with games played">vs ' + team(opp) + '</th><th class="sp-n">High</th><th class="sp-n" title="Games played this season before this game">GP</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="sp-muted">No player games stored for this team this season.</p>') + '</div>';
    }).join('');
    return '<div class="sp-panel" data-sp-panel="game"><div class="sp-panel-head"><h4>' + team(g.away_team) + ' at ' + team(g.home_team) + '</h4>' +
      '<button type="button" class="sp-close" data-sp-close="game" aria-label="Close game">×</button></div>' +
      '<div class="sp-ctl">' + statSelectHtml('data-sp-game-stat', 'Stat', all, pick, [['', 'Each player’s main stat']]) + '</div>' +
      matchupHtml(lg, pick) + teamBetsHtml(lg) +
      '<p class="sp-note">Players each team used in its last three games this season, with their averages this season before this game, and against this opponent this season and last. Bars: the last 10 games, oldest first, green above the player’s own average of them and red below. Select a column to sort, a name for charts and the game log.</p>' +
      '<div class="sp-teams">' + teams + '</div></div>';
  }

  // ---- Matchup: the two teams side by side ----------------------------------
  const ord = (n) => { const k = n % 100, e = k >= 11 && k <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'; return n + e; };
  // Default stats when the game panel shows each player's main stat.
  // (NBA points are already in the rows from final scores.)
  const MATCHUP_STATS = { nba: ['rebounds', 'assists', 'threes'], nfl: ['passing_yards', 'rushing_yards', 'receiving_yards'] };
  const GROUP_STAT = { QB: 'passing_yards', RB: 'rushing_yards', WR: 'receiving_yards', TE: 'receiving_yards' };
  function matchupHtml(lg, pick) {
    const M = L_matchup(lg), g = league(lg).game.game;
    if (!M) return '';
    const pair = [g.away_team, g.home_team], N = M.teams_ranked || 0;
    const rk = (r, what) => (r == null || !N ? '' : ' <small class="sp-rank" title="' + escape(what + ': ' + ord(r) + ' of ' + N + ' teams') + '">' + ord(r) + '</small>');
    const tag = (r) => (r == null || N < 6 ? '' : r <= Math.ceil(N / 5) ? ' <span class="sp-tag sp-tag-tough">tough</span>' : r > N - Math.ceil(N / 5) ? ' <span class="sp-tag sp-tag-soft">soft</span>' : '');
    const T = (t) => M.teams[t] || null;
    const cell = (t, fn) => '<td class="sp-n">' + (T(t) ? fn(T(t), t) : '<span class="sp-muted">—</span>') + '</td>';
    const signed = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + escape(Math.abs(v).toFixed(1)));
    const nw = (v) => '<span class="sp-nw">' + escape(v) + '</span>';
    const rec = (x) => nw(x.wins + '-' + x.losses + (x.ties ? '-' + x.ties : ''));
    const stats = pick ? [pick].filter((st) => st !== 'minutes') : MATCHUP_STATS[lg] || [];
    const S = (t) => M.stats[t] || {};
    const rows = [
      ['Record', (x) => rec(x) + rk(x.rank.win_pct, 'Win share')],
      // Records break only at the dot on a narrow screen, never inside "2-1".
      ['Home · away', (x) => nw(x.home) + ' · ' + nw(x.away)],
      ['Last 10 · streak', (x) => nw(x.last10) + ' · ' + nw(x.streak || '—')],
      ['Points per game', (x) => escape(f1(x.points_for)) + rk(x.rank.points_for, 'Points scored per game (1st = most)')],
      ['Allowed per game', (x) => escape(f1(x.points_against)) + rk(x.rank.points_against, 'Points allowed per game (1st = fewest)')],
      ['Point difference', (x) => '<span class="' + (x.diff > 0 ? 'sp-pos' : x.diff < 0 ? 'sp-neg' : '') + '">' + signed(x.diff) + '</span>' + rk(x.rank.diff, 'Point difference per game')],
    ].map(([name, fn]) => '<tr><th scope="row">' + escape(name) + '</th>' + pair.map((t) => cell(t, fn)).join('') + '</tr>').join('') +
      stats.map((st) => '<tr><th scope="row">' + escape(label(st)) + (st === 'points' ? ' per game (box scores)' : ' per game') + '</th>' + pair.map((t) => cell(t, () => escape(f1(S(t).for && S(t).for[st])) + rk(S(t).for_rank && S(t).for_rank[st], label(st) + ' per game (1st = most)'))).join('') + '</tr>' +
        '<tr><th scope="row">' + escape(label(st)) + ' allowed</th>' + pair.map((t) => cell(t, () => escape(f1(S(t).allowed && S(t).allowed[st])) + rk(S(t).allowed_rank && S(t).allowed_rank[st], label(st) + ' allowed per game (1st = fewest)'))).join('') + '</tr>').join('');
    const compare = '<div class="sp-table-wrap"><table class="sp-table sp-mx-table" data-nosort><thead><tr><th>Before this game</th>' + pair.map((t) => '<th class="sp-n">' + team(t) + (t === g.home_team ? ' <span class="sp-muted">home</span>' : '') + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    // What each defense allows to each position group, for the chosen stat
    // (or each group's usual stat), with its rank and the league average.
    const groups = Object.keys(M.allowed_by[pair[0]] || M.allowed_by[pair[1]] || {});
    const gStat = (grp) => pick && pick !== 'minutes' ? pick : lg === 'nfl' ? GROUP_STAT[grp] || 'receiving_yards' : 'points';
    const dvp = groups.length ? '<h6>What each defense allows by position</h6><div class="sp-table-wrap"><table class="sp-table sp-mx-table" data-nosort><thead><tr><th>Position</th>' +
      pair.map((t) => '<th class="sp-n">' + team(t) + ' allows</th>').join('') + '<th class="sp-n">League</th></tr></thead><tbody>' +
      groups.map((grp) => {
        const st = gStat(grp);
        return '<tr><th scope="row">' + escape(GROUP_NAMES[grp] || grp) + (pick ? '' : ' <small class="sp-muted">' + escape(SHORT[st] || st) + '</small>') + '</th>' +
          pair.map((t) => { const v = ((M.allowed_by[t] || {})[grp] || {})[st], r = ((M.allowed_by_rank[t] || {})[grp] || {})[st]; return '<td class="sp-n">' + escape(f1(v)) + rk(r, label(st) + ' allowed to ' + (GROUP_NAMES[grp] || grp).toLowerCase() + ' (1st = fewest)') + tag(r) + '</td>'; }).join('') +
          '<td class="sp-n sp-muted">' + escape(f1(((M.league.allowed_by || {})[grp] || {})[st])) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '';
    const MS = M.meeting_summary || {}, list = M.meetings || [];
    const lead = MS.games ? (MS.wins[pair[0]] === MS.wins[pair[1]] ? 'Even at ' + MS.wins[pair[0]] + '-' + MS.wins[pair[1]] : team(MS.wins[pair[0]] > MS.wins[pair[1]] ? pair[0] : pair[1]) + ' leads ' + Math.max(MS.wins[pair[0]], MS.wins[pair[1]]) + '-' + Math.min(MS.wins[pair[0]], MS.wins[pair[1]])) + (MS.ties ? ' with ' + MS.ties + ' tie' + (MS.ties === 1 ? '' : 's') : '') + ' · average total ' + escape(f1(MS.avg_total)) : '';
    const meetings = '<h6>Recent meetings</h6>' + (list.length
      ? '<p class="sp-muted">' + lead + ' (last ' + list.length + ' stored).</p><ul class="sp-meetings">' + list.map((m) => {
          const hw = m.home_score > m.away_score, aw = m.away_score > m.home_score;
          return '<li><span class="sp-muted">' + escape(fmtDay(m.date)) + ' ' + escape(String(m.date).slice(0, 4)) + (m.season_type === 'POST' ? ' · playoffs' : '') + '</span> <span class="' + (aw ? 'sp-win' : '') + '">' + team(m.away_team) + ' ' + num(m.away_score) + '</span> @ <span class="' + (hw ? 'sp-win' : '') + '">' + team(m.home_team) + ' ' + num(m.home_score) + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="sp-muted">No meetings between these teams in the stored seasons.</p>');
    const none = !T(pair[0]) && !T(pair[1]);
    // The game's spread and total (NFL: nflverse; NBA: the sportsbooks'
    // median, recorded by the props scan) and each side's implied total.
    const GL = league(lg).game.game_lines;
    const linesLine = GL ? '<p class="sp-muted">' + (GL.favorite ? team(GL.favorite) + ' favored by ' + escape(f1(Math.abs(GL.home_margin))) : 'Pick’em') + ' · total ' + escape(f1(GL.total)) +
      ' · implied ' + team(pair[0]) + ' ' + escape(f1(GL.away_team_total)) + ', ' + team(pair[1]) + ' ' + escape(f1(GL.home_team_total)) +
      ' <small>(' + escape(GL.source === 'sportsbooks' ? 'sportsbooks’ median' + (GL.books ? ', ' + GL.books + ' books' : '') : GL.source === 'nflverse' ? 'nflverse' : GL.source || 'stored') + ')</small></p>' : '';
    return '<details class="sp-matchup" open><summary>Matchup</summary>' + linesLine +
      (none ? '<p class="sp-muted">Neither team has a final game stored this season before this one.</p>' : compare + dvp) + meetings +
      '<p class="sp-note">This season before this game. Ranks are among ' + N + ' teams: 1st is the best record, the most scored and the fewest allowed, so a “soft” defense (bottom fifth) gives up the most. Stat totals are summed over each side’s players' + (lg === 'nfl' ? '; a player on the field with no stat counts as zero' : '') + '.</p></details>';
  }
  const L_matchup = (lg) => (league(lg).game && league(lg).game.matchup) || null;

  // ---- Team bets: the team game model (lib/sports/team-model.mjs) -----------
  // Win, win by X+, spread, game total and team totals for one game. The
  // checker prices any line in the page from the forecast's whole-number
  // distributions (the same math as priceTeamBet on the server), beside the
  // books' no-vig chance where stored and how each kind of bet held up on
  // held-out games.
  const TB_MARKETS = [['moneyline', 'To win'], ['win_by', 'Win by X+'], ['spread', 'Spread'], ['total', 'Game total'], ['team_total', 'Team total']];
  const TB_NAME = { moneyline: 'To win', win_by: 'Win by X+', spread: 'Spread', total: 'Game total', team_total: 'Team total' };
  const TB_STATUS = { validated: 'Passed the check', not_validated: 'Did not pass', learning: 'Learning', no_data: 'Not checked yet' };
  const tbState = (lg) => { const L = league(lg); return L.tb || (L.tb = { market: 'win_by', team: '', line: '', side: 'over', price: '' }); };
  const amText = (a) => (a == null || !Number.isFinite(a) ? '—' : a > 0 ? '+' + a : '−' + Math.abs(a));
  const fairOdds = (p) => (p > 0 && p < 1 ? amText(p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p)) : '—');
  const pct0 = (p) => (p == null ? '—' : Math.round(p * 100) + '%');
  // A typed price, the page's copy of parsePrice in lib/sports/bets.mjs
  // (sports-pick-smoke compares them): American (−110, +150), decimal (1.91)
  // or Kalshi cents (62¢, .62). Returns { decimal, american, cents } or null.
  function priceOf(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim().replace(/[−–]/g, '-').replace(/\s+/g, '').toLowerCase();
    let m, d = null;
    if ((m = /^(\d{1,2}(?:\.\d+)?)(?:c|¢|cents?)$/.exec(s))) { const c = Number(m[1]); d = c > 0 && c < 100 ? 100 / c : null; }
    else if ((m = /^([+-])(\d{3,6}(?:\.\d+)?)$/.exec(s))) { const a = Number(m[2]); d = a >= 100 && a <= 100000 ? (m[1] === '+' ? 1 + a / 100 : 1 + 100 / a) : null; }
    else if (/^\d*\.?\d+$/.test(s)) {
      const x = Number(s);
      d = x > 0 && x < 1 ? 1 / x : x > 1 && x < 100 ? x : x >= 100 && x <= 100000 ? 1 + x / 100 : null;
    }
    if (!(d > 1 && d <= 1001)) return null;
    return { decimal: Math.round(d * 10000) / 10000, american: d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1)), cents: Math.round(1000 / d) / 10 };
  }
  // A decimal price as text the price box reads back the same: 100 and up
  // with no sign would read as American, so those go as +American.
  const decimalText = (d) => (d >= 100 ? '+' + Math.round((d - 1) * 100) : String(d));
  // One price in all three ways: "−110 · 1.91 · 52.4¢".
  function oddsText(o) {
    if (!o || !(o.decimal > 1)) return '—';
    const cents = o.cents != null ? o.cents : Math.round(1000 / o.decimal) / 10;
    const am = o.american != null ? o.american : (o.decimal >= 2 ? Math.round((o.decimal - 1) * 100) : -Math.round(100 / (o.decimal - 1)));
    return amText(am) + ' · ' + Number(o.decimal).toFixed(2) + ' · ' + cents + '¢';
  }
  // A game bet's short name, as teamLegLabel in lib/sports/bets.mjs.
  function teamPickLabel(l) {
    const T = String(l.team || '').toUpperCase(), n = (x) => (x < 0 ? '−' : '') + Math.abs(x);
    if (l.market === 'moneyline') return T + ' to win';
    if (l.market === 'spread') return T + ' ' + (Number(l.line) === 0 ? 'pick’em' : (l.line > 0 ? '+' : '') + n(Number(l.line)));
    if (l.market === 'win_by') return T + (l.side === 'under' ? ' not to win by ' : ' to win by ') + l.line + '+';
    if (l.market === 'total') return 'Game total ' + sideWord(l.side) + ' ' + l.line;
    if (l.market === 'team_total') return T + ' team total ' + sideWord(l.side) + ' ' + l.line;
    return 'Game bet';
  }
  const isTeamPick = (l) => !!l && l.kind === 'team';
  // Two game bets no final score lets both win: the page's copy of
  // neverBothWin in lib/sports/bets.mjs (sports-pick-smoke compares them).
  function winSpan(l) {
    const L = Number(l.line), INF = Infinity;
    if (l.market === 'moneyline') return [1, INF];
    if (l.market === 'spread') return [Math.floor(-L) + 1, INF];
    if (l.market === 'win_by') return l.side === 'under' ? [-INF, L - 1] : [L, INF];
    if (l.market === 'total' || l.market === 'team_total') return l.side === 'under' ? [-INF, Math.ceil(L) - 1] : [Math.floor(L) + 1, INF];
    return null;
  }
  function neverBoth(a, b) {
    if (!isTeamPick(a) || !isTeamPick(b) || a.sport !== b.sport || a.game_id !== b.game_id) return false;
    const MM = ['moneyline', 'spread', 'win_by'], ma = MM.indexOf(a.market) >= 0, mb = MM.indexOf(b.market) >= 0;
    if (ma !== mb) return false;
    if (!ma && (a.market !== b.market || (a.market === 'team_total' && a.team !== b.team))) return false;
    const A = winSpan(a);
    let B = winSpan(b);
    if (!A || !B) return false;
    if (ma && a.team !== b.team) B = [-B[1], -B[0]];
    return Math.max(A[0], B[0]) > Math.min(A[1], B[1]);
  }
  // Kalshi names a player line by the count it needs: over 24.5 is "25+".
  const milestone = (side, t) => (side === 'over' && Number.isFinite(Number(t)) && Math.round(Number(t) * 2) % 2 !== 0 ? Math.ceil(Number(t)) + '+' : null);
  const halfUp = (x) => Math.round(x - 0.5) + 0.5;
  function tbCheckText(m) {
    if (!m || !m.n) return 'Not enough held-out games with this kind of bet yet.';
    return Number(m.n).toLocaleString('en-US') + ' held-out games: chances off by ' + (m.ece == null ? '—' : (m.ece * 100).toFixed(1) + ' points') + ' on average' +
      (m.ece_luck != null ? ' (luck alone allows ' + (m.ece_luck * 100).toFixed(1) + ')' : '') + '.';
  }
  function tbBadge(m) {
    const st = m && m.status;
    return '<span class="sp-q' + (st === 'validated' ? ' sp-q-validated' : '') + '" title="' + escape(tbCheckText(m)) + '">' + escape(TB_STATUS[st] || 'Not checked yet') + '</span>';
  }
  function tbChances(pmf, line) {
    let over = 0, push = 0, under = 0;
    for (let i = 0; i < pmf.p.length; i++) {
      const k = pmf.start + i;
      if (k > line + 1e-9) over += pmf.p[i]; else if (Math.abs(k - line) < 1e-9) push += pmf.p[i]; else under += pmf.p[i];
    }
    const s = over + push + under || 1;
    return { over: over / s, push: push / s, under: under / s };
  }
  // The line the checker uses when the box is empty: the books' spread or
  // total when stored, else the model's own number on the half point.
  function tbDefaultLine(fc, g, s, lg) {
    const home = s.team === g.home_team;
    // A median across books can be a quarter point. The entry accepts whole
    // and half lines, so use the nearest half without changing the consensus.
    const marketLine = x => Math.round(x * 2) / 2;
    if (s.market === 'win_by') return lg === 'nfl' ? 7 : 10;
    if (s.market === 'spread') { const m = fc.market ? marketLine(fc.market.home_margin) : halfUp(fc.expected.home_margin); return home ? -m : m; }
    if (s.market === 'total') return fc.market ? marketLine(fc.market.total) : halfUp(fc.expected.total);
    if (s.market === 'team_total') return halfUp(home ? fc.expected.home_points : fc.expected.away_points);
    return null;
  }
  function tbPrice(fc, g, b) {
    const P = fc.pmf;
    const who = b.market === 'total' ? null : b.team === g.home_team ? 'home' : b.team === g.away_team ? 'away' : null;
    if (b.market !== 'total' && !who) return { error: 'Pick a team.' };
    const line = b.line == null || b.line === '' ? null : Number(b.line);
    const T = who ? String(who === 'home' ? g.home_team : g.away_team).toUpperCase() : '';
    let win, push = 0, lose, text;
    if (b.market === 'moneyline') {
      const c = tbChances(P.margin, 0);
      win = who === 'home' ? c.over : c.under; lose = who === 'home' ? c.under : c.over; push = c.push; text = T + ' to win';
    } else if (b.market === 'win_by') {
      if (!(line >= 1 && line <= 60)) return { error: 'Type the points, from 1 to 60.' };
      const X = Math.ceil(line), c = tbChances(P.margin, (who === 'home' ? 1 : -1) * (X - 0.5));
      win = who === 'home' ? c.over : c.under; lose = 1 - win; text = T + ' to win by ' + X + ' or more';
    } else if (b.market === 'spread') {
      if (!(Number.isFinite(line) && Math.abs(line) <= 60)) return { error: 'Type the spread, like −7.5 or +3.' };
      const c = tbChances(P.margin, who === 'home' ? -line : line);
      win = who === 'home' ? c.over : c.under; push = c.push; lose = who === 'home' ? c.under : c.over;
      text = T + ' ' + (line > 0 ? '+' + line : line < 0 ? '−' + Math.abs(line) : 'pick’em');
    } else {
      if (!(line > 0 && line <= 400)) return { error: 'Type the total.' };
      const c = tbChances(b.market === 'total' ? P.total : P[who], line), over = b.side !== 'under';
      win = over ? c.over : c.under; push = c.push; lose = over ? c.under : c.over;
      text = (b.market === 'total' ? 'Game total ' : T + ' team total ') + (over ? 'over ' : 'under ') + line;
    }
    const out = { text, line, win, push, lose, chance: win + lose > 0 ? win / (win + lose) : 0 };
    const B = fc.book, M = fc.market;
    if (B && b.market === 'moneyline' && B.home_win != null) out.book = who === 'home' ? B.home_win : 1 - B.home_win;
    else if (B && M && b.market === 'spread' && B.home_cover != null && Math.abs((who === 'home' ? -line : line) - M.home_margin) < 1e-9) out.book = who === 'home' ? B.home_cover : 1 - B.home_cover;
    else if (B && M && b.market === 'total' && B.over != null && Math.abs(line - M.total) < 1e-9) out.book = b.side === 'under' ? 1 - B.over : B.over;
    // The price as American, decimal or cents (priceOf).
    const raw = String(b.price == null ? '' : b.price).trim();
    if (raw !== '') {
      const o = priceOf(raw);
      if (!o) out.priceErr = 'Type odds like −110, +150, 1.91 or 62¢.';
      else { out.price = o.american; out.priceText = oddsText(o); out.breakeven = 1 / o.decimal; out.ev = win * (o.decimal - 1) - lose; }
    }
    return out;
  }
  function tbResultHtml(lg) {
    const G = league(lg).game, TB = G && G.team_bets, fc = TB && TB.forecast;
    if (!fc || !fc.pmf) return '';
    const g = G.game, s = tbState(lg);
    const def = tbDefaultLine(fc, g, s, lg);
    const r = tbPrice(fc, g, { market: s.market, team: s.team, side: s.side, price: s.price, line: s.line === '' ? def : s.line });
    if (r.error) return '<p class="sp-muted">' + escape(r.error) + '</p>';
    const check = ((TB.check || {}).markets || {})[s.market];
    const parts = ['<p class="sp-tb-big"><span>' + escape(r.text) + '</span> <b>' + pct(r.chance) + '</b> <small>fair odds ' + escape(fairOdds(r.chance)) + '</small> ' + tbBadge(check) + '</p>'];
    if (r.push > 0.001) parts.push('<p class="sp-muted">Lands exactly on ' + escape(fv(Math.abs(r.line))) + ' (a push, stake back) ' + pct(r.push) + ' of the time; the chance above leaves pushes out.</p>');
    if (r.book != null) {
      const gap = r.chance - r.book;
      parts.push('<p class="sp-muted">Books, no vig: <b>' + pct(r.book) + '</b>. The model is ' + (Math.abs(gap) < 0.005 ? 'level with them' : escape((Math.abs(gap) * 100).toFixed(1)) + ' points ' + (gap > 0 ? 'higher' : 'lower')) + '.' +
        (Math.abs(gap) >= 0.05 ? ' <span class="sp-model-warn">A gap this big usually means news the model cannot see (injuries, rest). Check before trusting either.</span>' : '') + '</p>');
    }
    if (r.priceErr) parts.push('<p class="sp-muted">' + escape(r.priceErr) + '</p>');
    else if (r.price != null) {
      const edge = r.chance - r.breakeven;
      parts.push('<p class="sp-tb-ev">At ' + escape(r.priceText) + ' you need <b>' + pct(r.breakeven) + '</b> to break even. By this model: ' +
        '<b class="' + (r.ev > 0 ? 'sp-pos' : r.ev < 0 ? 'sp-neg' : '') + '">' + (r.ev >= 0 ? '+' : '−') + '$' + escape(Math.abs(r.ev * 100).toFixed(2)) + ' per $100</b> on average' +
        (Math.abs(edge) < 0.02 ? ', inside the model’s usual error, so call it even.' : edge > 0 ? '.' : '; the price is not good enough.') +
        (edge > 0 && !(check && check.status === 'validated') ? ' <span class="sp-model-warn">This kind of bet has not passed the check, so this return is rough; a big edge here usually means the model is missing something.</span>' : '') + '</p>');
    }
    return parts.join('');
  }
  function tbFormHtml(lg) {
    const G = league(lg).game, TB = G.team_bets, fc = TB.forecast, g = G.game, s = tbState(lg);
    if (s.team !== g.home_team && s.team !== g.away_team) s.team = fc.win.home >= fc.win.away ? g.home_team : g.away_team;
    const opt = (v, t, cur) => '<option value="' + escape(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + escape(t) + '</option>';
    const sel = (key, opts, cur, text) => '<label class="sp-field"><span>' + escape(text) + '</span><select data-sp-tb="' + key + '">' + opts.map(([v, t]) => opt(v, t, cur)).join('') + '</select></label>';
    const lineText = { win_by: 'By at least (points)', spread: 'Spread (−7.5 = favored)', total: 'Total points', team_total: 'Team points' }[s.market];
    const def = tbDefaultLine(fc, g, s, lg);
    return '<div class="sp-tb-form">' + sel('market', TB_MARKETS, s.market, 'Bet') +
      (s.market !== 'total' ? sel('team', [[g.away_team, String(g.away_team).toUpperCase()], [g.home_team, String(g.home_team).toUpperCase() + ' (home)']], s.team, 'Team') : '') +
      (s.market === 'total' || s.market === 'team_total' ? sel('side', [['over', 'Over'], ['under', 'Under']], s.side, 'Side') : '') +
      (lineText ? '<label class="sp-field"><span>' + escape(lineText) + '</span><input type="number" step="0.5"' + (s.market === 'spread' ? '' : ' inputmode="decimal"') + ' data-sp-tb="line" value="' + escape(s.line) + '" placeholder="' + escape(def == null ? '' : fv(def)) + '"></label>' : '') +
      '<label class="sp-field"><span>Odds offered (optional)</span><input type="text" maxlength="12" autocomplete="off" spellcheck="false" data-sp-tb="price" value="' + escape(s.price) + '" placeholder="−110" aria-label="Odds offered: American, decimal or cents"></label>' +
      (g.status === 'scheduled' && !(Date.parse(g.start_utc) <= Date.now()) ? '<button type="button" class="sp-btn" data-sp-tb-add>Add to Pick Builder</button>' : '') + '</div>' +
      '<p class="sp-pick-msg" data-sp-part="tb-msg" aria-live="polite"></p>' +
      '<div class="sp-tb-result" data-sp-part="tb-result" aria-live="polite">' + tbResultHtml(lg) + '</div>';
  }
  // Chance of winning by at least 1..30 points, one line per team, with the
  // books' spread marked.
  function tbWinBySvg(fc, g) {
    // A narrower drawing on phones keeps the labels readable.
    const nar = narrowScreen(), N = 30, W = nar ? 360 : 640, H = nar ? 200 : 210, L = 40, R = nar ? 10 : 16, T = 12, B = 30;
    const P = fc.pmf.margin, iw = W - L - R, ih = H - T - B;
    const atLeast = (sign, x) => { let s = 0, all = 0; for (let i = 0; i < P.p.length; i++) { all += P.p[i]; if (sign * (P.start + i) >= x) s += P.p[i]; } return all > 0 ? s / all : 0; };
    const x = (v) => L + ((v - 1) / (N - 1)) * iw, y = (p) => T + (1 - p) * ih;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => '<line class="sp-ch-grid' + (t === 0 ? ' is-zero' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text class="sp-ch-axis" x="' + (L - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end">' + Math.round(t * 100) + '%</text>').join('');
    const xt = (nar ? [1, 10, 20, 30] : [1, 5, 10, 15, 20, 25, 30]).map((v) => '<text class="sp-ch-axis" x="' + x(v).toFixed(1) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + v + '+</text>').join('');
    const hov = [];
    const lines = [[g.away_team, -1, 'is-away'], [g.home_team, 1, 'is-home']].map(([t, sign, cls]) => {
      const pts = [];
      for (let v = 1; v <= N; v++) { const p = atLeast(sign, v); pts.push([x(v), y(p)]); hov.push({ x: x(v), y: y(p), label: String(t).toUpperCase() + ' by ' + v + '+: ' + pct(p) + '\nFair odds ' + fairOdds(p) }); }
      return '<polyline class="sp-tb-line ' + cls + '" points="' + pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '"/>';
    }).join('');
    let mark = '';
    const m = fc.market ? Math.abs(fc.market.home_margin) : null;
    if (m != null && m >= 1 && m <= N) mark = '<line class="sp-ch-ref" x1="' + x(m).toFixed(1) + '" x2="' + x(m).toFixed(1) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="sp-ch-axis" x="' + (x(m) + 4).toFixed(1) + '" y="' + (T + 10) + '">spread ' + escape(fv(m)) + '</text>';
    return '<svg class="sp-ch sp-tb-ch" viewBox="0 0 ' + W + ' ' + H + '" style="max-width:' + W + 'px" role="img" aria-label="' + escape('Chance each team wins by at least 1 to 30 points') + '"' + hoverAttr(hov) + '>' + grid + mark + lines + xt +
      '<text class="sp-ch-axis" x="' + (W - R) + '" y="' + (H - 3) + '" text-anchor="end">wins by at least →</text></svg>' +
      '<p class="sp-ch-legend"><span><i class="sp-key-line sp-tb-key is-away"></i>' + team(g.away_team) + '</span><span><i class="sp-key-line sp-tb-key is-home"></i>' + team(g.home_team) + ' (home)</span>' + (mark ? '<span><i class="sp-key-line sp-key-ref"></i>Books’ spread</span>' : '') + '</p>';
  }
  function tbLadderHtml(TB, lg) {
    const fc = TB.forecast, rows = TB.ladder || [];
    const checks = (TB.check || {}).markets || {};
    const mid = fc.market ? fc.market.total : null;
    const isMain = (r) => r.market === 'moneyline' || r.market === 'spread' || (r.market === 'total' && (mid == null ? false : Math.abs(r.line - mid) < 1e-9));
    const row = (r) => {
      const gap = r.book_chance != null ? r.chance - r.book_chance : null;
      return '<tr><td>' + escape(r.label) + '</td><td class="sp-n"><b>' + pct(r.chance) + '</b>' + (r.push > 0.001 ? ' <small class="sp-muted" title="Lands on the number: stake back">push ' + pct(r.push) + '</small>' : '') + '</td><td class="sp-n">' + escape(amText(r.fair_american)) + '</td>' +
        '<td class="sp-n">' + (r.book_chance != null ? pct(r.book_chance) + (Math.abs(gap) >= 0.05 ? ' <span class="sp-model-warn" title="Model and books differ by 5+ points">gap</span>' : '') : '<span class="sp-muted">—</span>') + '</td><td>' + tbBadge(checks[r.market]) + '</td></tr>';
    };
    const head = '<thead><tr><th>Bet</th><th class="sp-n">Model chance</th><th class="sp-n" title="American odds that break even at the model’s chance">Fair odds</th><th class="sp-n" title="The books’ chance with their margin removed (Shin’s method)">Books</th><th>Check</th></tr></thead>';
    const main = rows.filter(isMain), more = rows.filter((r) => !isMain(r));
    return '<div class="sp-table-wrap"><table class="sp-table sp-tb-table" data-nosort>' + head + '<tbody>' + main.map(row).join('') + '</tbody></table></div>' +
      (more.length ? '<details class="sp-tb-more"><summary>More lines: win by, other totals and team totals (' + more.length + ')</summary><div class="sp-table-wrap"><table class="sp-table sp-tb-table" data-nosort>' + head + '<tbody>' + more.map(row).join('') + '</tbody></table></div></details>' : '');
  }
  // The team numbers behind the forecast, the two teams side by side.
  function marginSpark(vals) {
    const v = (vals || []).filter(isNum).slice().reverse();
    if (!v.length) return '<span class="sp-muted">—</span>';
    const W = 74, H = 22, slot = W / 10, top = Math.max(1, ...v.map(Math.abs));
    const mid = H / 2, sc = (H / 2 - 1) / top;
    return '<svg class="sp-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escape('Last ' + v.length + ' margins, oldest to newest: ' + v.map((x) => (x > 0 ? '+' : '') + x).join(', ')) + '">' +
      v.map((x, i) => '<rect class="sp-bar ' + (x > 0 ? 'is-over' : x < 0 ? 'is-under' : 'is-at') + '" x="' + (W - (v.length - i) * slot + 1).toFixed(1) + '" y="' + (x >= 0 ? mid - x * sc : mid).toFixed(1) + '" width="' + (slot - 2).toFixed(1) + '" height="' + Math.max(1, Math.abs(x) * sc).toFixed(1) + '"/>').join('') +
      '<line class="sp-ch-avg" x1="0" x2="' + W + '" y1="' + mid + '" y2="' + mid + '"/></svg>';
  }
  function tbTeamsHtml(TB, g, lg) {
    const pair = [g.away_team, g.home_team];
    const X = (t) => TB.teams && TB.teams[t] || {};
    if (!pair.some((t) => X(t).results || X(t).rating)) return '<p class="sp-muted">Neither team has a final game stored this season before this one.</p>';
    const sg = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '±') + escape(Math.abs(v).toFixed(1)));
    const col = (v, good) => (v == null ? '' : (good ? v > 0 : v < 0) ? 'sp-pos' : (good ? v < 0 : v > 0) ? 'sp-neg' : '');
    const rk = (r, n, what) => (r == null || !n ? '' : ' <small class="sp-rank" title="' + escape(what + ': ' + ord(r) + ' of ' + n + ' teams') + '">' + ord(r) + '</small>');
    const nw = (v) => '<span class="sp-nw">' + escape(v == null ? '—' : v) + '</span>';
    const C = lg === 'nfl' ? 8 : 5, B = lg === 'nfl' ? 14 : 15;
    const rows = [
      ['Team rating', (t) => { const r = X(t).rating; return r ? '<span class="' + col(r.net, true) + '">' + sg(r.net) + '</span>' + rk(r.net_rank, r.teams, 'Team rating') : '—'; }, 'Points better than an average team, from every game this season and last (older games count less)'],
      ['Scores · allows vs average', (t) => { const r = X(t).rating; return r ? '<span class="' + col(r.offense, true) + '">' + sg(r.offense) + '</span> · <span class="' + col(r.defense, false) + '">' + sg(r.defense) + '</span>' : '—'; }, 'Points scored and allowed per game against an average team'],
      ['Against the spread', (t) => nw(X(t).results && X(t).results.ats), 'Covered, failed, pushed, in games with a stored spread'],
      ['Beat the spread by', (t) => { const r = X(t).results; return r && r.vs_line != null ? '<span class="' + col(r.vs_line, true) + '">' + sg(r.vs_line) + '</span>' : '—'; }, 'Average margin minus the expected margin'],
      ['Over · under', (t) => nw(X(t).results && X(t).results.over_under), 'Game total over, under, pushed against the stored total'],
      ['As favorite · underdog', (t) => { const r = X(t).results; return r ? nw(r.as_favorite || '—') + ' · ' + nw(r.as_underdog || '—') : '—'; }, 'Win-loss record when the books favored the team, and when they did not'],
      ['Average margin', (t) => { const r = X(t).results; return r ? '<span class="' + col(r.avg_margin, true) + '">' + sg(r.avg_margin) + '</span>' : '—'; }],
      ['Home · away margin', (t) => { const r = X(t).results; return r ? sg(r.home_margin) + ' · ' + sg(r.away_margin) : '—'; }],
      ['Close games (' + C + ' or fewer)', (t) => nw(X(t).results && X(t).results.close), 'Won-lost in games decided by ' + C + ' points or fewer'],
      ['Won · lost by ' + B + '+', (t) => { const r = X(t).results; return r ? r.big_wins + ' · ' + r.big_losses : '—'; }],
      ['Average game total', (t) => escape(f1(X(t).results && X(t).results.avg_total))],
      ['Last 10 margins', (t) => marginSpark(X(t).results && X(t).results.last10), 'Oldest to newest; green won, red lost'],
      ['Rest before this game', (t) => (X(t).rest_days == null ? '—' : escape(X(t).rest_days) + ' day' + (X(t).rest_days === 1 ? '' : 's')), 'Days since the team’s previous game'],
    ];
    if (lg === 'nba') rows.push(
      ['Pace (possessions)', (t) => escape(f1(X(t).pace && X(t).pace.possessions)), 'Field goal tries + 0.44 × free throw tries − offensive rebounds + turnovers, per game (box scores)'],
      ['Points per 100 · allowed', (t) => { const p = X(t).pace; return p ? escape(f1(p.offense_per_100)) + ' · ' + escape(f1(p.defense_per_100)) : '—'; }, 'Per 100 possessions, so fast and slow teams compare fairly'],
    );
    return '<div class="sp-table-wrap"><table class="sp-table sp-mx-table" data-nosort><thead><tr><th>This season before this game</th>' + pair.map((t) => '<th class="sp-n">' + team(t) + (t === g.home_team ? ' <span class="sp-muted">home</span>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(([name, fn, tip]) => '<tr><th scope="row"' + (tip ? ' title="' + escape(tip) + '"' : '') + '>' + escape(name) + '</th>' + pair.map((t) => '<td class="sp-n">' + fn(t) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function teamBetsHtml(lg) {
    const G = league(lg).game, TB = G && G.team_bets;
    if (!TB) return '';
    const g = G.game, check = TB.check || {};
    const open = (body) => '<details class="sp-tb" open><summary>Team bets</summary>' + body + '</details>';
    if (TB.status === 'not_fitted' || TB.status === 'not_enough_games') return open('<p class="sp-muted">The team model has not been fitted yet; the next daily data run fits it.</p>');
    const teamsBlock = '<h6>Team numbers</h6>' + tbTeamsHtml(TB, g, lg);
    if (TB.status === 'played') {
      const F = TB.final, GL = G.game_lines;
      let settle = '';
      if (F && GL && isFinite(GL.home_margin) && isFinite(GL.total)) {
        const cover = F.margin - GL.home_margin, fav = GL.favorite;
        settle = ' Against the books: ' + (fav ? team(fav) + ' −' + escape(fv(Math.abs(GL.home_margin))) + ' ' + (cover === 0 ? 'pushed' : (fav === g.home_team ? cover > 0 : cover < 0) ? 'covered' : 'did not cover') : 'pick’em') +
          '; the total went ' + (F.total > GL.total ? 'over' : F.total < GL.total ? 'under' : 'right on') + ' ' + escape(fv(GL.total)) + '.';
      }
      return open(F ? '<p class="sp-tb-lead">Final: ' + team(g.away_team) + ' ' + num(F.away_score) + ', ' + team(g.home_team) + ' ' + num(F.home_score) + ' (' + (F.margin === 0 ? 'tie' : team(F.margin > 0 ? g.home_team : g.away_team) + ' by ' + Math.abs(F.margin)) + ', total ' + F.total + ').' + settle + '</p>' + teamsBlock : teamsBlock);
    }
    if (TB.status !== 'ok' || !TB.forecast) return open('<p class="sp-muted">No forecast for this game: one of the teams has no rated games yet.</p>' + teamsBlock);
    const fc = TB.forecast, E = fc.expected, BL = fc.blend || {};
    const pairText = '<p class="sp-tb-lead"><b>' + team(g.away_team) + ' ' + pct0(fc.win.away) + '</b> · <b>' + team(g.home_team) + ' ' + pct0(fc.win.home) + '</b> to win' + (fc.win.tie > 0.001 ? ' · tie ' + pct(fc.win.tie) : '') +
      '. Expected ' + team(g.away_team) + ' ' + escape(f1(E.away_points)) + ', ' + team(g.home_team) + ' ' + escape(f1(E.home_points)) + ' (' + (Math.abs(E.home_margin) < 0.05 ? 'even' : team(E.home_margin > 0 ? g.home_team : g.away_team) + ' by ' + escape(f1(Math.abs(E.home_margin)))) + ', total ' + escape(f1(E.total)) + ').</p>';
    const how = fc.mode === 'market'
      ? 'Starts from the ' + (fc.market && fc.market.source === 'nflverse' ? 'closing' : 'sportsbooks’') + ' spread and total' + (BL.margin > 0 || BL.total > 0
        ? ', moved ' + Math.round((BL.margin || 0) * 100) + '% (margin) and ' + Math.round((BL.total || 0) * 100) + '% (total) toward the team ratings' + (BL.tested ? ', the share that helped on earlier games.' : '; a small default, not yet tested (needs 200+ lined games).')
        : '; on earlier games the team ratings added nothing to them, so the books’ numbers stand.')
      : 'No spread or total is stored for this game yet, so this comes from the team ratings alone.';
    const ro = fc.ratings_only || {};
    const notes = [
      how + ' Team ratings alone say ' + (Math.abs(ro.margin) < 0.05 ? 'even' : team(ro.margin > 0 ? g.home_team : g.away_team) + ' by ' + escape(f1(Math.abs(ro.margin)))) + ', total ' + escape(f1(ro.total)) + '.',
      fc.rest && (fc.rest.home != null || fc.rest.away != null) ? 'Rest: ' + team(g.away_team) + ' ' + (fc.rest.away == null ? 'first game of the season' : fc.rest.away + ' day' + (fc.rest.away === 1 ? '' : 's')) + ', ' + team(g.home_team) + ' ' + (fc.rest.home == null ? 'first game of the season' : fc.rest.home + ' day' + (fc.rest.home === 1 ? '' : 's')) + (fc.rest_edge && check.params && check.params.rest ? '; the rest edge is counted (it helped on earlier games).' : '.') : '',
      fc.early ? '<span class="sp-model-warn">Early in the season: few games this year, so the ranges are widened.</span>' : '',
      fc.mode === 'market' && check.sd && check.sd.market && check.sd.market.borrowed ? 'How far results land from the books’ lines has not been measured for ' + lg.toUpperCase() + ' yet (the line archive is new), so the ratings’ wider spread is used and chances lean toward 50%.' : '',
    ].filter(Boolean).map((t) => '<p class="sp-muted">' + t + '</p>').join('');
    return open(pairText + notes +
      '<h6>Check a bet</h6><div data-sp-part="tb-form">' + tbFormHtml(lg) + '</div>' +
      '<h6>Win by X or more</h6>' + tbWinBySvg(fc, g) +
      '<h6>Lines</h6>' + tbLadderHtml(TB, lg) + teamsBlock +
      '<p class="sp-note">A forecast, not a promise. The model rates each team’s offense and defense from final scores (this season and last), adds home edge, and turns the expected margin and total into chances for every whole-number result, with the shape learned from past games (NBA has no ties; NFL lands on 3 and 7 more often). “Passed the check” means 300+ held-out games and chances off by 3 points or less (or no more than luck allows). Injuries and rest decisions are not in the data; the books’ line usually knows about them, which is why the model starts from it. Nothing is placed.</p>');
  }
  // Team model's win chance on a board row.
  function teamWinHtml(g) {
    const w = g.team_win;
    if (!w || !(w.home >= 0) || !(w.away >= 0)) return '';
    const fav = w.home >= w.away ? g.home_team : g.away_team, p = Math.max(w.home, w.away);
    return '<span class="sp-twin" title="Team model’s chance to win">' + team(fav) + ' ' + Math.round(p * 100) + '%</span>';
  }
  // The team model's check in the side card: one folded row per kind of bet.
  function teamModelCard(src) {
    const T = src.team_model;
    if (!T) return '';
    if (T.status !== 'ok') return '<div class="sp-source sp-model sp-tmodel"><h3>Team bets check</h3><p class="sp-muted">The team model has not been fitted yet; the next daily data run fits it.</p></div>';
    const names = { moneyline: 'Who wins', spread: 'Spread', win_by: 'Win by X+', total: 'Game total', team_total: 'Team totals' };
    const keys = Object.keys(names).filter((k) => T.markets[k]);
    const passed = keys.filter((k) => T.markets[k].status === 'validated').length;
    const rows = keys.map((k) => {
      const m = T.markets[k], B = m.baseline;
      return '<li><details class="sp-model-stat"><summary><span class="sp-model-name">' + escape(names[k]) + '</span><span class="sp-model-verdict">' + tbBadge(m) + '</span></summary><div class="sp-model-body">' +
        '<span>' + escape(tbCheckText(m)) + (m.slope != null ? ' Calibration slope ' + escape(m.slope.toFixed(2)) + ' (1 is ideal; above 1 means the chances were too timid).' : '') + '</span>' +
        (B && B.n ? '<span class="sp-muted">Score on ' + Number(B.n).toLocaleString('en-US') + ' games (lower is better): model ' + escape(B.model == null ? '—' : B.model.toFixed(4)) + ', ' + escape(B.name || 'baseline') + ' ' + escape(B.baseline == null ? '—' : B.baseline.toFixed(4)) + '.</span>' : '') +
        reliabilitySvg(m.reliability, names[k]) + '</div></details></li>';
    }).join('');
    const H = T.held_out, MM = (H && H.mean_miss) || {};
    return '<div class="sp-source sp-model sp-tmodel"><h3>Team bets check</h3><p class="sp-model-tally">' + passed + ' of ' + keys.length + ' kinds of bet passed.</p><ul class="sp-model-list">' + rows + '</ul>' +
      '<p class="sp-note">Fitted on earlier seasons, then scored on ' + (H ? Number(H.games).toLocaleString('en-US') + ' later games' + (H.from ? ' from ' + escape(fmtDay(H.from)) + ' ' + escape(H.from.slice(0, 4)) : '') : 'later games') + ' it never saw' +
      (MM.margin != null ? '. Margins missed by ' + escape(f1(MM.margin)) + ' points on average' + (MM.market_margin != null ? ' (the books’ spread: ' + escape(f1(MM.market_margin)) + ')' : '') : '') +
      (MM.total != null ? ', totals by ' + escape(f1(MM.total)) + (MM.market_total != null ? ' (books: ' + escape(f1(MM.market_total)) + ')' : '') : '') + '. ' +
      (T.blend && T.blend.tested ? 'Ratings blended into the books’ numbers at ' + Math.round((T.blend.margin || 0) * 100) + '% (margin) and ' + Math.round((T.blend.total || 0) * 100) + '% (total), the share that helped.' : 'The blend toward ratings is a small untested default until 200+ games have a stored line.') +
      ' · ' + escape(T.version) + '.</p></div>';
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
  // The averages table and game log, limited to one stat set (Main, Combos,
  // More or All). Repainted alone when the set or "show all" changes.
  function playerTablesHtml(lg) {
    const L = league(lg), P = L.player;
    if (!P) return '';
    const cols = P.stats.concat(P.context_stats).filter((st) => inSet(st, L.logSet));
    const summary = seg('data-sp-logset', SET_CHOICES, L.logSet, 'Stats shown in the averages and game log') + '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Stat</th><th class="sp-n">Last 5</th><th class="sp-n">Last 10</th><th class="sp-n">All stored</th><th class="sp-n">Median</th><th class="sp-n">Low – high</th><th class="sp-n">Games</th></tr></thead><tbody>' +
      cols.map((st) => {
        const s = P.summaries[st] || {};
        return '<tr' + (P.stats.indexOf(st) >= 0 ? ' class="sp-key"' : '') + '><td>' + escape(label(st)) + '</td><td class="sp-n">' + num(s.last5) + '</td><td class="sp-n">' + num(s.last10) + '</td><td class="sp-n">' + num(s.average) +
          '</td><td class="sp-n">' + num(s.median) + '</td><td class="sp-n">' + (s.games ? num(s.low) + ' – ' + num(s.high) : '—') + '</td><td class="sp-n">' + num(s.games) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    const logCols = cols.filter((st) => st !== 'minutes');
    const logGames = L.logAll ? P.games : P.games.slice(0, LOG_ROWS);
    // NFL: offensive snaps and the share of the team's snaps (nflverse).
    const snapsCol = lg === 'nfl' && P.games.some((r) => r.snaps != null);
    const snapText = (r) => r.snaps == null ? '—' : num(r.snaps) + (r.snap_pct != null ? ' <span class="sp-muted">' + Math.round(r.snap_pct * 100) + '%</span>' : '');
    const log = P.games.length ? '<div class="sp-table-wrap"><table class="sp-table sp-log"><thead><tr><th>Date</th><th>Game</th>' + (lg === 'nba' ? '<th class="sp-n">Min</th>' : '') + (snapsCol ? '<th class="sp-n" title="Offensive snaps and share of the team\'s snaps">Snaps</th>' : '') +
      logCols.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') + '</tr></thead><tbody>' +
      logGames.map((r) => '<tr' + (r.played ? '' : ' class="sp-dnp"') + '><td>' + escape(fmtDay(r.date)) + ' <span class="sp-muted">' + escape(String(r.date).slice(0, 4)) + '</span></td><td>' + (r.home ? 'vs ' : '@ ') + team(r.opponent) +
        (r.week != null ? ' <span class="sp-muted">' + (r.season_type === 'POST' ? 'playoffs' : 'wk ' + escape(r.week)) + '</span>' : '') + (resultHtml(r) ? ' ' + resultHtml(r) : '') + (r.played ? '' : ' <span class="sp-muted">did not play' + (r.dnp_reason ? ': ' + escape(String(r.dnp_reason).toLowerCase()) : '') + '</span>') + '</td>' +
        (lg === 'nba' ? '<td class="sp-n">' + num(r.minutes) + '</td>' : '') + (snapsCol ? '<td class="sp-n">' + snapText(r) + '</td>' : '') +
        logCols.map((st) => '<td class="sp-n">' + num(r.stats[st]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (P.games.length > logGames.length ? '<button type="button" class="sp-btn sp-more" data-sp-logall>Show all ' + P.games.length + ' games</button>' : '')
      : '<p class="sp-muted">No games stored for this player.</p>';
    return summary + '<h5>Game log' + (P.total_games > logGames.length ? ' (latest ' + logGames.length + ' of ' + P.total_games + ')' : '') + '</h5>' + log;
  }
  // No forecast for any stat: one line per reason, not one per stat (there
  // are a dozen modeled stats, usually all missing for the same reason).
  function fcNoneHtml(stats, F, lg) {
    const groups = new Map();
    for (const st of stats) {
      const why = modelReason(F.forecasts[st] || {}, lg);
      if (!groups.has(why)) groups.set(why, []);
      groups.get(why).push(label(st));
    }
    const items = [...groups].map(([why, names]) => '<li><b>' + escape(groups.size === 1 && names.length > 2 ? 'All ' + names.length + ' modeled stats' : names.join(', ')) + '</b> <span class="sp-muted">' + escape(why) + '</span></li>');
    return '<ul class="sp-fc-none">' + items.join('') + '</ul>';
  }
  // The player's listing on the latest ESPN injury report for the next game,
  // and the regular teammates listed out (NBA forecasts count their minutes).
  function availHtml(P) {
    const a = P.availability, F = P.forecast;
    if (!a) return '';
    // NFL: the official injury report and roster status the daily job stores,
    // shown even when ESPN's report cannot be read.
    const nfl = officialHtml(a);
    if (a.state !== 'ok') return '<p class="sp-avail' + (nfl && (a.out || a.unsure) ? ' sp-model-warn' : ' sp-muted') + '">' + (nfl ? 'ESPN injury report' : 'Injury report') + ': ' + (a.state === 'stale' ? 'the latest copy is out of date' : 'not available right now') + '.' + nfl + '</p>';
    const own = a.status === 'not listed' ? 'Not listed on the latest ESPN injury report' : 'Listed <b>' + escape(a.status) + '</b> on the ESPN injury report' + (a.detail ? ' (' + escape(a.detail) + ')' : '');
    const withMin = F && F.teammates_out && F.teammates_out.length;
    const names = withMin ? F.teammates_out.map((p) => escape(p.name) + ' (' + num(p.minutes) + ' min)') : (a.teammates_out || []).map(escape);
    const tm = names.length ? ' Teammates listed out: ' + names.join(', ') + (withMin ? ', usual minutes a game.' : '.') : '';
    return '<p class="sp-avail' + (a.out || a.unsure ? ' sp-model-warn' : ' sp-muted') + '">' + own + '.' + nfl + tm + '</p>';
  }
  // The official NFL report line and roster status (empty for NBA).
  function officialHtml(a) {
    const o = a && a.official;
    const off = o && o.state === 'ok' ? ' Official NFL report, week ' + escape(o.week) + ': ' + (o.game_status ? '<b>' + escape(o.game_status) + '</b>' : 'no game status yet') +
      (o.injury ? ' (' + escape(o.injury) + ')' : '') + (o.practice ? '; practice: ' + escape(o.practice) : '') + '.'
      : o && o.state === 'not_yet' ? ' Official NFL report: not filed for this game yet.' : '';
    const rs = a && a.roster_status;
    const roster = rs && rs.code !== 'ACT' ? ' Roster: <b>' + escape(rs.label) + '</b>' + (rs.code === 'DEV' ? ' (plays only if elevated for the game)' : '') + '.' : '';
    return off + roster;
  }
  // The next game's spread and total from this player's side, the NFL snap
  // share trend, and which forecasts use them (sports-model-4).
  function fcInputsHtml(P) {
    const F = P.forecast, g = F && F.game_lines;
    const fcs = P.stats.map((st) => [st, F && F.forecasts[st]]).filter(([, f]) => f && f.status === 'ok');
    const usedBy = (key) => fcs.filter(([, f]) => f[key] && f[key].applied).map(([st]) => label(st));
    const parts = [];
    if (g) {
      const m = Math.abs(g.team_margin), used = usedBy('game_lines');
      parts.push((g.team_margin > 0 ? 'Favored by ' + escape(f1(m)) : g.team_margin < 0 ? 'Underdog by ' + escape(f1(m)) : 'Pick’em') + ' · game total ' + escape(f1(g.total)) + ' · implied team total ' + escape(f1(g.team_total)) +
        ' <small>(' + escape(g.source === 'sportsbooks' || g.source === 'archive' ? 'sportsbooks’ median' : g.source === 'nflverse' ? 'nflverse' : g.source || 'stored') + ')</small>. ' +
        (used.length ? 'Used in the forecast for ' + escape(used.join(', ')) + '.' : 'Shown only; not used in these forecasts.'));
    }
    const snap = fcs.map(([, f]) => f.snap_trend).find((t) => t && t.recent != null);
    if (snap) {
      const used = usedBy('snap_trend');
      parts.push('Snap share: last 2 games ' + Math.round(snap.recent * 100) + '%, last 8 ' + Math.round(snap.longer * 100) + '%. ' + (used.length ? 'Used for ' + escape(used.join(', ')) + '.' : 'Shown only.'));
    }
    return parts.length ? '<p class="sp-muted sp-fc-inputs">' + parts.join(' ') + '</p>' : '';
  }
  // ---- Player page -----------------------------------------------------------
  // Clicking a player opens the player's page in place of the board (the address
  // carries ?player=, so the browser's Back button and shared links work): a
  // header with this season's numbers and the next game, then tabs.
  const PTABS = [['overview', 'Overview'], ['upcoming', 'Upcoming games'], ['charts', 'Charts'], ['log', 'Game log'], ['opponents', 'Vs teams'], ['seasons', 'Seasons'], ['pick', 'Add a pick']];
  const BACK_TO = { games: 'games', players: 'player stats', teams: 'team stats', record: 'prop track record' };
  const KEY_BY_GROUP = {
    nba: ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks'],
    QB: ['passing_yards', 'passing_tds', 'completions', 'interceptions', 'rushing_yards'],
    RB: ['rushing_yards', 'carries', 'rushing_tds', 'receptions', 'receiving_yards'],
    WR: ['receptions', 'targets', 'receiving_yards', 'receiving_tds', 'rush_rec_yards'],
    TE: ['receptions', 'targets', 'receiving_yards', 'receiving_tds', 'rush_rec_yards'],
  };
  const nflGroup = (pos) => { const p = String(pos || '').toUpperCase(); return p === 'QB' ? 'QB' : p === 'RB' || p === 'FB' || p === 'HB' ? 'RB' : p === 'TE' ? 'TE' : 'WR'; };
  function keyStats(P, lg) {
    const pref = lg === 'nba' ? KEY_BY_GROUP.nba : KEY_BY_GROUP[nflGroup(P.player.position || (P.games[0] || {}).position)];
    return pref.filter((st) => P.games.some((g) => g.played && isNum(gv(g, st))));
  }
  const playedGames = (P) => P.games.filter((g) => g.played);
  const latestSeason = (P) => (P.games.length ? P.games[0].season : null);
  const avgStat = (list, st) => avgOf(list.map((g) => gv(g, st)).filter(isNum));
  const resultHtml = (g) => (isNum(g.team_score) && isNum(g.opp_score)
    ? '<span class="sp-res ' + (g.team_score > g.opp_score ? 'is-w' : g.team_score < g.opp_score ? 'is-l' : '') + '">' + (g.team_score > g.opp_score ? 'W' : g.team_score < g.opp_score ? 'L' : 'T') + ' ' + g.team_score + '–' + g.opp_score + '</span>' : '');
  const rankTip = (r, n, what) => (r == null || !n ? '' : ' <small class="sp-rank" title="' + escape(what + ': ' + ord(r) + ' of ' + n + ' teams (1st = fewest)') + '">' + ord(r) + '</small>');
  const toughTag = (r, n) => (r == null || n < 6 ? '' : r <= Math.ceil(n / 5) ? ' <span class="sp-tag sp-tag-tough">tough</span>' : r > n - Math.ceil(n / 5) ? ' <span class="sp-tag sp-tag-soft">soft</span>' : '');
  function linesText(l) {
    if (!l) return '—';
    return (l.team_margin > 0 ? '−' + escape(fv(l.team_margin)) : l.team_margin < 0 ? '+' + escape(fv(-l.team_margin)) : 'PK') + ' · ' + escape(fv(l.total));
  }
  function playerTilesHtml(P, lg) {
    const season = latestSeason(P), list = playedGames(P).filter((g) => g.season === season);
    if (!list.length) return '';
    const stats = keyStats(P, lg).slice(0, lg === 'nba' ? 6 : 5).concat(lg === 'nba' && list.some((g) => isNum(g.minutes)) ? ['minutes'] : []);
    return '<div class="sp-pp-tiles">' + stats.map((st) => {
      const a = avgStat(list, st), l5 = avgStat(list.slice(0, 5), st), d = l5 != null && a != null ? l5 - a : null;
      const recent = list.slice(0, 10).map((g) => gv(g, st));
      return '<div class="sp-pp-tile"><span class="sp-pp-tl">' + escape(label(st)) + '</span><b>' + escape(f1(a)) + '</b><span class="sp-pp-sub">Last 5 ' + escape(f1(l5)) +
        (d != null && Math.abs(d) >= 0.05 ? ' <small class="' + (d > 0 ? 'sp-pos' : 'sp-neg') + '">' + (d > 0 ? '▲' : '▼') + escape(f1(Math.abs(d))) + '</small>' : '') + '</span>' +
        sparkSvg(recent, label(st) + ', last ' + recent.length + ' games') + '</div>';
    }).join('') + '</div><p class="sp-note sp-pp-note">' + escape(seasonLabel(lg, season)) + ' season averages over ' + list.length + ' game' + (list.length === 1 ? '' : 's') + ' played. Bars: the last 10, green above their average.</p>';
  }
  function nextGameBoxHtml(P, lg) {
    const G = P.next_game, U = (P.upcoming || [])[0];
    if (!G) return '<div class="sp-pp-next"><span class="sp-muted">No upcoming game stored for the player’s team.</span></div>';
    const same = U && U.game_id === G.game_id;
    const team0 = P.forecast ? (P.forecast.home ? G.home_team : G.away_team) : P.player.team;
    const home = same ? U.home : G.home_team === team0;
    const opp = same ? U.opponent : home ? G.away_team : G.home_team;
    const chips = [];
    if (same && isNum(U.win_chance)) chips.push('Team win chance ' + pct0(U.win_chance));
    if (same && U.lines) chips.push(U.lines.team_margin > 0 ? 'Favored by ' + escape(fv(U.lines.team_margin)) : U.lines.team_margin < 0 ? 'Underdog by ' + escape(fv(-U.lines.team_margin)) : 'Pick’em');
    if (same && U.opponent_team) chips.push(team(opp) + ' ' + escape(U.opponent_team.record) + (U.opponent_team.last_season ? ' last season' : ''));
    if (same && U.vs) { const st = keyStats(P, lg)[0]; if (st) chips.push('Averages ' + escape(f1(U.vs.values[st])) + ' ' + escape(unitWord(st)) + ' vs ' + team(opp) + ' (' + U.vs.games + 'g)'); }
    return '<div class="sp-pp-next"><span class="sp-pp-tl">Next game</span><b>' + (home ? 'vs ' : '@ ') + team(opp) + '</b> <span class="sp-muted">' + escape(G.time_tbd ? fmtDay(G.local_date) + ' · time TBD' : fmtWhen(G.start_utc, zone())) + '</span>' +
      (chips.length ? '<span class="sp-pp-chips">' + chips.map((c) => '<span>' + c + '</span>').join('') + '</span>' : '') + '</div>';
  }
  // The model forecast for the next game (the table the old player panel had).
  function forecastBlockHtml(P, lg) {
    const F = P.forecast, G = P.next_game;
    if (!G) return '';
    if (!F) return '<h5>Model forecast for the next game</h5>' + availHtml(P) + '<p class="sp-muted">The model has not been fitted yet.</p>';
    // Stats the model does not cover for this position share one row
    // instead of repeating the same sentence on each.
    const offPos = P.stats.filter((st) => (F.forecasts[st] || {}).reason === 'position');
    const fr = P.stats.map((st) => {
      const f = F.forecasts[st] || {};
      if (f.reason === 'position') return '';
      if (f.status !== 'ok') return '<tr><td>' + escape(label(st)) + '</td><td colspan="3" class="sp-muted sp-wrap">' + escape(modelReason(f, lg)) + '</td></tr>';
      return '<tr><td>' + escape(label(st)) + ' ' + qualityBadge(f.quality) + '</td><td class="sp-n"><b>' + escape(Number(f.mean).toFixed(1)) + '</b></td><td class="sp-n">' + escape(f.low) + ' – ' + escape(f.high) + '</td><td class="sp-lines">' +
        (f.lines || []).map((x) => '<span>' + escape(x.threshold) + ' <b>' + pct(x.over) + '</b></span>').join('') + '</td></tr>';
    }).join('');
    const offNote = offPos.length ? '<p class="sp-muted sp-fc-off">Not modeled for this player: ' + escape(offPos.map(label).join(', ')) + '. ' +
      escape(modelReason({ reason: 'position' }, lg).replace(/^Model: /, '').replace(/^./, (c) => c.toUpperCase())) + '</p>' : '';
    const any = P.stats.map((st) => F.forecasts[st]).find((f) => f && f.status === 'ok');
    // With no forecast at all, a plain list reads better than a table of
    // empty columns (and does not run off a phone screen).
    const table = any ? '<div class="sp-table-wrap"><table class="sp-table sp-fc" data-nosort><thead><tr><th>Stat</th><th class="sp-n">Expected</th><th class="sp-n">80% range</th><th>Chance of the over at each line</th></tr></thead><tbody>' + fr + '</tbody></table></div>' + offNote
      : fcNoneHtml(P.stats, F, lg);
    return '<h5>Model forecast for the next game</h5><p class="sp-muted sp-fc-game">' + (F.home ? 'vs ' : '@ ') + team(F.opponent) + ' · ' + escape(fmtWhen(G.start_utc, zone())) + '</p>' + availHtml(P) + fcInputsHtml(P) + table +
      (any ? '<p class="sp-note">Built from ' + escape(any.games) + ' stored games: about ' + escape(any.expected_opportunity) + ' ' + escape(any.unit) + ' expected' + (any.regular_role ? '' : ' (a smaller role than the check covers, so it stays experimental)') +
        ', opponent factor ' + escape(any.opponent_factor) + ', ' + (F.home ? 'home' : 'away') + '. Model fitted on games through ' + escape(any.as_of_date ? fmtDay(any.as_of_date) + ' ' + any.as_of_date.slice(0, 4) : '—') + '. A forecast, not a promise: ' +
        (lg === 'nba' ? 'rest and role changes are not in the data; regular teammates listed out are counted for the stats where that helped in testing.' : 'the player’s own injury and rest are not in the data; the game’s spread and total and his recent snap share count only for the stats where that helped in testing.') + '</p>' : '');
  }
  function recentGamesHtml(P, lg) {
    const list = P.games.slice(0, 6), ks = keyStats(P, lg).slice(0, 5);
    if (!list.length) return '';
    return '<h5>Last games</h5><div class="sp-table-wrap"><table class="sp-table sp-log" data-nosort><thead><tr><th>Date</th><th>Game</th><th>Result</th>' + (lg === 'nba' ? '<th class="sp-n">Min</th>' : '') +
      ks.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') + '</tr></thead><tbody>' +
      list.map((g) => '<tr' + (g.played ? '' : ' class="sp-dnp"') + '><td>' + escape(fmtDay(g.date)) + '</td><td>' + (g.home ? 'vs ' : '@ ') + team(g.opponent) + (g.played ? '' : ' <span class="sp-muted">did not play</span>') + '</td><td>' + resultHtml(g) + '</td>' +
        (lg === 'nba' ? '<td class="sp-n">' + num(g.minutes) + '</td>' : '') + ks.map((st) => '<td class="sp-n">' + (g.played ? num(gv(g, st)) : '—') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function upcomingHtml(P, lg) {
    const U = P.upcoming || [];
    if (!U.length) return '<p class="sp-muted">No upcoming games stored for the player’s team.</p>';
    const ks = keyStats(P, lg).slice(0, 3);
    const first = U.find((u) => u.opponent_team), O0 = first && first.opponent_team;
    const gst = O0 ? Object.keys(O0.allowed) : [];
    const grp = O0 ? GROUP_NAMES[O0.group] || O0.group : '';
    const head = '<tr><th>Game</th><th class="sp-n" title="Days since each team’s previous game">Rest</th><th class="sp-n" title="The player’s team spread (− = favored) and the game total">Spread · total</th><th class="sp-n" title="Team model’s chance the player’s team wins">Team win</th>' +
      '<th class="sp-n">Opponent</th><th class="sp-n" title="Points the opponent allows per game, rank (1st = fewest)">Allows</th>' +
      gst.map((st) => '<th class="sp-n" title="' + escape(label(st) + ' the opponent allows per game to ' + String(grp).toLowerCase() + ' (1st = fewest)') + '">' + escape(SHORT[st] || st) + ' to ' + escape(O0.group) + '</th>').join('') +
      '<th class="sp-n">Average vs them</th><th data-nosort></th></tr>';
    const rows = U.map((u) => {
      const O = u.opponent_team;
      return '<tr><td><b>' + (u.home ? 'vs ' : '@ ') + team(u.opponent) + '</b> <small class="sp-muted sp-nw">' + escape(u.time_tbd ? fmtDay(u.local_date) + ' · TBD' : fmtWhen(u.start_utc, zone())) + (u.week != null ? ' · wk ' + escape(u.week) : '') + '</small></td>' +
        '<td class="sp-n">' + (u.rest_days == null ? '—' : escape(u.rest_days) + 'd') + (u.opponent_rest_days != null ? ' <small class="sp-muted">opp ' + escape(u.opponent_rest_days) + 'd</small>' : '') + '</td>' +
        '<td class="sp-n">' + linesText(u.lines) + '</td><td class="sp-n">' + (isNum(u.win_chance) ? '<b>' + pct0(u.win_chance) + '</b>' : '—') + '</td>' +
        '<td class="sp-n">' + (O ? '<span class="sp-nw">' + escape(O.record) + '</span> <small class="sp-muted">' + (O.last_season ? escape(seasonLabel(lg, O.season)) : 'L10 ' + escape(O.last10)) + '</small>' : '—') + '</td>' +
        '<td class="sp-n">' + (O ? escape(f1(O.points_against)) + rankTip(O.points_against_rank, O.teams, 'Points allowed') : '—') + '</td>' +
        gst.map((st) => '<td class="sp-n">' + (O && O.allowed[st] != null ? escape(f1(O.allowed[st])) + rankTip(O.allowed_rank[st], O.teams, label(st) + ' allowed to ' + String(grp).toLowerCase()) + toughTag(O.allowed_rank[st], O.teams) : '—') + '</td>').join('') +
        '<td class="sp-n">' + (u.vs ? ks.map((st) => escape(SHORT[st] || st) + ' ' + escape(f1(u.vs.values[st]))).join(' · ') + ' <small class="sp-muted">' + u.vs.games + 'g</small>' : '<span class="sp-muted">never</span>') + '</td>' +
        '<td><button type="button" class="sp-link" data-sp-pp-game="' + escape(u.game_id) + '">Open game</button></td></tr>';
    }).join('');
    return '<div class="sp-table-wrap"><table class="sp-table sp-mx-table sp-pp-up" data-nosort><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="sp-note">The team’s next ' + U.length + ' stored game' + (U.length === 1 ? '' : 's') + '. Opponent numbers are this season so far (last season’s, labeled, for a team that has not played yet); ranks are among ' + (O0 ? O0.teams : 'all') + ' teams, 1st = fewest allowed, so a “soft” defense (bottom fifth) gives up the most to ' + escape(String(grp).toLowerCase() || 'the position') + '. ' +
      'Spreads and totals appear once stored (NBA: about a day before the game). Average vs them covers every stored game against that team. “Open game” shows both teams, the matchup and team bets.</p>';
  }
  function opponentsHtml(P, lg) {
    const list = playedGames(P), ks = keyStats(P, lg).slice(0, 4);
    if (!list.length) return '<p class="sp-muted">No played games stored.</p>';
    const all = Object.fromEntries(ks.map((st) => [st, avgStat(list, st)]));
    const by = new Map();
    list.forEach((g) => { if (!by.has(g.opponent)) by.set(g.opponent, []); by.get(g.opponent).push(g); });
    const rows = [...by].sort((a, b) => b[1].length - a[1].length || b[1][0].date.localeCompare(a[1][0].date)).map(([o, gs]) => {
      const w = gs.filter((g) => isNum(g.team_score) && g.team_score > g.opp_score).length, l = gs.filter((g) => isNum(g.team_score) && g.team_score < g.opp_score).length;
      return '<tr><td>' + team(o) + '</td><td class="sp-n">' + gs.length + '</td>' + ks.map((st) => { const a = avgStat(gs, st); return '<td class="sp-n"><span class="' + (a == null || all[st] == null ? '' : a > all[st] ? 'sp-pos' : a < all[st] ? 'sp-neg' : '') + '">' + escape(f1(a)) + '</span></td>'; }).join('') +
        '<td class="sp-n"><span class="sp-nw">' + (w + l ? w + '-' + l : '—') + '</span></td><td class="sp-n">' + escape(fmtDay(gs[0].date)) + ' <small class="sp-muted">' + escape(String(gs[0].date).slice(0, 4)) + '</small></td></tr>';
    }).join('');
    return '<div class="sp-table-wrap"><table class="sp-table sp-pp-opp"><thead><tr><th>Opponent</th><th class="sp-n">Games</th>' + ks.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') + '<th class="sp-n" title="The team’s record in those games">Team W-L</th><th class="sp-n">Last met</th></tr></thead><tbody>' +
      '<tr class="sp-key"><td>All teams</td><td class="sp-n">' + list.length + '</td>' + ks.map((st) => '<td class="sp-n">' + escape(f1(all[st])) + '</td>').join('') + '<td></td><td></td></tr>' + rows + '</tbody></table></div>' +
      '<p class="sp-note">Averages against each team in the ' + list.length + ' played games stored here' + (P.total_games > P.games.length ? ' (the newest ' + P.games.length + ' of ' + P.total_games + ')' : '') + '; green above the overall average, red below. One or two games against a team say little. Select a column to sort.</p>';
  }
  function seasonsHtml(P, lg) {
    const ks = keyStats(P, lg).slice(0, 5), seasons = [...new Set(P.games.map((g) => g.season))].sort((a, b) => b - a);
    if (!seasons.length) return '<p class="sp-muted">No games stored.</p>';
    const rows = seasons.map((y) => {
      const gs = P.games.filter((g) => g.season === y), pl = gs.filter((g) => g.played);
      const home = pl.filter((g) => g.home), away = pl.filter((g) => !g.home), st0 = ks[0];
      return '<tr><td>' + escape(seasonLabel(lg, y)) + '</td><td class="sp-n">' + pl.length + (gs.length > pl.length ? ' <small class="sp-muted">+' + (gs.length - pl.length) + ' missed</small>' : '') + '</td>' +
        (lg === 'nba' ? '<td class="sp-n">' + escape(f1(avgStat(pl, 'minutes'))) + '</td>' : '') + ks.map((st) => '<td class="sp-n">' + escape(f1(avgStat(pl, st))) + '</td>').join('') +
        (st0 ? '<td class="sp-n">' + escape(f1(avgStat(home, st0))) + ' · ' + escape(f1(avgStat(away, st0))) + '</td>' : '') + '</tr>';
    }).join('');
    return '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Season</th><th class="sp-n">Games</th>' + (lg === 'nba' ? '<th class="sp-n">Min</th>' : '') + ks.map((st) => '<th class="sp-n" title="' + escape(label(st)) + '">' + escape(SHORT[st] || st) + '</th>').join('') +
      (ks[0] ? '<th class="sp-n" title="' + escape(label(ks[0]) + ' at home and away') + '">' + escape(SHORT[ks[0]] || ks[0]) + ' home · away</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="sp-note">Per-game averages in the games stored here' + (P.total_games > P.games.length ? ' (the newest ' + P.games.length + ' of ' + P.total_games + ', so the oldest season may be partial)' : '') + '. Playoff games count in their season.</p>';
  }
  function playerTabHtml(lg, tab) {
    const L = league(lg), P = L.player;
    if (tab === 'upcoming') return upcomingHtml(P, lg);
    if (tab === 'charts') return chartStats(P).length ? '<div class="sp-charts" data-sp-part="chart">' + chartHtml(lg) + '</div>' : '<p class="sp-muted">No stored games to chart.</p>';
    if (tab === 'log') return '<h5>Averages over ' + num(P.total_games) + ' stored game' + (P.total_games === 1 ? '' : 's') + '</h5><div data-sp-part="logset">' + playerTablesHtml(lg) + '</div>' +
      '<p class="sp-note">' + (lg === 'nba'
        ? 'Games the player missed are listed as did not play and left out of the averages.'
        : 'Games where the player was on the field but recorded no stat are counted as zero (from the snap counts); games he did not play are not listed.') + '</p>';
    if (tab === 'opponents') return opponentsHtml(P, lg);
    if (tab === 'seasons') return seasonsHtml(P, lg);
    if (tab === 'pick') return pickFormHtml(lg, P, 'league');
    return forecastBlockHtml(P, lg) + recentGamesHtml(P, lg);
  }
  function playerPanelHtml(lg) {
    const L = league(lg);
    if (!L.playerId) return '';
    const back = '<div class="sp-pp-top"><button type="button" class="sp-back" data-sp-close="player">← Back to ' + escape(BACK_TO[L.view] || 'games') + '</button></div>';
    if (L.playerErr) return '<div class="sp-panel sp-ppage" data-sp-panel="player">' + back + errorBox(L.playerErr, 'player') + '</div>';
    if (!L.player) return '<div class="sp-panel sp-ppage" data-sp-panel="player">' + back + '<p class="sp-loading">Loading the player…</p></div>';
    const P = L.player, tab = PTABS.some(([k]) => k === L.ptab) ? L.ptab : 'overview';
    const meta = [P.player.position, P.player.team ? String(P.player.team).toUpperCase() : null].filter(Boolean).join(' · ');
    const a = P.availability, listed = a && a.state === 'ok' && a.status && a.status !== 'not listed' ? ' <span class="sp-out">' + escape(a.status) + '</span>' : '';
    return '<div class="sp-panel sp-ppage" data-sp-panel="player">' + back +
      '<div class="sp-pp-head"><div class="sp-pp-who"><h3 class="sp-pp-name">' + escape(P.player.name) + '</h3><p class="sp-muted">' + escape(meta) + listed + '</p></div>' + nextGameBoxHtml(P, lg) + '</div>' +
      playerTilesHtml(P, lg) +
      '<div class="sp-ptabs" role="tablist" aria-label="Player page">' + PTABS.map(([k, t]) => '<button type="button" role="tab" data-sp-ptab="' + k + '" aria-selected="' + (k === tab ? 'true' : 'false') + '" tabindex="' + (k === tab ? '0' : '-1') + '">' + escape(t) + '</button>').join('') + '</div>' +
      '<div class="sp-ptab-body" role="tabpanel" aria-label="' + escape((PTABS.find(([k]) => k === tab) || PTABS[0])[1]) + '" data-sp-part="ptab">' + playerTabHtml(lg, tab) + '</div></div>';
  }

  // ---- Charts --------------------------------------------------------------
  // Drawn as plain SVG and HTML (the page has no chart library). Hover and
  // tap readouts use the site's shared engine when the page passes it in
  // (options.hover). Every chart reads only the player's stored games.
  const hoverAttr = (pts) => (options.hover ? options.hover(pts) : '');
  const narrowScreen = () => (host.innerWidth || 1024) < 560;
  const gv = (g, st) => (st === 'minutes' ? g.minutes : g.stats ? g.stats[st] : null);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const avgOf = (xs) => (xs.length ? sum(xs) / xs.length : null);
  const sdOf = (xs) => { const m = avgOf(xs); return xs.length > 1 ? Math.sqrt(sum(xs.map((x) => (x - m) * (x - m))) / (xs.length - 1)) : 0; };
  const medianOf = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const f1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—');
  const fv = (v) => (isNum(v) ? (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toFixed(1)) : '—');
  const sideCls = (v, ref) => (ref == null ? 'is-at' : v > ref ? 'is-over' : v < ref ? 'is-under' : 'is-at');
  const unitWord = (st) => ({ threes: 'threes', touchdowns: 'TDs', fantasy: 'fantasy points' })[st] || (statGroup(st) === 'combo' ? SHORT[st] : label(st).toLowerCase());
  const seasonLabel = (lg, y) => (lg === 'nba' ? y + '–' + String(y + 1).slice(2) : String(y));
  function niceStep(raw, steps) {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const s of steps || [1, 2, 2.5, 5, 10]) if (s * mag >= raw - 1e-9) return s * mag;
    return 10 * mag;
  }
  function axisTicks(lo, hi, target) {
    const step = niceStep((hi - lo) / Math.max(1, target - 1));
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 && out.length < 12; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  // A line or dot chart does not need zero on its axis: pad the data range
  // and stop at zero only when the data is near it.
  function tightRange(xs) {
    let lo = Math.min(...xs), hi = Math.max(...xs);
    const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.04, 0.5);
    lo -= pad; hi += pad;
    if (Math.min(...xs) >= 0 && lo < 0) lo = 0;
    return [lo, hi];
  }
  // Charts are drawn at the width of their box (measured after each paint,
  // fitCharts below), so they fill the card instead of stopping at 720 px.
  let chartW = 0;
  function frame() {
    const narrow = narrowScreen();
    const W = chartW > 0 ? Math.round(Math.max(280, Math.min(1600, chartW))) : narrow ? 360 : 720;
    return { narrow, W, H: narrow ? 230 : W >= 900 ? 280 : 260, L: 38, R: 46, T: 14, B: 36 };
  }
  function fitCharts(page) {
    const lg = leagueOf(page), el = lg && league(lg).player ? part(page, 'chart-body') : null;
    const w = el ? el.clientWidth : 0;
    if (!(w > 0) || Math.abs(w - chartW) < 16) return;
    chartW = w;
    el.innerHTML = chartBodyHtml(lg);
  }
  const svgOpen = (f, label, extra) => '<svg class="sp-ch" viewBox="0 0 ' + f.W + ' ' + f.H + '" style="max-width:' + f.W + 'px" role="img" aria-label="' + escape(label) + '"' + (extra || '') + '>';
  function yAxis(f, lo, hi) {
    const ih = f.H - f.T - f.B;
    const y = (v) => f.T + ((hi - v) / (hi - lo)) * ih;
    const grid = axisTicks(lo, hi, f.narrow ? 4 : 6).map((t) => '<line class="sp-ch-grid' + (t === 0 ? ' is-zero' : '') + '" x1="' + f.L + '" x2="' + (f.W - f.R) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/>' +
      '<text class="sp-ch-axis" x="' + (f.L - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end">' + escape(fv(t)) + '</text>').join('');
    return { y, grid };
  }
  // The average (dashed) and the typed line (solid) across the plot, each
  // with its value in the right-hand margin.
  function refLines(f, y, D) {
    const x2 = f.W - f.R;
    const tags = [];
    let h = '';
    if (isNum(D.avg)) { h += '<line class="sp-ch-avg" x1="' + f.L + '" x2="' + x2 + '" y1="' + y(D.avg).toFixed(1) + '" y2="' + y(D.avg).toFixed(1) + '"/>'; tags.push(['sp-ch-tag-avg', y(D.avg), f1(D.avg)]); }
    if (isNum(D.line)) { h += '<line class="sp-ch-ref" x1="' + f.L + '" x2="' + x2 + '" y1="' + y(D.line).toFixed(1) + '" y2="' + y(D.line).toFixed(1) + '"/>'; tags.push(['sp-ch-tag-ref', y(D.line), fv(D.line)]); }
    if (tags.length === 2 && Math.abs(tags[0][1] - tags[1][1]) < 12) {
      const up = tags[0][1] <= tags[1][1] ? 0 : 1;
      tags[up][1] -= 6; tags[1 - up][1] += 6;
    }
    return h + tags.map((t) => '<text class="sp-ch-tag ' + t[0] + '" x="' + (x2 + 4) + '" y="' + (t[1] + 3.5).toFixed(1) + '">' + escape(t[2]) + '</text>').join('');
  }
  function legendHtml(D, extra) {
    const over = isNum(D.line) ? 'Over ' + fv(D.line) : 'Above the average', under = isNum(D.line) ? 'Under' : 'Below';
    return '<p class="sp-ch-legend"><span><i class="sp-swatch is-over"></i>' + escape(over) + '</span><span><i class="sp-swatch is-under"></i>' + escape(under) + '</span>' +
      '<span><i class="sp-key-line sp-key-avg"></i>Average ' + escape(f1(D.avg)) + '</span>' +
      (isNum(D.line) ? '<span><i class="sp-key-line sp-key-ref"></i>Line ' + escape(fv(D.line)) + '</span>' : '') + (extra || '') + '</p>';
  }
  function tipText(D, it) {
    const word = isNum(D.line) ? (it.v > D.line ? 'over ' + fv(D.line) : it.v < D.line ? 'under ' + fv(D.line) : 'on the line') : (it.v > D.avg ? 'above the average' : it.v < D.avg ? 'below the average' : 'on the average');
    return it.when + '\n' + fv(it.v) + ' ' + (D.unitText || unitWord(D.stat)) + ' · ' + word;
  }

  // Bars: one per game, oldest on the left. Green above the average (or the
  // typed line), red below.
  function barsSvg(D) {
    const f = frame(), n = D.items.length, vals = D.vals;
    let lo = Math.min(0, ...vals), hi = Math.max(...vals, D.avg, isNum(D.line) ? D.line : -Infinity);
    if (!(hi > lo)) hi = lo + 1;
    hi += (hi - lo) * 0.12;
    const { y, grid } = yAxis(f, lo, hi);
    const iw = f.W - f.L - f.R, slot = iw / n, bw = Math.max(2, Math.min(44, slot * 0.68));
    const showVals = n <= (f.narrow ? 10 : 20), showOpp = n <= (f.narrow ? 10 : 20), showDate = !f.narrow && n <= 12;
    // Opponent labels: one row when they fit their slot, two staggered rows
    // when they do not, and only every other one when even that is tight.
    const labelW = Math.max(...D.items.map((it) => ((it.home ? '' : '@') + String(it.opp || '')).length)) * 6.4 + 6;
    const oppRows = labelW <= slot ? 1 : 2, oppEvery = labelW <= slot * 2 ? 1 : Math.ceil(labelW / (slot * 2));
    let bars = '', vl = '', xl = '';
    const hov = [];
    D.items.forEach((it, i) => {
      const cx = f.L + slot * (i + 0.5), y0 = y(0), yv = y(it.v);
      const top = Math.min(y0, yv), h = Math.max(1.5, Math.abs(yv - y0));
      bars += '<rect class="sp-bar ' + sideCls(it.v, D.ref) + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (it.v === 0 ? y0 - 1.5 : top).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2"/>';
      if (showVals) vl += '<text class="sp-ch-val" x="' + cx.toFixed(1) + '" y="' + (it.v >= 0 ? top - 4 : top + h + 11).toFixed(1) + '" text-anchor="middle">' + escape(fv(it.v)) + '</text>';
      const row = oppRows === 2 ? Math.floor(i / oppEvery) % 2 : 0; // the shown labels alternate rows
      if (showOpp && i % oppEvery === 0) xl += '<text class="sp-ch-axis" x="' + cx.toFixed(1) + '" y="' + (f.H - f.B + 14 + row * 12) + '" text-anchor="middle">' + (it.home ? '' : '@') + team(it.opp) + '</text>';
      if (showDate && oppRows === 1) xl += '<text class="sp-ch-axis sp-ch-sub" x="' + cx.toFixed(1) + '" y="' + (f.H - f.B + 27) + '" text-anchor="middle">' + escape(shortDate(it.date)) + '</text>';
      hov.push({ x: cx, y: Math.min(yv, y0), label: tipText(D, it) });
    });
    if (!showOpp) xl = dateTicks(f, D.items, (i) => f.L + slot * (i + 0.5));
    return svgOpen(f, label(D.stat) + ' by game, ' + n + ' games, average ' + f1(D.avg), hoverAttr(hov)) + grid + bars + refLines(f, y, D) + vl + xl + '</svg>';
  }
  function shortDate(d) { const p = String(d).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function dateTicks(f, items, xOf) {
    const n = items.length, idx = [...new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1])];
    return idx.map((i) => '<text class="sp-ch-axis" x="' + xOf(i).toFixed(1) + '" y="' + (f.H - f.B + 14) + '" text-anchor="' + (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + escape(shortDate(items[i].date) + '/' + String(items[i].date).slice(2, 4)) + '</text>').join('');
  }

  // Trend: the game-by-game line, a five-game moving average and the reference.
  function trendSvg(D) {
    const f = frame(), n = D.items.length, vals = D.vals, rolls = D.items.map((it) => it.roll);
    const [lo, hi] = tightRange(vals.concat(rolls, [D.avg], isNum(D.line) ? [D.line] : []));
    const { y, grid } = yAxis(f, lo, hi);
    const iw = f.W - f.L - f.R;
    const x = (i) => (n === 1 ? f.L + iw / 2 : f.L + (i * iw) / (n - 1));
    const line = D.items.map((it, i) => x(i).toFixed(1) + ',' + y(it.v).toFixed(1)).join(' ');
    const roll = D.items.map((it, i) => x(i).toFixed(1) + ',' + y(it.roll).toFixed(1)).join(' ');
    const r = n > 40 ? 2.5 : 3.5;
    const dots = D.items.map((it, i) => '<circle class="sp-dot ' + sideCls(it.v, D.ref) + '" cx="' + x(i).toFixed(1) + '" cy="' + y(it.v).toFixed(1) + '" r="' + r + '"/>').join('');
    const hov = D.items.map((it, i) => ({ x: x(i), y: y(it.v), label: tipText(D, it) + '\n5-game average ' + f1(it.roll) }));
    return svgOpen(f, label(D.stat) + ' trend over ' + n + ' games', hoverAttr(hov)) + grid + refLines(f, y, D) +
      (n > 1 ? '<polyline class="sp-ch-roll" points="' + roll + '"/><polyline class="sp-ch-line" points="' + line + '"/>' : '') + dots + dateTicks(f, D.items, x) + '</svg>';
  }

  // Spread: how many games landed in each range of values.
  function spreadSvg(D) {
    const f = frame(), vals = D.vals;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const whole = vals.every((v) => Number.isInteger(v));
    let step = niceStep((mx - mn) / (f.narrow ? 6 : 9), [1, 2, 5, 10]);
    if (whole) step = Math.max(1, Math.round(step));
    const start = Math.floor(mn / step) * step;
    const bins = [];
    for (let b = start; b <= mx + 1e-9 && bins.length < 40; b += step) bins.push({ b, n: 0 });
    vals.forEach((v) => { const k = Math.min(bins.length - 1, Math.floor((v - start) / step + 1e-9)); bins[k].n++; });
    const end = start + bins.length * step, top = Math.max(...bins.map((x) => x.n));
    const { y, grid } = yAxis(f, 0, top + Math.max(1, top * 0.15));
    const iw = f.W - f.L - f.R, bw = iw / bins.length;
    const xv = (v) => f.L + ((v - start) / (end - start)) * iw;
    const range = (b) => (whole ? (step === 1 ? fv(b) : fv(b) + '–' + fv(b + step - 1)) : fv(b) + ' to ' + fv(b + step));
    const cls = (b) => (D.ref == null ? 'is-at' : b + (whole ? step - 1 : step) < D.ref ? 'is-under' : b > D.ref ? 'is-over' : 'is-at');
    const every = bins.length > (f.narrow ? 7 : 12) ? 2 : 1;
    let h = '';
    const hov = [];
    bins.forEach((x, i) => {
      const x0 = f.L + i * bw, yy = y(x.n);
      if (x.n) h += '<rect class="sp-bar ' + cls(x.b) + '" x="' + (x0 + 1.5).toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + Math.max(1, bw - 3).toFixed(1) + '" height="' + (y(0) - yy).toFixed(1) + '" rx="2"/>';
      if (i % every === 0) h += '<text class="sp-ch-axis" x="' + (x0 + bw / 2).toFixed(1) + '" y="' + (f.H - f.B + 14) + '" text-anchor="middle">' + escape(fv(x.b)) + '</text>';
      hov.push({ x: x0 + bw / 2, y: yy, label: range(x.b) + ' ' + unitWord(D.stat) + '\n' + x.n + ' of ' + vals.length + ' games (' + Math.round((x.n / vals.length) * 100) + '%)' });
    });
    const vline = (v, c) => (isNum(v) && v >= start && v <= end ? '<line class="' + c + '" x1="' + xv(v).toFixed(1) + '" x2="' + xv(v).toFixed(1) + '" y1="' + f.T + '" y2="' + (f.H - f.B) + '"/>' : '');
    return svgOpen(f, label(D.stat) + ': how often each range happened', hoverAttr(hov)) + grid + h + vline(D.avg, 'sp-ch-avg') + vline(D.line, 'sp-ch-ref') + '</svg>';
  }

  // The stat against the playing time (NBA) or the volume behind it (NFL).
  const OPPORTUNITY = { passing_yards: 'attempts', completions: 'attempts', passing_tds: 'attempts', interceptions: 'attempts', receptions: 'targets', receiving_yards: 'targets', receiving_tds: 'targets', rushing_yards: 'carries', rushing_tds: 'carries' };
  const UNIT_ONE = { minutes: 'minute', attempts: 'pass attempt', targets: 'target', carries: 'carry' };
  const UNIT_MANY = { minutes: 'minutes', attempts: 'pass attempts', targets: 'targets', carries: 'carries' };
  function opportunityStat(lg, stat) { return lg === 'nba' ? (stat === 'minutes' ? null : 'minutes') : OPPORTUNITY[stat] || null; }
  function volumeSvg(D, lg) {
    const os = opportunityStat(lg, D.stat);
    const pts = D.items.map((it) => ({ it, x: gv(it.g, os) })).filter((p) => isNum(p.x));
    if (pts.length < 3) return '<p class="sp-muted">Too few games with ' + escape(label(os).toLowerCase()) + ' to draw this.</p>';
    const f = frame(), xs = pts.map((p) => p.x), ys = pts.map((p) => p.it.v);
    let xlo = Math.max(0, Math.min(...xs) * 0.9), xhi = Math.max(...xs) * 1.05;
    if (!(xhi > xlo)) xhi = xlo + 1;
    const [lo, hi] = tightRange(ys.concat([D.avg], isNum(D.line) ? [D.line] : []));
    const { y, grid } = yAxis(f, lo, hi);
    const iw = f.W - f.L - f.R;
    const x = (v) => f.L + ((v - xlo) / (xhi - xlo)) * iw;
    const sx = sum(xs), rate = sx > 0 ? sum(ys) / sx : null;
    const xt = axisTicks(xlo, xhi, f.narrow ? 4 : 6).map((t) => '<text class="sp-ch-axis" x="' + x(t).toFixed(1) + '" y="' + (f.H - f.B + 14) + '" text-anchor="middle">' + escape(fv(t)) + '</text>').join('');
    // The rate line, drawn only where it stays inside the plot.
    let fit = '';
    if (rate != null && rate > 0) {
      const a = Math.max(xlo, lo / rate), b = Math.min(xhi, hi / rate);
      if (b > a) fit = '<line class="sp-ch-fit" x1="' + x(a).toFixed(1) + '" y1="' + y(rate * a).toFixed(1) + '" x2="' + x(b).toFixed(1) + '" y2="' + y(rate * b).toFixed(1) + '"/>';
    }
    const dots = pts.map((p) => '<circle class="sp-dot ' + sideCls(p.it.v, D.ref) + '" cx="' + x(p.x).toFixed(1) + '" cy="' + y(p.it.v).toFixed(1) + '" r="4"/>').join('');
    const unit = UNIT_MANY[os];
    const hov = pts.map((p) => ({ x: x(p.x), y: y(p.it.v), label: p.it.when + '\n' + fv(p.x) + ' ' + unit + ' · ' + fv(p.it.v) + ' ' + unitWord(D.stat) }));
    const svg = svgOpen(f, label(D.stat) + ' against ' + label(os).toLowerCase(), ' data-ch-xy' + hoverAttr(hov)) + grid + refLines(f, y, D) + fit + dots + xt +
      '<text class="sp-ch-axis" x="' + (f.W - f.R) + '" y="' + (f.H - 4) + '" text-anchor="end">' + escape(label(os)) + ' →</text></svg>';
    const per = rate != null ? '<p class="sp-note">' + escape(rate < 10 ? rate.toFixed(2) : f1(rate)) + ' ' + escape(unitWord(D.stat)) + ' per ' + escape(UNIT_ONE[os]) +
      ' over these games (the dotted line). ' + escape(lg === 'nba' ? 'Playing time' : 'Volume') + ' averaged ' + escape(f1(avgOf(xs))) + ' ' + escape(unit) + '. The stat model works the same way: expected ' + escape(unit) + ' times a rate.</p>' : '';
    return svg + per;
  }

  // Hit rates: how often the player cleared each line, in the games shown.
  function hitsHtml(D) {
    const vals = D.vals, n = vals.length;
    const s = Math.max(1, Math.round(niceStep(Math.max(0.5, sdOf(vals) / 4), [1, 2, 5, 10])));
    const center = Math.round((D.ref ?? D.avg) / s) * s;
    let lines = [];
    for (let k = -7; k <= 7; k++) { const t = center + k * s - 0.5; if (t > 0) lines.push(t); }
    if (isNum(D.line) && !lines.includes(D.line)) lines.push(D.line);
    lines = [...new Set(lines)].sort((a, b) => a - b);
    // Keep one line where every game cleared and one where none did.
    const overAt = (t) => vals.filter((v) => v > t).length;
    while (lines.length > 3 && overAt(lines[1]) === n && lines[1] !== D.line && lines[0] !== D.line) lines.shift();
    while (lines.length > 3 && overAt(lines[lines.length - 2]) === 0 && lines[lines.length - 2] !== D.line && lines[lines.length - 1] !== D.line) lines.pop();
    const near = lines.reduce((best, t) => (Math.abs(t - D.avg) < Math.abs(best - D.avg) ? t : best), lines[0]);
    const rows = lines.map((t) => {
      const over = vals.filter((v) => v > t).length, under = vals.filter((v) => v < t).length, push = n - over - under;
      const po = (over / n) * 100, pu = (under / n) * 100;
      return '<li class="sp-hit' + (t === D.line ? ' is-line' : '') + '"><span class="sp-hit-t">Over ' + escape(fv(t)) + (t === near ? ' <small>near avg</small>' : '') + '</span>' +
        '<span class="sp-hit-bar" role="img" aria-label="' + over + ' over, ' + under + ' under' + (push ? ', ' + push + ' on the line' : '') + '"><i class="is-over" style="width:' + po.toFixed(1) + '%"></i><i class="is-under" style="width:' + pu.toFixed(1) + '%"></i></span>' +
        '<span class="sp-hit-n"><b>' + over + '/' + n + '</b> ' + Math.round(po) + '%' + (push ? ' <small>' + push + ' push</small>' : '') + '</span></li>';
    }).join('');
    return '<ul class="sp-hits">' + rows + '</ul><p class="sp-note">Share of these ' + n + ' games above each line (green) and below it (red). What happened, not a forecast.</p>';
  }

  // Splits: the same games grouped by place, role, rest, opponent and season.
  // The split bars shared by Splits and Game script: one block per group,
  // one bar per row (the average of the games in it), the reference marked.
  function splitBlocksHtml(D, it, groups) {
    const built = groups.map(([name, defs, ranked]) => {
      const rows = defs.map(([lab, fn]) => { const v = it.filter(fn).map((x) => x.v); return { lab, n: v.length, avg: avgOf(v), over: D.ref == null ? 0 : v.filter((a) => a > D.ref).length }; }).filter((x) => x.n);
      if (ranked) rows.sort((a, b) => b.avg - a.avg || b.n - a.n);
      return [name, rows];
    });
    const max = Math.max(D.ref || 0, ...built.flatMap((g) => g[1].map((x) => x.avg))) || 1;
    const refPct = isNum(D.ref) ? Math.max(0, Math.min(100, (D.ref / max) * 100)) : null;
    const word = isNum(D.line) ? 'over ' + fv(D.line) : 'above avg';
    return built.filter((g) => g[1].length).map(([name, rows]) => '<div class="sp-split"><h6>' + escape(name) + '</h6><ul>' + rows.map((x) =>
      '<li><span class="sp-split-name">' + escape(x.lab) + '</span><span class="sp-split-track"><i class="sp-split-bar ' + sideCls(x.avg, D.ref) + '" style="width:' + Math.max(1, (Math.max(0, x.avg) / max) * 100).toFixed(1) + '%"></i>' +
      (refPct != null ? '<i class="sp-split-ref" style="left:' + refPct.toFixed(1) + '%"></i>' : '') + '</span>' +
      '<span class="sp-split-val"><b>' + escape(f1(x.avg)) + '</b> <small>' + x.n + ' g · ' + x.over + ' ' + escape(word) + '</small></span></li>').join('') + '</ul></div>').join('');
  }
  function splitsHtml(D, lg) {
    const it = D.items;
    const groups = [['Home or away', [['Home', (x) => x.home], ['Away', (x) => !x.home]]]];
    if (lg === 'nba' && it.some((x) => x.g.starter === true) && it.some((x) => x.g.starter === false)) groups.push(['Role', [['Started', (x) => x.g.starter === true], ['Off the bench', (x) => x.g.starter === false]]]);
    const r = (x) => x.g.rest_days;
    groups.push(['Rest before the game', lg === 'nba'
      ? [['Back-to-back', (x) => r(x) === 1], ['One day off', (x) => r(x) === 2], ['Two or more days off', (x) => r(x) >= 3]]
      : [['Short week (5 days or less)', (x) => r(x) != null && r(x) <= 5], ['Normal week (6–8 days)', (x) => r(x) >= 6 && r(x) <= 8], ['Extra rest (9+ days)', (x) => r(x) >= 9]]]);
    const opps = [...new Set(it.map((x) => x.opp))];
    groups.push(['Opponent', opps.map((o) => ['vs ' + String(o).toUpperCase(), (x) => x.opp === o]), true]);
    const seasons = [...new Set(it.map((x) => x.g.season))];
    if (seasons.length > 1) groups.push(['Season', seasons.sort().map((s) => [seasonLabel(lg, s), (x) => x.g.season === s])]);
    return splitBlocksHtml(D, it, groups) +
      '<p class="sp-note">Average in each group of the games shown; the thin mark is ' + (isNum(D.line) ? 'the line' : 'the average of all of them') + '. Small groups swing a lot.' +
      (lg === 'nfl' ? ' Rest is days since the team’s previous game.' : ' Rest counts days since the team’s previous game; a back-to-back is the second of two days in a row.') + '</p>';
  }

  // Game script: the same games grouped by how the team's game went (final
  // score, and the spread and total where the game file stores them).
  function scriptHtml(D, lg) {
    const it = D.items.filter((x) => isNum(x.g.team_score) && isNum(x.g.opp_score));
    if (it.length < 3) return '<p class="sp-muted">Too few games with a stored final score to split.</p>';
    const C = lg === 'nfl' ? 8 : 5, B = lg === 'nfl' ? 14 : 15;
    const m = (x) => x.g.team_score - x.g.opp_score;
    const ts = medianOf(it.map((x) => x.g.team_score)), tot = medianOf(it.map((x) => x.g.team_score + x.g.opp_score));
    const groups = [
      ['Result', [['Team won', (x) => m(x) > 0], ['Team lost', (x) => m(x) < 0]]],
      ['Final margin', [['Close (' + C + ' or fewer)', (x) => Math.abs(m(x)) <= C], ['In between', (x) => Math.abs(m(x)) > C && Math.abs(m(x)) < B], ['Won by ' + B + '+', (x) => m(x) >= B], ['Lost by ' + B + '+', (x) => m(x) <= -B]]],
      ['Team points', [['Team scored ' + fv(ts) + '+', (x) => x.g.team_score >= ts], ['Team scored under ' + fv(ts), (x) => x.g.team_score < ts]]],
      ['Game total', [['High-scoring (' + fv(tot) + '+)', (x) => x.g.team_score + x.g.opp_score >= tot], ['Low-scoring (under ' + fv(tot) + ')', (x) => x.g.team_score + x.g.opp_score < tot]]],
    ];
    const lined = it.filter((x) => isNum(x.g.line_margin) && isNum(x.g.line_total));
    if (lined.length >= 3) {
      const lt = medianOf(lined.map((x) => x.g.line_total));
      groups.push(['Spread before the game', [['Team favored', (x) => isNum(x.g.line_margin) && x.g.line_margin > 0], ['Team underdog', (x) => isNum(x.g.line_margin) && x.g.line_margin < 0]]]);
      groups.push(['Expected total', [['Total ' + fv(lt) + '+', (x) => isNum(x.g.line_total) && x.g.line_total >= lt], ['Total under ' + fv(lt), (x) => isNum(x.g.line_total) && x.g.line_total < lt]]]);
    }
    return splitBlocksHtml(D, it, groups) +
      '<p class="sp-note">Average in each group of the ' + it.length + ' games shown with a final score; the thin mark is ' + (isNum(D.line) ? 'the line' : 'the average of all of them') + '. Blowouts often cut starters’ ' + (lg === 'nba' ? 'minutes' : 'snaps') + '; a trailing team throws more. ' +
      (lined.length >= 3 ? 'The spread and total are the closing numbers from the schedule.' : lg === 'nba' ? 'NBA spreads are stored only since November 2026, so the favored / underdog split appears once enough games have one.' : '') + ' Small groups swing a lot.</p>';
  }

  // Two stats: each game as a dot, this stat up the side and a second stat
  // across, with how closely they moved together.
  const PAIR_DEFAULT = { points: 'assists', rebounds: 'points', assists: 'points', threes: 'points', steals: 'points', blocks: 'rebounds', minutes: 'points',
    passing_yards: 'rushing_yards', completions: 'passing_yards', rushing_yards: 'receiving_yards', receptions: 'receiving_yards', receiving_yards: 'receptions', carries: 'rushing_yards', targets: 'receptions' };
  function pairStat(P, C, stat) {
    const list = chartStats(P).filter((s) => s !== stat);
    if (C.stat2 && list.indexOf(C.stat2) >= 0) return C.stat2;
    const d = PAIR_DEFAULT[stat];
    return d && list.indexOf(d) >= 0 ? d : list[0] || null;
  }
  function pearson(xs, ys) {
    const mx = avgOf(xs), my = avgOf(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  }
  function pairHtml(D, lg) {
    const L = league(lg), P = L.player, s2 = pairStat(P, L.chart, D.stat);
    if (!s2) return '<p class="sp-muted">No second stat to compare.</p>';
    const sel = '<div class="sp-ch-controls">' + statSelectHtml('data-sp-chart-stat2', 'Against', chartStats(P).filter((s) => s !== D.stat), s2) + '</div>';
    const pts = D.items.map((it) => ({ it, x: gv(it.g, s2) })).filter((p) => isNum(p.x));
    if (pts.length < 4) return sel + '<p class="sp-muted">Too few games with both stats.</p>';
    const f = frame(), xs = pts.map((p) => p.x), ys = pts.map((p) => p.it.v);
    const [xlo, xhi] = tightRange(xs), [lo, hi] = tightRange(ys.concat([D.avg], isNum(D.line) ? [D.line] : []));
    const { y, grid } = yAxis(f, lo, hi);
    const iw = f.W - f.L - f.R, x = (v) => f.L + ((v - xlo) / (xhi - xlo || 1)) * iw;
    const ax = avgOf(xs);
    const xt = axisTicks(xlo, xhi, f.narrow ? 4 : 6).map((t) => '<text class="sp-ch-axis" x="' + x(t).toFixed(1) + '" y="' + (f.H - f.B + 14) + '" text-anchor="middle">' + escape(fv(t)) + '</text>').join('');
    const vline = '<line class="sp-ch-avg" x1="' + x(ax).toFixed(1) + '" x2="' + x(ax).toFixed(1) + '" y1="' + f.T + '" y2="' + (f.H - f.B) + '"/>';
    const dots = pts.map((p) => '<circle class="sp-dot ' + sideCls(p.it.v, D.ref) + '" cx="' + x(p.x).toFixed(1) + '" cy="' + y(p.it.v).toFixed(1) + '" r="4"/>').join('');
    const hov = pts.map((p) => ({ x: x(p.x), y: y(p.it.v), label: p.it.when + '\n' + fv(p.it.v) + ' ' + unitWord(D.stat) + ' · ' + fv(p.x) + ' ' + unitWord(s2) }));
    const svg = svgOpen(f, label(D.stat) + ' against ' + label(s2).toLowerCase(), ' data-ch-xy' + hoverAttr(hov)) + grid + refLines(f, y, D) + vline + dots + xt +
      '<text class="sp-ch-axis" x="' + (f.W - f.R) + '" y="' + (f.H - 4) + '" text-anchor="end">' + escape(label(s2)) + ' →</text></svg>';
    const r = pearson(xs, ys), n = pts.length;
    const upY = ys.filter((v) => v > D.ref).length, upX = xs.filter((v) => v > ax).length, both = pts.filter((p) => p.it.v > D.ref && p.x > ax).length;
    const word = r == null ? 'no read' : Math.abs(r) < 0.15 ? 'little link: one says almost nothing about the other' : r > 0 ? (r >= 0.5 ? 'a strong link: high games came together' : 'some link: they tended to rise together') : (r <= -0.5 ? 'a strong opposite link: when one ran high the other ran low' : 'some opposite link: one tended to rise when the other fell');
    return sel + legendHtml(D, '<span><i class="sp-key-line sp-key-avg"></i>' + escape(label(s2)) + ' average ' + escape(f1(ax)) + '</span>') + svg +
      '<p class="sp-note">Correlation <b>' + (r == null ? '—' : escape(r.toFixed(2))) + '</b> over ' + n + ' games, ' + escape(word) + '. ' +
      escape(label(D.stat)) + ' ' + (isNum(D.line) ? 'over ' + escape(fv(D.line)) : 'above average') + ' and ' + escape(label(s2).toLowerCase()) + ' above average together in <b>' + both + '</b> of ' + n + '; unrelated stats would do that about ' + escape(f1((upY * upX) / n)) + ' times. ' +
      'Useful for combos and two picks on one player; the Pick Builder prices same-player pairs only with links it has measured.</p>';
  }

  // Rate: the stat per 36 minutes (NBA) or per target, carry or pass attempt
  // (NFL), game by game, to tell a bigger role from better play.
  function rateHtml(D, lg) {
    const os = opportunityStat(lg, D.stat);
    if (!os) return '<p class="sp-muted">No volume stat for ' + escape(label(D.stat).toLowerCase()) + '.</p>';
    const per = lg === 'nba' ? 36 : 1;
    const raw = D.items.map((it) => { const o = gv(it.g, os); return isNum(o) && o > 0 ? { it, o } : null; }).filter(Boolean);
    if (raw.length < 3) return '<p class="sp-muted">Too few games with ' + escape(label(os).toLowerCase()) + ' to draw this.</p>';
    const unit = lg === 'nba' ? 'per 36 min' : 'per ' + UNIT_ONE[os];
    const items = raw.map((p, i) => {
      const w = raw.slice(Math.max(0, i - 4), i + 1);
      return { g: p.it.g, v: Math.round((p.it.v / p.o) * per * 100) / 100, home: p.it.home, opp: p.it.opp, date: p.it.date, when: p.it.when + ' · ' + fv(p.it.v) + ' in ' + fv(p.o) + ' ' + UNIT_MANY[os], roll: (sum(w.map((q) => q.it.v)) / sum(w.map((q) => q.o))) * per };
    });
    const vals = items.map((x) => x.v), overall = (sum(raw.map((p) => p.it.v)) / sum(raw.map((p) => p.o))) * per;
    const R = { stat: D.stat, unitText: unitWord(D.stat) + ' ' + unit, items, vals, avg: overall, line: null, ref: overall };
    const l5 = raw.slice(-5), rate5 = (sum(l5.map((p) => p.it.v)) / sum(l5.map((p) => p.o))) * per;
    const vol = avgOf(raw.map((p) => p.o)), vol5 = avgOf(l5.map((p) => p.o));
    return legendHtml(R, '<span><i class="sp-key-line sp-key-roll"></i>5-game rate</span>') + trendSvg(R) +
      '<p class="sp-note">' + escape(fv(Math.round(overall * 100) / 100)) + ' ' + escape(unitWord(D.stat)) + ' ' + escape(unit) + ' over these ' + raw.length + ' games; last 5: ' + escape(fv(Math.round(rate5 * 100) / 100)) + '. ' +
      escape(label(os)) + ' averaged ' + escape(f1(vol)) + ', last 5: ' + escape(f1(vol5)) + '. A higher stat with the same rate means a bigger role; a higher rate with the same ' + escape(UNIT_MANY[os]) + ' means more done with it.</p>';
  }

  function factsHtml(D) {
    const v = D.vals, n = v.length;
    const ref = isNum(D.line) ? D.line : D.avg;
    const over = v.filter((x) => x > ref).length;
    const recent = D.items.slice(-5).map((x) => x.v);
    const facts = [
      ['Games', n + (D.missed ? ' <small>+' + D.missed + ' missed</small>' : '')],
      ['Average', escape(f1(D.avg))], ['Median', escape(fv(medianOf(v)))],
      ['Low – high', escape(fv(Math.min(...v))) + '–' + escape(fv(Math.max(...v)))], ['Std dev', escape(f1(sdOf(v)))],
      [isNum(D.line) ? 'Over ' + escape(fv(D.line)) : 'Above avg', over + ' of ' + n + ' <small>' + Math.round((over / n) * 100) + '%</small>'],
    ];
    // The current run of games over (or under) the reference, newest back,
    // and the longest run over it in the games shown.
    let run = 0, dir = 0, best = 0, cur = 0;
    for (let i = n - 1; i >= 0; i--) { const d = v[i] > ref ? 1 : v[i] < ref ? -1 : 0; if (!d || (dir && d !== dir)) break; dir = d; run++; }
    v.forEach((x) => { cur = x > ref ? cur + 1 : 0; best = Math.max(best, cur); });
    facts.push(['Streak', run ? run + ' ' + (dir > 0 ? 'over' : 'under') + ' <small>longest over ' + best + '</small>' : '— <small>longest over ' + best + '</small>']);
    if (n > 5) { const r5 = avgOf(recent), d = r5 - D.avg; facts.push(['Last 5', escape(f1(r5)) + ' <small class="' + (d > 0 ? 'sp-pos' : d < 0 ? 'sp-neg' : '') + '">' + (d > 0 ? '+' : d < 0 ? '−' : '±') + escape(f1(Math.abs(d))) + '</small>']); }
    return '<dl class="sp-facts">' + facts.map((x) => '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>').join('') + '</dl>';
  }

  const WINDOWS = [[5, 'Last 5'], [10, 'Last 10'], [20, 'Last 20'], ['season', 'Season'], ['all', 'All']];
  const KINDS = [['bars', 'Bars'], ['trend', 'Trend'], ['hits', 'Hit rates'], ['spread', 'Spread'], ['volume', 'Volume'], ['rate', 'Rate'], ['splits', 'Splits'], ['script', 'Game script'], ['pair', 'Two stats']];
  const NEEDS_VOLUME = { volume: 1, rate: 1 };
  function chartStats(P) {
    return P.stats.concat(P.context_stats).filter((st) => P.games.some((g) => g.played && isNum(gv(g, st))));
  }
  function chartStat(P, C, lg) {
    const list = chartStats(P);
    if (C.stat && list.indexOf(C.stat) >= 0) return C.stat;
    const pos = String(P.player.position || '').toUpperCase();
    const pref = lg === 'nfl' ? (pos === 'QB' ? 'passing_yards' : pos === 'RB' ? 'rushing_yards' : 'receptions') : 'points';
    return list.indexOf(pref) >= 0 ? pref : list[0] || null;
  }
  function chartData(P, lg) {
    const C = league(lg).chart, stat = chartStat(P, C, lg);
    if (!stat) return null;
    const all = P.games;
    const played = all.filter((g) => g.played && isNum(gv(g, stat)));
    const latest = all.length ? all[0].season : null;
    const list = C.n === 'season' ? played.filter((g) => g.season === latest) : C.n === 'all' ? played : played.slice(0, C.n);
    const items = list.map((g) => {
      const i = played.indexOf(g), w = played.slice(i, i + 5).map((x) => gv(x, stat));
      return { g, v: gv(g, stat), home: g.home, opp: g.opponent, date: g.date, when: fmtDay(g.date) + ' ' + String(g.date).slice(0, 4) + ' · ' + (g.home ? 'vs ' : '@ ') + String(g.opponent).toUpperCase(), roll: avgOf(w) };
    }).reverse();
    const vals = items.map((x) => x.v), avg = avgOf(vals);
    const raw = String(C.line == null ? '' : C.line).trim(), num = Number(raw);
    const line = raw !== '' && Number.isFinite(num) && num >= 0 ? num : null;
    const oldest = list.length ? list[list.length - 1].date : null;
    return { stat, items, vals, avg, line, ref: line != null ? line : avg, missed: oldest ? all.filter((g) => !g.played && g.date >= oldest).length : 0, available: played.length };
  }
  function chartBodyHtml(lg) {
    const L = league(lg), P = L.player, D = chartData(P, lg);
    if (!D) return '';
    if (!D.items.length) return '<p class="sp-muted">No games with ' + escape(label(D.stat).toLowerCase()) + ' in this window.</p>';
    const kind = NEEDS_VOLUME[L.chart.kind] && !opportunityStat(lg, D.stat) ? 'bars' : L.chart.kind;
    const short = typeof L.chart.n === 'number' && D.items.length < L.chart.n ? '<p class="sp-note">Only ' + D.items.length + ' stored game' + (D.items.length === 1 ? '' : 's') + ' with this stat.</p>' : '';
    let body;
    if (kind === 'trend') body = legendHtml(D, '<span><i class="sp-key-line sp-key-roll"></i>5-game average</span>') + trendSvg(D);
    else if (kind === 'hits') body = hitsHtml(D);
    else if (kind === 'spread') body = legendHtml(D, '<span>Bar height: games</span>') + spreadSvg(D);
    else if (kind === 'volume') body = legendHtml(D, '<span><i class="sp-key-line sp-key-fit"></i>Rate</span>') + volumeSvg(D, lg);
    else if (kind === 'splits') body = splitsHtml(D, lg);
    else if (kind === 'script') body = scriptHtml(D, lg);
    else if (kind === 'pair') body = pairHtml(D, lg);
    else if (kind === 'rate') body = rateHtml(D, lg);
    else body = legendHtml(D) + barsSvg(D);
    return '<div class="sp-ch-wrap">' + body + '</div>' + factsHtml(D) + short;
  }
  function seg(attr, list, current, aria, disabled) {
    return '<div class="sp-seg" role="group" aria-label="' + escape(aria) + '">' + list.map(([v, t]) => {
      const off = disabled && disabled(v);
      return '<button type="button" ' + attr + '="' + escape(v) + '" aria-pressed="' + (String(v) === String(current) ? 'true' : 'false') + '"' + (off ? ' disabled title="' + escape(off) + '"' : '') + '>' + escape(t) + '</button>';
    }).join('') + '</div>';
  }
  function chartHtml(lg) {
    const L = league(lg), P = L.player, C = L.chart;
    const stats = chartStats(P);
    if (!stats.length) return '';
    const stat = chartStat(P, C, lg), os = opportunityStat(lg, stat);
    const kinds = KINDS.map(([k, t]) => [k, k === 'volume' ? (lg === 'nba' ? 'Vs minutes' : os ? 'Vs ' + label(os).toLowerCase() : 'Vs volume') : k === 'rate' ? (lg === 'nba' ? 'Per 36 min' : os ? 'Per ' + UNIT_ONE[os] : 'Rate') : t]);
    return '<div class="sp-ch-controls">' + statSelectHtml('data-sp-chart-stat', 'Stat', stats, stat) +
      '<label class="sp-field sp-line-field"><span>Compare to a line</span><input type="number" min="0" max="1000" step="0.5" inputmode="decimal" placeholder="Average" data-sp-chart-line value="' + escape(C.line) + '"></label></div>' +
      seg('data-sp-chart-n', WINDOWS, C.n, 'Games shown') +
      seg('data-sp-chart-kind', kinds, NEEDS_VOLUME[C.kind] && !os ? 'bars' : C.kind, 'Chart', (k) => (NEEDS_VOLUME[k] && !os ? 'No volume stat for ' + label(stat).toLowerCase() : '')) +
      '<div data-sp-part="chart-body">' + chartBodyHtml(lg) + '</div>';
  }

  // A small ten-game bar chart for a table row, coloured against the row's
  // own average of those games.
  function sparkSvg(vals, what) {
    const v = (vals || []).filter(isNum).slice().reverse();
    if (!v.length) return '<span class="sp-muted">—</span>';
    const a = avgOf(v), W = 74, H = 22, n = v.length, slot = W / 10;
    const lo = Math.min(0, ...v), hi = Math.max(...v, a, 1);
    const y = (x) => 1 + ((hi - x) / (hi - lo)) * (H - 2);
    const bars = v.map((x, i) => { const top = Math.min(y(x), y(0)); return '<rect class="sp-bar ' + sideCls(x, a) + '" x="' + (W - (n - i) * slot + 1).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + (slot - 2).toFixed(1) + '" height="' + Math.max(1, Math.abs(y(x) - y(0))).toFixed(1) + '"/>'; }).join('');
    return '<svg class="sp-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escape(what + ', oldest to newest: ' + v.join(', ') + '; average ' + f1(a)) + '">' + bars +
      '<line class="sp-ch-avg" x1="0" x2="' + W + '" y1="' + y(a).toFixed(1) + '" y2="' + y(a).toFixed(1) + '"/></svg>';
  }

  // ---- Player and team stats views ------------------------------------------
  const VIEWS_LIST = [['games', 'Games'], ['players', 'Player stats'], ['teams', 'Team stats'], ['record', 'Prop track record']];
  function sortTh(attr, key, text, cur, dir, title, cls) {
    const on = cur === key;
    return '<th class="' + (cls || 'sp-n') + '" aria-sort="' + (on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sp-th' + (on ? ' is-on' : '') + '" ' + attr + '="' + escape(key) + '"' + (title ? ' title="' + escape(title) + '"' : '') + '>' + escape(text) + '<i aria-hidden="true">' + (on ? (dir === 'asc' ? '▲' : '▼') : '') + '</i></button></th>';
  }
  function sortList(list, get, dir) {
    return list.map((x, i) => ({ x, i, v: get(x) })).sort((a, b) => {
      const ma = a.v == null || a.v === '' || (typeof a.v === 'number' && !Number.isFinite(a.v)), mb = b.v == null || b.v === '' || (typeof b.v === 'number' && !Number.isFinite(b.v));
      if (ma || mb) return ma && mb ? a.i - b.i : ma ? 1 : -1;
      const c = typeof a.v === 'string' ? a.v.localeCompare(b.v) : a.v - b.v;
      return (dir === 'asc' ? c : -c) || a.i - b.i;
    }).map((o) => o.x);
  }
  function selectHtml(attr, labelText, opts, current) {
    return '<label class="sp-field"><span>' + escape(labelText) + '</span><select ' + attr + '>' + opts.map(([v, t]) => '<option value="' + escape(v) + '"' + (String(v) === String(current) ? ' selected' : '') + '>' + escape(t) + '</option>').join('') + '</select></label>';
  }
  // A stat picker grouped as Main / Combos / More. `lead` adds plain options
  // before the groups (the game panel's "each player's main stat").
  function statSelectHtml(attr, labelText, stats, current, lead) {
    const opt = (v, t) => '<option value="' + escape(v) + '"' + (String(v) === String(current) ? ' selected' : '') + '>' + escape(t) + '</option>';
    const groups = STAT_SETS.map(([g, name]) => {
      const list = stats.filter((st) => statGroup(st) === g);
      return list.length ? '<optgroup label="' + escape(name) + '">' + list.map((st) => opt(st, label(st))).join('') + '</optgroup>' : '';
    }).join('');
    return '<label class="sp-field"><span>' + escape(labelText) + '</span><select ' + attr + '>' + (lead || []).map(([v, t]) => opt(v, t)).join('') + groups + '</select></label>';
  }
  const MIN_GAMES = [1, 2, 3, 5, 10, 20, 40];
  function defaultMinGames(lg, players) {
    const top = Math.max(0, ...players.map((p) => p.games));
    const want = lg === 'nfl' ? (top >= 8 ? 4 : top >= 4 ? 2 : 1) : (top >= 20 ? 10 : top >= 8 ? 5 : top >= 3 ? 2 : 1);
    return want;
  }
  const GROUP_NAMES = { G: 'Guards', F: 'Forwards', C: 'Centers', QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends' };

  function leadersView(lg) {
    const Q = league(lg).leaders, D = Q.data;
    if (Q.err) return errorBox(Q.err, 'leaders');
    if (!D) return '<p class="sp-loading">Loading player stats…</p>';
    if (Q.min == null) Q.min = defaultMinGames(lg, D.players);
    if (!Q.sort) Q.sort = D.stats.filter((st) => st !== 'minutes')[0];
    const controls = '<div class="sp-ctl">' +
      (D.seasons.length > 1 ? selectHtml('data-sp-lead-season', 'Season', D.seasons.map((y) => [y, seasonLabel(lg, y)]), D.season) : '') +
      selectHtml('data-sp-lead-team', 'Team', [['', 'All teams']].concat(D.teams.map((t) => [t, String(t).toUpperCase()])), Q.team) +
      selectHtml('data-sp-lead-group', 'Position', [['', 'All positions']].concat(D.groups.map((g) => [g, GROUP_NAMES[g] || g])), Q.group) +
      selectHtml('data-sp-lead-min', 'Played at least', MIN_GAMES.map((m) => [m, m + ' game' + (m === 1 ? '' : 's')]), Q.min) +
      statSelectHtml('data-sp-lead-sort', 'Rank by', D.stats, D.stats.indexOf(Q.sort) >= 0 ? Q.sort : D.stats[0]) +
      '</div>' + seg('data-sp-lead-window', [['season', 'Whole season'], ['last10', 'Last 10 games'], ['last5', 'Last 5 games']], D.window, 'Games counted') +
      seg('data-sp-lead-mode', [['table', 'Table'], ['chart', 'Chart']], Q.mode, 'Show as') +
      (Q.mode === 'table' ? seg('data-sp-lead-set', SET_CHOICES, Q.set, 'Stat columns') : '');
    return '<h3>Player stats <span class="sp-muted">' + escape(seasonLabel(lg, D.season)) + '</span></h3>' + controls + '<div data-sp-part="lead-body">' + leadersBody(lg) + '</div>';
  }
  function leadersBody(lg) {
    const Q = league(lg).leaders, D = Q.data;
    if (!D) return '';
    const rows = D.players.filter((p) => (!Q.team || p.team === Q.team) && (!Q.group || p.group === Q.group) && p.games >= Q.min);
    if (!rows.length) return emptyBox('No players match.', escape(D.players.length ? 'Lower the games played or clear a filter.' : 'No games are stored for this season yet.'));
    const per = D.window === 'season' ? 'per game this season' : 'per game over each player’s ' + (D.window === 'last10' ? 'last 10' : 'last 5') + ' games';
    if (Q.mode === 'chart') {
      const st = Q.sort, list = sortList(rows, (p) => p.values[st], 'desc').filter((p) => isNum(p.values[st])).slice(0, 20);
      if (!list.length) return emptyBox('No ' + label(st).toLowerCase() + ' stored for these players.');
      const vals = rows.map((p) => p.values[st]).filter(isNum), a = avgOf(vals), max = Math.max(...list.map((p) => p.values[st]), a, 0) || 1;
      return '<p class="sp-ch-legend"><span><i class="sp-swatch is-over"></i>Above the average of all ' + vals.length + ' players shown</span><span><i class="sp-swatch is-under"></i>Below</span><span><i class="sp-key-line sp-key-avg"></i>Average ' + escape(f1(a)) + '</span></p>' +
        '<ol class="sp-hbars">' + list.map((p, i) => '<li><span class="sp-hb-rank">' + (i + 1) + '</span><span class="sp-hb-name"><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button> <small>' + team(p.team) + ' · ' + escape(p.position || '') + '</small></span>' +
          '<span class="sp-hb-track"><i class="sp-hb-bar ' + sideCls(p.values[st], a) + '" style="width:' + ((Math.max(0, p.values[st]) / max) * 100).toFixed(1) + '%"></i><i class="sp-split-ref" style="left:' + Math.max(0, Math.min(100, (a / max) * 100)).toFixed(1) + '%"></i></span>' +
          '<span class="sp-hb-val">' + escape(f1(p.values[st])) + '</span></li>').join('') + '</ol>' +
        '<p class="sp-note">Top 20 by ' + escape(label(st).toLowerCase()) + ', ' + escape(per) + '. Select a name for charts and the game log.</p>';
    }
    const sorted = Q.sort === 'name' || Q.sort === 'team' ? sortList(rows, (p) => (Q.sort === 'name' ? p.name : p.team), Q.dir) : Q.sort === 'games' ? sortList(rows, (p) => p.games, Q.dir) : sortList(rows, (p) => p.values[Q.sort], Q.dir);
    const shown = Q.all ? sorted : sorted.slice(0, 50);
    const th = (k, t, title, cls) => sortTh('data-sp-lsort', k, t, Q.sort, Q.dir, title, cls);
    const cols = D.stats.filter((st) => st === 'minutes').concat(D.stats.filter((st) => st !== 'minutes')).filter((st) => inSet(st, Q.set) || st === Q.sort);
    return '<div class="sp-table-wrap"><table class="sp-table sp-lead" data-nosort><thead><tr><th class="sp-n">#</th>' + th('name', 'Player', null, 'sp-l') + th('team', 'Team', null, 'sp-l') + '<th>Pos</th>' + th('games', 'GP', 'Games played this season') +
      cols.map((st) => th(st, SHORT[st] || st, label(st))).join('') + '</tr></thead><tbody>' +
      shown.map((p, i) => '<tr><td class="sp-n sp-muted">' + (i + 1) + '</td><td><button type="button" class="sp-link" data-sp-player="' + escape(p.player_id) + '">' + escape(p.name) + '</button></td><td>' + team(p.team) + '</td><td>' + escape(p.position || '') + '</td>' +
        '<td class="sp-n">' + p.games + (p.missed ? ' <small class="sp-muted" title="Games missed">+' + p.missed + '</small>' : '') + '</td>' + cols.map((st) => '<td class="sp-n' + (st === Q.sort ? ' is-sorted' : '') + '">' + escape(f1(p.values[st])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (sorted.length > shown.length ? '<button type="button" class="sp-btn sp-more" data-sp-lead-all>Show all ' + sorted.length + ' players</button>' : '') +
      '<p class="sp-note">Averages ' + escape(per) + '; missed games are left out (+N). Select a column to sort, a name for charts and the game log.</p>';
  }

  function teamsView(lg) {
    const Q = league(lg).teams, D = Q.data;
    if (Q.err) return errorBox(Q.err, 'teams');
    if (!D) return '<p class="sp-loading">Loading team stats…</p>';
    if (!Q.stat || D.stats.indexOf(Q.stat) < 0) Q.stat = D.stats[0];
    const sides = [['for', 'Scored by the team'], ['against', 'Allowed to opponents']].concat(D.groups.map((g) => ['to:' + g, 'Allowed to ' + (GROUP_NAMES[g] || g).toLowerCase()]));
    const controls = '<div class="sp-ctl">' +
      (D.seasons.length > 1 ? selectHtml('data-sp-team-season', 'Season', D.seasons.map((y) => [y, seasonLabel(lg, y)]), D.season) : '') +
      statSelectHtml('data-sp-team-stat', 'Stat', D.stats, Q.stat) +
      (Q.mode === 'chart' ? selectHtml('data-sp-team-side', 'Show', sides, Q.side) : '') +
      '</div>' + seg('data-sp-team-mode', [['table', 'Table'], ['chart', 'Chart']], Q.mode, 'Show as');
    return '<h3>Team stats <span class="sp-muted">' + escape(seasonLabel(lg, D.season)) + '</span></h3>' + controls + '<div data-sp-part="team-body">' + teamsBody(lg) + '</div>';
  }
  function teamValue(t, key, st) {
    if (key === 'team') return t.team;
    if (key === 'diff') return t.points_for != null && t.points_against != null ? t.points_for - t.points_against : null;
    if (key === 'for') return t.for[st];
    if (key === 'against') return t.against[st];
    if (key.indexOf('to:') === 0) return (t.against_by[key.slice(3)] || {})[st];
    return t[key];
  }
  function teamsBody(lg) {
    const Q = league(lg).teams, D = Q.data;
    if (!D) return '';
    if (!D.teams.length) return emptyBox('No team games stored for this season yet.');
    const st = Q.stat, s = SHORT[st] || st;
    if (Q.mode === 'chart') {
      const side = Q.side, list = sortList(D.teams, (t) => teamValue(t, side, st), 'desc').filter((t) => isNum(teamValue(t, side, st)));
      if (!list.length) return emptyBox('No ' + label(st).toLowerCase() + ' stored for this season.');
      const vals = list.map((t) => teamValue(t, side, st)), a = avgOf(vals), max = Math.max(...vals, a, 0) || 1;
      const what = side === 'for' ? 'scored per game' : side === 'against' ? 'allowed per game' : 'allowed to ' + (GROUP_NAMES[side.slice(3)] || side.slice(3)).toLowerCase() + ' per game';
      return '<p class="sp-ch-legend"><span><i class="sp-swatch is-over"></i>Above the league average</span><span><i class="sp-swatch is-under"></i>Below</span><span><i class="sp-key-line sp-key-avg"></i>Average ' + escape(f1(a)) + '</span></p>' +
        '<ol class="sp-hbars">' + list.map((t, i) => '<li><span class="sp-hb-rank">' + (i + 1) + '</span><span class="sp-hb-name"><button type="button" class="sp-link" data-sp-team-pick="' + escape(t.team) + '">' + team(t.team) + '</button> <small>' + escape(t.wins + '-' + t.losses + (t.ties ? '-' + t.ties : '')) + '</small></span>' +
          '<span class="sp-hb-track"><i class="sp-hb-bar ' + sideCls(teamValue(t, side, st), a) + '" style="width:' + ((Math.max(0, teamValue(t, side, st)) / max) * 100).toFixed(1) + '%"></i><i class="sp-split-ref" style="left:' + Math.max(0, Math.min(100, (a / max) * 100)).toFixed(1) + '%"></i></span>' +
          '<span class="sp-hb-val">' + escape(f1(teamValue(t, side, st))) + '</span></li>').join('') + '</ol>' +
        '<p class="sp-note">' + escape(label(st)) + ' ' + escape(what) + ', summed over each team’s players.' + (side === 'for' ? '' : ' Higher means the defense gives up more, which favors overs against it.') + ' Select a team to see its players.</p>';
    }
    const th = (k, t, title, cls) => sortTh('data-sp-tsort', k, t, Q.sort, Q.dir, title, cls);
    const sorted = sortList(D.teams, (t) => teamValue(t, Q.sort, st), Q.dir);
    return '<div class="sp-table-wrap"><table class="sp-table sp-teamtable" data-nosort><thead><tr>' + th('team', 'Team', null, 'sp-l') + '<th>Record</th>' + th('win_pct', 'Win %') + '<th>Home</th><th>Away</th><th>Last 10</th><th>Streak</th>' +
      th('points_for', 'Pts/g', 'Points scored per game (final scores)') + th('points_against', 'Opp/g', 'Points allowed per game (final scores)') + th('diff', 'Diff', 'Point difference per game') +
      th('for', s + ' for', label(st) + ' by the team per game') + th('against', s + ' allowed', label(st) + ' allowed per game') +
      D.groups.map((g) => th('to:' + g, 'to ' + g, label(st) + ' allowed to ' + (GROUP_NAMES[g] || g).toLowerCase() + ' per game')).join('') + '</tr></thead><tbody>' +
      sorted.map((t) => {
        const diff = teamValue(t, 'diff');
        return '<tr><td><button type="button" class="sp-link" data-sp-team-pick="' + escape(t.team) + '">' + team(t.team) + '</button></td><td>' + escape(t.wins + '-' + t.losses + (t.ties ? '-' + t.ties : '')) + '</td>' +
          '<td class="sp-n">' + (t.win_pct == null ? '—' : escape(t.win_pct.toFixed(3).replace(/^0/, ''))) + '</td><td>' + escape(t.home) + '</td><td>' + escape(t.away) + '</td><td>' + escape(t.last10) + '</td><td>' + escape(t.streak || '—') + '</td>' +
          '<td class="sp-n">' + escape(f1(t.points_for)) + '</td><td class="sp-n">' + escape(f1(t.points_against)) + '</td><td class="sp-n ' + (diff > 0 ? 'sp-pos' : diff < 0 ? 'sp-neg' : '') + '">' + (diff == null ? '—' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + escape(f1(Math.abs(diff)))) + '</td>' +
          '<td class="sp-n">' + escape(f1(t.for[st])) + '</td><td class="sp-n">' + escape(f1(t.against[st])) + '</td>' + D.groups.map((g) => '<td class="sp-n">' + escape(f1((t.against_by[g] || {})[st])) + '</td>').join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="sp-note">Records and points from final scores. Stat columns are per game, summed over each side’s players' + (lg === 'nfl' ? ' (a player on the field with no stat counts as zero)' : '') + '. “to G” is what opponents at that position put up. Select a column to sort, a team to see its players.</p>';
  }

  function gamesView(lg) {
    return '<h3>Games</h3><div data-sp-part="board" aria-live="polite">' + boardHtml(lg) + '</div><div data-sp-part="game">' + gamePanelHtml(lg) + '</div>' +
      '<div class="sp-search"><h3>Players</h3><label class="sp-find"><span>Find a player</span><input type="search" data-sp-search autocomplete="off" spellcheck="false" placeholder="Name, at least 2 letters" value="' + escape(league(lg).query) + '"></label>' +
      '<div data-sp-part="results" aria-live="polite">' + resultsHtml(lg) + '</div></div>';
  }
  function viewHtml(lg) {
    const v = league(lg).view;
    return v === 'record' ? propRecordHtml(lg) : v === 'players' ? leadersView(lg) : v === 'teams' ? teamsView(lg) : gamesView(lg);
  }
  function propRecordHtml(lg) {
    const L = league(lg), R = L.record;
    if (L.recordErr) return errorBox(L.recordErr, 'props-record');
    if (!R) return '<p class="sp-loading">Loading the prop track record…</p>';
    const S = R.summary, results = { win: 'Win', loss: 'Bust', push: 'Push', void: 'Void', no_stats: 'No stat line', pending: 'Pending', awaiting_stats: 'Waiting for stats' };
    const CL = S.closing_line || null;
    const metrics = [['Wins', S.wins], ['Busts', S.losses], ['Win rate', S.win_rate == null ? '—' : (S.win_rate * 100).toFixed(1) + '%'], ['Pushes / voids', S.pushes + ' / ' + (S.voids + (S.no_stats || 0))], ['Pending', S.pending],
      ['Beat the close', CL && CL.beat_rate != null ? (CL.beat_rate * 100).toFixed(0) + '% of ' + (CL.beat + CL.worse) : '—']];
    const clvCell = (p) => !p.clv ? '<td class="sp-n sp-muted">—</td>' : '<td class="sp-n">' + num(p.threshold) + ' → ' + num(p.clv.line) + (p.clv.points ? ' <span class="' + (p.clv.points > 0 ? 'sp-pos' : 'sp-neg') + '">(' + (p.clv.points > 0 ? '+' : '') + p.clv.points.toFixed(1) + ')</span>' : ' <span class="sp-muted">(same)</span>') + '</td>';
    const rows = R.records.map((p) => '<tr><td>' + escape(fmtWhen(p.game_start_utc, zone())) + '</td><td><b>' + escape(p.player_name) + '</b><br>' + (p.side === 'over' ? 'More' : 'Less') + ' ' + num(p.threshold) + ' ' + escape(label(p.stat)) + '</td>' + clvCell(p) +
      '<td class="sp-n">' + num(p.actual) + '</td><td class="' + (p.result === 'win' ? 'sp-pos' : p.result === 'loss' ? 'sp-neg' : '') + '">' + escape(results[p.result] || p.result) + '</td><td class="sp-n">' + num(p.rank_score) + '</td><td><details><summary>Saved analysis</summary><p>' + escape(p.basis === 'history_only' ? 'History only' : 'Model + history') + ' · ' + escape(p.rank_version || '') + '</p>' +
      '<p>Issued ' + escape(fmtWhen(p.issued_utc, zone())) + ' · line observed ' + escape(fmtWhen(p.observed_utc, zone())) + '</p>' + (lg === 'nba' && p.market ? nbaComparisonHtml(p) : '') + p.evidence.map((e) => '<p><b>' + escape(e.label) + ':</b> ' + escape(e.text) + '</p>').join('') + '</details></td></tr>').join('');
    const breakdown = Object.entries(R.by_stat).map(([st, s]) => '<tr><td>' + escape(label(st)) + '</td><td class="sp-n">' + s.wins + '</td><td class="sp-n">' + s.losses + '</td><td class="sp-n">' + (s.win_rate == null ? '—' : (s.win_rate * 100).toFixed(1) + '%') + '</td></tr>').join('');
    return '<section class="sp-prop-record"><h3>Prop track record</h3>' + (lg === 'nba' ? nbaResearchStatsHtml(R.nba_research) : '') + '<dl class="sp-facts">' + metrics.map(([k, v]) => '<div><dt>' + escape(k) + '</dt><dd>' + escape(v) + '</dd></div>').join('') + '</dl>' +
      '<p class="sp-note">' + escape(R.note) + '</p><p><button type="button" class="sp-link" data-sp-record-refresh>Refresh results</button> · <button type="button" class="sp-link" data-sp-record-export' + (L.recordExportPending ? ' disabled' : '') + '>' + (L.recordExportPending ? 'Preparing download…' : 'Download all research data (JSON)') + '</button></p>' +
      (L.recordExportErr ? '<p class="sp-note" role="alert">' + escape(L.recordExportErr) + '</p>' : '') +
      (rows ? '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Game time</th><th>Original pick</th><th title="Saved line → last pregame line seen; points in the pick\u2019s favor">Line → close</th><th>Actual</th><th>Result</th><th>Rank</th><th>Evidence</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="sp-note">Showing ' + R.records.length + ' of ' + R.total + ' saved props. The download includes every saved line, analysis and current result.</p>' : emptyBox('No issued props yet.', 'The next successful pregame scan records each game’s first pair automatically.')) +
      (breakdown ? '<h4>Results by stat</h4><div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Stat</th><th>Wins</th><th>Busts</th><th>Win rate</th></tr></thead><tbody>' + breakdown + '</tbody></table></div>' : '') +
      closingLineHtml(CL, R.by_line_move) +
      '<p class="sp-note">Model-only Brier score (lower is better): ' + (S.model_check.brier == null ? 'not enough resolved modeled picks' : S.model_check.brier.toFixed(3) + ' across ' + S.model_check.samples + ' picks') + '. Rank scores are not treated as probabilities. Results update when the daily data job stores final box scores.</p></section>';
  }
  function nbaResearchStatsHtml(R) {
    if (!R) return '';
    const C = R.closing_value, P = R.paper;
    const bins = R.calibration.bins.map((b) => '<tr><td>' + b.bin + '–' + (b.bin + 9) + '%</td><td>' + b.n + '</td><td>' + nbaPct(b.predicted) + '</td><td>' + nbaPct(b.observed) + '</td><td>' + (b.status === 'insufficient_sample' ? 'Small sample' : 'Descriptive') + '</td></tr>').join('');
    return '<section class="sp-nba-research"><h4>NBA research · prospective record</h4><p class="sp-note">All research picks are counted, including pass games. Paper entries and positive screens are measured separately below.</p><p>' + R.games + ' games · ' + R.captures + ' recorded snapshots · ' + R.wins + ' wins / ' + R.losses + ' busts · ' + R.pending + ' pending.</p>' +
      '<p>Both props won: ' + R.both_win + '/' + R.resolved_pairs + ' (' + nbaPct(R.both_win_rate) + '). Market calibration: ' + R.calibration.n + ' exact-price samples; Brier ' + num(R.calibration.brier) + '.</p>' +
      '<p>Closing comparison: ' + C.n + ' samples; average probability change ' + (C.average_probability_change == null ? '—' : (C.average_probability_change * 100).toFixed(2) + ' points') + '. ' + escape(C.note) + '</p>' +
      '<p>Paper pairs: ' + P.saved + ' saved, ' + P.resolved + ' resolved; ' + num(P.net_units) + ' net units, ROI ' + nbaPct(P.roi) + '. ' + P.excluded_push_void + ' excluded for push/void settlement.</p>' +
      Object.entries(R.paper_by_screen || {}).map(([k, s]) => '<p class="sp-note">' + escape(k === 'positive_screen' ? 'Positive screens' : 'Pass screens saved for research') + ': ' + s.saved + ' saved, ' + s.resolved + ' resolved; ROI ' + nbaPct(s.roi) + '.</p>').join('') +
      '<p class="sp-note">' + escape(R.note) + '</p>' + (bins ? '<details><summary>Calibration by market probability</summary>' + reliabilitySvg(R.calibration.bins.map((b) => ({ p: b.predicted, y: b.observed, n: b.n })), 'Market probability') + '<div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Bin</th><th>Samples</th><th>Predicted</th><th>Observed</th><th>Status</th></tr></thead><tbody>' + bins + '</tbody></table></div></details>' : '') +
      '<details><summary>Paper pairs & complete game research</summary><ul>' + R.recent_games.map((g) => '<li>' + escape(fmtWhen(g.start_utc, zone())) + (g.paper ? '<p>' + escape(g.paper.players.join(' + ')) + ' · ' + num(g.paper.payout) + '× · ' + escape(({ win: 'Won', loss: 'Lost', pending: 'Pending', excluded: 'Push/void · excluded from ROI' })[g.paper.result]) + '</p>' : '') + ' <button type="button" class="sp-link" data-sp-nba-export="' + escape(g.game_id) + '" data-sp-nba-season="' + g.season + '">Download game research</button></li>').join('') + '</ul></details></section>';
  }
  // Closing line value (lib/sports/prop-record.mjs closingSummary): how often
  // the saved line beat the last pregame line, the half-point histogram of the
  // move in the pick's favor, and the win rate split by which way it moved.
  function closingLineHtml(CL, byMove) {
    if (!CL || !CL.n) return '<p class="sp-note">Closing lines appear once a pregame scan has seen a saved pick\u2019s line again before the start.</p>';
    const keys = Object.keys(CL.histogram || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    let hist = '';
    if (keys.length >= 2) {
      const W = 300, H = 96, P = 14, bw = Math.max(6, Math.min(26, (W - 2 * P) / ((keys[keys.length - 1] - keys[0]) / 0.5 + 1) - 3));
      const maxN = Math.max(...keys.map((k) => CL.histogram[(k > 0 ? '+' : '') + k.toFixed(1)] || 0));
      const x = (k) => P + (k - keys[0]) / Math.max(0.5, keys[keys.length - 1] - keys[0]) * (W - 2 * P - bw);
      const bars = keys.map((k) => { const n = CL.histogram[(k > 0 ? '+' : '') + k.toFixed(1)] || 0, h = n / maxN * (H - 2 * P - 10);
        return '<rect class="sp-clv-bar' + (k > 0 ? ' is-for' : k < 0 ? ' is-against' : '') + '" x="' + x(k).toFixed(1) + '" y="' + (H - P - 10 - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '"/>'; }).join('');
      const hov = keys.map((k) => ({ x: x(k) + bw / 2, y: H - P - 10 - (CL.histogram[(k > 0 ? '+' : '') + k.toFixed(1)] || 0) / maxN * (H - 2 * P - 10), label: (k > 0 ? '+' : '') + k.toFixed(1) + ' pts\n' + (CL.histogram[(k > 0 ? '+' : '') + k.toFixed(1)] || 0) + ' picks' }));
      hist = '<figure class="sp-clv"><svg class="sp-clv-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Closing line value histogram"' + hoverAttr(hov) + '>' + bars +
        '<text class="sp-ch-axis" x="' + P + '" y="' + (H - 2) + '">' + (keys[0] > 0 ? '+' : '') + keys[0].toFixed(1) + '</text><text class="sp-ch-axis" x="' + (W - P) + '" y="' + (H - 2) + '" text-anchor="end">' + (keys[keys.length - 1] > 0 ? '+' : '') + keys[keys.length - 1].toFixed(1) + ' pts</text></svg>' +
        '<figcaption>Line move in the pick\u2019s favor, half-point bins (clamped at ±3).</figcaption></figure>';
    }
    const split = [['Moved for us', CL.when_beat], ['Unchanged', CL.when_unchanged], ['Moved against', CL.when_worse]].filter(([, r]) => r && r.n);
    let bars = '';
    if (split.length >= 2) {
      bars = '<ul class="sp-clv-split">' + split.map(([k, r]) => '<li><span>' + escape(k) + ' <small>' + r.n + '</small></span><span class="sp-clv-track"><i style="width:' + Math.round(r.win_rate * 100) + '%"></i></span><b>' + (r.win_rate * 100).toFixed(0) + '%</b></li>').join('') + '</ul>';
    }
    const lead = CL.median_lead_seconds == null ? '' : ' The closing line was typically seen ' + (CL.median_lead_seconds < 90 ? CL.median_lead_seconds + ' seconds' : Math.round(CL.median_lead_seconds / 60) + ' minutes') + ' before the start.';
    return '<section class="sp-clv-section"><h4>Closing line value</h4><p>' + CL.n + ' picks with a closing line: the saved line beat the close on ' + CL.beat + ', lost to it on ' + CL.worse + ' and matched it on ' + CL.unchanged +
      (CL.average_points != null ? '; average move ' + (CL.average_points > 0 ? '+' : '') + CL.average_points.toFixed(2) + ' points in the pick\u2019s favor' : '') + '.' + escape(lead) + '</p>' +
      '<div class="sp-clv-charts">' + hist + (bars ? '<div><p class="sp-label">Win rate by line move</p>' + bars + '</div>' : '') + '</div>' +
      '<p class="sp-note">' + escape(CL.note) + '</p></section>';
  }
  function loadPropRecord(page, lg) {
    const L = league(lg), seq = ++L.recordSeq; L.recordErr = null;
    api('props-record', { sport: lg }).then((data) => { if (seq === L.recordSeq) L.record = data; }, (err) => { if (seq === L.recordSeq) L.recordErr = err; }).then(() => { if (seq === L.recordSeq && state.page === page && L.view === 'record') paint(page, 'view', viewHtml(lg)); });
  }
  async function exportPropRecord(page, lg) {
    const L = league(lg);
    if (L.recordExportPending) return;
    const repaint = () => { if (state.page === page && L.view === 'record') paint(page, 'view', viewHtml(lg)); };
    L.recordExportPending = true; L.recordExportErr = null; repaint();
    try {
      const records = []; let offset = 0, first = null;
      do {
        const data = await api('props-record', { sport: lg, download: '1', offset, as_of: first?.as_of, snapshot: first?.snapshot });
        if (!first) first = data;
        if (!Array.isArray(data.records) || data.offset !== offset || data.snapshot !== first.snapshot || data.total !== first.total || data.next_offset != null && !(data.next_offset > offset)) throw new Error('Incomplete prop record');
        records.push(...data.records); offset = data.next_offset;
        if (records.length > first.total || records.length > 10000) throw new Error('Unexpected prop record size');
      } while (offset != null);
      if (records.length !== first.total || !options.owner()) throw new Error('Incomplete prop record');
      const { offset: _offset, page_size: _size, next_offset: _next, ...metadata } = first;
      const url = host.URL.createObjectURL(new host.Blob([JSON.stringify({ ...metadata, exported_utc: new Date().toISOString(), records }, null, 2)], { type: 'application/json' }));
      const a = doc.createElement('a'); a.href = url; a.download = lg + '-prop-record.json'; a.click();
      host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
    } catch (err) { L.recordExportErr = err.detail || 'The full prop record could not be downloaded. Please try again.'; }
    finally { L.recordExportPending = false; repaint(); }
  }

  function leagueHtml(s, lg) {
    const src = s.sources[lg], tz = s.window.time_zone;
    const name = lg.toUpperCase();
    const connected = src.state !== 'not_connected';
    const board = connected
      ? seg('data-sp-view', VIEWS_LIST, league(lg).view, 'View') + '<div data-sp-part="view">' + viewHtml(lg) + '</div>'
      : '<h3>Games</h3>' + emptyBox('No ' + name + ' games loaded yet.', escape(lg === 'nfl'
        ? 'The daily nflverse job has not written its first records yet.'
        : 'The daily hoopR job has not written its first records yet.'));
    // The open player spans both columns, so the charts and tables use the
    // full width instead of stopping beside the side cards.
    const player = connected ? '<div class="sp-player-row" data-sp-part="player">' + playerPanelHtml(lg) + '</div>' : '';
    return dayStrip(s, dataChip(src, tz)) + '<div class="sp-grid"><div class="sp-board">' + board + '</div>' +
      '<aside class="sp-side">' + sourceCard(src, tz) + modelCard(src) + teamModelCard(src) + statList(s.stats[lg] || []) + '</aside>' + player + '</div>' +
      '<p class="sp-foot">Private research for the two owners. PrizePicks lines come from PropLine; player availability comes from ESPN. Nothing is placed and no AI model is called by this page.</p>';
  }

  // ---- Pick Builder: draft ---------------------------------------------------
  function blankDraft(keep) {
    return { legs: [], operator: (keep && keep.operator) || 'prizepicks', format: (keep && keep.format) || 'power', stake: keep && keep.stake > 0 ? keep.stake : 10, payouts: {}, parlayPrice: '', note: '' };
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
    d.legs = decoded.legs.map((l) => Object.assign({}, l, { probability: null, probability_source: null, price: l.price > 1 ? decimalText(l.price) : '' },
      l.kind === 'team' ? { label: teamPickLabel(l) } : {}));
    if (d.format === 'parlay' && !d.legs.every((l) => priceOf(l.price)) && d.payouts[d.legs.length] > 1) d.parlayPrice = decimalText(d.payouts[d.legs.length]);
    state.draft = d;
    saveDraft();
    pb.prefill = 'ok'; pb.evaluation = null; pb.msg = null;
  }
  function draftBody() {
    const d = draft(), n = d.legs.length, payouts = {};
    const parlay = d.format === 'parlay';
    if (parlay) {
      // Each pick's odds multiplied (the server does it) or one typed price.
      const one = priceOf(d.parlayPrice);
      if (!d.legs.every((l) => priceOf(l.price)) && one) payouts[n] = one.decimal;
    } else Object.keys(d.payouts || {}).forEach((k) => {
      const v = d.payouts[k];
      if (v === '' || v == null) return;
      if (d.format === 'power' ? Number(k) === n : Number(k) <= n) payouts[k] = Number(v);
    });
    const price = (l) => { const o = parlay ? priceOf(l.price) : null; return o ? o.decimal : null; };
    return {
      legs: d.legs.map((l) => isTeamPick(l)
        ? { kind: 'team', sport: l.sport, game_id: l.game_id, market: l.market, team: l.team, side: l.side, line: l.line, probability: l.probability, probability_source: l.probability_source, price: price(l) }
        : { sport: l.sport, player_id: l.player_id, game_id: l.game_id, stat: l.stat, side: l.side, threshold: l.threshold, probability: l.probability, probability_source: l.probability_source, price: price(l) }),
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
  const lineHint = (v) => (typeof v === 'number' && v >= 0 ? String(Math.floor(v) + 0.5) : '24.5');
  function pickFormHtml(sport, P, where) {
    const g = P.next_game, name = P.player.name;
    if (!g) return '<p class="sp-muted">No upcoming game is stored for ' + escape(name) + '’s team yet, so a pick cannot be attached.</p>';
    const stats = (CATALOG[sport] || []).map((st) => st.id);
    // Start on the player's main stat (rushing yards for a running back),
    // the same one the charts open on, not the first stat in the list.
    const main = P.stats && P.games ? chartStat(P, {}, sport) : null;
    const first = stats.indexOf(main) >= 0 ? main : stats[0];
    // The line box hints a line near the player's last-10 average of the
    // chosen stat (not 24.5 for a quarterback's passing yards).
    const avgs = {};
    stats.forEach((st) => { const s = P.summaries && P.summaries[st], v = s ? (s.last10 != null ? s.last10 : s.average) : null; if (isNum(v)) avgs[st] = Math.round(v * 10) / 10; });
    return '<div class="sp-pickform" data-sp-pickform="' + escape(where) + '" data-sp-avgs="' + escape(JSON.stringify(avgs)) + '">' +
      '<p class="sp-pick-game">Next game: ' + team(g.away_team) + ' at ' + team(g.home_team) + ' · ' + (g.time_tbd ? escape(fmtDay(g.local_date)) + ', time TBD' : escape(fmtWhen(g.start_utc, zone()))) + '</p>' +
      '<div class="sp-pick-row">' +
      statSelectHtml('name="stat"', 'Stat', stats, first) +
      '<label class="sp-field"><span>Side</span><select name="side"><option value="over">Over</option><option value="under">Under</option></select></label>' +
      '<label class="sp-field sp-line-field"><span>Line</span><input name="line" type="number" min="0" max="1000" step="0.5" inputmode="decimal" placeholder="' + escape(lineHint(avgs[first])) + '"></label>' +
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
    const clash = d.legs.find((l) => l.sport === sport && l.game_id === g.game_id && l.player_id === P.player.player_id && l.stat === stat);
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
    const modes = '<div class="sp-seg" role="group" aria-label="Kind of pick">' + [['player', 'Player line'], ['game', 'Game bet']].map(([v, t]) =>
      '<button type="button" class="sp-seg-btn" data-sp-add-mode="' + v + '" aria-pressed="' + (A.mode === v ? 'true' : 'false') + '">' + t + '</button>').join('') + '</div>';
    const sport = '<label class="sp-field"><span>League</span><select data-sp-add-sport><option value="nba"' + (A.sport === 'nba' ? ' selected' : '') + '>NBA</option><option value="nfl"' + (A.sport === 'nfl' ? ' selected' : '') + '>NFL</option></select></label>';
    if (A.mode === 'game') {
      return '<div class="sp-add">' + modes + '<div class="sp-add-row">' + sport + '</div>' +
        '<p class="sp-muted sp-add-hint">Who wins, the spread, win by X or more, the game total or one team’s points.</p>' +
        '<div data-sp-part="gb-add" aria-live="polite">' + gameAddHtml() + '</div></div>';
    }
    return '<div class="sp-add">' + modes + '<div class="sp-add-row">' + sport +
      '<label class="sp-find"><span>Player</span><input type="search" data-sp-add-search autocomplete="off" spellcheck="false" placeholder="Name, at least 2 letters" value="' + escape(A.query) + '"></label></div>' +
      '<div data-sp-part="add-results" aria-live="polite">' + addResultsHtml() + '</div>' +
      '<div data-sp-part="add-form">' + addFormHtml() + '</div></div>';
  }
  // ---- Pick Builder: adding a game bet ---------------------------------------
  // On a stored game that has not started. The model's chance shows as the
  // bet is typed (tbPrice, the page's copy of priceTeamBet).
  const gbState = () => pb.add.gb || (pb.add.gb = { market: 'moneyline', team: '', side: 'over', line: '' });
  function gameChoices() {
    const A = pb.add, B = A.board, now = Date.now();
    if (!B || B.sport !== A.sport) return [];
    const list = (B.games || []).slice();
    if (B.next_game && !list.some((g) => g.game_id === B.next_game.game_id)) list.push(B.next_game);
    return list.filter((g) => g.status === 'scheduled' && !(Date.parse(g.start_utc) <= now));
  }
  function loadAddBoard() {
    const A = pb.add, sport = A.sport, seq = ++A.boardSeq;
    A.boardErr = null;
    api('board', { sport, tz: zone() }).then((data) => { if (seq === A.boardSeq) A.board = Object.assign({ sport }, data); }, (err) => { if (seq === A.boardSeq) A.boardErr = err; })
      .then(() => { if (state.page === BUILDER && seq === A.boardSeq && A.mode === 'game') paint(BUILDER, 'gb-add', gameAddHtml()); });
  }
  function gameAddHtml() {
    const A = pb.add;
    if (A.boardErr) return errorBox(A.boardErr, 'add-board');
    if (!A.board || A.board.sport !== A.sport) return '<p class="sp-loading">Loading games…</p>';
    const games = gameChoices();
    if (!games.length) return '<p class="sp-muted">No ' + escape(A.sport.toUpperCase()) + ' game that has not started is stored yet.</p>';
    const opt = (g) => '<option value="' + escape(g.game_id) + '"' + (g.game_id === A.gameId ? ' selected' : '') + '>' + escape(String(g.away_team).toUpperCase() + ' at ' + String(g.home_team).toUpperCase() + ' · ' + (g.time_tbd ? fmtDay(g.local_date) + ', time TBD' : fmtWhen(g.start_utc, zone()))) + '</option>';
    return '<div class="sp-add-row"><label class="sp-field sp-gb-game"><span>Game</span><select data-sp-gb-game><option value="">Choose a game</option>' + games.map(opt).join('') + '</select></label></div>' +
      '<div data-sp-part="gb-form">' + gbFormHtml() + '</div>';
  }
  function gbFormHtml() {
    const A = pb.add;
    if (!A.gameId) return '';
    if (A.gameErr) return errorBox(A.gameErr, 'add-game');
    if (!A.game || A.game.game.game_id !== A.gameId) return '<p class="sp-loading">Loading the game…</p>';
    const g = A.game.game, fc = A.game.team_bets && A.game.team_bets.forecast, s = gbState();
    if (s.team !== g.home_team && s.team !== g.away_team) s.team = fc && fc.win && fc.win.away > fc.win.home ? g.away_team : g.home_team;
    const opt = (v, t, cur) => '<option value="' + escape(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + escape(t) + '</option>';
    const sel = (key, opts, cur, text) => '<label class="sp-field"><span>' + escape(text) + '</span><select data-sp-gb="' + key + '">' + opts.map(([v, t]) => opt(v, t, cur)).join('') + '</select></label>';
    const lineText = { win_by: 'By at least (points)', spread: 'Spread (−7.5 = favored)', total: 'Total points', team_total: 'Team points' }[s.market];
    const def = fc ? tbDefaultLine(fc, g, s, A.sport) : null;
    return '<div class="sp-tb-form">' + sel('market', TB_MARKETS, s.market, 'Bet') +
      (s.market !== 'total' ? sel('team', [[g.away_team, String(g.away_team).toUpperCase()], [g.home_team, String(g.home_team).toUpperCase() + ' (home)']], s.team, 'Team') : '') +
      (s.market === 'total' || s.market === 'team_total' ? sel('side', [['over', 'Over'], ['under', 'Under']], s.side, 'Side') : s.market === 'win_by' ? sel('side', [['over', 'Yes'], ['under', 'No']], s.side, 'Wins by that much') : '') +
      (lineText ? '<label class="sp-field"><span>' + escape(lineText) + '</span><input type="number" step="' + (s.market === 'win_by' ? '1' : '0.5') + '"' + (s.market === 'spread' ? '' : ' inputmode="decimal"') + ' data-sp-gb="line" value="' + escape(s.line) + '" placeholder="' + escape(def == null ? '' : fv(def)) + '"></label>' : '') +
      '<button type="button" class="sp-btn" data-sp-gb-add>Add to entry</button></div>' +
      '<div class="sp-tb-result" data-sp-part="gb-result" aria-live="polite">' + gbResultHtml() + '</div>';
  }
  // The bet as typed, with an empty line read as the placeholder (the books'
  // line, else the model's number).
  function gbBet() {
    const A = pb.add, G = A.game, s = gbState();
    if (!G) return null;
    const g = G.game, fc = G.team_bets && G.team_bets.forecast;
    const def = fc ? tbDefaultLine(fc, g, s, A.sport) : null;
    const line = s.market === 'moneyline' ? null : s.line === '' ? def : Number(s.line);
    return { market: s.market, team: s.market === 'total' ? null : s.team, side: s.market === 'moneyline' || s.market === 'spread' ? 'over' : s.side, line };
  }
  function gbProblem(b) {
    if (b.market === 'moneyline') return null;
    const x = Number(b.line);
    if (b.line == null || !Number.isFinite(x)) return 'Type the line.';
    if (b.market === 'win_by') return Number.isInteger(x) && x >= 1 && x <= 60 ? null : 'Win by takes whole points from 1 to 60.';
    if (Math.round(x * 2) !== x * 2) return 'Use a whole or half number, like 7.5.';
    if (b.market === 'spread') return Math.abs(x) <= 60 ? null : 'The spread runs from −60 to 60.';
    return x > 0 && x <= 400 ? null : 'Type a total above 0.';
  }
  function gbResultHtml() {
    const A = pb.add, G = A.game, b = gbBet();
    if (!G || !b) return '';
    const msg = A.gbMsg ? '<p class="sp-pick-msg' + (A.gbMsg.bad ? ' sp-bad' : '') + '">' + A.gbMsg.html + '</p>' : '';
    const bad = gbProblem(b);
    if (bad) return '<p class="sp-muted">' + escape(bad) + '</p>' + msg;
    const fc = G.team_bets && G.team_bets.forecast;
    if (!fc || !fc.pmf) return '<p class="sp-muted">' + escape(teamPickLabel(b)) + ': the team model has no forecast for this game, so type your own chance after adding it.</p>' + msg;
    const r = tbPrice(fc, G.game, Object.assign({}, b, { price: '' }));
    if (r.error) return '<p class="sp-muted">' + escape(r.error) + '</p>' + msg;
    const no = b.market === 'win_by' && b.side === 'under';
    const win = no ? r.lose : r.win, chance = no ? 1 - r.chance : r.chance;
    const check = ((G.team_bets.check || {}).markets || {})[b.market];
    return '<p class="sp-tb-big"><span>' + escape(teamPickLabel(b)) + '</span> <b>' + pct(win) + '</b> <small>fair odds ' + escape(fairOdds(chance)) + '</small> ' + tbBadge(check) + '</p>' +
      (r.push > 0.001 ? '<p class="sp-muted">Push (stake back) ' + pct(r.push) + ' of the time.</p>' : '') +
      (r.book != null && !no ? '<p class="sp-muted">Books, no vig: ' + pct(r.book) + '.</p>' : '') + msg;
  }
  function gbOpenGame(id) {
    const A = pb.add, sport = A.sport;
    A.gameId = id || null; A.game = null; A.gameErr = null; A.gbMsg = null;
    if (A.gb) A.gb.line = '';
    paint(BUILDER, 'gb-form', gbFormHtml());
    if (!id) return;
    api('game', { sport, id }).then((data) => { if (A.gameId === id) A.game = data; }, (err) => { if (A.gameId === id) A.gameErr = err; })
      .then(() => { if (state.page === BUILDER && A.gameId === id) paint(BUILDER, 'gb-form', gbFormHtml()); });
  }
  // Adds a game bet to the draft. Returns an error message, or null.
  function addTeamPick(sport, g, b) {
    const d = draft();
    if (!g || g.status !== 'scheduled' || Date.parse(g.start_utc) <= Date.now()) return 'This game has started.';
    if (d.legs.length >= MAX_PICKS) return 'An entry has at most 6 picks.';
    const bad = gbProblem(b);
    if (bad) return bad;
    const leg = { kind: 'team', sport, game_id: g.game_id, market: b.market, team: b.market === 'total' ? null : b.team, side: b.side, line: b.market === 'moneyline' ? null : Number(b.line),
      matchup: g.away_team + '@' + g.home_team, game_start_utc: g.start_utc, probability: null, probability_source: null, price: '' };
    leg.label = teamPickLabel(leg);
    const same = d.legs.find((l) => isTeamPick(l) && l.game_id === leg.game_id && l.market === leg.market && (l.team || null) === leg.team && l.side === leg.side && Number(l.line) === Number(leg.line));
    if (same) return 'That bet is already in the entry.';
    if (leg.market === 'moneyline' && d.legs.some((l) => isTeamPick(l) && l.game_id === leg.game_id && l.market === 'moneyline')) return 'Both teams to win cancel out.';
    const clash = d.legs.find((l) => neverBoth(l, leg));
    if (clash) return leg.label + ' and ' + (clash.label || teamPickLabel(clash)) + ' can never both win.';
    d.legs.push(leg);
    d.payouts = {};
    saveDraft();
    return null;
  }
  function gbAdd() {
    const A = pb.add, G = A.game, b = gbBet();
    if (!G || !b) return;
    const err = addTeamPick(A.sport, G.game, b);
    A.gbMsg = err ? { bad: true, html: escape(err) } : { html: 'Added as pick ' + draft().legs.length + '.' };
    if (!err) { pb.msg = null; pb.prefill = null; paintEntry(); scheduleEval(0); }
    paint(BUILDER, 'gb-result', gbResultHtml());
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
    if (!e || !l || e.game_id !== l.game_id || e.side !== l.side) return null;
    if (isTeamPick(l)) return e.kind === 'team' && e.market === l.market && (e.team || null) === (l.team || null) && (e.line == null ? l.line == null || l.line === '' : Number(e.line) === Number(l.line)) ? e : null;
    return e.kind !== 'team' && e.player_id === l.player_id && e.stat === l.stat && Number(e.threshold) === Number(l.threshold) ? e : null;
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
    if (r === 'stat') return 'Model: no forecast for this stat; history only.';
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
      modelCheckNoteHtml(m) +
      (m.probability > 0.005 && m.probability < 0.995 ? '<span class="sp-hist-use"><button type="button" class="sp-chip" data-sp-usemodel="' + i + '" data-prob="' + escape(m.probability) + '">Use ' + Math.round(m.probability * 100) + '% (model)</button></span>' : '');
  }
  // How calls near this chance did in testing, and the early-season miss.
  // Shown only when they say something: a gap of 5+ points, or a miss of 5%+
  // of the forecast.
  function modelCheckNoteHtml(m) {
    const out = [];
    const t = m.tested;
    if (t && Math.abs(t.said - t.hit) >= 0.05) out.push('In testing, calls near ' + pct(t.said) + ' hit ' + pct(t.hit) + ' (' + t.games + ' games).');
    const es = m.early_season;
    if (es && es.tested_miss != null && m.mean > 0 && Math.abs(es.tested_miss) >= 0.05 * m.mean) {
      out.push('Early season (' + es.games_this_season + ' game' + (es.games_this_season === 1 ? '' : 's') + ' this year): forecasts this early ran ' + escape(Math.abs(es.tested_miss)) + (es.tested_miss > 0 ? ' high' : ' low') + ' on average.');
    }
    return out.length ? '<span class="sp-model-line sp-model-warn">' + out.join(' ') + '</span>' : '';
  }
  // The pick's last ten games against its own line: green would have won,
  // red would have lost (for an under, a game below the line is a win).
  function legChartHtml(e, what) {
    const r = (e.recent || []).slice().reverse();
    if (r.length < 2) return '';
    const t = Number(e.threshold), W = 200, H = 44, slot = W / 10, n = r.length;
    const vals = r.map((x) => x.value);
    const lo = Math.min(0, t, ...vals) * 1.08, hi = Math.max(...vals, t, 1) * 1.08;
    const y = (v) => 2 + ((hi - v) / (hi - lo)) * (H - 4);
    const res = (v) => (v === t ? 'is-at' : (e.side === 'under' ? v < t : v > t) ? 'is-over' : 'is-under');
    const word = { 'is-at': 'push', 'is-over': 'would have won', 'is-under': 'would have lost' };
    const hov = [];
    const bars = r.map((x, i) => {
      const cx = W - (n - i - 0.5) * slot, top = Math.min(y(x.value), y(0));
      hov.push({ x: cx, y: top, label: fmtDay(x.date) + ' ' + String(x.date).slice(0, 4) + ' · ' + (x.home ? 'vs ' : '@ ') + String(x.opponent).toUpperCase() + '\n' + fv(x.value) + ' · ' + word[res(x.value)] });
      return '<rect class="sp-bar ' + res(x.value) + '" x="' + (cx - slot / 2 + 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + (slot - 4).toFixed(1) + '" height="' + Math.max(1.5, Math.abs(y(x.value) - y(0))).toFixed(1) + '" rx="1.5"/>';
    }).join('');
    const won = r.filter((x) => res(x.value) === 'is-over').length;
    return '<span class="sp-leg-chart"><svg class="sp-legspark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + escape('Last ' + n + ' games, oldest first: ' + vals.join(', ') + '; line ' + fv(t)) + '"' + hoverAttr(hov) + '>' + bars +
      '<line class="sp-ch-ref" x1="0" x2="' + W + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/></svg>' +
      '<small>' + (what ? escape(what) + ': ' : 'Last ' + n + ' against ' + escape(sideWord(e.side)) + ' ' + escape(fv(t)) + ': ') + '<b>' + won + ' of ' + n + '</b> would have won (green).</small></span>';
  }
  function histHtml(i) {
    const e = evalLeg(i);
    if (!e) return pb.evalErr ? '' : '<span class="sp-muted">Checking history…</span>';
    if (e.kind === 'team') return teamHistHtml(i, e);
    const h = e.history;
    if (!h.all.games) return '<span class="sp-muted">No stored games before this one.</span>' + modelLineHtml(i, e) + legAvailHtml(e);
    // The 95% range of the hit rate (decided games only) as a hover note.
    const c = (name, x) => name + ' <b' + (x.range ? ' title="' + escape('Likely true rate ' + pct(x.range.low) + ' to ' + pct(x.range.high) + ' (95% range from ' + (x.games - x.pushes) + ' decided games)') + '"' : '') + '>' + x.hits + '/' + x.games + '</b>';
    const rangeAll = h.all.range && h.all.games >= 5 ? '<span class="sp-muted sp-hist-range">All stored: likely ' + pct(h.all.range.low) + '–' + pct(h.all.range.high) + ' (95% range; few games make it wide).</span>' : '';
    const pushes = h.all.pushes ? ' <span class="sp-muted">(' + h.all.pushes + ' push' + (h.all.pushes === 1 ? '' : 'es') + ')</span>' : '';
    const use = (key, name) => { const r = rateOf(h[key]); return r == null ? '' : '<button type="button" class="sp-chip" data-sp-usehist="' + i + '" data-rate="' + r + '">Use ' + r + '% (' + name + ')</button>'; };
    const uses = use('last10', 'last 10') + use('all', 'all stored');
    return legChartHtml(e) + '<span class="sp-hist-line">Cleared ' + sideWord(e.side) + ' ' + escape(e.threshold) + ' before this game: ' + c('last 5', h.last5) + ' · ' + c('last 10', h.last10) + ' · ' + c('all stored', h.all) + pushes + '</span>' + rangeAll +
      (uses ? '<span class="sp-hist-use">' + uses + '</span>' : h.all.games < MIN_RATE_GAMES ? '<span class="sp-muted">Too few games to copy a rate.</span>' : '') + modelLineHtml(i, e) + legAvailHtml(e);
  }
  // The injury report for one pick (NBA, when the report could be read) and
  // the teammates-out lift in its forecast.
  function legAvailHtml(e) {
    const a = e.availability, m = e.model && e.model.status === 'ok' ? e.model : null, out = [];
    if (a && (a.out || a.unsure)) {
      // ESPN's listing and, NFL, the official report or roster status: say
      // which one flagged the player (ESPN may list him as not listed).
      const espn = a.state === 'ok' && a.status && a.status !== 'not listed' ? 'ESPN lists ' + escape(a.status) + (a.detail ? ' (' + escape(a.detail) + ')' : '') + '.' : '';
      const why = [espn, officialHtml(a).trim()].filter(Boolean).join(' ');
      out.push('<span class="sp-model-line sp-model-warn">Injury report: ' + (why || 'listed.') + ' ' + (a.out ? 'If the player does not play, most apps remove the pick.' : 'Check again before the game.') + '</span>');
    }
    if (m && m.teammates_out && m.teammates_out.applied) out.push('<span class="sp-model-line">Regular teammates listed out (about ' + num(Math.round(m.teammates_out.minutes)) + ' usual minutes): the forecast is raised \u00d7' + escape(m.teammates_out.factor) + '.</span>');
    if (m && m.game_lines) out.push('<span class="sp-model-line">Game total ' + escape(m.game_lines.total) + ', this team’s implied total ' + escape(m.game_lines.team_total) +
      (m.game_lines.applied ? ' (in the forecast).' : ' (shown only; not used for this stat’s forecast).') + '</span>');
    return out.join('');
  }
  const SOURCE_TEXT = { history: 'from history', model: 'from model', book: 'from books', owner: 'typed' };
  // The chance box and, for a parlay, the pick's own odds.
  function legChanceHtml(l, i) {
    const parlay = draft().format === 'parlay';
    return '<label class="sp-chance"><span>Your chance</span><input data-sp-leg-chance type="number" min="1" max="99" step="1" inputmode="numeric" value="' + (l.probability != null ? Math.round(l.probability * 100) : '') + '" aria-label="Your chance for pick ' + (i + 1) + ', percent"><i>%</i></label>' +
      '<span class="sp-src" data-sp-src>' + (SOURCE_TEXT[l.probability_source] || (l.probability != null ? 'typed' : '')) + '</span>' +
      (parlay ? '<label class="sp-field sp-price-field"><span>Odds</span><input data-sp-leg-price type="text" maxlength="12" autocomplete="off" spellcheck="false" value="' + escape(l.price || '') + '" placeholder="−110" aria-label="Odds for pick ' + (i + 1) + ': American, decimal or cents"></label>' +
        '<span class="sp-price-note" data-sp-price-note="' + i + '">' + legPriceNoteHtml(i) + '</span>' : '');
  }
  // What a typed price means: its three forms, and against the chance used,
  // the pick's fair odds and edge (from the last check).
  function legPriceNoteHtml(i) {
    const l = draft().legs[i];
    if (!l || l.price == null || l.price === '') return '';
    const o = priceOf(l.price);
    if (!o) return '<span class="sp-bad">Type odds like −110, +150, 1.91 or 62¢.</span>';
    const e = evalLeg(i), O = e && e.odds;
    let out = oddsText(o);
    if (O && O.edge != null && O.price && Math.abs(O.price.decimal - o.decimal) < 1e-3) {
      out += ' · fair ' + escape(amText(O.fair && O.fair.american)) + ' · edge <b class="' + (O.edge > 0 ? 'sp-pos' : O.edge < 0 ? 'sp-neg' : '') + '">' + (O.edge > 0 ? '+' : O.edge < 0 ? '−' : '') + (Math.abs(O.edge) * 100).toFixed(1) + '%</b>';
    }
    return out;
  }
  function legHtml(l, i) {
    if (isTeamPick(l)) return teamLegHtml(l, i);
    const nameShown = l.player_name || l.player_id, ms = milestone(l.side, l.threshold);
    return '<li class="sp-leg" data-sp-leg="' + i + '"><div class="sp-leg-head"><span class="sp-leg-name"><i>' + (i + 1) + '</i>' + escape(nameShown) +
      (l.team ? ' <span>' + team(l.team) + '</span>' : '') + '</span>' +
      '<button type="button" class="sp-close" data-sp-remove="' + i + '" aria-label="Remove pick ' + (i + 1) + '">×</button></div>' +
      '<p class="sp-leg-game">' + escape(String(l.sport).toUpperCase()) + ' · ' + (l.matchup ? matchupText(l.matchup) : 'game ' + escape(l.game_id)) + (l.game_start_utc ? ' · ' + escape(fmtWhen(l.game_start_utc, zone())) : '') + '</p>' +
      '<div class="sp-leg-line"><span class="sp-leg-stat">' + escape(label(l.stat)) + '</span>' +
      '<select data-sp-leg-side aria-label="Over or under for pick ' + (i + 1) + '"><option value="over"' + (l.side === 'over' ? ' selected' : '') + '>Over</option><option value="under"' + (l.side === 'under' ? ' selected' : '') + '>Under</option></select>' +
      '<input data-sp-leg-line type="number" min="0" max="1000" step="0.5" inputmode="decimal" value="' + escape(l.threshold) + '" aria-label="Line for pick ' + (i + 1) + '">' +
      '<span class="sp-ms" data-sp-ms title="How Kalshi names this line">' + (ms ? escape(ms) : '') + '</span>' +
      legChanceHtml(l, i) + '</div>' +
      '<div class="sp-hist" data-sp-hist="' + i + '">' + histHtml(i) + '</div></li>';
  }
  // A game bet in the entry: the bet, its line and side, the chance and the
  // team's own record against the same line this season.
  function teamLegHtml(l, i) {
    const m = l.market, opt = (v, t, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + t + '</option>';
    const side = m === 'total' || m === 'team_total'
      ? '<select data-sp-leg-side aria-label="Over or under for pick ' + (i + 1) + '">' + opt('over', 'Over', l.side) + opt('under', 'Under', l.side) + '</select>'
      : m === 'win_by' ? '<select data-sp-leg-side aria-label="Yes or no for pick ' + (i + 1) + '">' + opt('over', 'Yes', l.side) + opt('under', 'No', l.side) + '</select>' : '';
    const step = m === 'win_by' ? '1' : '0.5', min = m === 'spread' ? '-60' : m === 'win_by' ? '1' : '0.5', max = m === 'total' || m === 'team_total' ? '400' : '60';
    // No decimal keypad for a spread: phones' decimal pads have no minus sign.
    const line = m === 'moneyline' ? '' : '<input data-sp-leg-tline type="number" min="' + min + '" max="' + max + '" step="' + step + '"' + (m === 'spread' ? '' : ' inputmode="decimal"') + ' value="' + escape(l.line) + '" aria-label="' + (m === 'spread' ? 'Spread' : m === 'win_by' ? 'Points' : 'Line') + ' for pick ' + (i + 1) + '">';
    return '<li class="sp-leg sp-leg-team" data-sp-leg="' + i + '"><div class="sp-leg-head"><span class="sp-leg-name"><i>' + (i + 1) + '</i><span data-sp-tlabel>' + escape(l.label || teamPickLabel(l)) + '</span>' + (m === 'moneyline' ? '' : ' <span>' + escape(TB_NAME[m] || 'Game bet') + '</span>') + '</span>' +
      '<button type="button" class="sp-close" data-sp-remove="' + i + '" aria-label="Remove pick ' + (i + 1) + '">×</button></div>' +
      '<p class="sp-leg-game">' + escape(String(l.sport).toUpperCase()) + ' · ' + (l.matchup ? matchupText(l.matchup) : 'game ' + escape(l.game_id)) + (l.game_start_utc ? ' · ' + escape(fmtWhen(l.game_start_utc, zone())) : '') + '</p>' +
      '<div class="sp-leg-line"><span class="sp-leg-stat">' + escape(m === 'spread' ? 'Spread' : m === 'win_by' ? 'Win by' : m === 'moneyline' ? 'Winner' : 'Points') + '</span>' + side + line +
      legChanceHtml(l, i) + '</div>' +
      '<div class="sp-hist" data-sp-hist="' + i + '">' + histHtml(i) + '</div></li>';
  }
  const TEAM_REASON = { no_model: 'the team game model is not fitted yet', started: 'the game has started', bet: 'this bet cannot be priced', team: 'no forecast for this game' };
  function teamHistHtml(i, e) {
    const l = draft().legs[i], h = e.history, m = e.model, T = String(l.team || '').toUpperCase();
    const subject = l.market === 'total' ? 'Both teams’ last ' + (e.recent || []).length + ' game totals' : l.market === 'team_total' ? T + '’s last ' + (e.recent || []).length + ' scores' : T + '’s last ' + (e.recent || []).length + ' margins';
    const chart = e.chart ? legChartHtml({ recent: e.recent, threshold: e.chart.threshold, side: e.chart.side }, subject) : '';
    const c = (name, x) => name + ' <b>' + x.hits + '/' + x.games + '</b>';
    const hist = h && h.all.games ? '<span class="sp-hist-line">This bet in ' + (l.market === 'total' ? 'their' : T + '’s') + ' games this season: ' + c('last 5', h.last5) + ' · ' + c('last 10', h.last10) + ' · ' + c('all', h.all) +
      (h.all.pushes ? ' <span class="sp-muted">(' + h.all.pushes + ' push' + (h.all.pushes === 1 ? '' : 'es') + ')</span>' : '') + '</span>' : '<span class="sp-muted">No finished games this season yet.</span>';
    const r10 = h ? rateOf(h.last10) : null, rAll = h ? rateOf(h.all) : null;
    const uses = (r10 != null ? '<button type="button" class="sp-chip" data-sp-usehist="' + i + '" data-rate="' + r10 + '">Use ' + r10 + '% (last 10)</button>' : '') +
      (rAll != null ? '<button type="button" class="sp-chip" data-sp-usehist="' + i + '" data-rate="' + rAll + '">Use ' + rAll + '% (season)</button>' : '');
    let model;
    if (!m || m.status !== 'ok') model = '<span class="sp-model-line sp-muted">Model: ' + escape(TEAM_REASON[m && m.reason] || 'no forecast for this bet') + '.</span>';
    else {
      const bookWin = m.book_chance != null ? m.book_chance * (1 - (m.push || 0)) : null;
      model = '<span class="sp-model-line">Model: <b>' + pct(m.probability) + '</b> wins' + (m.push > 0.001 ? ' · push ' + pct(m.push) + ' (stake back)' : '') + ' · fair odds ' + escape(amText(m.fair_american)) + ' ' + tbBadge(m.check) +
        (m.expected ? ' · expects ' + team(e.away_team) + ' ' + escape(Number(m.expected.away_points).toFixed(1)) + ', ' + team(e.home_team) + ' ' + escape(Number(m.expected.home_points).toFixed(1)) : '') + '</span>' +
        (m.book_chance != null ? '<span class="sp-model-line">Books, no vig: <b>' + pct(m.book_chance) + '</b>' + (m.push > 0.001 ? ' (pushes left out)' : '') +
          (m.gap != null && Math.abs(m.gap) >= 0.05 ? ' <span class="sp-model-warn">The model is ' + (Math.abs(m.gap) * 100).toFixed(1) + ' points ' + (m.gap > 0 ? 'higher' : 'lower') + '; a gap this big usually means news the model cannot see.</span>' : '') + '</span>' : '') +
        '<span class="sp-hist-use">' + (m.probability > 0.005 && m.probability < 0.995 ? '<button type="button" class="sp-chip" data-sp-usemodel="' + i + '" data-prob="' + escape(m.probability) + '">Use ' + Math.round(m.probability * 100) + '% (model)</button>' : '') +
        (bookWin > 0.005 && bookWin < 0.995 ? '<button type="button" class="sp-chip" data-sp-usebook="' + i + '" data-prob="' + escape(Math.round(bookWin * 10000) / 10000) + '">Use ' + Math.round(bookWin * 100) + '% (books)</button>' : '') + '</span>';
    }
    return chart + hist + (uses ? '<span class="sp-hist-use">' + uses + '</span>' : '') + model;
  }
  function legsHtml() {
    const d = draft();
    const banner = pb.prefill === 'ok' ? '<p class="sp-banner">Filled in from a shared link. Check every pick, line and payout against your app before saving.</p>'
      : pb.prefill === 'bad' ? '<p class="sp-banner sp-bad">The shared link could not be read, so nothing was filled in.</p>' : '';
    if (!d.legs.length) return banner + emptyBox('No picks yet.', 'Add 1 to 6 player lines or game bets above, or from the NBA and NFL pages.');
    return banner + '<ol class="sp-legs">' + d.legs.map(legHtml).join('') + '</ol>' + '<div data-sp-part="use-all">' + useAllHtml() + '</div>' +
      '<p class="sp-note">History rates show how often the player (or, for a game bet, the team) cleared this line in stored games; they ignore minutes, opponent and role. Game bets are priced by the team game model, whose check is on the NBA and NFL pages. The model reads minutes or targets, the opponent and home or away, and is checked on past games (see the Model check on the NBA and NFL pages). A pick whose player is listed Out, Doubtful or Questionable on the latest ESPN injury report says so, and for NBA the model counts regular teammates listed out; neither reads news or confirmed lineups. The chance you enter is yours.</p>';
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
      '<label class="sp-field"><span>Entry type</span><select data-sp-format>' + opt('power', 'Power: every pick must hit', d.format) + opt('flex', 'Flex: pays with some misses', d.format) + opt('parlay', 'Parlay: odds on each bet (sportsbook, Kalshi)', d.format) + '</select></label>' +
      '<label class="sp-field"><span>Paper stake</span><span class="sp-money"><i>$</i><input data-sp-stake type="number" min="0.01" max="100000" step="0.01" inputmode="decimal" value="' + escape(d.stake) + '"></span></label></div>';
  }
  function payoutsHtml() {
    const d = draft(), n = d.legs.length;
    if (!n) return '';
    if (d.format === 'parlay') return parlayHtml();
    const ks = d.format === 'power' ? [n] : [n, n - 1, n - 2].filter((k) => k >= 1);
    return '<div class="sp-payouts"><p class="sp-label">Payout from your app</p><div class="sp-payout-row">' + ks.map((k) =>
      '<label class="sp-field"><span>' + (n === 1 ? 'Pick hits' : k === n ? 'All ' + n + ' hit' : k + ' of ' + n + ' hit') + '</span><span class="sp-money"><input data-sp-payout="' + k + '" type="number" min="0" max="100000" step="0.01" inputmode="decimal" value="' + escape(d.payouts[k] ?? '') + '"><i>×</i></span></label>').join('') + '</div>' +
      '<p class="sp-note">Type the multiplier your app shows for this exact entry, stake included (3× on $10 pays back $30).' + (d.format === 'flex' ? ' Leave a row empty if it pays nothing.' : '') + ' Payouts clear when the picks or entry type change.</p></div>';
  }
  // A parlay pays the picks' odds multiplied. Type each pick's odds above,
  // or the one price the app shows for the whole parlay here.
  function parlayHtml() {
    const d = draft(), n = d.legs.length;
    const each = d.legs.map((l) => priceOf(l.price));
    if (each.every(Boolean)) {
      const dec = each.reduce((a, o) => a * o.decimal, 1);
      return '<div class="sp-payouts"><p class="sp-label">Parlay odds</p><p class="sp-parlay-all">' + (n === 1 ? 'The bet pays ' : 'The ' + n + ' picks’ odds multiplied: ') + '<b>' + escape(oddsText({ decimal: Math.round(dec * 10000) / 10000 })) + '</b> (' + escape(dec.toFixed(2)) + '× the stake back)</p>' +
        '<p class="sp-note">A pick that pushes drops out and the rest pay at their own odds. Many apps price a same-game parlay below the multiplied odds; if yours shows a different price, clear one pick’s odds and type the app’s price for the whole parlay instead.</p></div>';
    }
    return '<div class="sp-payouts"><p class="sp-label">Parlay odds from your app</p><div class="sp-payout-row">' +
      '<label class="sp-field"><span>' + (n === 1 ? 'The bet' : 'All ' + n + ' win') + '</span><input data-sp-parlay type="text" maxlength="12" autocomplete="off" spellcheck="false" value="' + escape(d.parlayPrice || '') + '" placeholder="+600"></label>' +
      '<span class="sp-price-note" data-sp-parlay-note>' + parlayNoteHtml() + '</span></div>' +
      '<p class="sp-note">Type the price as American (+600), decimal (7.0) or Kalshi cents (14¢), or type every pick’s odds above and they are multiplied. With one price for the whole parlay, a pushed pick is treated as the stake back.</p></div>';
  }
  function parlayNoteHtml() {
    const raw = draft().parlayPrice;
    if (raw == null || raw === '') return '';
    const o = priceOf(raw);
    return o ? escape(oddsText(o)) + ' · pays ' + escape(o.decimal.toFixed(2)) + '× the stake' : '<span class="sp-bad">Type odds like +600, 7.0 or 14¢.</span>';
  }
  // The entry's price in every format: fair at the chance shown, what the
  // app pays and the edge.
  function oddsBlockHtml(E, ev) {
    const O = E && E.odds;
    if (!O) return '';
    const n = ev.legs.length;
    const row = (name, o, sub) => '<tr><th scope="row">' + name + (sub ? ' <small class="sp-muted">' + sub + '</small>' : '') + '</th><td class="sp-n">' + escape(oddsText(o)) + '</td></tr>';
    const same = E.status === 'joint_estimate' || E.status === 'not_calculated';
    const rows = [
      O.fair ? row('Fair odds', O.fair, n > 1 ? 'all ' + n + ' win, at the chance shown' : 'at the chance shown') : '',
      same && O.fair_if_unrelated ? row('Fair if unrelated', O.fair_if_unrelated, 'chances multiplied') : '',
      O.offered ? row(ev.format === 'parlay' ? 'Your odds' : 'Your payout', O.offered, ev.format === 'flex' ? 'top row' : '') : '',
    ].join('');
    if (!rows) return '';
    const edge = O.edge != null ? '<p class="sp-odds-edge">Edge: <b class="' + (O.edge > 0 ? 'sp-pos' : O.edge < 0 ? 'sp-neg' : '') + '">' + (O.edge > 0 ? '+' : O.edge < 0 ? '−' : '') + (Math.abs(O.edge) * 100).toFixed(1) + '%</b> expected profit per $1 at the chance shown' +
      (E.push_chance > 0.001 ? (ev.format === 'parlay' ? ' (a pushed pick drops out)' : ' (a push counted as a miss)') : '') + '.</p>' : '';
    return '<div class="sp-odds"><p class="sp-label">Odds</p><table class="sp-table sp-odds-table" data-nosort><tbody>' + rows + '</tbody></table>' + edge + '</div>';
  }
  // Same-game notes: picks on one number, and how much the links moved the
  // chance away from "unrelated".
  function sameGameNoteHtml(E, n) {
    const out = [];
    (E.shared_numbers || []).forEach((x) => out.push('Picks ' + (x.legs[0] + 1) + ' and ' + (x.legs[1] + 1) + ' settle on the same number, so they are priced exactly together (one cannot win without the other’s number landing too).'));
    if (E.status === 'joint_estimate' && E.independent_probability > 0) {
      const r = E.joint_probability / E.independent_probability;
      if (Math.abs(r - 1) >= 0.02) out.push('Together these picks hit ' + pct(E.joint_probability) + ', against ' + pct(E.independent_probability) + ' if they were unrelated: ' + (E.links && E.links.length ? 'the links make ' : 'sharing a number makes ') + (n === 2 ? 'both' : 'all ' + n) + ' winning ' + (r > 1 ? 'more' : 'less') + ' likely (' + r.toFixed(2) + '×).');
    }
    if ((E.shared_numbers || []).length && draft().format === 'parlay') out.push('Most sportsbooks will not put two bets on the same number in one parlay (like a team to win and to cover), or price them well below the odds multiplied; check the app’s own price.');
    if (E.push_chance > 0.001) out.push('About ' + pct(E.push_chance) + ' of the time a pick pushes and none loses; ' + (draft().format === 'parlay' ? 'the pushed pick drops out of the parlay. Expected return includes push refunds; the all-win fair odds and break-even line exclude them.' : 'apps usually drop that pick and pay a smaller entry.'));
    return out.length ? '<ul class="sp-sg-notes">' + out.map((x) => '<li>' + escape(x) + '</li>').join('') + '</ul>' : '';
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
      (E.status === 'joint_estimate' ? (E.links && E.links.length ? 'they are priced with how such picks moved together in past games (below).' : 'they are priced together on the one number they share (below).') : 'they are priced only when every pair has a measured link.')));
    const perPick = E.breakeven_per_pick != null && n > 1 ? ' That is about <b>' + pct(E.breakeven_per_pick) + '</b> for each pick if they were independent and equally likely.' : '';
    const be = E.breakeven_probability != null ? '<p>Breakeven' + (ev.format === 'parlay' ? ' before push refunds' : '') + ': all ' + n + ' must hit together at least <b>' + pct(E.breakeven_probability) + '</b> of the time to pay back the stake on average.' + perPick + '</p>'
      : E.breakeven_per_pick != null ? '<p>Breakeven: each pick needs about <b>' + pct(E.breakeven_per_pick) + '</b> (if they were independent and equally likely) for this payout table to pay back the stake on average.</p>' : '';
    let body = '';
    if (E.status === 'needs_payout') {
      const first = String(E.problems[0] || '');
      body = '<p><b>' + escape(first.charAt(0).toUpperCase() + first.slice(1)) + '.</b></p>' + be;
    } else if (E.status === 'not_calculated') {
      const nr = E.expected_net_range;
      body = be + '<p class="sp-muted">No chance of all of them hitting is shown. ' + escape(E.detail || 'Picks from one game need a measured link between them.') + '</p>' +
        (E.bounds ? '<p class="sp-muted">Under any link the chance lies between ' + pct(E.bounds.low) + ' and ' + pct(E.bounds.high) + (E.independent_probability != null ? '; if the picks were unrelated it would be ' + pct(E.independent_probability) : '') + '.' +
          (nr ? ' Expected profit across that range: ' + signedMoney(nr.low) + ' to ' + signedMoney(nr.high) + '.' : '') + '</p>' : '') + sameGameNoteHtml(E, n) + oddsBlockHtml(E, ev);
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
        E.breakeven_per_pick != null ? tile('Each pick needs', pct(E.breakeven_per_pick), 'if equal and independent') : '',
        tile('Expected back', money(E.expected_gross), 'on ' + money(ev.stake) + ' paper'),
        tile('Expected profit', '<span class="' + (E.expected_net > 0 ? 'sp-pos' : E.expected_net < 0 ? 'sp-neg' : '') + '">' + signedMoney(E.expected_net) + '</span>', (E.expected_roi > 0 ? '+' : '') + (E.expected_roi * 100).toFixed(1) + '% return'),
      ].join('');
      const dist = ev.format === 'flex' ? '<p class="sp-dist">Chance of each result: ' + E.distribution.map((p, k) => ({ p, k })).reverse().map((x) => x.k + ' hit ' + pct(x.p)).join(' · ') + '</p>' : '';
      const fromHistory = ev.legs.some((l) => l.probability_source === 'history');
      body = beBarHtml(E.joint_probability, E.breakeven_probability, E.bounds) + '<div class="sp-tiles">' + tiles + '</div>' + dist + sameGameNoteHtml(E, n) + oddsBlockHtml(E, ev) +
        '<p class="sp-note">Independence baseline: it assumes no pick affects another, using the chances entered above' + (fromHistory ? ' (some copied from history rates)' : '') + '. A starting point, not a forecast.</p>';
    }
    return '<div class="sp-eval">' + (warn.length ? '<ul class="sp-warn">' + warn.map((w) => '<li>' + w + '</li>').join('') + '</ul>' : '') + body + '</div>';
  }
  // Same-game estimate: the measured links between picks from one game,
  // priced with the chances entered above (lib/sports/joint.mjs).
  const RELATION_TEXT = { same_player: 'one player', teammate: 'teammates', opponent: 'opponents', game: 'same game' };
  const TEAM_RELATION = { same_player: 'one team', teammate: 'same team', opponent: 'other team', game: 'same game' };
  function linkName(stats, relation) {
    const teamNum = stats.some((x) => x === 'team_margin' || x === 'team_points' || x === 'game_total');
    return (stats[0] === stats[1] ? label(stats[0]) : label(stats[0]) + ' and ' + label(stats[1]).toLowerCase()) + ', ' + (teamNum ? TEAM_RELATION : RELATION_TEXT)[relation];
  }
  const signedLink = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
  function jointHtml(ev, E, n) {
    const tile = (name, value, sub) => '<div class="sp-tile"><span>' + name + '</span><b>' + value + '</b>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>';
    const netRange = E.expected_net_range && E.expected_net_range.high - E.expected_net_range.low >= 0.005 ? signedMoney(E.expected_net_range.low) + ' to ' + signedMoney(E.expected_net_range.high) + ' across the range' : null;
    const tiles = [
      tile('All ' + n + ' hit', pct(E.joint_probability), 'same-game estimate ' + qualityBadge(E.quality)),
      E.links.length ? tile('Range', pct(E.range.low) + ' – ' + pct(E.range.high), 'from how sure each link is') : '',
      tile('If unrelated', pct(E.independent_probability), 'chances multiplied'),
      E.breakeven_probability != null ? tile('Breakeven', pct(E.breakeven_probability), 'all ' + n + ' hit') : '',
      tile('Expected back', money(E.expected_gross), 'on ' + money(ev.stake) + ' paper'),
      tile('Expected profit', '<span class="' + (E.expected_net > 0 ? 'sp-pos' : E.expected_net < 0 ? 'sp-neg' : '') + '">' + signedMoney(E.expected_net) + '</span>', netRange || ((E.expected_roi > 0 ? '+' : '') + (E.expected_roi * 100).toFixed(1) + '% return')),
    ].join('');
    const dist = ev.format === 'flex' ? '<p class="sp-dist">Chance of each result: ' + E.distribution.map((p, k) => ({ p, k })).reverse().map((x) => x.k + ' hit ' + pct(x.p)).join(' · ') + '</p>' : '';
    const links = '<ul class="sp-links">' + E.links.map((l) => '<li><b>Picks ' + (l.legs[0] + 1) + ' and ' + (l.legs[1] + 1) + '</b><span>' + escape(linkName(l.stats, l.relation)) + '</span>' +
      '<span class="sp-link-val">link ' + signedLink(l.link) + ' <i>(95%: ' + signedLink(l.low) + ' to ' + signedLink(l.high) + ')</i></span>' + qualityBadge(l.status) + '</li>').join('') + '</ul>';
    const why = E.quality === 'validated' ? '' : '<p class="sp-muted">Experimental: ' + escape(E.quality_reason || 'a link has not passed its check') + '.</p>';
    return beBarHtml(E.joint_probability, E.breakeven_probability, E.range) + '<div class="sp-tiles">' + tiles + '</div>' + dist + sameGameNoteHtml(E, n) + oddsBlockHtml(E, ev) +
      (E.links.length ? '<p class="sp-label">How these picks moved together in past games</p>' + links : '') + why +
      (!E.links.length ? '<p class="sp-note">Picks on the same number are priced exactly from the model’s chances; picks from different games are treated as unrelated.</p>' : '<p class="sp-note">The link runs from −1 to +1: above 0 means the two results went up and down together, 0 means unrelated. It is measured on the model’s misses in stored games (' + escape(E.as_of_date ? 'through ' + fmtDay(E.as_of_date) + ' ' + E.as_of_date.slice(0, 4) : 'stored seasons') +
      ') and applied to the chances entered above, in ' + Number(E.simulation.draws).toLocaleString('en-US') + ' simulated games (seed ' + escape(E.simulation.seed) + ').' + (E.simulation.adjusted ? ' The links did not fit together exactly, so they were pulled slightly toward 0.' : '') + ' Picks from different games are treated as unrelated.</p>');
  }
  // Break-even vs chance: one bar so the gap reads at a glance.
  function beBarHtml(chance, breakeven, range) {
    if (!(chance >= 0) || !(breakeven > 0)) return '';
    const hi = range && range.high > 0 ? range.high : chance;
    const top = Math.min(1, Math.max(chance, breakeven, hi) * 1.25) || 1;
    const x = (v) => Math.max(0, Math.min(100, (v / top) * 100)).toFixed(1) + '%';
    const ahead = chance >= breakeven;
    const band = range && range.low >= 0 && range.high > range.low ? '<span class="sp-be-band" style="left:' + x(range.low) + ';width:calc(' + x(range.high) + ' - ' + x(range.low) + ')"></span>' : '';
    return '<div class="sp-be" role="img" aria-label="' + escape('Chance ' + pct(chance) + ' against break-even ' + pct(breakeven)) + '">' +
      '<div class="sp-be-head"><span>Chance all hit <b class="' + (ahead ? 'sp-pos' : 'sp-neg') + '">' + pct(chance) + '</b></span><span>Break-even <b>' + pct(breakeven) + '</b></span></div>' +
      '<div class="sp-be-track">' + band + '<span class="sp-be-fill ' + (ahead ? 'is-ahead' : 'is-behind') + '" style="width:' + x(chance) + '"></span><span class="sp-be-mark" style="left:' + x(breakeven) + '"></span></div>' +
      '<div class="sp-be-scale"><span>0%</span><span>' + (ahead ? 'Above break-even by ' : 'Short of break-even by ') + (Math.abs(chance - breakeven) * 100).toFixed(1) + ' pts</span><span>' + pct(top) + '</span></div></div>';
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
      draft().legs.forEach((_, i) => {
        const el = root(BUILDER)?.querySelector('[data-sp-hist="' + i + '"]'); if (el) el.innerHTML = histHtml(i);
        const note = root(BUILDER)?.querySelector('[data-sp-price-note="' + i + '"]'); if (note) note.innerHTML = legPriceNoteHtml(i);
      });
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
        if (l && isTeamPick(l) && e.kind === 'team' && l.game_id === e.game_id && !l.matchup) {
          Object.assign(l, { matchup: e.matchup, game_start_utc: e.game_start_utc, label: e.label });
          filled = true;
        } else if (l && !isTeamPick(l) && l.player_id === e.player_id && l.game_id === e.game_id && !l.player_name) {
          Object.assign(l, { player_name: e.player_name, team: e.team, matchup: e.matchup, game_start_utc: e.game_start_utc });
          filled = true;
        }
      });
      if (filled) saveDraft();
      if (state.page === BUILDER) paintChecked(filled);
      if (pb.useAllPending) { pb.useAllPending = false; if (state.page === BUILDER) useModelAll(); }
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
    if (e.format === 'parlay' && e.payouts[n] > 1) return 'Parlay at ' + escape(oddsText({ decimal: Number(e.payouts[n]) })) + (Array.isArray(e.prices) ? ' (each pick’s odds multiplied)' : '');
    const keys = Object.keys(e.payouts).map(Number).sort((a, b) => b - a);
    return keys.map((k) => escape(e.payouts[k]) + '× ' + (k === n ? (n === 1 ? 'if it hits' : 'all ' + n + ' hit') : k + ' of ' + n)).join(' · ');
  }
  function legResultHtml(l) {
    if (l.result) {
      const actual = l.actual != null ? ' · ' + escape(isTeamPick(l) && l.market !== 'total' && l.market !== 'team_total' ? (l.actual > 0 ? 'won by ' + l.actual : l.actual < 0 ? 'lost by ' + Math.abs(l.actual) : 'tied') : l.actual) : '';
      const why = l.result === 'void' ? (l.game_status === 'final' ? ' · did not play' : ' · game ' + escape(l.game_status)) : '';
      return '<span class="sp-res sp-res-' + escape(l.result) + '">' + RESULT_TEXT[l.result] + actual + why + '</span>';
    }
    const started = Date.parse(l.game_start_utc) <= Date.now();
    return '<span class="sp-res">' + (started ? (isTeamPick(l) ? 'Waiting for the final score' : l.sport === 'nfl' && l.game_status === 'final' ? 'No stat in the final file' : 'Waiting for the final stats') : 'Not started') + '</span>';
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
    const legs = e.legs.map((l) => '<li><span>' + (isTeamPick(l) ? escape(l.label || teamPickLabel(l)) : escape(l.player_name || l.player_id) + ' · ' + escape(label(l.stat)) + ' ' + sideWord(l.side) + ' ' + escape(l.threshold)) +
      ' <span class="sp-muted">' + matchupText(l.matchup) + (l.model && l.model.status === 'ok' ? ' · model ' + pct(l.model.probability) : '') + (l.probability != null ? ' · used ' + pct(l.probability) + (l.probability_source ? ' ' + escape(SOURCE_TEXT[l.probability_source] || '') : '') : '') +
      (l.price > 1 ? ' · at ' + escape(oddsText({ decimal: l.price })) : '') + '</span></span>' + legResultHtml(l) + '</li>').join('');
    const money2 = st.state === 'settled' ? '<p class="sp-entry-money">Paid back ' + money(st.gross) + ' · <b class="' + (st.net > 0 ? 'sp-pos' : st.net < 0 ? 'sp-neg' : '') + '">' + signedMoney(st.net) + '</b>' + (st.manual ? ' <span class="sp-muted">entered by hand' + (st.note ? ': ' + escape(st.note) : '') + '</span>' : '') + '</p>'
      : st.state === 'review' ? '<p class="sp-entry-money">' + escape(st.reason || 'Enter what the app paid.') + '</p>' : '';
    return '<li class="sp-entry' + (st.state === 'withdrawn' ? ' is-withdrawn' : '') + '" data-sp-entry="' + escape(e.entry_id) + '"><div class="sp-entry-head"><span>' + escape(fmtWhen(e.created_utc, zone())) + ' · ' + escape(OPERATOR_NAMES[e.operator] || e.operator) + ' · ' + (e.format === 'flex' ? 'Flex' : e.format === 'parlay' ? 'Parlay' : 'Power') + ' · ' + money(e.stake) + ' paper</span>' + badgeHtml(st) + '</div>' +
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
      ['Add picks', 'Add 1 to 6 picks: player lines (stat, over or under, the line) or game bets (who wins, the spread, win by X or more, the game total, a team total). Add them here, from a player on the NBA and NFL pages, or from a game’s Team bets.'],
      ['Enter the payout', 'Pick’em apps (PrizePicks, Betr): type the power or flex payout. Sportsbooks and Kalshi: choose Parlay and type each bet’s odds (−110, 1.91 or 62¢) or the whole parlay’s price. The site never guesses one.'],
      ['Check the odds', 'Each pick shows its record against the line, the model’s chance and fair odds (game bets also the books’). The entry shows the chance all win, fair odds, your odds and the edge. Picks from one game are priced with how such results moved together in past games; picks on the same number (LAL to win and LAL −5.5) are priced exactly together.'],
      ['Save a paper pick', 'Save before the games start. The journal grades it from the final stats.'],
      ['Screenshots', 'Send a slip screenshot to Claude or ChatGPT; it can open this page with the picks filled in for you to check and save.'],
    ];
    return dayStrip(s) + '<div class="sp-grid"><div class="sp-board">' +
      '<h3>Add a pick</h3><div data-sp-part="add">' + addHtml() + '</div>' +
      '<h3 class="sp-gap">Entry</h3><div data-sp-part="legs">' + legsHtml() + '</div><div data-sp-part="settings">' + settingsHtml() + '</div>' +
      '<div data-sp-part="payouts">' + payoutsHtml() + '</div>' +
      '<div data-sp-part="eval" aria-live="polite">' + evalHtml() + '</div>' +
      '<div data-sp-part="save">' + saveHtml() + '</div><div data-sp-part="save-msg" aria-live="polite">' + saveMsgHtml() + '</div></div>' +
      '<aside class="sp-side"><h3>How it works</h3><ol class="sp-steps">' + steps.map((st) => '<li><b>' + escape(st[0]) + '</b><span>' + escape(st[1]) + '</span></li>').join('') + '</ol></aside></div>' +
      '<section class="sp-journal"><h3>Paper journal</h3><div data-sp-part="journal" aria-live="polite">' + journalHtml() + '</div></section>' +
      '<p class="sp-foot">Paper picks only. The game pages read lines through PropLine. Nothing is placed and no AI model is called by this page.</p>';
  }

  function paint(page, name, html) {
    const el = part(page, name);
    if (el) el.innerHTML = html;
    if (el && (name === 'player' || name === 'chart' || name === 'chart-body' || name === 'view')) fitCharts(page);
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
    if (leagueOf(page)) { syncPlayerMode(page, leagueOf(page)); refocus(page, league(leagueOf(page))); }
    fitCharts(page);
  }
  // A player closed by Back is followed by a full redraw, which drops the
  // focus put back on the name; the redraws in the next few seconds restore it.
  function refocus(page, L) {
    const R = L.refocus;
    if (!R || Date.now() > R.until) { L.refocus = null; return; }
    if (focusLost()) focusIn(page, R.sel);
  }

  function loadBoard(page, lg, manual) {
    const L = league(lg), seq = ++L.boardSeq;
    L.boardErr = null;
    api('board', { sport: lg, tz: zone() }).then((data) => { if (seq === L.boardSeq) L.board = data; }, (err) => { if (seq === L.boardSeq) L.boardErr = err; })
      .then(() => { if (state.page === page && seq === L.boardSeq) paint(page, 'board', boardHtml(lg)); });
    loadProps(page, lg, manual);
  }
  // `manual` = the "Refresh lines & injuries" button: show that it is working
  // at once, ask the server to re-read the feeds, and say when it finished.
  function loadProps(page, lg, manual) {
    const L = league(lg), seq = ++L.propsSeq;
    host.clearTimeout(L.propsTimer);
    L.propsPending = true; L.propsErr = null;
    if (manual) { L.propsNote = ''; if (state.page === page) paint(page, 'board', boardHtml(lg)); }
    api('props', { sport: lg, tz: zone(), refresh: manual ? 1 : null }).then((data) => {
      if (seq === L.propsSeq) { L.props = data; L.propsErr = null; }
    }, (err) => { if (seq === L.propsSeq) { L.propsErr = err; L.props = null; } }).then(() => {
      if (seq !== L.propsSeq) return;
      L.propsPending = false;
      if (manual) L.propsNote = L.propsErr ? 'Refresh failed. Try again in a minute.' : 'Refreshed at ' + fmtClock(new Date().toISOString(), zone()) + '.';
      if (state.page === page) paint(page, 'board', boardHtml(lg));
      const delay = L.props ? Math.max(1000, Math.min(120000, Date.parse(L.props.expires_utc) - Date.now())) : 120000;
      L.propsTimer = host.setTimeout(() => {
        const pane = doc.getElementById('page-pane-' + page);
        if (state.page === page && L.view === 'games' && pane && !pane.hidden && !doc.hidden && options.owner()) { loadBoard(page, lg); }
      }, delay);
    });
  }
  function openGame(page, lg, id) {
    const L = league(lg);
    L.gameId = id; L.game = null; L.gameErr = null;
    if (L.tb) L.tb.line = '';
    paint(page, 'game', gamePanelHtml(lg)); paint(page, 'board', boardHtml(lg));
    api('game', { sport: lg, id }).then((data) => { if (L.gameId === id) L.game = data; }, (err) => { if (L.gameId === id) L.gameErr = err; })
      .then(() => { if (state.page === page && L.gameId === id) paint(page, 'game', gamePanelHtml(lg)); });
  }
  // The open player lives in the address (?player=) so the browser's Back
  // button closes the player page and a link opens it.
  const embedded = () => !!(doc.documentElement && doc.documentElement.classList && doc.documentElement.classList.contains('is-embed'));
  function urlPlayer() {
    try { const v = new URLSearchParams(host.location.search).get('player'); return v && /^[A-Za-z0-9._:-]{1,40}$/.test(v) ? v : null; } catch (_) { return null; }
  }
  function setPlayerUrl(id, push) {
    try {
      const u = new URL(host.location.href);
      if (id) u.searchParams.set('player', id); else u.searchParams.delete('player');
      const next = u.pathname + u.search + u.hash;
      if (next === host.location.pathname + host.location.search + host.location.hash) return false;
      const add = push && !embedded();
      if (add) host.history.pushState(host.history.state, '', next); else host.history.replaceState(host.history.state, '', next);
      return add;
    } catch (_) { return false; }
  }
  function syncPlayerMode(page, lg) {
    const el = root(page);
    if (el && el.classList) el.classList.toggle('sp-has-player', !!league(lg).playerId);
  }
  function scrollToPage(page) {
    const el = root(page);
    if (!el || !el.getBoundingClientRect || !host.scrollTo) return;
    const y = host.scrollY || 0, top = el.getBoundingClientRect().top + y - 72;
    if (y > top) host.scrollTo(0, Math.max(0, top));
  }
  // Keyboard focus follows the page: onto the back button when a player
  // opens, back to the name that opened it when it closes.
  function focusIn(page, sel) {
    const el = root(page), b = el && el.querySelector(sel);
    if (b && b.focus && b.offsetParent !== null) { try { b.focus({ preventScroll: true }); } catch (_) { b.focus(); } return true; }
    return false;
  }
  const focusLost = () => !doc.activeElement || doc.activeElement === doc.body || !doc.documentElement.contains(doc.activeElement);
  function openPlayer(page, lg, id, how) {
    const L = league(lg), fromUrl = how === 'url', wasOpen = !!L.playerId;
    if (!wasOpen) L.returnY = fromUrl ? null : host.scrollY || 0;
    if (!fromUrl) { const pushed = setPlayerUrl(id, !wasOpen); if (!wasOpen) L.playerPushed = pushed; }
    L.playerId = id; L.player = null; L.playerErr = null; L.logAll = false; L.ptab = 'overview';
    paint(page, 'player', playerPanelHtml(lg));
    syncPlayerMode(page, lg);
    scrollToPage(page);
    if (!fromUrl) focusIn(page, '[data-sp-close="player"]');
    api('player', { sport: lg, id }).then((data) => { if (L.playerId === id) L.player = data; }, (err) => { if (L.playerId === id) L.playerErr = err; })
      .then(() => {
        if (state.page !== page || L.playerId !== id) return;
        const r = part(page, 'player'), had = !fromUrl && r && r.contains(doc.activeElement);
        paint(page, 'player', playerPanelHtml(lg));
        if (had || (!fromUrl && focusLost())) focusIn(page, '[data-sp-close="player"]');
      });
  }
  // `fromUrl`: the address already changed (Back, a link). `direct`: close
  // now and leave the history alone (Open game from the player page).
  function closePlayer(page, lg, fromUrl, direct) {
    const L = league(lg);
    if (!L.playerId) return;
    if (!fromUrl && !direct && L.playerPushed && urlPlayer() === L.playerId && host.history && host.history.back) { L.playerPushed = false; host.history.back(); return; }
    const y = direct ? null : L.returnY, was = L.playerId;
    L.playerId = null; L.player = null; L.playerErr = null; L.playerPushed = false; L.returnY = null;
    if (!fromUrl) setPlayerUrl(null, false);
    paint(page, 'player', '');
    syncPlayerMode(page, lg);
    const sel = '.sp-board [data-sp-player="' + String(was).replace(/["\\]/g, '') + '"]';
    if (!direct && focusLost()) focusIn(page, sel);
    L.refocus = direct ? null : { sel, until: Date.now() + 4000 };
    if (y != null) host.setTimeout(() => host.scrollTo(0, y), 0);
  }
  function syncPlayerFromUrl(page, lg) {
    const id = urlPlayer(), L = league(lg);
    if (id && id !== L.playerId) openPlayer(page, lg, id, 'url');
    else if (!id && L.playerId) closePlayer(page, lg, true);
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

  // Player and team stats load once per season and window, then sort and
  // filter in the page.
  function loadTable(page, lg, which) {
    const Q = league(lg)[which];
    const key = (Q.season || '') + '|' + (which === 'leaders' ? Q.window : '');
    Q.key = key; Q.err = null;
    if (Q.cache[key]) { Q.data = Q.cache[key]; paint(page, 'view', viewHtml(lg)); return; }
    Q.data = null;
    paint(page, 'view', viewHtml(lg));
    const params = { sport: lg };
    if (Q.season) params.season = Q.season;
    if (which === 'leaders') params.window = Q.window;
    api(which, params).then((data) => { Q.cache[key] = data; if (Q.key === key) Q.data = data; }, (err) => { if (Q.key === key) Q.err = err; })
      .then(() => { if (state.page === page && league(lg).view === (which === 'leaders' ? 'players' : 'teams') && Q.key === key) paint(page, 'view', viewHtml(lg)); });
  }
  function showView(page, lg, v) {
    const L = league(lg);
    L.view = v;
    root(page)?.querySelectorAll('[data-sp-view]').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-sp-view') === v ? 'true' : 'false'));
    if (v === 'players' && !L.leaders.data) loadTable(page, lg, 'leaders');
    else if (v === 'teams' && !L.teams.data) loadTable(page, lg, 'teams');
    else paint(page, 'view', viewHtml(lg));
    if (v === 'record') loadPropRecord(page, lg);
    if (v === 'games' && ((!L.board && !L.boardErr) || !L.props || Date.parse(L.props.expires_utc) <= Date.now())) loadBoard(page, lg);
  }
  let lineTimer = null;
  // The Team bets checker: a new bet kind or team redraws the form, a typed
  // line or price only the answer.
  function tbChange(page, lg, t) {
    const s = tbState(lg), k = t.getAttribute('data-sp-tb');
    if (['market', 'team', 'side', 'line', 'price'].indexOf(k) < 0 || !league(lg).game) return;
    s[k] = String(t.value).slice(0, 12);
    if (k === 'market') s.line = '';
    if (k === 'market' || k === 'team') { paint(page, 'tb-form', tbFormHtml(lg)); focusIn(page, '[data-sp-tb="' + k + '"]'); }
    else paint(page, 'tb-result', tbResultHtml(lg));
  }
  // League page controls (charts, game panel, player and team stats).
  function leagueChange(page, lg, t) {
    const L = league(lg);
    if (t.matches('[data-sp-chart-stat]')) { L.chart.stat = t.value; paint(page, 'chart', chartHtml(lg)); return true; }
    if (t.matches('[data-sp-chart-stat2]')) { L.chart.stat2 = t.value; paint(page, 'chart-body', chartBodyHtml(lg)); return true; }
    if (t.matches('[data-sp-tb]')) { tbChange(page, lg, t); return true; }
    if (t.matches('[data-sp-game-stat]')) { L.gameStat = t.value; paint(page, 'game', gamePanelHtml(lg)); return true; }
    const Q = L.leaders, T = L.teams;
    if (t.matches('[data-sp-lead-season]')) { Q.season = Number(t.value); Q.all = false; loadTable(page, lg, 'leaders'); return true; }
    if (t.matches('[data-sp-lead-team]')) { Q.team = t.value; Q.all = false; }
    else if (t.matches('[data-sp-lead-group]')) { Q.group = t.value; Q.all = false; }
    else if (t.matches('[data-sp-lead-min]')) { Q.min = Number(t.value); Q.all = false; }
    else if (t.matches('[data-sp-lead-sort]')) { Q.sort = t.value; Q.dir = 'desc'; }
    else if (t.matches('[data-sp-team-season]')) { T.season = Number(t.value); loadTable(page, lg, 'teams'); return true; }
    else if (t.matches('[data-sp-team-stat]')) { T.stat = t.value; paint(page, 'team-body', teamsBody(lg)); return true; }
    else if (t.matches('[data-sp-team-side]')) { T.side = t.value; paint(page, 'team-body', teamsBody(lg)); return true; }
    else return false;
    paint(page, 'lead-body', leadersBody(lg));
    return true;
  }
  function leagueClick(page, lg, t) {
    const L = league(lg), Q = L.leaders, T = L.teams;
    let b;
    if ((b = t.closest('[data-sp-ptab]'))) {
      L.ptab = b.getAttribute('data-sp-ptab');
      root(page)?.querySelectorAll('[data-sp-ptab]').forEach((x) => { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); x.setAttribute('tabindex', x === b ? '0' : '-1'); });
      const body = part(page, 'ptab');
      if (body) body.setAttribute('aria-label', b.textContent);
      if (L.player) { paint(page, 'ptab', playerTabHtml(lg, L.ptab)); fitCharts(page); }
      return true;
    }
    if ((b = t.closest('[data-sp-pp-game]'))) {
      const id = b.getAttribute('data-sp-pp-game');
      closePlayer(page, lg, false, true);
      if (L.view !== 'games') showView(page, lg, 'games');
      openGame(page, lg, id);
      const el = part(page, 'game');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      return true;
    }
    if (lg === 'nba' && (b = t.closest('[data-sp-nba-export]'))) { exportNBAResearch(page, b.getAttribute('data-sp-nba-export'), b.getAttribute('data-sp-nba-season')); return true; }
    if (lg === 'nba' && (b = t.closest('[data-sp-nba-evaluate], [data-sp-nba-save]'))) { evaluateNBAPair(page, b.getAttribute('data-sp-nba-evaluate') || b.getAttribute('data-sp-nba-save'), b.hasAttribute('data-sp-nba-save')); return true; }
    if (t.closest('[data-sp-tb-add]') && L.game && L.game.game) {
      const g = L.game.game, s = tbState(lg), fc = L.game.team_bets && L.game.team_bets.forecast;
      const def = fc ? tbDefaultLine(fc, g, s, lg) : null;
      const raw = s.market === 'moneyline' ? null : s.line === '' ? def : Number(s.line);
      // The checker reads "win by 7.5" as 8 or more; the pick takes whole points.
      const line = s.market === 'win_by' && Number.isFinite(raw) ? Math.ceil(raw) : raw;
      const b = { market: s.market, team: s.market === 'total' ? null : s.team, side: s.market === 'moneyline' || s.market === 'spread' || s.market === 'win_by' ? 'over' : s.side, line };
      const err = addTeamPick(lg, g, b);
      const n = draft().legs.length;
      paint(page, 'tb-msg', err ? '<span class="sp-bad">' + escape(err) + '</span>' : 'Added ' + escape(teamPickLabel(b)) + '. The entry has ' + n + ' pick' + (n === 1 ? '' : 's') + '. <button type="button" class="sp-link" data-sp-goto="' + BUILDER + '">Open Pick Builder</button>');
      return true;
    }
    if (t.closest('[data-sp-record-export]')) { exportPropRecord(page, lg); return true; }
    if (t.closest('[data-sp-record-refresh]')) { loadPropRecord(page, lg); return true; }
    if ((b = t.closest('[data-sp-props-refresh]'))) { if (!b.disabled && !L.propsPending) loadBoard(page, lg, true); return true; }
    if ((b = t.closest('[data-sp-prop-add]'))) {
      const gameId = b.getAttribute('data-sp-prop-add'), P = L.props;
      const game = L.board?.games.find((g) => g.game_id === gameId);
      const p = P?.games.find((g) => g.game_id === gameId)?.picks[Number(b.getAttribute('data-sp-prop-index'))];
      const d = draft();
      if (!p || !game || game.status !== 'scheduled' || game.time_tbd || Date.parse(game.start_utc) <= Date.now() || Date.parse(p.start_utc) <= Date.now() || Date.parse(P.expires_utc) <= Date.now()) { L.propsMsg = 'This pick expired. Refresh the lines before adding it.'; }
      else if (d.legs.length >= MAX_PICKS) L.propsMsg = 'The entry already has 6 picks.';
      else if (d.legs.some((l) => l.sport === lg && l.game_id === gameId && l.player_id === p.player_id && l.stat === p.stat)) L.propsMsg = 'That player and stat is already in the entry.';
      else {
        d.legs.push({ sport: lg, player_id: p.player_id, player_name: p.player_name, team: p.team, game_id: gameId,
          matchup: game.away_team + '@' + game.home_team, game_start_utc: game.start_utc,
          stat: p.stat, side: p.side, threshold: p.threshold, probability: null, probability_source: null });
        d.payouts = {}; saveDraft(); L.propsMsg = 'Added ' + p.player_name + '. Enter the actual entry payout in Pick Builder.';
      }
      paint(page, 'board', boardHtml(lg)); return true;
    }
    if ((b = t.closest('[data-sp-view]'))) { showView(page, lg, b.getAttribute('data-sp-view')); return true; }
    if ((b = t.closest('[data-sp-chart-n]'))) { const v = b.getAttribute('data-sp-chart-n'); L.chart.n = /^\d+$/.test(v) ? Number(v) : v; paint(page, 'chart', chartHtml(lg)); return true; }
    if ((b = t.closest('[data-sp-chart-kind]'))) { L.chart.kind = b.getAttribute('data-sp-chart-kind'); paint(page, 'chart', chartHtml(lg)); return true; }
    if (t.closest('[data-sp-logall]')) { L.logAll = true; paint(page, 'logset', playerTablesHtml(lg)); return true; }
    if ((b = t.closest('[data-sp-logset]'))) { L.logSet = b.getAttribute('data-sp-logset'); paint(page, 'logset', playerTablesHtml(lg)); return true; }
    if ((b = t.closest('[data-sp-lead-set]'))) { Q.set = b.getAttribute('data-sp-lead-set'); paint(page, 'view', viewHtml(lg)); return true; }
    if ((b = t.closest('[data-sp-lead-window]'))) { Q.window = b.getAttribute('data-sp-lead-window'); Q.all = false; loadTable(page, lg, 'leaders'); return true; }
    if ((b = t.closest('[data-sp-lead-mode]'))) { Q.mode = b.getAttribute('data-sp-lead-mode'); paint(page, 'view', viewHtml(lg)); return true; }
    if (t.closest('[data-sp-lead-all]')) { Q.all = true; paint(page, 'lead-body', leadersBody(lg)); return true; }
    if ((b = t.closest('[data-sp-lsort]'))) {
      const k = b.getAttribute('data-sp-lsort');
      Q.dir = Q.sort === k ? (Q.dir === 'asc' ? 'desc' : 'asc') : k === 'name' || k === 'team' ? 'asc' : 'desc';
      Q.sort = k;
      paint(page, 'view', viewHtml(lg));
      return true;
    }
    if ((b = t.closest('[data-sp-team-mode]'))) { T.mode = b.getAttribute('data-sp-team-mode'); paint(page, 'view', viewHtml(lg)); return true; }
    if ((b = t.closest('[data-sp-tsort]'))) {
      const k = b.getAttribute('data-sp-tsort');
      T.dir = T.sort === k ? (T.dir === 'asc' ? 'desc' : 'asc') : k === 'team' ? 'asc' : 'desc';
      T.sort = k;
      paint(page, 'team-body', teamsBody(lg));
      return true;
    }
    if ((b = t.closest('[data-sp-team-pick]'))) {
      Q.team = b.getAttribute('data-sp-team-pick'); Q.group = ''; Q.all = false;
      if (T.data && T.data.season !== (Q.data && Q.data.season)) Q.season = T.data.season;
      L.view = 'players';
      root(page)?.querySelectorAll('[data-sp-view]').forEach((x) => x.setAttribute('aria-pressed', x.getAttribute('data-sp-view') === 'players' ? 'true' : 'false'));
      const key = (Q.season || '') + '|' + Q.window;
      if (Q.data && Q.key === key) paint(page, 'view', viewHtml(lg)); else loadTable(page, lg, 'leaders');
      const el = part(page, 'view');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return true;
    }
    return false;
  }

  function bind(page) {
    const el = root(page);
    if (!el || state.bound[page]) return;
    state.bound[page] = true;
    const lg = leagueOf(page);
    el.addEventListener('keydown', (event) => {
      const t = event.target && event.target.closest ? event.target.closest('[data-sp-ptab]') : null;
      if (!t || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      const tabs = [...el.querySelectorAll('[data-sp-ptab]')], i = tabs.indexOf(t);
      const j = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[j].focus();
      tabs[j].click();
    });
    el.addEventListener('change', (event) => {
      const t = event.target;
      if (t.closest('[data-sp-zone]')) {
        saveZone(t.value);
        state.status = null;
        Object.keys(state.leagues).forEach((k) => { const L = state.leagues[k]; L.board = null; L.props = null; L.propsSeq++; L.boardSeq++; host.clearTimeout(L.propsTimer); });
        load(page, true);
        return;
      }
      const pickForm = t.matches('[name="stat"]') ? t.closest('[data-sp-pickform]') : null;
      if (pickForm) {
        let avgs = {};
        try { avgs = JSON.parse(pickForm.getAttribute('data-sp-avgs') || '{}'); } catch (e) { avgs = {}; }
        const box = pickForm.querySelector('[name="line"]');
        if (box) box.placeholder = lineHint(avgs[t.value]);
        return;
      }
      if (lg) { leagueChange(page, lg, t); return; }
      if (page !== BUILDER) return;
      const d = draft();
      const legEl = t.closest('[data-sp-leg]');
      if (t.matches('[data-sp-leg-side]') && legEl) {
        const l = d.legs[Number(legEl.getAttribute('data-sp-leg'))];
        if (l) {
          l.side = t.value; clearChance(legEl, l);
          if (isTeamPick(l)) { l.label = teamPickLabel(l); const lab = legEl.querySelector('[data-sp-tlabel]'); if (lab) lab.textContent = l.label; }
          else { const ms = legEl.querySelector('[data-sp-ms]'); if (ms) ms.textContent = milestone(l.side, l.threshold) || ''; }
          saveDraft(); scheduleEval();
        }
      } else if (t.matches('[data-sp-operator]')) {
        d.operator = t.value;
        // Sportsbooks and Kalshi price bets with odds; pick'em apps use a payout table.
        const odds = ODDS_APPS.indexOf(d.operator) >= 0;
        if (odds !== (d.format === 'parlay') && d.operator !== 'other') { d.format = odds ? 'parlay' : 'power'; d.payouts = {}; formatChanged('[data-sp-operator]'); }
        saveDraft(); scheduleEval();
      }
      else if (t.matches('[data-sp-format]')) { d.format = t.value; d.payouts = {}; saveDraft(); formatChanged('[data-sp-format]'); scheduleEval(); }
      else if (t.matches('[data-sp-add-sport]')) {
        const A = pb.add;
        A.sport = t.value; A.results = null; A.playerId = null; A.player = null;
        A.board = null; A.gameId = null; A.game = null; A.gbMsg = null;
        if (A.mode === 'game') { paint(BUILDER, 'gb-add', gameAddHtml()); loadAddBoard(); return; }
        paint(BUILDER, 'add-results', ''); paint(BUILDER, 'add-form', '');
        if (A.query.trim().length >= 2) addSearch(A.query);
      }
      else if (t.matches('[data-sp-gb-game]')) gbOpenGame(t.value);
      else if (t.matches('[data-sp-gb]')) gbChange(t);
    });
    el.addEventListener('input', (event) => {
      const t = event.target;
      if (lg === 'nba' && t.matches('[data-sp-nba-payout]')) {
        const d = league('nba').nbaPairs[t.getAttribute('data-sp-nba-payout')];
        if (d) { d.value = t.value; d.seq++; d.result = null; d.error = null; d.pending = false; const status = t.closest('.sp-nba-pair')?.querySelector('[data-sp-pair-result]'); if (status) status.textContent = 'Evaluate the entered payout before saving a paper pair.'; }
        return;
      }
      const box = t.closest('[data-sp-search]');
      if (box && lg) { search(page, lg, box.value); return; }
      if (t.matches('[data-sp-tb]') && lg) { tbChange(page, lg, t); return; }
      if (t.matches('[data-sp-chart-line]') && lg) {
        league(lg).chart.line = t.value;
        host.clearTimeout(lineTimer);
        lineTimer = host.setTimeout(() => { if (league(lg).player) paint(page, 'chart-body', chartBodyHtml(lg)); }, 150);
        return;
      }
      if (page !== BUILDER) return;
      const d = draft();
      const legEl = t.closest('[data-sp-leg]');
      const l = legEl ? d.legs[Number(legEl.getAttribute('data-sp-leg'))] : null;
      if (t.matches('[data-sp-add-search]')) addSearch(t.value);
      else if (t.matches('[data-sp-gb]')) gbChange(t);
      else if (t.matches('[data-sp-leg-line]') && l) {
        l.threshold = t.value === '' ? '' : Number(t.value); clearChance(legEl, l);
        const ms = legEl.querySelector('[data-sp-ms]');
        if (ms) ms.textContent = milestone(l.side, l.threshold) || '';
        saveDraft(); scheduleEval();
      }
      else if (t.matches('[data-sp-leg-tline]') && l) {
        l.line = t.value === '' ? '' : Number(t.value); l.label = teamPickLabel(l); clearChance(legEl, l);
        const lab = legEl.querySelector('[data-sp-tlabel]');
        if (lab) lab.textContent = l.label;
        saveDraft(); scheduleEval();
      }
      else if (t.matches('[data-sp-leg-price]') && l) {
        l.price = String(t.value).slice(0, 12);
        const note = legEl.querySelector('[data-sp-price-note]');
        if (note) note.innerHTML = legPriceNoteHtml(Number(legEl.getAttribute('data-sp-leg')));
        saveDraft(); paint(BUILDER, 'payouts', payoutsHtml()); scheduleEval();
      }
      else if (t.matches('[data-sp-parlay]')) {
        d.parlayPrice = String(t.value).slice(0, 12);
        const note = root(BUILDER)?.querySelector('[data-sp-parlay-note]');
        if (note) note.innerHTML = parlayNoteHtml();
        saveDraft(); scheduleEval();
      }
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
        else if (what === 'props-record' && L) loadPropRecord(page, lg);
        else if (what === 'game' && L) openGame(page, lg, L.gameId);
        else if (what === 'player' && L) openPlayer(page, lg, L.playerId);
        else if (what === 'search' && L) search(page, lg, L.query);
        else if ((what === 'leaders' || what === 'teams') && L) loadTable(page, lg, what);
        else if (what === 'journal') { paint(BUILDER, 'journal', '<p class="sp-loading">Loading the journal…</p>'); loadJournal(); }
        else if (what === 'evaluate') scheduleEval(0);
        else if (what === 'add-search') addSearch(pb.add.query);
        else if (what === 'add-player') addOpenPlayer(pb.add.playerId);
        else if (what === 'add-board') { paint(BUILDER, 'gb-add', '<p class="sp-loading">Loading games…</p>'); loadAddBoard(); }
        else if (what === 'add-game') gbOpenGame(pb.add.gameId);
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
      if (lg && leagueClick(page, lg, t)) return;
      const game = t.closest('[data-sp-game]');
      if (game && lg) { openGame(page, lg, game.getAttribute('data-sp-game')); return; }
      const player = t.closest('[data-sp-player]');
      if (player && lg) { openPlayer(page, lg, player.getAttribute('data-sp-player')); return; }
      const close = t.closest('[data-sp-close]');
      if (close && lg) {
        const L = league(lg);
        if (close.getAttribute('data-sp-close') === 'game') { L.gameId = null; L.game = null; paint(page, 'game', ''); paint(page, 'board', boardHtml(lg)); }
        else closePlayer(page, lg, false);
      }
    });
  }
  // The game-bet form: a new bet kind or team redraws it, a line only the answer.
  function gbChange(t) {
    const s = gbState(), k = t.getAttribute('data-sp-gb');
    if (['market', 'team', 'side', 'line'].indexOf(k) < 0) return;
    s[k] = String(t.value).slice(0, 12);
    pb.add.gbMsg = null;
    if (k === 'market') { s.line = ''; if (s.market === 'win_by' || s.market === 'moneyline' || s.market === 'spread') s.side = 'over'; }
    if (k === 'market' || k === 'team') { paint(BUILDER, 'gb-form', gbFormHtml()); focusIn(BUILDER, '[data-sp-gb="' + k + '"]'); }
    else paint(BUILDER, 'gb-result', gbResultHtml());
  }
  // Power / flex / parlay changes which boxes each pick shows.
  function formatChanged(sel) {
    paint(BUILDER, 'settings', settingsHtml());
    paint(BUILDER, 'legs', legsHtml());
    paint(BUILDER, 'payouts', payoutsHtml());
    focusIn(BUILDER, sel);
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
  function useModelAll() {
    draft().legs.forEach((l, i) => { const e = evalLeg(i); if (e && e.model && e.model.status === 'ok') useModel(i, e.model.probability); });
    saveDraft(); scheduleEval(0);
  }
  function builderClick(t) {
    const d = draft();
    const hit = (sel) => t.closest(sel);
    let b;
    if ((b = hit('[data-sp-add-player]'))) { addOpenPlayer(b.getAttribute('data-sp-add-player')); return; }
    if ((b = hit('[data-sp-add-mode]'))) {
      const A = pb.add, mode = b.getAttribute('data-sp-add-mode') === 'game' ? 'game' : 'player';
      if (A.mode !== mode) { A.mode = mode; paint(BUILDER, 'add', addHtml()); if (mode === 'game' && (!A.board || A.board.sport !== A.sport)) loadAddBoard(); }
      focusIn(BUILDER, '[data-sp-add-mode="' + mode + '"]');
      return;
    }
    if (hit('[data-sp-gb-add]')) { gbAdd(); return; }
    if ((b = hit('[data-sp-usebook]'))) {
      const i = Number(b.getAttribute('data-sp-usebook')), p = Number(b.getAttribute('data-prob'));
      const l = d.legs[i], legEl = b.closest('[data-sp-leg]');
      if (l && legEl && p > 0 && p < 1) {
        l.probability = p; l.probability_source = 'book';
        legEl.querySelector('[data-sp-leg-chance]').value = String(Math.round(p * 100));
        legEl.querySelector('[data-sp-src]').textContent = SOURCE_TEXT.book;
        saveDraft(); scheduleEval(0);
      }
      return;
    }
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
      // Clicked while a check is still running: apply when it answers.
      if (!pb.evaluation) { pb.useAllPending = true; return; }
      useModelAll();
      return;
    }
    if (hit('[data-sp-save]')) { saveEntry(); return; }
    if (hit('[data-sp-clear]')) {
      state.draft = blankDraft(d); saveDraft(); pb.useAllPending = false;
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
    if (leagueOf(page) && options.owner()) syncPlayerFromUrl(page, leagueOf(page));
    if (page === BUILDER && options.owner()) { applyPrefill(); pb.evaluation = null; pb.evalErr = null; }
    render(page);
    if (!options.owner()) return;
    fetchStatus(force).then((s) => {
      render(page);
      const lg = leagueOf(page);
      if (lg && s.sources[lg] && s.sources[lg].state !== 'not_connected') {
        const L = league(lg);
        if (force || !L.board) loadBoard(page, lg);
        else if (!L.props || Date.parse(L.props.expires_utc) <= Date.now()) loadProps(page, lg);
        if (L.view === 'players' && !L.leaders.data) loadTable(page, lg, 'leaders');
        if (L.view === 'teams' && !L.teams.data) loadTable(page, lg, 'teams');
        if (L.view === 'record') loadPropRecord(page, lg);
      }
      if (page === BUILDER) {
        loadJournal();
        if (draft().legs.length) scheduleEval(0);
      }
    }, () => render(page));
  }

  // Redraw the open player's charts at the new width after a resize.
  let resizeTimer = null;
  if (host.addEventListener) host.addEventListener('resize', () => {
    host.clearTimeout(resizeTimer);
    resizeTimer = host.setTimeout(() => { if (leagueOf(state.page)) fitCharts(state.page); }, 150);
  });
  // A hidden tab stops its timer. Returning to it must restart the live
  // scan (or refresh settled results) even without a navigation click.
  doc.addEventListener('visibilitychange', () => {
    const page = state.page, lg = leagueOf(page), pane = doc.getElementById('page-pane-' + page);
    if (doc.hidden || !lg || !pane || pane.hidden || !options.owner()) return;
    const L = league(lg);
    if (L.view === 'record') loadPropRecord(page, lg);
    else if (L.view === 'games' && !L.propsPending) { loadBoard(page, lg); paint(page, 'board', boardHtml(lg)); }
  });
  // priceOf is returned for the smoke test, which compares it with parsePrice.
  return { load, priceOf, neverBoth };
}
