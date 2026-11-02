// /api/auth/me?sports=<op> — the one server entry for the Owner Sports
// section. It rides inside api/auth/[action].js (the proven cookie path the
// Research Lab also uses), so Sports adds no Vercel function. Every response
// is private and no-store; every op re-checks the signed Owner session.
import { getSession } from '../session.mjs';
import { sportsEnabled, sportsDeniedStatus } from './access.mjs';
import { sportsDayWindow, resolveTimeZone, SPORTS_DEFAULT_TIME_ZONE, SPORTS_TIME_ZONES } from './time.mjs';
import { SPORTS, SPORTS_STATS, SPORTS_SCHEMA_VERSION } from './schema.mjs';
import { sportsKey, readSportsJson } from './store.mjs';
import { buildBoard, buildGame, searchPlayers, buildPlayerLog, buildLeaders, buildTeams, storedSeasons, CHART_LIMIT } from './read.mjs';
import { evaluateEntry, saveEntry, reviseEntry, journalView } from './journal.mjs';
import { LEAGUE_SOURCES } from './leagues.mjs';

// What each league's history comes from. Branches 2 and 3 connect these; until
// a job has written a status record the board says "not connected yet".
export const SPORTS_SOURCES = Object.freeze({
  nfl: { provider: 'nflverse', url: 'https://github.com/nflverse/nflverse-data', license: 'CC BY 4.0 (most releases)', refresh: 'Daily in season' },
  nba: { provider: 'hoopR (ESPN box scores)', url: 'https://hoopr.sportsdataverse.org/', license: 'Private research use', refresh: 'Daily in season' },
});

const GET_OPS = new Set(['status', 'board', 'game', 'players', 'player', 'leaders', 'teams', 'journal']);
const LEAGUE_OPS = new Set(['board', 'game', 'players', 'player', 'leaders', 'teams']);
const QUERY_ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,95}$/;

// One store reader per request: each record is fetched once even when a view
// asks for it twice. A missing record is null; a broken one is an error.
export function recordLoader(store) {
  const cache = new Map();
  return (kind, opts = {}) => {
    const key = sportsKey(kind, opts);
    if (!cache.has(key)) cache.set(key, readSportsJson(store, key));
    return cache.get(key);
  };
}

// `limit` is how many of a player's games come back (newest first). The
// Sports page asks for CHART_LIMIT so its charts can show whole seasons.
export async function leagueView(op, { store, sport, query = {}, now = Date.now(), limit }) {
  const load = recordLoader(store);
  const tz = typeof query.tz === 'string' ? query.tz : undefined;
  if (op === 'board') return buildBoard({ load, sport, nowMs: now, tz });
  if (op === 'players') return searchPlayers({ load, sport, query: String(query.q || '').slice(0, 60) });
  const status = await load('status', { sport }).catch(() => null);
  const seasons = storedSeasons(status, sport, now);
  if (op === 'leaders' || op === 'teams') {
    const season = /^\d{4}$/.test(String(query.season || '')) ? Number(query.season) : undefined;
    return op === 'leaders' ? buildLeaders({ load, sport, seasons, season, window: String(query.window || 'season') }) : buildTeams({ load, sport, seasons, season });
  }
  const id = String(query.id || '').toLowerCase();
  if (!QUERY_ID_RE.test(id)) return { error: 400 };
  if (op === 'game') {
    // The older finished seasons the job keeps for the stat model (NFL: three)
    // add to the meetings: most NFL pairs do not meet every season.
    const history = Array.from({ length: LEAGUE_SOURCES[sport]?.modelHistory || 0 }, (_, i) => Math.min(...seasons) - 1 - i);
    return (await buildGame({ load, sport, gameId: id, seasons, history })) || { error: 404 };
  }
  if (op === 'player') return (await buildPlayerLog({ load, sport, playerId: id, seasons, nowMs: now, limit })) || { error: 404 };
  return { error: 405 };
}
// Pick Builder writes. `evaluate` only reads; `save-entry` and
// `revise-entry` append to the paper journal under an R2 lease.
const POST_OPS = new Set(['evaluate', 'save-entry', 'revise-entry']);
const MAX_BODY_BYTES = 16 * 1024;

function jsonBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: 413 };
    try { body = JSON.parse(String(body)); } catch { return { error: 400 }; }
  } else if (body && JSON.stringify(body).length > MAX_BODY_BYTES) return { error: 413 };
  return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { error: 400 };
}

export async function pickBuilderAction(op, { store, body, now = Date.now(), sub }) {
  const load = recordLoader(store);
  if (op === 'evaluate') return evaluateEntry({ load, body, now });
  if (op === 'save-entry') return { entry: await saveEntry({ store, load, body, now, sub }) };
  if (op === 'revise-entry') return { event: await reviseEntry({ store, load, body, now, sub }) };
  return { error: 405 };
}

export function sameOrigin(req) {
  const origin = req.headers?.origin, site = req.headers?.['sec-fetch-site'];
  if (!origin) return site === 'same-origin';
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return new URL(origin).origin === new URL(proto + '://' + host).origin;
  } catch { return false; }
}

function sourceStatus(sport, record) {
  const base = { sport, ...SPORTS_SOURCES[sport] };
  if (!record || typeof record !== 'object') return { ...base, state: 'not_connected', last_success_utc: null, seasons: [], counts: null, model: null };
  return {
    ...base,
    state: ['ok', 'degraded', 'failed'].includes(record.state) ? record.state : 'unknown',
    last_success_utc: typeof record.last_success_utc === 'string' ? record.last_success_utc : null,
    last_attempt_utc: typeof record.last_attempt_utc === 'string' ? record.last_attempt_utc : null,
    seasons: Array.isArray(record.seasons) ? record.seasons.filter(Number.isInteger) : [],
    latest_game_date: typeof record.latest_game_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.latest_game_date) ? record.latest_game_date : null,
    counts: record.counts && typeof record.counts === 'object' ? record.counts : null,
    message: typeof record.message === 'string' ? record.message.slice(0, 300) : null,
    model: modelStatus(record.model),
  };
}

// The stat models' holdout check, as the ingest job last wrote it.
function modelStatus(m) {
  if (!m || typeof m !== 'object' || typeof m.model_version !== 'string') return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const stats = {};
  for (const [stat, v] of Object.entries(m.stats || {})) {
    if (!/^[a-z_]{1,40}$/.test(stat) || !v || typeof v !== 'object') continue;
    const b = v.brier && typeof v.brier === 'object' ? v.brier : {};
    stats[stat] = {
      status: v.status === 'validated' ? 'validated' : 'experimental',
      reason: typeof v.reason === 'string' ? v.reason.slice(0, 120) : null,
      test_n: Number.isInteger(v.test_n) ? v.test_n : 0,
      split_date: typeof v.split_date === 'string' ? v.split_date.slice(0, 10) : null,
      brier: { model: num(b.model), last10_hit_rate: num(b.last10_hit_rate), plain_average: num(b.plain_average) },
      ece: num(v.ece), over_rate: num(v.over_rate),
    };
  }
  const RELATIONS = ['same_player', 'teammate', 'opponent'];
  const links = (Array.isArray(m.links) ? m.links : []).filter((l) => l && Array.isArray(l.stats) && l.stats.length === 2 && l.stats.every((x) => /^[a-z_]{1,40}$/.test(x)) && RELATIONS.includes(l.relation)).slice(0, 30).map((l) => {
    const bc = l.both_cleared && typeof l.both_cleared === 'object' ? l.both_cleared : {};
    return {
      stats: l.stats.slice(), relation: l.relation, link: num(l.link),
      status: l.status === 'validated' ? 'validated' : 'experimental',
      reason: typeof l.reason === 'string' ? l.reason.slice(0, 120) : null,
      test_pairs: Number.isInteger(l.test_pairs) ? l.test_pairs : 0,
      both_cleared: { observed: num(bc.observed), copula: num(bc.copula), independent: num(bc.independent) },
    };
  });
  return { model_version: m.model_version.slice(0, 40), as_of_date: typeof m.as_of_date === 'string' ? m.as_of_date.slice(0, 10) : null, seasons: Array.isArray(m.seasons) ? m.seasons.filter(Number.isInteger) : [], stats, links };
}

export async function sportsStatus({ store, now = Date.now(), tz } = {}) {
  const zone = resolveTimeZone(tz);
  const records = store && typeof store.rawGet === 'function'
    ? await Promise.all(SPORTS.map((s) => readSportsJson(store, sportsKey('status', { sport: s })).catch(() => null)))
    : SPORTS.map(() => null);
  return {
    schema_version: SPORTS_SCHEMA_VERSION,
    generated_utc: new Date(now).toISOString(),
    window: sportsDayWindow(now, zone),
    default_time_zone: SPORTS_DEFAULT_TIME_ZONE,
    time_zones: SPORTS_TIME_ZONES.map(([id, label]) => ({ id, label })),
    storage: store?.backend || 'unavailable',
    sources: Object.fromEntries(SPORTS.map((s, i) => [s, sourceStatus(s, records[i])])),
    stats: SPORTS_STATS,
    // Sports never calls an AI model or a sportsbook. Lines are typed in, or
    // read from a screenshot by Claude/ChatGPT outside the site.
    ai_requests: 0,
    sportsbook_requests: 0,
  };
}

export async function handleSportsRequest(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const env = deps.env || process.env;
  const session = await (deps.getSession || getSession)(req).catch(() => null);
  if (!sportsEnabled(session, env)) return res.status(sportsDeniedStatus(env)).json({ error: 'Sports is unavailable for this session' });
  const op = req.query?.sports;
  if (typeof op !== 'string' || req.query?.data != null || req.query?.lab != null) return res.status(400).json({ error: 'Ambiguous sports request' });
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'Same-origin request required' });
  if (!(req.method === 'GET' ? GET_OPS : POST_OPS).has(op)) return res.status(405).json({ error: 'Unknown action or incorrect method' });
  try {
    const store = deps.store || (await import('../datastore.mjs')).store;
    if (op === 'status') {
      const tz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
      return res.status(200).json(await sportsStatus({ store, now: deps.now ? deps.now() : Date.now(), tz }));
    }
    if (LEAGUE_OPS.has(op)) {
      const sport = req.query.sport;
      if (!SPORTS.includes(sport)) return res.status(400).json({ error: 'sport must be nba or nfl' });
      const view = await leagueView(op, { store, sport, query: req.query, now: deps.now ? deps.now() : Date.now(), limit: CHART_LIMIT });
      if (view?.error) return res.status(view.error).json({ error: view.error === 404 ? 'Not found' : 'Bad request' });
      return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...view });
    }
    const now = deps.now ? deps.now() : Date.now();
    if (op === 'journal') return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...(await journalView({ load: recordLoader(store), now, sub: session.sub })) });
    if (POST_OPS.has(op)) {
      const parsed = jsonBody(req);
      if (parsed.error) return res.status(parsed.error).json({ error: parsed.error === 413 ? 'Entry is too large' : 'Send the entry as JSON' });
      const out = await pickBuilderAction(op, { store, body: parsed.body, now, sub: session.sub });
      if (out?.error) return res.status(out.error).json({ error: 'Unknown action' });
      return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...out });
    }
    return res.status(405).json({ error: 'Unknown action or incorrect method' });
  } catch (err) {
    // Pick Builder checks throw readable messages the owner can act on.
    if (err?.expose && Number.isInteger(err.status) && err.status >= 400 && err.status < 600) return res.status(err.status).json({ error: String(err.message).slice(0, 300) });
    console.error('[sports] request failed:', err?.message || err);
    return res.status(502).json({ error: 'Sports data unavailable' });
  }
}
