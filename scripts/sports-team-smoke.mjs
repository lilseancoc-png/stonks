#!/usr/bin/env node
// Team vs team game model (lib/sports/team-model.mjs) and the Team bets view
// (lib/sports/team-bets.mjs): whole-number distributions, bet pricing for
// both sides, the books' no-vig chances, the walk-forward fit on a seeded
// league with known strengths (ratings recover the order, chances hold up on
// held-out games, the market blend is measured), team numbers against the
// spread, and the archive's moneyline chance. Offline and deterministic.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTeamModel, forecastGame, priceTeamBet, pmfChances, wholePmf, fairAmerican, restEdge, restDaysFor, bookChances, teamBetLadder, teamModelSummary, TEAM_MARKETS } from '../lib/sports/team-model.mjs';
import { teamBetsView, teamResultStats, findTeamGame, winByLadder } from '../lib/sports/team-bets.mjs';
import { archivedGameLine } from '../lib/sports/line-archive.mjs';
import { seededRandom, seededNormals } from '../lib/sports/normal.mjs';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

// --- whole-number distributions ------------------------------------------------
{
  const pmf = wholePmf(3.5, 13, null);
  near(pmf.p.reduce((a, b) => a + b, 0), 1, 1e-9, 'a distribution adds to 1');
  near(pmf.p.reduce((a, b, i) => a + (pmf.start + i) * b, 0), 3.5, 0.02, 'and keeps its center at the expected value');
  const w = { start: 0, w: [0.2, 1, 1, 3, 1, 1, 1, 2], symmetric: true };
  const keyed = wholePmf(3.5, 13, w);
  near(keyed.p.reduce((a, b, i) => a + (keyed.start + i) * b, 0), 3.5, 0.02, 'reweighted favorite numbers keep the center too');
  ok(keyed.p[3 - keyed.start] > pmf.p[3 - pmf.start] * 2, 'a margin of 3 is weighted up (NFL key number)');
  const c = pmfChances(keyed, 3);
  near(c.over + c.push + c.under, 1, 1e-9, 'over, push and under add to 1');
  ok(c.push > 0.05, 'a whole-number line can push');
  eq(pmfChances(keyed, 3.5).push, 0, 'a half-point line cannot');
  eq(fairAmerican(0.5), -100, 'even money');
  eq(fairAmerican(0.8), -400, 'a favorite');
  eq(fairAmerican(0.2), 400, 'an underdog');
  eq([restEdge('nba', 1, 2), restEdge('nba', 2, 1), restEdge('nba', 1, 1), restEdge('nfl', 14, 7), restEdge('nfl', 4, 7)], [-1, 1, 0, 1, -3 / 7], 'rest edge for the home side');
  eq([restEdge('nfl', 210, 175), restEdge('nba', 1, 190)], [0, 0], 'an offseason gap is not rest: no edge');
  eq(restDaysFor([{ game_id: 'a', home_team: 'x', away_team: 'y', start_utc: '2026-04-12T00:00:00Z', local_date: '2026-04-11', status: 'final' },
    { game_id: 'b', home_team: 'z', away_team: 'y', start_utc: '2026-10-20T00:00:00Z', local_date: '2026-10-19', status: 'final' }],
  { game_id: 'c', home_team: 'x', away_team: 'y', start_utc: '2026-10-22T00:00:00Z', local_date: '2026-10-21' }), { home: null, away: 2 }, 'a season opener shows no rest days; the other team’s 2 days stand');
}

// --- a seeded league with known strengths ---------------------------------------------
const TEAMS = ['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh', 'iii', 'jjj', 'kkk', 'lll'];
const TRUE = Object.fromEntries(TEAMS.map((t, i) => [t, { off: (i - 5.5) * 0.9, def: -(i - 5.5) * 0.5 }])); // later letters are better
function league({ seasons, perSeason, withLines, seed = 7 }) {
  const rnd = seededRandom(seed), z = seededNormals(seed + 1);
  const games = [];
  let day = Date.parse('2022-10-20T00:00:00Z');
  for (const season of seasons) {
    for (let n = 0; n < perSeason; n++) {
      const i = Math.floor(rnd() * TEAMS.length);
      let j = Math.floor(rnd() * (TEAMS.length - 1));
      if (j >= i) j++;
      const home = TEAMS[i], away = TEAMS[j];
      const mh = 112 + 1.5 + TRUE[home].off + TRUE[away].def, ma = 112 - 1.5 + TRUE[away].off + TRUE[home].def;
      const hs = Math.max(70, Math.round(mh + 11.5 * z())), as = Math.max(70, Math.round(ma + 11.5 * z()));
      const start = new Date(day + n * 3600000 * 9).toISOString();
      games.push({
        sport: 'nba', game_id: 'g' + season + '_' + n, season, start_utc: start, local_date: start.slice(0, 10), home_team: home, away_team: away,
        status: hs === as ? 'final' : 'final', home_score: hs, away_score: hs === as ? as + 1 : as, neutral: false,
        ...(withLines ? { lines: { total: Math.round((mh + ma + 2 * z()) * 2) / 2, home_margin: Math.round((mh - ma + 1.5 * z()) * 2) / 2, source: 'test' } } : {}),
      });
    }
    day += perSeason * 3600000 * 9 + 120 * 86400000;
  }
  return games;
}
const NOW = Date.parse('2026-11-12T00:00:00Z');
const plain = league({ seasons: [2022, 2023, 2024], perSeason: 700, withLines: false });
const M = buildTeamModel({ sport: 'nba', games: plain, now: NOW });
eq(M.status, 'ok', 'the model fits on three seasons');
{
  const order = Object.entries(M.ratings).sort((a, b) => a[1].net - b[1].net).map(([t]) => t);
  ok(order.indexOf('lll') > 8 && order.indexOf('aaa') < 3, 'ratings recover the strongest and weakest teams');
  near(M.params.home, 3, 1.2, 'home edge measured from the scores');
  ok(M.blend.tested === false && M.blend.margin === 0.2, 'no market lines: the blend stays at its untested prior');
  ok(M.sd.market.borrowed === true, 'and market games borrow the ratings’ wider miss');
  const S = teamModelSummary(M);
  for (const k of ['moneyline', 'win_by', 'total', 'team_total']) ok(S.markets[k].n > 0 && typeof S.markets[k].ece === 'number', k + ' is scored on held-out games');
  ok(S.markets.moneyline.status === 'validated', 'moneyline chances hold up on held-out games (known strengths)');
  ok(S.markets.win_by.status === 'validated', 'and win-by ladders');
  ok(S.markets.moneyline.baseline.baseline === 0.25 && S.markets.moneyline.brier < 0.25, 'and beat a coin flip');
  eq(S.markets.spread.status, 'no_data', 'no spread check without market lines');
  ok(S.markets.moneyline.ece_luck > 0 && S.markets.moneyline.slope > 0.7 && S.markets.moneyline.slope < 1.4, 'luck bound and calibration slope reported');
  ok(M.weights.margin.w[0] === 0, 'NBA: a margin of 0 never happens');
}
const lined = league({ seasons: [2022, 2023, 2024], perSeason: 700, withLines: true, seed: 11 });
const ML = buildTeamModel({ sport: 'nfl', games: lined.map((g) => ({ ...g, sport: 'nfl' })), now: NOW });
{
  ok(ML.blend.tested === true && ML.blend.games >= 200, 'with market lines the blend is measured');
  ok(ML.blend.margin < 0.5, 'and a good market keeps most of the weight');
  ok(!ML.sd.market.borrowed && ML.sd.market.margin <= ML.sd.model.margin + 0.3, 'market widths are measured and no wider than the ratings’');
  const S = teamModelSummary(ML);
  ok(S.markets.spread.n > 300 && S.markets.total.n > 300, 'spreads and totals scored at the market numbers');
  ok(S.markets.spread.baseline.name === 'market alone', 'against the market alone');
  near(S.markets.spread.reliability.reduce((a, b) => a + b.n * b.chance, 0) / S.markets.spread.n, 0.5, 0.06, 'cover chances at the market spread sit near 50%');
}

// --- one game's forecast and pricing ---------------------------------------------------
const up = { sport: 'nba', game_id: 'up1', season: 2024, start_utc: '2026-11-13T00:00:00Z', local_date: '2026-11-12', home_team: 'lll', away_team: 'aaa', status: 'scheduled', home_score: null, away_score: null };
const fc = forecastGame(M, up, { rest: { home: 2, away: 1 } });
{
  ok(fc && fc.mode === 'model' && fc.expected.home_margin > 8, 'the strong home team is a clear favorite');
  ok(fc.rest_edge === 1, 'the away team on a back-to-back');
  near(fc.win.home + fc.win.away + fc.win.tie, 1, 1e-3, 'win chances add up');
  eq(fc.win.tie, 0, 'no NBA ties');
  const home = priceTeamBet(fc, up, { market: 'moneyline', team: 'lll' }), away = priceTeamBet(fc, up, { market: 'moneyline', team: 'away' });
  near(home.chance + away.chance, 1, 1e-3, 'moneylines are two sides of one bet');
  const by20 = priceTeamBet(fc, up, { market: 'win_by', team: 'lll', line: 20, price: 450 });
  ok(by20.chance > 0.05 && by20.chance < home.chance, 'win by 20+ is less likely than winning');
  near(by20.breakeven, 100 / 550, 1e-4, 'breakeven from +450');
  near(by20.ev_per_dollar, by20.win * 4.5 - by20.lose, 1e-3, 'expected value per $1');
  const s1 = priceTeamBet(fc, up, { market: 'spread', team: 'lll', line: -9.5 }), s2 = priceTeamBet(fc, up, { market: 'spread', team: 'aaa', line: 9.5 });
  near(s1.chance + s2.chance, 1, 1e-3, 'the two sides of a spread add to 1');
  const w10 = priceTeamBet(fc, up, { market: 'win_by', team: 'lll', line: 10 });
  near(s1.chance, w10.chance, 1e-4, 'home −9.5 is the same bet as home to win by 10+');
  const o = priceTeamBet(fc, up, { market: 'total', side: 'over', line: 224.5 }), u = priceTeamBet(fc, up, { market: 'total', side: 'under', line: 224.5 });
  near(o.chance + u.chance, 1, 1e-3, 'over and under add to 1');
  const tt = priceTeamBet(fc, up, { market: 'team_total', team: 'aaa', side: 'over', line: 99.5 });
  ok(tt.chance > 0.5 && tt.label.startsWith('AAA team total over'), 'team total from that team’s points');
  ok(priceTeamBet(fc, up, { market: 'spread', team: 'zzz', line: 3 }).error, 'an unknown team is refused');
  ok(priceTeamBet(fc, up, { market: 'win_by', team: 'lll', line: 0 }).error, 'win by needs 1+ points');
  ok(priceTeamBet(fc, up, { market: 'total', line: 220 }).error, 'a total needs a side');
  ok(priceTeamBet(fc, up, { market: 'moneyline', team: 'lll', price: 50 }).error, 'a price must be American odds');
  ok(priceTeamBet(fc, up, { market: 'parlay' }).error, 'unknown markets are refused');
  eq(TEAM_MARKETS, ['moneyline', 'spread', 'win_by', 'total', 'team_total']);
  const L = teamBetLadder(fc, up, 'nba');
  ok(L.length > 15 && L.every((r) => r.chance >= 0 && r.chance <= 1 && r.label), 'a ladder of every market');
  const ladder = winByLadder(fc, up);
  const lv = Object.values(ladder.lll);
  ok(lv.length === 30 && Object.keys(ladder.lll)[19] === '20+' && lv.every((v, i) => i === 0 || v <= lv[i - 1]), 'win-by chances fall as the margin grows');
}

// --- the books' no-vig chances ------------------------------------------------------------
{
  const nflGame = { home_team: 'den', away_team: 'kc', lines: { total: 44.5, home_margin: 3.5, source: 'nflverse', prices: { home_ml: -180, away_ml: 150, home_spread: -110, away_spread: -110, over: -105, under: -115 } } };
  const b = bookChances(nflGame);
  ok(b.home_win > 0.6 && b.home_win < 0.64, 'NFL moneyline no-vig chance from the schedule prices');
  near(b.home_cover, 0.5, 1e-6, 'even spread prices: 50%');
  ok(b.over > 0.48 && b.over < 0.5, 'over at -105 / -115');
  eq(bookChances({ lines: { total: 220, home_margin: 2, book: { home_win: 0.58, home_cover: null, over: 0.51, books: 3 } } }), { home_win: 0.58, home_cover: null, over: 0.51, source: 'sportsbooks', books: 3 }, 'NBA: the props scan’s median');
  eq(bookChances({ lines: { total: 220, home_margin: 2 } }), null, 'no prices, no book chance');
  const g2 = { ...up, lines: { total: 221.5, home_margin: 6.5, source: 'sportsbooks', book: { home_win: 0.7, home_cover: 0.49, over: 0.52 } } };
  const f2 = forecastGame(M, g2, {});
  eq(f2.mode, 'market', 'with a market line the forecast starts from it');
  near(f2.expected.home_margin, 6.5 + 0.2 * (f2.ratings_only.margin - 6.5), 0.02, 'and moves toward the ratings by the blend share');
  const ml = priceTeamBet(f2, g2, { market: 'moneyline', team: 'lll' });
  eq(ml.book_chance, 0.7, 'the books’ moneyline chance beside the model’s');
  near(ml.gap, ml.chance - 0.7, 1e-4, 'and the gap');
  eq(priceTeamBet(f2, g2, { market: 'spread', team: 'away', line: 6.5 }).book_chance, 0.51, 'book cover chance at the market spread only');
  eq(priceTeamBet(f2, g2, { market: 'spread', team: 'away', line: 5.5 }).book_chance, undefined, 'not at an alternate spread');
  eq(priceTeamBet(f2, g2, { market: 'total', side: 'under', line: 221.5 }).book_chance, 0.48, 'book under chance at the market total');
  // The archive keeps the moneyline chance as a fourth field.
  eq(archivedGameLine({ games: { x1: [221.5, 6.5, '2026-11-12T20:00:00Z', 0.7] } }, 'x1'), { total: 221.5, home_margin: 6.5, observed_utc: '2026-11-12T20:00:00Z', source: 'sportsbooks', book: { home_win: 0.7 } }, 'archived game line with its moneyline chance');
  eq(archivedGameLine({ games: { x1: [221.5, 6.5, '2026-11-12T20:00:00Z'] } }, 'x1').book, undefined, 'older three-field rows still read');
}

// --- the page's bet checker prices exactly like the server -----------------------------------
// The Team bets checker re-prices any bet in the browser from the same
// whole-number distributions (tbPrice in scripts/render/sports-client.mjs).
// Its source is read here and run against priceTeamBet for every market,
// both teams, half and whole lines (pushes), prices and the books' chance.
{
  const src = readFileSync(new URL('./render/sports-client.mjs', import.meta.url), 'utf8');
  const fnText = (name) => {
    const i = src.indexOf('function ' + name + '(');
    ok(i >= 0, 'the page has ' + name);
    for (let k = src.indexOf('{', i), d = 0; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
    return '';
  };
  const { tbPrice, fairOdds } = new Function('const amText = (a) => (a == null || !Number.isFinite(a) ? \'—\' : a > 0 ? \'+\' + a : \'−\' + Math.abs(a));\n' +
    'const fairOdds = (p) => (p > 0 && p < 1 ? amText(p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p)) : \'—\');\n' +
    fnText('tbChances') + fnText('tbPrice') + '\nreturn { tbPrice, fairOdds };')();
  ok(/const fairOdds = \(p\) => \(p > 0 && p < 1 \? amText\(p >= 0\.5 \? -Math\.round\(\(100 \* p\) \/ \(1 - p\)\) : Math\.round\(\(100 \* \(1 - p\)\) \/ p\)\) : '—'\);/.test(src), 'the page’s fair odds rule is the one checked here');
  const g2 = { ...up, lines: { total: 221.5, home_margin: 6.5, source: 'sportsbooks', book: { home_win: 0.7, home_cover: 0.49, over: 0.52 } } };
  const f2 = forecastGame(M, g2, {});
  let n = 0, worst = 0;
  for (const [f, g] of [[fc, up], [f2, g2]]) {
    const bets = [{ market: 'moneyline' }];
    for (const line of [-12.5, -9, -6.5, -1, 0, 3, 6.5, 10]) bets.push({ market: 'spread', line });
    for (const line of [1, 4, 10, 19.5, 30]) bets.push({ market: 'win_by', line });
    for (const line of [200, 210.5, 221.5, 224, 240.5]) for (const side of ['over', 'under']) bets.push({ market: 'total', line, side });
    for (const line of [95, 99.5, 110, 118.5]) for (const side of ['over', 'under']) bets.push({ market: 'team_total', line, side });
    for (const b0 of bets) for (const team of b0.market === 'total' ? [null] : [g.home_team, g.away_team]) for (const price of ['', -110, 145, 450]) {
      const b = { ...b0, team, price }, srv = priceTeamBet(f, g, { ...b, price: price === '' ? null : price }), cli = tbPrice(f, g, b);
      assert.ok(!srv.error && !cli.error, 'both price ' + JSON.stringify(b));
      for (const [x, y] of [[srv.win, cli.win], [srv.push, cli.push], [srv.lose, cli.lose], [srv.chance, cli.chance]]) worst = Math.max(worst, Math.abs(x - y));
      if (price !== '') { worst = Math.max(worst, Math.abs(srv.breakeven - cli.breakeven), Math.abs(srv.ev_per_dollar - cli.ev)); }
      assert.ok((srv.book_chance == null) === (cli.book == null) && (srv.book_chance == null || Math.abs(srv.book_chance - cli.book) < 1e-4), 'the same books’ chance for ' + srv.label);
      // Fair odds: the same rule, so the page's odds imply the server's chance
      // (a hair apart only where a chance sits on a rounding boundary).
      const back = (t) => { const a = Number(String(t).replace('−', '-').replace('+', '')); return a < 0 ? -a / (100 - a) : 100 / (100 + a); };
      assert.ok(srv.fair_american == null ? fairOdds(cli.chance) === '—' : Math.abs(back(fairOdds(cli.chance)) - back(srv.fair_american)) < 2e-4, 'the same fair odds for ' + srv.label);
      n++;
    }
  }
  ok(n > 300 && worst < 1e-4, 'page and server agree on ' + n + ' bets (largest gap ' + worst + ')');
}

// --- team numbers and the view ----------------------------------------------------------
{
  const G = (id, day, home, away, hs, as, margin, total) => ({ game_id: id, season: 2026, start_utc: day + 'T00:00:00Z', local_date: day, home_team: home, away_team: away, status: 'final', home_score: hs, away_score: as, ...(margin != null ? { lines: { home_margin: margin, total } } : {}) });
  const finals = [G('a', '2026-10-01', 'bos', 'tor', 120, 100, 5, 220), G('b', '2026-10-03', 'tor', 'bos', 110, 108, -3, 210), G('c', '2026-10-05', 'bos', 'ny', 99, 101, 2, 205), G('d', '2026-10-07', 'mia', 'bos', 90, 115, null, null)];
  const s = teamResultStats('nba', 'bos', finals);
  eq([s.games, s.ats, s.over_under, s.close, s.big_wins, s.big_losses], [4, '1-2', '1-1-1', '0-2', 2, 0], 'record against the spread, over/under, close games, big wins');
  eq(s.last10, [25, -2, -2, 20], 'margins, newest first');
  eq(s.win_by, { 1: 2, 5: 2, 10: 2, 15: 2, 20: 2 }, 'wins by at least each margin');
  eq(s.as_favorite, '1-2', 'favored three times, won once');
  eq(teamResultStats('nba', 'zzz', finals), null, 'no games, no numbers');
  eq(restDaysFor(finals, { game_id: 'n', local_date: '2026-10-08', home_team: 'bos', away_team: 'tor' }), { home: 1, away: 5 }, 'rest days from the schedule');
  const view = teamBetsView({ sport: 'nba', game: up, model: M, allGames: plain.concat(up), table: [] });
  eq(view.status, 'ok', 'the view forecasts a scheduled game');
  ok(view.forecast && view.ladder.length && view.teams.lll.rating.net_rank === 1, 'with a ladder and rating ranks');
  eq(teamBetsView({ sport: 'nba', game: up, model: null }).status, 'not_fitted', 'no model yet');
  const played = teamBetsView({ sport: 'nba', game: plain[plain.length - 1], model: M, allGames: plain });
  ok(played.status === 'played' && played.final && !played.forecast, 'a played game shows its final, no forecast');
  const store = { games: { sport: 'nba', season: 2024, games: [up, { ...up, game_id: 'up2', start_utc: '2026-11-14T00:00:00Z' }] } };
  const load = async (kind) => store[kind] || null;
  eq((await findTeamGame({ load, sport: 'nba', seasons: [2024], team: 'AAA', opponent: 'lll', nowMs: NOW }))?.game_id, 'up1', 'the next meeting by team codes');
  eq(await findTeamGame({ load, sport: 'nba', seasons: [2024], team: 'aaa', opponent: 'bbb', nowMs: NOW }), null, 'none when they do not meet');
}

console.log(`Sports team model smoke passed (${checks} checks).`);
