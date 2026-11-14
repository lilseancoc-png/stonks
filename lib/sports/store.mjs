// Where Sports records live. Everything sits under `_stonks/sports/v1/` in the
// private R2 store: outside the published data generations, so the public
// /data reader cannot serve it, sync-data never pushes or deletes it, and the
// MCP's key filter refuses it. Only lib/sports/ reads or writes these keys.
import { SPORTS } from './schema.mjs';

export const SPORTS_PREFIX = '_stonks/sports/v1/';
const MAX_READ_BYTES = 24 * 1024 * 1024;

const KINDS = Object.freeze({
  status: ({ sport }) => `status/${sport}.json`,           // last ingestion run per sport (written by the data jobs)
  players: ({ sport }) => `${sport}/players.json`,          // canonical players + provider id crosswalk
  games: ({ sport, season }) => `${sport}/games/${season}.json`,
  'player-games': ({ sport, season }) => `${sport}/player-games/${season}.json`,
  model: ({ sport }) => `${sport}/model.json`,               // stat forecasts' fitted numbers + their holdout check
  'team-model': ({ sport }) => `${sport}/team-model.json`,   // team vs team game model (lib/sports/team-model.mjs) + its holdout check
  'prop-record': ({ sport, season }) => `${sport}/prop-record/${season}.json`, // frozen issued props; never owned by stock workflows
  lines: ({ sport, date }) => `${sport}/lines/${date}.json`, // every pregame PrizePicks main line the props scan matched, by game date (ET)
  injuries: ({ sport }) => `${sport}/injuries.json`,        // the official league injury report, newest week (NFL; written by the data job)
  'nba-research-index': ({ season }) => `nba/research/${season}/index.json`,
  'nba-research-game': ({ season, gameId }) => `nba/research/${season}/games/${gameId}.json`,
  'nba-research-input': ({ digest }) => `nba/research/inputs/${digest}.json`,
  'nba-pair-payouts': ({ owner }) => `nba/payouts/${owner}.json`, // private, account-specific exact-pair quotes
  observations: () => 'markets/observations.json',          // captured lines, append-only
  journal: () => 'journal/entries.json',                    // paper entries, append-only revisions
});

export function sportsKey(kind, { sport, season, gameId, digest, date, owner } = {}) {
  const build = KINDS[kind];
  if (!build) throw new Error('unknown sports record kind ' + kind);
  if (['status', 'players', 'games', 'player-games', 'model', 'team-model', 'prop-record', 'lines', 'injuries'].includes(kind) && !SPORTS.includes(sport)) throw new Error('sport must be nba or nfl');
  if (kind === 'lines' && !(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date + 'T00:00:00Z')))) throw new Error('date must be YYYY-MM-DD');
  if (['games', 'player-games', 'prop-record'].includes(kind) && !(Number.isInteger(season) && season >= 1946 && season <= 2100)) throw new Error('season must be a year');
  if (kind.startsWith('nba-research')) {
    if (sport !== 'nba') throw new Error('NBA research requires sport nba');
    if (kind !== 'nba-research-input' && !(Number.isInteger(season) && season >= 1946 && season <= 2100)) throw new Error('season must be a year');
    if (kind === 'nba-research-game' && (typeof gameId !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,95}$/.test(gameId))) throw new Error('invalid research game id');
    if (kind === 'nba-research-input' && (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) throw new Error('invalid research input digest');
  }
  if (kind === 'nba-pair-payouts' && (sport !== 'nba' || typeof owner !== 'string' || !/^[a-f0-9]{12}$/.test(owner))) throw new Error('Invalid NBA payout owner');
  return SPORTS_PREFIX + build({ sport, season, gameId, digest, date, owner });
}

export function isSportsKey(key) {
  return typeof key === 'string' && key.startsWith(SPORTS_PREFIX) && !key.includes('..');
}

// Read one JSON record; null when it does not exist yet.
export async function readSportsJson(store, key) {
  if (!isSportsKey(key)) throw new Error('not a sports key');
  const bytes = await store.rawGet(key);
  if (bytes == null) return null;
  if (bytes.length > MAX_READ_BYTES) throw Object.assign(new Error('sports record exceeds its size ceiling'), { code: 'RESOURCE_LIMIT' });
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

export async function writeSportsJson(store, key, value) {
  if (!isSportsKey(key)) throw new Error('not a sports key');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_READ_BYTES) throw Object.assign(new Error('sports record exceeds its size ceiling'), { code: 'RESOURCE_LIMIT' });
  await store.rawPut(key, body);
}
