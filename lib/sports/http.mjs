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
import { loadPropSources } from './prop-sources.mjs';
import { recommendationsView, teamAbsence } from './props.mjs';
import { availabilityFor } from './book-price.mjs';
import { unpackRows } from './rows.mjs';
import { capturePropPicks, propRecordView } from './prop-record.mjs';
import { archiveLines } from './line-archive.mjs';
import { captureNBAResearch, nbaPairAction, exportNBAResearch, nbaResearchSummary } from './nba-research.mjs';

// What each league's history comes from. Branches 2 and 3 connect these; until
// a job has written a status record the board says "not connected yet".
export const SPORTS_SOURCES = Object.freeze({
  nfl: { provider: 'nflverse', url: 'https://github.com/nflverse/nflverse-data', license: 'CC BY 4.0 (most releases)', refresh: 'Daily in season' },
  nba: { provider: 'hoopR (ESPN box scores)', url: 'https://hoopr.sportsdataverse.org/', license: 'Private research use', refresh: 'Daily in season' },
});

const GET_OPS = new Set(['status', 'board', 'game', 'players', 'player', 'leaders', 'teams', 'journal', 'props', 'props-record', 'nba-research']);
const LEAGUE_OPS = new Set(['board', 'game', 'players', 'player', 'leaders', 'teams', 'props', 'props-record']);
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
// `load`: a record reader to share across calls in one request (each record
// is then fetched once); a fresh one when not given.
export async function leagueView(op, { store, sport, query = {}, now = Date.now(), limit, absence = null, load = recordLoader(store) }) {
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
  if (op === 'player') return (await buildPlayerLog({ load, sport, playerId: id, seasons, nowMs: now, limit, absence })) || { error: 404 };
  return { error: 405 };
}
// Regular teammates the live injury report lists out for one NBA team's game
// on `date` (teamAbsence), read from the stored seasons. Empty when the
// report is not current.
export async function teamAbsenceFor({ store, sport, team, date, injuries, now = Date.now(), exclude = null, load = recordLoader(store) }) {
  if (sport !== 'nba' || injuries?.state !== 'ok' || !team || !date) return { minutes: 0, players: [] };
  const status = await load('status', { sport }).catch(() => null);
  const seasons = storedSeasons(status, sport, now);
  const [people, ...recs] = await Promise.all([load('players', { sport }).catch(() => null), ...seasons.map((season) => load('player-games', { sport, season }).catch(() => null))]);
  return teamAbsence({ sport, team, date, reports: injuries.reports || [], players: people?.players || [], rows: recs.flatMap((r) => (r ? unpackRows(r) : [])), exclude });
}
// The latest ESPN injury report for one league (free, cached two minutes in
// prop-sources.mjs); `{ state: 'unavailable' }` when it cannot be read.
async function injuryReport(sport, now, env, loadSources) {
  try { return (await loadSources({ sport, now, env, parts: ['injuries'] }))?.injuries || { state: 'unavailable', reports: [] }; }
  catch { return { state: 'unavailable', reports: [] }; }
}

// A player's listing on the injury report for their next game and, for NBA,
// the regular teammates listed out (the forecast's teammates-out input).
// Nothing when no game is ahead.
export async function nextGameAvailability({ store, sport, view, now = Date.now(), env = process.env, loadSources = loadPropSources, load = recordLoader(store) }) {
  const next = view?.next_game;
  if (!next || !(Date.parse(next.start_utc) > now)) return { availability: null, absence: null };
  const injuries = await injuryReport(sport, now, env, loadSources);
  const team = view.forecast ? (view.forecast.home ? next.home_team : next.away_team) : view.player?.team || null;
  const people = (await load('players', { sport }).catch(() => null))?.players || [];
  const person = people.find((p) => p.player_id === view.player?.player_id) || view.player || {};
  // NFL: the official injury report the daily ingest stores, beside ESPN's.
  const official = sport === 'nfl' ? { record: await load('injuries', { sport }).catch(() => null), week: next.week ?? null } : null;
  const availability = availabilityFor(person, team, injuries, sport, official);
  const absence = sport === 'nba' && view.forecast && injuries.state === 'ok'
    ? await teamAbsenceFor({ store, sport, team, date: next.local_date, injuries, now, exclude: view.player?.player_id, load }).catch(() => null) : null;
  return { availability, absence: absence?.minutes > 0 ? absence : null };
}

// Pick Builder writes. `evaluate` only reads; `save-entry` and
// `revise-entry` append to the paper journal under an R2 lease.
const POST_OPS = new Set(['evaluate', 'save-entry', 'revise-entry', 'nba-pair']);
const MAX_BODY_BYTES = 16 * 1024;

function jsonBody(req) {
  let body = req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: 413 };
    try { body = JSON.parse(String(body)); } catch { return { error: 400 }; }
  } else if (body && JSON.stringify(body).length > MAX_BODY_BYTES) return { error: 413 };
  return body && typeof body === 'object' && !Array.isArray(body) ? { body } : { error: 400 };
}

// `injuries`: { nba, nfl: <ESPN report> } when the caller read them, so NBA
// forecasts count regular teammates listed out (as the MCP's do) and each
// leg shows the player's listing. Saving uses the same report as checking.
export async function pickBuilderAction(op, { store, body, now = Date.now(), sub, injuries = null }) {
  const load = recordLoader(store);
  if (op === 'evaluate') return evaluateEntry({ load, body, now, injuries });
  if (op === 'save-entry') return { entry: await saveEntry({ store, load, body, now, sub, injuries }) };
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
  const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const text = (x) => (typeof x === 'string' ? x.slice(0, 160) : null);
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
      // The per-stat checks the card explains (recalibration, early season,
      // teammates out, game factors, real PrizePicks lines). They were left
      // out here until 2026-11-11, so the card never showed them.
      recalibration: obj(v.recalibration) ? { applied: v.recalibration.applied === true, why: text(v.recalibration.why) } : null,
      early_season: obj(v.early_season) ? { n: Number.isInteger(v.early_season.n) ? v.early_season.n : 0, bias: num(v.early_season.bias) } : null,
      teammates_out: obj(v.teammates_out) ? { applied: v.teammates_out.applied === true, why: text(v.teammates_out.why) } : null,
      factors: obj(v.factors) ? Object.fromEntries(Object.entries(v.factors).filter(([k, f]) => /^[a-z_]{1,30}$/.test(k) && obj(f)).slice(0, 6)
        .map(([k, f]) => [k, { applied: f.applied === true, games: Number.isInteger(f.games) ? f.games : 0, brier_with: num(f.brier_with), brier_without: num(f.brier_without), why: text(f.why) }])) : null,
      real_lines: obj(v.real_lines) ? { n: Number.isInteger(v.real_lines.n) ? v.real_lines.n : 0, enough: v.real_lines.enough === true,
        brier: obj(v.real_lines.brier) ? { model: num(v.real_lines.brier.model), last10_hit_rate: num(v.real_lines.brier.last10_hit_rate), even: num(v.real_lines.brier.even) } : {} } : null,
      // Calibration bands for the reliability chart: stated chance, how often it happened, games.
      reliability: (Array.isArray(v.reliability) ? v.reliability : []).slice(0, 20)
        .map((r) => ({ p: num(r?.p), y: num(r?.y), n: Number.isInteger(r?.n) ? r.n : 0 }))
        .filter((r) => r.p != null && r.y != null && r.p >= 0 && r.p <= 1 && r.y >= 0 && r.y <= 1 && r.n > 0),
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
    // This status request never calls an AI model or a sportsbook. The
    // separate props operation reads PrizePicks lines through PropLine.
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
    if (op === 'nba-research') {
      const season = Number(req.query.season), gameId = req.query.id;
      if (req.query.sport !== 'nba' || !Number.isInteger(season) || season < 1946 || season > 2100 || typeof gameId !== 'string' || !QUERY_ID_RE.test(gameId)) return res.status(400).json({ error: 'Invalid NBA research request' });
      const bytes = await exportNBAResearch({ store, season, gameId });
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="nba-research-' + gameId + '.json.gz"');
      return res.status(200).send(bytes);
    }
    if (op === 'status') {
      const tz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
      return res.status(200).json(await sportsStatus({ store, now: deps.now ? deps.now() : Date.now(), tz }));
    }
    if (LEAGUE_OPS.has(op)) {
      const sport = req.query.sport;
      if (!SPORTS.includes(sport)) return res.status(400).json({ error: 'sport must be nba or nfl' });
      if (op === 'props') {
        const now = deps.now ? deps.now() : Date.now();
        const sources = await (deps.loadPropSources || loadPropSources)({ sport, now, env });
        const view = await recommendationsView({ load: recordLoader(store), sport, now, tz: req.query.tz, sources });
        if (sport === 'nba') view.research_tracking = await captureNBAResearch({ store, view, now, clock: deps.now || Date.now });
        view.tracking = await capturePropPicks({ store, view, lines: sources.lines?.lines || null, now: deps.now ? deps.now() : Date.now(), clock: deps.now || Date.now });
        // The model check's real lines (lib/sports/line-archive.mjs); best effort, not in the response.
        await archiveLines({ store, sport, lines: view.line_index, now });
        return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...view });
      }
      if (op === 'props-record') {
        const now = deps.now ? deps.now() : Date.now(), load = recordLoader(store);
        const seasons = storedSeasons(await load('status', { sport }), sport, now);
        const all = req.query.download === '1';
        const offset = req.query.offset == null ? 0 : /^\d+$/.test(String(req.query.offset)) ? Number(req.query.offset) : NaN;
        const limit = req.query.limit == null ? undefined : /^\d+$/.test(String(req.query.limit)) ? Number(req.query.limit) : NaN;
        if (req.query.as_of != null && typeof req.query.as_of !== 'string' || req.query.snapshot != null && (typeof req.query.snapshot !== 'string' || !/^[a-f0-9]{24}$/.test(req.query.snapshot))) return res.status(400).json({ error: 'Invalid prop record snapshot' });
        const view = await propRecordView({ load, sport, seasons, now, all, offset, limit, asOf: req.query.as_of, snapshot: req.query.snapshot });
        if (sport === 'nba' && !all) view.nba_research = await nbaResearchSummary({ load, seasons, now });
        if (all) res.setHeader('Content-Disposition', 'attachment; filename="' + sport + '-prop-record-page-' + offset + '.json"');
        return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...view });
      }
      const now = deps.now ? deps.now() : Date.now(), load = recordLoader(store);
      let view = await leagueView(op, { store, sport, query: req.query, now, limit: CHART_LIMIT, load });
      if (view?.error) return res.status(view.error).json({ error: view.error === 404 ? 'Not found' : 'Bad request' });
      if (op === 'player') {
        // The same injury context the MCP shows: the player's own listing and,
        // for NBA, the forecast raised for regular teammates listed out.
        const live = await nextGameAvailability({ store, sport, view, now, env, loadSources: deps.loadPropSources || loadPropSources, load });
        if (live.absence) view = await leagueView(op, { store, sport, query: req.query, now, limit: CHART_LIMIT, absence: live.absence, load });
        view = { ...view, availability: live.availability };
      }
      return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...view });
    }
    const now = deps.now ? deps.now() : Date.now();
    if (op === 'journal') return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...(await journalView({ load: recordLoader(store), now, sub: session.sub })) });
    if (POST_OPS.has(op)) {
      if (op === 'nba-pair') {
        const parsed = jsonBody(req); if (parsed.error) return res.status(parsed.error).json({ error: 'Invalid request body' });
        if (parsed.body.sport !== 'nba') return res.status(400).json({ error: 'NBA pair evaluation requires sport nba' });
        return res.status(200).json({ schema_version: SPORTS_SCHEMA_VERSION, ...(await nbaPairAction({ store, body: parsed.body, now, clock: deps.now || Date.now })) });
      }
      const parsed = jsonBody(req);
      if (parsed.error) return res.status(parsed.error).json({ error: parsed.error === 413 ? 'Entry is too large' : 'Send the entry as JSON' });
      const legs = Array.isArray(parsed.body.legs) ? parsed.body.legs : [];
      const leagues = op === 'revise-entry' ? [] : SPORTS.filter((sp) => legs.some((l) => l?.sport === sp));
      const injuries = leagues.length ? Object.fromEntries(await Promise.all(leagues.map(async (sp) => [sp, await injuryReport(sp, now, env, deps.loadPropSources || loadPropSources)]))) : null;
      const out = await pickBuilderAction(op, { store, body: parsed.body, now, sub: session.sub, injuries });
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
