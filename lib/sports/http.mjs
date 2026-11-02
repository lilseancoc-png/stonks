// /api/auth/me?sports=<op> — the one server entry for the Owner Sports
// section. It rides inside api/auth/[action].js (the proven cookie path the
// Research Lab also uses), so Sports adds no Vercel function. Every response
// is private and no-store; every op re-checks the signed Owner session.
import { getSession } from '../session.mjs';
import { sportsEnabled, sportsDeniedStatus } from './access.mjs';
import { sportsDayWindow, resolveTimeZone, SPORTS_DEFAULT_TIME_ZONE, SPORTS_TIME_ZONES } from './time.mjs';
import { SPORTS, SPORTS_STATS, SPORTS_SCHEMA_VERSION } from './schema.mjs';
import { sportsKey, readSportsJson } from './store.mjs';

// What each league's history comes from. Branches 2 and 3 connect these; until
// a job has written a status record the board says "not connected yet".
export const SPORTS_SOURCES = Object.freeze({
  nfl: { provider: 'nflverse', url: 'https://github.com/nflverse/nflverse-data', license: 'CC BY 4.0 (most releases)', refresh: 'Daily in season' },
  nba: { provider: 'hoopR / ESPN box scores, plus owner CSV import', url: 'https://hoopr.sportsdataverse.org/', license: 'Private research use', refresh: 'Daily in season' },
});

const GET_OPS = new Set(['status']);
const POST_OPS = new Set([]);

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
  if (!record || typeof record !== 'object') return { ...base, state: 'not_connected', last_success_utc: null, seasons: [], counts: null };
  return {
    ...base,
    state: ['ok', 'degraded', 'failed'].includes(record.state) ? record.state : 'unknown',
    last_success_utc: typeof record.last_success_utc === 'string' ? record.last_success_utc : null,
    last_attempt_utc: typeof record.last_attempt_utc === 'string' ? record.last_attempt_utc : null,
    seasons: Array.isArray(record.seasons) ? record.seasons.filter(Number.isInteger) : [],
    counts: record.counts && typeof record.counts === 'object' ? record.counts : null,
    message: typeof record.message === 'string' ? record.message.slice(0, 300) : null,
  };
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
    return res.status(405).json({ error: 'Unknown action or incorrect method' });
  } catch (err) {
    console.error('[sports] request failed:', err?.message || err);
    return res.status(502).json({ error: 'Sports data unavailable' });
  }
}
