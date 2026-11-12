// Read-only feeds for the Owner prop board. Keys stay on the server; no
// sportsbook account, proxy, captcha bypass or AI call is involved.
// Provider contract: https://prop-line.com/docs (bulk odds / timestamps).
import { foldName } from './read.mjs';
import { NBA_BOOKS, NBA_REFERENCE_MARKETS, normalizeNBAQuotes, nbaLineCurrent, quoteFresh, shinProbabilities } from './nba-market.mjs';

export const PROP_MARKETS = Object.freeze({
  nba: {
    player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists', player_threes: 'threes',
    player_steals: 'steals', player_blocks: 'blocks', player_turnovers: 'turnovers', player_blocks_steals: 'blk_stl',
    player_points_rebounds_assists: 'pra', player_points_rebounds: 'pts_reb', player_points_assists: 'pts_ast',
    player_rebounds_assists: 'reb_ast', player_fantasy_score: 'fantasy', player_field_goals_made: 'field_goals_made',
    player_field_goals_attempted: 'field_goals_attempted', player_threes_attempted: 'three_attempts',
    player_free_throws_made: 'free_throws_made', player_free_throws_attempted: 'free_throws_attempted',
    player_offensive_rebounds: 'offensive_rebounds', player_defensive_rebounds: 'defensive_rebounds',
  },
  nfl: {
    player_pass_yds: 'passing_yards', player_receptions: 'receptions', player_rush_yds: 'rushing_yards',
    player_reception_yds: 'receiving_yards', player_pass_tds: 'passing_tds', player_pass_interceptions: 'interceptions',
    player_pass_completions: 'completions', player_pass_attempts: 'attempts', player_rush_attempts: 'carries',
    player_rush_tds: 'rushing_tds', player_reception_tds: 'receiving_tds',
    player_pass_rush_yds: 'pass_rush_yards', player_rush_reception_yds: 'rush_rec_yards',
  },
});
export const LINE_MAX_AGE_MS = 10 * 60 * 1000;
export const INJURY_MAX_AGE_MS = 30 * 60 * 1000;
const PATH = { nba: 'basketball/nba', nfl: 'football/nfl' };
const SPORT_KEY = { nba: 'basketball_nba', nfl: 'football_nfl' };
const cache = new Map();

export function fresh(iso, now, maxAge) {
  const age = now - Date.parse(iso);
  return Number.isFinite(age) && age >= -60000 && age <= maxAge;
}
export function teamCode(value, sport) {
  const t = String(value || '').toLowerCase();
  const aliases = sport === 'nba' ? { gsw: 'gs', nyk: 'ny', nop: 'no', sas: 'sa', uta: 'utah' }
    : { wsh: 'was', ws: 'was', jac: 'jax', lar: 'la' };
  return aliases[t] || t;
}

async function fetchJson(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error('provider unavailable'), { status: res.status });
  const max = 16 * 1024 * 1024;
  if (Number(res.headers.get('content-length')) > max) throw new Error('provider response too large');
  const chunks = []; let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) { await res.body.cancel().catch(() => {}); throw new Error('provider response too large'); }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Coalesce simultaneous Owner tabs and reuse for two minutes. Failures expire
// too, and never reuse an old board as if its lines were current.
// A manual "Refresh lines & injuries" click (`force`) re-reads anything older
// than FORCE_REUSE_MS, so the button always fetches without letting repeated
// clicks spend the free PropLine request allowance.
export const FORCE_REUSE_MS = 30000;
async function cached(key, now, fn, fetchImpl, force = false) {
  if (fetchImpl !== fetch) return fn();
  const prior = cache.get(key);
  if (prior && now < prior.until && (!force || now - prior.at < FORCE_REUSE_MS)) return prior.promise;
  if (cache.size > 8) cache.clear();
  const promise = fn();
  cache.set(key, { at: now, until: now + 120000, promise });
  return promise;
}

export function normalizeOdds(events, sport, now) {
  if (!Array.isArray(events)) throw new Error('unexpected odds response');
  const lines = [], seen = new Set();
  for (const event of events) {
    if (event.live || !(Date.parse(event.commence_time) > now)) continue;
    if (event.sport_key && event.sport_key !== SPORT_KEY[sport]) continue;
    for (const book of event.bookmakers || []) {
      if (book.key !== 'prizepicks') continue;
      for (const market of book.markets || []) {
        const stat = PROP_MARKETS[sport]?.[market.key];
        if (!stat || market.suspended_at || market.period && !['full_game', 'full', 'game'].includes(market.period)) continue;
        if (/promo|discount|flash|goblin|demon/i.test(market.description || '')) continue;
        if (market.line_type && market.line_type !== 'main') continue;
        for (const outcome of market.outcomes || []) {
          const side = ({ over: 'over', more: 'over', under: 'under', less: 'under' })[String(outcome.side || outcome.name).toLowerCase()];
          const at = outcome.last_seen_at || market.last_update || book.last_update;
          if (!side || typeof outcome.point !== 'number' || !Number.isFinite(outcome.point) || outcome.point < 0 || outcome.point > 1000 || !Number.isInteger(outcome.point * 2) || !outcome.description || !fresh(at, now, LINE_MAX_AGE_MS)) continue;
          if (outcome.dfs_odds_type && outcome.dfs_odds_type !== 'standard' || outcome.line_type && outcome.line_type !== 'main') continue;
          if (sport === 'nba' && outcome.dfs_odds_type !== 'standard') continue;
          if (outcome.allowed_wager_types && !['under_or_over', side, side === 'over' ? 'more' : 'less'].includes(outcome.allowed_wager_types)) continue;
          if (sport === 'nba' && !nbaLineCurrent(outcome, market, book, now)) continue;
          const key = [event.id, foldName(outcome.description), stat, outcome.point, side].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          lines.push({ event_id: String(event.id), espn_event_id: event.espn_event_id ? String(event.espn_event_id) : null,
            home_team: event.home_team, away_team: event.away_team, start_utc: event.commence_time,
            player_name: String(outcome.description).slice(0, 120), provider_player_id: outcome.player_id || null,
            stat, side, threshold: outcome.point, observed_utc: at, projection_id: outcome.book_outcome_id || null,
            ...(sport === 'nba' ? { last_change_at: outcome.last_change_at || null, book_updated_at: outcome.book_updated_at || null } : {}) });
        }
      }
    }
  }
  return lines;
}

// Game spreads and totals (NBA, 2026-11-11): a sportsbook request of its own
// beside the player prices (`game_lines` in loadPropSources' parts; the two
// were one request until 2026-11-12) asks for `spreads` and `totals`. Per
// book the main row (the book's own,
// else the pair priced closest to even), then the median across books.
// `home_margin` is how many points the home team is favored by (minus the
// home spread), the same sign as nflverse's spread_line. A game total only
// (team totals carry `market.team` and are left out).
// Since 2026-11-12 (team bets) it also asks for `h2h`
// (moneylines), and each game carries the books' no-vig chances (Shin's
// method, the median across books): the home team winning, covering the main
// spread and the game going over the main total.
export const GAME_LINE_MARKETS = Object.freeze(['spreads', 'totals', 'h2h']);
const GAME_LINE_MAX_AGE_MS = 6 * 3600000;
const impliedFromAmerican = (a) => !Number.isFinite(a) || a === 0 ? null : a > 0 ? 100 / (a + 100) : -a / (-a + 100);
function evenness(pair) {
  const p = pair.map((o) => impliedFromAmerican(Number(o.price)));
  return p.every((x) => x != null) ? Math.abs(p[0] - p[1]) : 1;
}
function mainPair(rows) {
  const main = rows.filter((r) => r.market.line_type === 'main');
  const pool = main.length ? main : rows;
  return pool.sort((a, b) => evenness(a.pair) - evenness(b.pair))[0] || null;
}
const medianOf = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function normalizeGameLines(events, sport, now, books = NBA_BOOKS) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const event of events) {
    if (event.live || !(Date.parse(event.commence_time) > now)) continue;
    if (event.sport_key && event.sport_key !== SPORT_KEY[sport]) continue;
    const totals = [], margins = [], seen = [], fairWin = [], fairCover = [], fairOver = [];
    const fair = (pair) => {
      const imp = pair.map((o) => impliedFromAmerican(Number(o.price)));
      return imp.every((x) => x != null) ? shinProbabilities(imp)[0] : null;
    };
    for (const book of event.bookmakers || []) {
      if (!books.includes(book.key)) continue;
      const spreadRows = [], totalRows = [];
      let h2h = null;
      for (const market of book.markets || []) {
        if (market.suspended_at || market.period && !['full_game', 'full', 'game'].includes(market.period)) continue;
        const at = market.last_update || book.last_update;
        if (at && !fresh(at, now, GAME_LINE_MAX_AGE_MS)) continue;
        const outs = (market.outcomes || []).filter((o) => typeof o.point === 'number' && Number.isFinite(o.point));
        if (market.key === 'spreads') {
          const home = outs.find((o) => o.side === 'home' || o.name === event.home_team);
          const away = outs.find((o) => o.side === 'away' || o.name === event.away_team);
          if (home && away && Math.abs(home.point + away.point) < 1e-9 && Math.abs(home.point) <= 60) spreadRows.push({ market, pair: [home, away], value: -home.point });
        } else if (market.key === 'totals' && market.team == null) {
          const over = outs.find((o) => /^over$/i.test(o.name)), under = outs.find((o) => /^under$/i.test(o.name));
          if (over && under && over.point === under.point && over.point > 0 && over.point <= 400) totalRows.push({ market, pair: [over, under], value: over.point });
        } else if (market.key === 'h2h' && !h2h) {
          const all = market.outcomes || [];
          const home = all.find((o) => o.side === 'home' || o.name === event.home_team), away = all.find((o) => o.side === 'away' || o.name === event.away_team);
          if (home && away && all.length === 2) h2h = [home, away];
        }
      }
      const s = mainPair(spreadRows), t = mainPair(totalRows);
      if (s) { margins.push(s.value); const f = fair(s.pair); if (f != null) fairCover.push([s.value, f]); }
      if (t) { totals.push(t.value); const f = fair(t.pair); if (f != null) fairOver.push([t.value, f]); }
      if (h2h) { const f = fair(h2h); if (f != null) fairWin.push(f); }
      if (s || t) seen.push(book.key);
    }
    if (!totals.length && !margins.length) continue;
    const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
    const total = medianOf(totals), margin = medianOf(margins);
    // The cover and over chances only from books whose main line is the
    // stored (median) line, so the chance is for that exact line; none when
    // the books split around it.
    const at = (pairs, line) => pairs.filter(([v]) => line != null && Math.abs(v - line) < 1e-9).map(([, f]) => f);
    const cover = at(fairCover, margin), over = at(fairOver, total);
    const book = { home_win: r4(medianOf(fairWin)), home_cover: r4(medianOf(cover)), over: r4(medianOf(over)), books: Math.max(fairWin.length, cover.length, over.length) };
    out.push({ event_id: String(event.id), home_team: event.home_team, away_team: event.away_team, start_utc: event.commence_time,
      total, home_margin: margin, books: seen.length, observed_utc: new Date(now).toISOString(),
      ...(book.books ? { book } : {}) });
  }
  return out;
}
// The research copy of the sportsbook response keeps the player markets
// only, so stored research records do not grow with the game markets.
function withoutGameMarkets(events) {
  if (!Array.isArray(events)) return events;
  return events.map((e) => ({ ...e, bookmakers: (e.bookmakers || []).map((b) => ({ ...b, markets: (b.markets || []).filter((m) => !GAME_LINE_MARKETS.includes(m.key)) })) }));
}

export function normalizeInjuries(data, sport) {
  if (data?.status !== 'success' || !Array.isArray(data.injuries) || !Number.isFinite(Date.parse(data.timestamp))) throw new Error('unexpected injury response');
  return data.injuries.flatMap((t) => (t.injuries || []).map((i) => {
    const a = i.athlete || {}, href = a.links?.find((l) => l.rel?.includes('playercard'))?.href || '';
    return { name: a.displayName || '', espn_id: String(a.id || href.match(/\/_\/id\/(\d+)/)?.[1] || ''),
      team: teamCode(a.team?.abbreviation, sport), team_name: t.displayName || '', position: a.position?.abbreviation || '',
      status: String(i.status || 'Unknown'), report_utc: i.date || null,
      detail: String(i.shortComment || i.longComment || '').slice(0, 600) };
  })).filter((i) => i.name);
}

// `parts` picks the feeds to read (the MCP's book-price check skips the
// PrizePicks board; 'game_lines' needs 'reference'); every part has the same
// two-minute cache (`force`: a manual refresh, see cached()).
export async function loadPropSources({ sport, now = Date.now(), env = process.env, fetchImpl = fetch, parts = ['lines', 'injuries', 'reference', 'game_lines'], force = false }) {
  if (!SPORT_KEY[sport]) throw new Error('unsupported sport');
  const key = env.PROPLINE_API_KEY;
  const linesJob = !parts.includes('lines') ? Promise.resolve({ state: 'skipped', lines: [] }) : !key ? Promise.resolve({ state: 'not_configured', lines: [], message: 'Connect the free PropLine feed to load PrizePicks lines.' }) :
    cached('lines:' + sport + ':' + key, now, async () => {
      try {
        const url = new URL('https://api.prop-line.com/v1/sports/' + SPORT_KEY[sport] + '/odds');
        url.search = new URLSearchParams({ bookmakers: 'prizepicks', markets: Object.keys(PROP_MARKETS[sport]).join(','), max_age: '600', includeBookIds: 'true' }).toString();
        const data = await fetchJson(url, { 'X-API-Key': key }, fetchImpl);
        return { state: 'ok', lines: normalizeOdds(data, sport, now), fetched_utc: new Date(now).toISOString(), ...(sport === 'nba' ? { raw_events: data } : {}) };
      } catch (err) {
        return { state: err.status === 429 ? 'rate_limited' : 'unavailable', lines: [], message: err.status === 401 || err.status === 403 ? 'The line provider refused access. Check the feed key and plan.' : err.status === 429 ? 'The line feed reached its request limit. Try again later.' : 'The PrizePicks line feed is unavailable. Try again shortly.' };
      }
    }, fetchImpl, force);
  const injuryJob = !parts.includes('injuries') ? Promise.resolve({ state: 'skipped', reports: [] }) : cached('injuries:' + sport, now, async () => {
    try {
      const data = await fetchJson('https://site.api.espn.com/apis/site/v2/sports/' + PATH[sport] + '/injuries', {}, fetchImpl);
      return { state: fresh(data.timestamp, now, INJURY_MAX_AGE_MS) ? 'ok' : 'stale', observed_utc: data.timestamp, reports: normalizeInjuries(data, sport) };
    } catch { return { state: 'unavailable', reports: [] }; }
  }, fetchImpl, force);
  const nbaOdds = (markets) => {
    const url = new URL('https://api.prop-line.com/v1/sports/basketball_nba/odds');
    url.search = new URLSearchParams({ bookmakers: NBA_BOOKS.join(','), markets: markets.join(','), max_age: '300', includeBookIds: 'true' });
    return fetchJson(url, { 'X-API-Key': key }, fetchImpl);
  };
  const failState = (err) => (err?.status === 429 ? 'rate_limited' : 'unavailable');
  const withStatus = (field, err) => (Number.isInteger(err?.status) ? { [field]: err.status } : {});
  const referenceJob = sport !== 'nba' || !parts.includes('reference') ? Promise.resolve(null) : !key ? Promise.resolve({ state: 'not_configured', quotes: [], message: 'Connect the PropLine key to compare sportsbook prices.' }) :
    cached('nba-references:' + key, now, async () => {
      try {
        const data = await nbaOdds(Object.keys(NBA_REFERENCE_MARKETS));
        return { state: 'ok', quotes: normalizeNBAQuotes(data, now), raw_events: withoutGameMarkets(data), fetched_utc: new Date(now).toISOString() };
      } catch (err) { return { state: failState(err), ...withStatus('http_status', err), quotes: [], message: 'Fresh sportsbook comparisons are unavailable. NBA pairs remain research only.' }; }
    }, fetchImpl, force);
  // The game spreads, totals and moneylines are their own request (since
  // 2026-11-12; one combined request with the player prices failed every run
  // after the game markets were added to it), so a refused or oversized game
  // read never takes the player prices down. Callers that do not need them
  // leave 'game_lines' out of `parts` (the five-minute research collector,
  // which reads the archived lines instead, and the MCP's player tools).
  const gameLinesJob = sport !== 'nba' || !parts.includes('reference') || !parts.includes('game_lines') || !key ? Promise.resolve(null) :
    cached('nba-game-lines:' + key, now, async () => {
      try {
        return { game_lines_state: 'ok', game_lines: normalizeGameLines(await nbaOdds(GAME_LINE_MARKETS), 'nba', now) };
      } catch (err) { return { game_lines_state: failState(err), ...withStatus('game_lines_http_status', err), game_lines: [] }; }
    }, fetchImpl, force);
  const [lines, injuries, referencePart, gamePart] = await Promise.all([linesJob, injuryJob, referenceJob, gameLinesJob]);
  const reference = referencePart ? { ...referencePart, ...(gamePart || { game_lines_state: 'skipped', game_lines: [] }) } : null;
  // Check freshness again on a cache hit, not just when it was downloaded.
  const currentLines = lines.lines.filter((l) => Date.parse(l.start_utc) > now && fresh(l.observed_utc, now, sport === 'nba' ? 300000 : LINE_MAX_AGE_MS));
  return { lines: { ...lines, lines: currentLines, provider: 'PropLine · PrizePicks', url: 'https://prop-line.com/odds-api/book/prizepicks' },
    ...(reference ? { reference: { ...reference, provider: 'PropLine · sportsbook prices', quotes: reference.quotes.filter((q) => Date.parse(q.start_utc) > now && quoteFresh(q.observed_utc, now) && Object.values(q.sides).every((s) => !s.book_updated_at || quoteFresh(s.book_updated_at, now))),
      game_lines: (reference.game_lines || []).filter((g) => Date.parse(g.start_utc) > now) } } : {}),
    injuries: { ...injuries, state: injuries.state === 'ok' && !fresh(injuries.observed_utc, now, INJURY_MAX_AGE_MS) ? 'stale' : injuries.state,
      provider: 'ESPN injuries', url: 'https://www.espn.com/' + sport + '/injuries' } };
}
