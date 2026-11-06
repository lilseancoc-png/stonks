// Read-only feeds for the Owner prop board. Keys stay on the server; no
// sportsbook account, proxy, captcha bypass or AI call is involved.
// Provider contract: https://prop-line.com/docs (bulk odds / timestamps).
import { foldName } from './read.mjs';

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
async function cached(key, now, fn, fetchImpl) {
  if (fetchImpl !== fetch) return fn();
  const prior = cache.get(key);
  if (prior && now < prior.until) return prior.promise;
  if (cache.size > 8) cache.clear();
  const promise = fn();
  cache.set(key, { until: now + 120000, promise });
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
          if (outcome.allowed_wager_types && !['under_or_over', side, side === 'over' ? 'more' : 'less'].includes(outcome.allowed_wager_types)) continue;
          const key = [event.id, foldName(outcome.description), stat, outcome.point, side].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          lines.push({ event_id: String(event.id), espn_event_id: event.espn_event_id ? String(event.espn_event_id) : null,
            home_team: event.home_team, away_team: event.away_team, start_utc: event.commence_time,
            player_name: String(outcome.description).slice(0, 120), provider_player_id: outcome.player_id || null,
            stat, side, threshold: outcome.point, observed_utc: at, projection_id: outcome.book_outcome_id || null });
        }
      }
    }
  }
  return lines;
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

export async function loadPropSources({ sport, now = Date.now(), env = process.env, fetchImpl = fetch }) {
  if (!SPORT_KEY[sport]) throw new Error('unsupported sport');
  const key = env.PROPLINE_API_KEY;
  const linesJob = !key ? Promise.resolve({ state: 'not_configured', lines: [], message: 'Connect the free PropLine feed to load PrizePicks lines.' }) :
    cached('lines:' + sport + ':' + key, now, async () => {
      try {
        const url = new URL('https://api.prop-line.com/v1/sports/' + SPORT_KEY[sport] + '/odds');
        url.search = new URLSearchParams({ bookmakers: 'prizepicks', markets: Object.keys(PROP_MARKETS[sport]).join(','), max_age: '600', includeBookIds: 'true' }).toString();
        const data = await fetchJson(url, { 'X-API-Key': key }, fetchImpl);
        return { state: 'ok', lines: normalizeOdds(data, sport, now), fetched_utc: new Date(now).toISOString() };
      } catch (err) {
        return { state: err.status === 429 ? 'rate_limited' : 'unavailable', lines: [], message: err.status === 401 || err.status === 403 ? 'The line provider refused access. Check the feed key and plan.' : err.status === 429 ? 'The line feed reached its request limit. Try again later.' : 'The PrizePicks line feed is unavailable. Try again shortly.' };
      }
    }, fetchImpl);
  const injuryJob = cached('injuries:' + sport, now, async () => {
    try {
      const data = await fetchJson('https://site.api.espn.com/apis/site/v2/sports/' + PATH[sport] + '/injuries', {}, fetchImpl);
      return { state: fresh(data.timestamp, now, INJURY_MAX_AGE_MS) ? 'ok' : 'stale', observed_utc: data.timestamp, reports: normalizeInjuries(data, sport) };
    } catch { return { state: 'unavailable', reports: [] }; }
  }, fetchImpl);
  const [lines, injuries] = await Promise.all([linesJob, injuryJob]);
  // Check freshness again on a cache hit, not just when it was downloaded.
  const currentLines = lines.lines.filter((l) => Date.parse(l.start_utc) > now && fresh(l.observed_utc, now, LINE_MAX_AGE_MS));
  return { lines: { ...lines, lines: currentLines, provider: 'PropLine · PrizePicks', url: 'https://prop-line.com/odds-api/book/prizepicks' },
    injuries: { ...injuries, state: injuries.state === 'ok' && !fresh(injuries.observed_utc, now, INJURY_MAX_AGE_MS) ? 'stale' : injuries.state,
      provider: 'ESPN injuries', url: 'https://www.espn.com/' + sport + '/injuries' } };
}
