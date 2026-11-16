#!/usr/bin/env node
// Winning margin bands, Kalshi game markets and the live win-by record
// (lib/sports/win-by.mjs), plus their place in the Team bets view and the
// MCP's read-only Sports store. Offline and deterministic: Kalshi is faked.
// Run: node scripts/sports-win-by-smoke.mjs
import assert from 'node:assert/strict';
import { buildTeamModel, forecastGame } from '../lib/sports/team-model.mjs';
import { teamBetsView, winByLadder } from '../lib/sports/team-bets.mjs';
import {
  marginBands, MARGIN_BANDS, parseKalshiGameTicker, matchKalshiEvent, kalshiAbbrs, kalshiMarketTeam, kalshiWinByX,
  readKalshiGames, kalshiVsModel, updateWinByRecord, winByRecordSummary, WIN_BY_RECORD_VERSION, KALSHI_GAME_SERIES,
} from '../lib/sports/win-by.mjs';
import { sportsKey } from '../lib/sports/store.mjs';
import { seededRandom, seededNormals } from '../lib/sports/normal.mjs';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

// A seeded league with known strengths (same shape as sports-team-smoke).
const TEAMS = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh', 'iii', 'jjj', 'kkk', 'lll'];
const TRUE = Object.fromEntries(TEAMS.map((t, i) => [t, { off: (i - 5.5) * 0.9, def: -(i - 5.5) * 0.5 }]));
function league({ seasons, perSeason, sport = 'nba', seed = 7, startDay = '2022-10-20T00:00:00Z', status = 'final' }) {
  const rnd = seededRandom(seed), z = seededNormals(seed + 1);
  const games = [];
  let day = Date.parse(startDay);
  for (const season of seasons) {
    for (let n = 0; n < perSeason; n++) {
      const i = Math.floor(rnd() * TEAMS.length);
      let j = Math.floor(rnd() * (TEAMS.length - 1));
      if (j >= i) j++;
      const home = TEAMS[i], away = TEAMS[j];
      const mh = 112 + 1.5 + TRUE[home].off + TRUE[away].def, ma = 112 - 1.5 + TRUE[away].off + TRUE[home].def;
      const hs = Math.max(70, Math.round(mh + 11.5 * z())), as0 = Math.max(70, Math.round(ma + 11.5 * z()));
      const as = sport === 'nba' && hs === as0 ? as0 + 1 : as0;
      const start = new Date(day + n * 3600000 * 9).toISOString();
      games.push({ sport, game_id: 'g' + season + '_' + n, season, start_utc: start, local_date: start.slice(0, 10), home_team: home, away_team: away, status, home_score: hs, away_score: as, neutral: false });
    }
    day += perSeason * 3600000 * 9 + 120 * 86400000;
  }
  return games;
}
const NOW = Date.parse('2026-11-12T00:00:00Z');
const past = league({ seasons: [2022, 2023, 2024], perSeason: 700 });
const M = buildTeamModel({ sport: 'nba', games: past, now: NOW });
eq(M.status, 'ok', 'the team model fits');

// --- margin bands ------------------------------------------------------------------
const up = { sport: 'nba', game_id: 'up1', season: 2025, start_utc: '2026-11-13T00:00:00Z', local_date: '2026-11-12', home_team: 'lll', away_team: 'aaa', status: 'scheduled', home_score: null, away_score: null };
const fc = forecastGame(M, up, { rest: { home: 2, away: 2 } });
{
  const mb = marginBands(fc, up, 'nba');
  eq(mb.bands.lll.map((b) => b.label), ['1-5', '6-10', '11-15', '16-20', '21+'], 'NBA bands');
  const total = [...mb.bands.lll, ...mb.bands.aaa].reduce((a, b) => a + b.chance, 0) + mb.tie;
  near(total, 1, 0.01, 'both teams’ bands and a tie add to 1');
  eq(mb.tie, 0, 'no NBA tie');
  const lad = winByLadder(fc, up);
  near(mb.bands.lll.slice(1).reduce((a, b) => a + b.chance, 0), lad.lll['6+'], 0.006, 'bands agree with the win-by ladder');
  ok(mb.most_likely.team === 'lll' && mb.most_likely.by >= 1, 'the strong home team is the most likely winner');
  ok(mb.range80.low <= mb.range50.low && mb.range50.low <= mb.median_home_margin && mb.median_home_margin <= mb.range50.high && mb.range50.high <= mb.range80.high, 'ranges are nested around the median');
  ok(mb.median_home_margin > 3, 'median favors the strong team');
  eq(MARGIN_BANDS.nfl.length, 4, 'NFL has four bands');
  const nflBands = marginBands(fc, { ...up, sport: 'nfl' }, 'nfl');
  eq(nflBands.bands.lll.map((b) => b.label), ['1-6', '7-13', '14-20', '21+'], 'NFL band labels');
  eq(marginBands(null, up, 'nba'), null, 'no forecast, no bands');
}

// --- Kalshi tickers, team matching, win-by numbers ---------------------------------
{
  eq(parseKalshiGameTicker('KXNFLSPREAD-26OCT25KCSEA'), { date: '2026-10-25', teams: 'KCSEA' }, 'event ticker read');
  eq(parseKalshiGameTicker('KXNFLGAME-26JAN04MIANE'), { date: '2026-01-04', teams: 'MIANE' }, 'game ticker read');
  eq(parseKalshiGameTicker('nonsense'), null, 'other tickers ignored');
  ok(kalshiAbbrs('jax', 'nfl').includes('JAC') && kalshiAbbrs('gs', 'nba').includes('GSW') && kalshiAbbrs('la', 'nfl').includes('LAR'), 'Kalshi abbreviations map to stored codes');
  const games = [
    { game_id: 'kc-sea', home_team: 'sea', away_team: 'kc', status: 'scheduled', local_date: '2026-10-25', start_utc: '2026-10-25T20:05:00Z' },
    { game_id: 'jax-den', home_team: 'den', away_team: 'jax', status: 'scheduled', local_date: '2026-10-25', start_utc: '2026-10-25T20:25:00Z' },
  ];
  eq(matchKalshiEvent({ event_ticker: 'KXNFLSPREAD-26OCT25KCSEA' }, games, 'nfl')?.game_id, 'kc-sea', 'matched by date and both teams');
  eq(matchKalshiEvent({ event_ticker: 'KXNFLGAME-26OCT25JACDEN' }, games, 'nfl')?.game_id, 'jax-den', 'JAC is Jacksonville');
  eq(matchKalshiEvent({ event_ticker: 'KXNFLGAME-26NOV01KCSEA' }, games, 'nfl'), null, 'a different week is not matched');
  const g = games[0];
  eq(kalshiMarketTeam({ yes_sub_title: 'SEA Seahawks win by over 3.5 points' }, g, 'nfl'), 'sea', 'team from the label');
  eq(kalshiMarketTeam({ yes_sub_title: 'Kansas City', ticker: 'KXNFLGAME-26OCT25KCSEA-KC' }, g, 'nfl'), 'kc', 'team from the ticker when the label is a city');
  eq(kalshiWinByX({ floor_strike: 3.5 }), { floor: 3.5, x: 4 }, 'over 3.5 is wins by 4+');
  eq(kalshiWinByX({ yes_sub_title: 'KC Chiefs win by over 10.5 points' }), { floor: 10.5, x: 11 }, 'read from the label');
  eq(kalshiWinByX({ floor_strike: 7 }), { floor: 7, x: 8 }, 'over 7 is wins by 8+');
}

// --- reading Kalshi (faked) ------------------------------------------------------
const upGames = [up, { ...up, game_id: 'up2', home_team: 'bbb', away_team: 'kkk', start_utc: '2026-11-13T01:00:00Z' }];
const mk = (ticker, sub, bid, ask, extra = {}) => ({ ticker, yes_sub_title: sub, yes_bid_dollars: bid.toFixed(4), yes_ask_dollars: ask.toFixed(4), last_price_dollars: ((bid + ask) / 2).toFixed(4), volume_fp: '5000', ...extra });
const fakeKalshi = (calls) => async (url) => {
  calls.push(url);
  const s = new URL(url).searchParams.get('series_ticker');
  if (s === 'KXNBAGAME') return JSON.stringify({ events: [
    { event_ticker: 'KXNBAGAME-26NOV12AAALLL', markets: [mk('KXNBAGAME-26NOV12AAALLL-LLL', 'LLL', 0.80, 0.82), mk('KXNBAGAME-26NOV12AAALLL-AAA', 'AAA', 0.19, 0.21)] },
    { event_ticker: 'KXNBAGAME-26NOV12XXXYYY', markets: [mk('KXNBAGAME-26NOV12XXXYYY-XXX', 'XXX', 0.5, 0.52)] },
  ], cursor: '' });
  if (s === 'KXNBASPREAD') return JSON.stringify({ events: [
    { event_ticker: 'KXNBASPREAD-26NOV12AAALLL', markets: [mk('KXNBASPREAD-26NOV12AAALLL-LLL5', 'LLL wins by over 5.5 points', 0.6, 0.62, { floor_strike: 5.5 }), mk('KXNBASPREAD-26NOV12AAALLL-LLL10', 'LLL wins by over 10.5 points', 0.3, 0.33, { floor_strike: 10.5 }), mk('KXNBASPREAD-26NOV12AAALLL-AAA2', 'AAA wins by over 2.5 points', 0.1, 0.12, { floor_strike: 2.5 })] },
  ], cursor: '' });
  return null;
};
// The fixture teams' codes are not real NBA codes, so the abbreviations are
// the codes themselves (upper case), as kalshiAbbrs gives.
const calls = [];
const kg = await readKalshiGames({ fetchText: fakeKalshi(calls), sport: 'nba', games: upGames, now: NOW });
{
  eq(calls.length, 2, 'one request per series');
  ok(calls.every((u) => u.startsWith('https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=') && u.includes('status=open') && u.includes('with_nested_markets=true')), 'public events endpoint');
  eq(Object.keys(kg.games), ['up1'], 'only the stored game is matched');
  eq(kg.series.KXNBAGAME.matched, 1, 'unmatched events counted, not kept');
  const row = kg.games.up1;
  near(row.winner.lll + row.winner.aaa, 1, 0.002, 'winner pair scaled to add to 1');
  near(row.winner_raw.lll, 0.81, 1e-9, 'raw mid kept');
  eq(Object.keys(row.win_by.lll).sort(), ['11+', '6+'], 'win-by markets by threshold');
  near(row.win_by.aaa['3+'], 0.11, 1e-9, 'the underdog’s win-by market');
  ok(kg.ok, 'read ok');
  const failed = await readKalshiGames({ fetchText: async () => { throw new Error('HTTP 503'); }, sport: 'nba', games: upGames, now: NOW });
  ok(!failed.ok && failed.series.KXNBAGAME.error === 'HTTP 503' && !Object.keys(failed.games).length, 'a failed read is noted, never throws');
  eq(Object.keys(KALSHI_GAME_SERIES), ['nfl', 'nba'], 'both leagues');
  const kv = kalshiVsModel(fc, up, { ...row, as_of: kg.fetched_utc });
  eq(kv.win_by.map((r) => `${r.team}:${r.wins_by}`), ['aaa:3+', 'lll:6+', 'lll:11+'], 'away team first, then by points');
  near(kv.win_by[1].model, winByLadder(fc, up).lll['6+'], 0.002, 'model chance at the same threshold');
  ok(kv.winner.lll.kalshi > 0.7 && kv.winner.lll.model > 0.5, 'winner side by side');
  // In the Team bets view.
  const view = teamBetsView({ sport: 'nba', game: up, model: M, allGames: past, kalshi: { ...row, as_of: kg.fetched_utc } });
  ok(view.margin_bands && view.kalshi && view.kalshi.win_by.length === 3, 'Team bets carries the bands and Kalshi');
  ok(!teamBetsView({ sport: 'nba', game: up, model: M, allGames: past }).kalshi, 'no Kalshi row, no Kalshi block');
}

// --- live record: freeze before the game, grade after -----------------------------
{
  const live = league({ seasons: [2025], perSeason: 400, seed: 23, startDay: '2026-01-05T00:00:00Z' });
  let rec = null;
  for (const g of live) {
    const start = Date.parse(g.start_utc);
    const sched = { ...g, status: 'scheduled', home_score: null, away_score: null };
    // A data run 30 hours before (a draft), one 2 hours before (the frozen
    // one), and one after the final.
    rec = updateWinByRecord(rec, { sport: 'nba', season: 2025, games: [sched], model: M, now: start - 30 * 3600000, kalshi: null });
    const first = rec.entries[g.game_id]?.frozen_utc;
    rec = updateWinByRecord(rec, { sport: 'nba', season: 2025, games: [sched], model: M, now: start - 2 * 3600000, kalshi: g.game_id === live[0].game_id ? { games: { [g.game_id]: { winner: { [g.home_team]: 0.6, [g.away_team]: 0.4 }, win_by: { [g.home_team]: { '5+': 0.4 } } } } } : null });
    if (g === live[0]) ok(first && rec.entries[g.game_id].frozen_utc > first, 'a later pre-game run replaces the draft');
    rec = updateWinByRecord(rec, { sport: 'nba', season: 2025, games: [g], model: M, now: start + 4 * 3600000 });
  }
  const e0 = rec.entries[live[0].game_id];
  ok(e0.final && e0.final.margin === live[0].home_score - live[0].away_score, 'graded from the final score');
  const after = updateWinByRecord(rec, { sport: 'nba', season: 2025, games: [{ ...live[1], status: 'scheduled' }], model: M, now: Date.parse(live[1].start_utc) + 3600000 });
  eq(after.entries[live[1].game_id].frozen_utc, rec.entries[live[1].game_id].frozen_utc, 'a game that started is never re-frozen');
  const far = { ...live[5], game_id: 'far', status: 'scheduled', start_utc: new Date(NOW + 5 * 86400000).toISOString() };
  ok(!updateWinByRecord(null, { sport: 'nba', season: 2025, games: [far], model: M, now: NOW }).entries.far, 'games more than 48 hours out wait');
  const canceled = updateWinByRecord({ version: WIN_BY_RECORD_VERSION, sport: 'nba', season: 2025, entries: { x: { ...e0, final: null } } }, { sport: 'nba', season: 2025, games: [{ ...live[0], game_id: 'x', status: 'canceled' }], model: M, now: NOW });
  ok(!canceled.entries.x, 'a canceled game leaves the record');
  eq(updateWinByRecord({ ...rec, season: 2024 }, { sport: 'nba', season: 2025, games: [], model: M, now: NOW }).entries, {}, 'a new season starts a new record');
  const S = winByRecordSummary(rec);
  eq(S.graded, 400, 'every game graded');
  ok(S.status === 'beats_chance', 'known strengths beat chance: ' + S.status);
  ok(S.winner.brier < 0.25 && S.winner.favorite_won > 0.55, 'favorites win more often than a coin');
  near(S.winner.favorite_won, S.winner.favorite_chance, 0.06, 'and about as often as the model said');
  near(S.ranges.in80, 0.8, 0.07, '80% range holds about 80% of finals');
  near(S.ranges.in50, 0.5, 0.08, '50% range holds about half');
  ok(S.bands.chance_on_actual > S.bands.even_split, 'more chance on the band that happened than an even split');
  for (const r of S.ladder) near(r.model, r.actual, 0.06, `win by ${r.wins_by} said vs happened`);
  ok(S.kalshi && S.kalshi.winner.n === 1 && S.kalshi.win_by.n === 1, 'Kalshi graded on the games it priced');
  eq(S.recent.length, 15, 'recent games listed');
  eq(winByRecordSummary({ sport: 'nba', season: 2025, entries: {} }).status, 'collecting', 'nothing graded yet');
  ok(updateWinByRecord(null, { sport: 'nba', season: 2025, games: [up], model: { status: 'not_enough_games' }, now: NOW }).last_run.frozen === 0, 'no model, nothing frozen');
}

// --- the data job: freeze, Kalshi read and status, through ingestLeague ----------------
{
  const { ingestLeague } = await import('../lib/sports/ingest.mjs');
  const NOW2 = Date.parse('2026-11-12T15:00:00Z');
  const hist = league({ seasons: [2024, 2025], perSeason: 600, seed: 31 });
  const cur = league({ seasons: [2026], perSeason: 230, seed: 37, startDay: '2026-08-01T00:00:00Z' });
  // Re-time the current season: finals up to an hour ago, then ten games in
  // the next 30 hours, then the rest later.
  const timed = cur.map((g, i) => {
    const start = i < 200 ? NOW2 - (200 - i) * 9 * 3600000 : i < 210 ? NOW2 + (2 + (i - 200) * 3) * 3600000 : NOW2 + (3 + i - 210) * 86400000;
    const iso = new Date(start).toISOString();
    return i < 200 ? { ...g, start_utc: iso, local_date: iso.slice(0, 10) } : { ...g, start_utc: iso, local_date: iso.slice(0, 10), status: 'scheduled', home_score: null, away_score: null };
  });
  const all = [...hist, ...timed];
  const adapter = { sport: 'nba', source: 'test', version: 1, modelHistory: 0, teamHistory: 0,
    games: async (_ft, seasons) => new Map(seasons.map((y) => [y, all.filter((g) => g.season === y)])),
    rows: async () => ({ rows: [], rejected: [] }), players: async () => ({ players: [] }) };
  const objects = new Map();
  const store = { rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null), rawPut: async (k, v) => { objects.set(k, String(v)); } };
  const g0 = timed[200];
  const kTicker = (series) => `${series}-${g0.local_date.slice(2, 4)}${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(g0.local_date.slice(5, 7)) - 1]}${g0.local_date.slice(8, 10)}${g0.away_team.toUpperCase()}${g0.home_team.toUpperCase()}`;
  const asked = [];
  const fetchText = async (url) => {
    asked.push(url);
    if (!url.includes('kalshi')) return null;
    const series = new URL(url).searchParams.get('series_ticker');
    const evt = kTicker(series);
    const markets = series.endsWith('GAME')
      ? [mk(evt + '-' + g0.home_team.toUpperCase(), g0.home_team.toUpperCase(), 0.55, 0.57), mk(evt + '-' + g0.away_team.toUpperCase(), g0.away_team.toUpperCase(), 0.43, 0.45)]
      : [mk(evt + '-' + g0.home_team.toUpperCase() + '5', g0.home_team.toUpperCase() + ' wins by over 5.5 points', 0.3, 0.32, { floor_strike: 5.5 })];
    return JSON.stringify({ events: [{ event_ticker: evt, markets }] });
  };
  const logs = [];
  await ingestLeague({ adapter, store, fetchText, now: NOW2, log: (m) => logs.push(m), kalshi: true });
  const rec = JSON.parse(objects.get(sportsKey('win-by-record', { sport: 'nba', season: 2026 })) || 'null');
  ok(rec && Object.keys(rec.entries).length === 10, 'the next 48 hours of games are frozen: ' + (rec && Object.keys(rec.entries).length));
  ok(rec.entries[g0.game_id].kalshi?.winner && rec.entries[g0.game_id].kalshi.win_by[g0.home_team]['6+'] === 0.31, 'with Kalshi’s prices of the same run');
  const kgs = JSON.parse(objects.get(sportsKey('kalshi-games', { sport: 'nba' })) || 'null');
  ok(kgs && kgs.games[g0.game_id] && kgs.ok, 'the Kalshi read is stored for the pages');
  eq(asked.filter((u) => u.includes('kalshi')).length, 2, 'two Kalshi requests for the league');
  const st = JSON.parse(objects.get(sportsKey('status', { sport: 'nba' })));
  ok(st.win_by_record && st.win_by_record.pending === 10 && st.win_by_record.graded === 0, 'the status record carries the live record summary');
  ok(logs.some((l) => /win-by record: 10 forecasts frozen/.test(l)) && logs.some((l) => /Kalshi KXNBASPREAD: 1 open events, 1 matched/.test(l)), 'counts in the log');
  // Off by default (tests and offline runs never call Kalshi).
  asked.length = 0;
  await ingestLeague({ adapter, store, fetchText, now: NOW2 + 3600000, log: () => {} });
  ok(!asked.some((u) => u.includes('kalshi')), 'no Kalshi request unless asked');
  ok(JSON.parse(objects.get(sportsKey('win-by-record', { sport: 'nba', season: 2026 }))).entries[g0.game_id].kalshi?.winner == null, 'a later run without Kalshi refreezes without its prices');
}

// --- store keys and the MCP's read-only Sports store --------------------------------
{
  eq(sportsKey('win-by-record', { sport: 'nfl', season: 2026 }), '_stonks/sports/v1/nfl/win-by-record/2026.json', 'record key');
  eq(sportsKey('kalshi-games', { sport: 'nba' }), '_stonks/sports/v1/nba/kalshi-games.json', 'Kalshi key');
  assert.throws(() => sportsKey('win-by-record', { sport: 'nfl' }), /season/); checks++;
  const { sportsReadOnlyStore } = await import('../lib/mcp/read-only-store.mjs');
  const asked = [];
  const ro = sportsReadOnlyStore({ rawGet: async (k) => { asked.push(k); return Buffer.from('{}'); } });
  ok(await ro.rawGet('_stonks/sports/v1/nba/kalshi-games.json') && await ro.rawGet('_stonks/sports/v1/nfl/win-by-record/2026.json'), 'the MCP can read both');
  await assert.rejects(() => ro.rawGet('_stonks/sports/v1/markets/observations.json')); checks++;
}

console.log(`Sports win-by smoke passed (${checks} checks).`);
