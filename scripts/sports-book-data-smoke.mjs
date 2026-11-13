// Sports book-price data fixes (2026-11-13): more NBA books, NFL book prices,
// the anchored price for a line no book posts, the real-line coin-flip
// warning, the NBA team blend held at the market until tested, and the
// NBA.com request headers. Made-up quotes only; no credentials or network.
import assert from 'node:assert/strict';
import { normalizeQuotes, normalizeNBAQuotes, nbaMarketForProp, NBA_BOOKS, NFL_BOOKS } from '../lib/sports/nba-market.mjs';
import { bookPriceForLine, bookVsModel, anchoredPrice } from '../lib/sports/book-price.mjs';
import { loadPropSources } from '../lib/sports/prop-sources.mjs';
import { realLinesCheck, REAL_WARN_MIN, forecastStat } from '../lib/sports/models.mjs';
import { headersFor } from './sports-ingest.mjs';

const now = Date.parse('2026-11-15T15:00Z');
const at = new Date(now - 30000).toISOString();
const start = '2026-11-15T18:00Z';
const pair = (description, point, over, under) => ['Over', 'Under'].map((name) => ({ name, description, point, price: name === 'Over' ? over : under, last_seen_at: at }));
const ev = (sport_key, home_team, away_team, books) => ({ id: 'e1', sport_key, home_team, away_team, commence_time: start,
  bookmakers: books.map(([key, markets]) => ({ key, markets: markets.map(([mk, outs]) => ({ key: mk, line_type: 'main', last_update: at, outcomes: outs })) })) });

// --- NBA: the added books count -------------------------------------------------------------
{
  for (const b of ['bovada', 'unibet', 'novig', 'prophetx']) assert.ok(NBA_BOOKS.includes(b), b + ' is an NBA reference book');
  const nba = ev('basketball_nba', 'Los Angeles Lakers', 'Golden State Warriors', [
    ['bovada', [['player_points', pair('Fixture One', 25.5, -115, -105)]]],
    ['novig', [['player_points', pair('Fixture One', 25.5, -102, 102)]]],
    ['draftkings', [['player_points', pair('Fixture One', 25.5, -120, 100)]]],
  ]);
  const q = normalizeNBAQuotes([nba], now);
  assert.deepEqual(q.map((x) => x.book).sort(), ['bovada', 'draftkings', 'novig'], 'Bovada and the no-margin Novig exchange are read');
  const m = nbaMarketForProp({ event_id: 'e1', home_team: 'Los Angeles Lakers', away_team: 'Golden State Warriors', start_utc: start, observed_utc: at,
    player_name: 'Fixture One', stat: 'points', side: 'over', threshold: 25.5 }, q, now);
  assert.equal(m.state, 'supported', 'three books with the new ones: supported');
  assert.equal(m.method, 'exact');
}

// --- NFL: book prices -----------------------------------------------------------------------
const nflEvent = ev('football_nfl', 'Kansas City Chiefs', 'Denver Broncos', [
  ['bovada', [['player_reception_yds', pair('Fixture Wideout', 64.5, -115, -105)]]],
  ['hardrock', [['player_reception_yds', pair('Fixture Wideout', 64.5, -110, -110)], ['player_reception_yds', pair('Fixture Wideout', 69.5, 120, -150)]]],
  ['kalshi', [['player_reception_yds', pair('Fixture Wideout', 64.5, -105, -105)]]],
  ['prizepicks', [['player_reception_yds', pair('Fixture Wideout', 64.5, -110, -110)]]],
]);
{
  assert.ok(NFL_BOOKS.includes('hardrock') && NFL_BOOKS.includes('bovada'));
  const q = normalizeQuotes([nflEvent], now, 'nfl');
  assert.deepEqual([...new Set(q.map((x) => x.book))].sort(), ['bovada', 'hardrock', 'kalshi'], 'NFL books read; PrizePicks never a reference');
  assert.equal(normalizeQuotes([nflEvent], now, 'nba').length, 0, 'an NFL event is not read as NBA');
  assert.ok(q.every((x) => x.stat === 'receiving_yards'));
  const game = { start_utc: start, home_team: 'kc', away_team: 'den' };
  const reference = { state: 'ok', quotes: q };
  const leg = { sport: 'nfl', player_name: 'Fixture Wideout', stat: 'receiving_yards', side: 'over', threshold: 64.5 };
  const b = bookPriceForLine(leg, game, reference, now);
  assert.equal(b.state, 'supported', 'three NFL books at the exact line');
  assert.ok(b.chance > 0.49 && b.chance < 0.52);
  assert.deepEqual(b.lines.map((l) => l.threshold), [64.5, 69.5]);
  // A slip line past every book line: unavailable without the model, anchored with it.
  const far = { ...leg, threshold: 72.5 };
  assert.equal(bookPriceForLine(far, game, reference, now).state, 'unavailable');
  const overAt = (t) => Math.max(0, Math.min(1, 0.5 - (t - 64.5) * 0.02));
  const a = bookPriceForLine(far, game, reference, now, { overAt });
  assert.equal(a.state, 'anchored');
  assert.equal(a.method, 'book_anchored');
  assert.equal(a.anchor.threshold, 69.5, 'moved from the nearest book line');
  assert.ok(Math.abs(a.chance - (a.anchor.book_over - 0.06)) < 1e-4, 'book price at 69.5 plus the model step to 72.5');
  const vs = bookVsModel(a, overAt(72.5));
  assert.ok(vs && Math.abs(vs.gap - (overAt(69.5) - a.anchor.book_over)) < 1e-3, 'the gap equals the gap at the nearest book line');
  assert.equal(bookPriceForLine({ ...leg, threshold: 120.5 }, game, reference, now, { overAt }).state, 'unavailable', 'too far from any book line: no anchor');
  // Whole-number slip lines: More 72 is Over 72.5; Less 72 is Under 71.5.
  const more = anchoredPrice({ side: 'over', threshold: 72 }, b.lines, overAt), less = anchoredPrice({ side: 'under', threshold: 72 }, b.lines, overAt);
  assert.ok(Math.abs(more.chance - a.chance) < 1e-4);
  assert.ok(Math.abs(less.chance - (1 - (b.lines[1].over + overAt(71.5) - overAt(69.5)))) < 1e-4);
}
// The NFL reference read is one request, only when asked for.
{
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('espn')) return new Response(JSON.stringify({ status: 'success', timestamp: at, injuries: [] }), { status: 200 });
    return new Response(JSON.stringify([nflEvent]), { status: 200 });
  };
  const env = { PROPLINE_API_KEY: 'fixture-secret' };
  const board = await loadPropSources({ sport: 'nfl', now, env, fetchImpl });
  assert.equal(board.reference, undefined, 'the NFL board read spends no book request');
  assert.equal(calls.filter((u) => u.includes('prop-line')).length, 1);
  calls.length = 0;
  const mcp = await loadPropSources({ sport: 'nfl', now, env, fetchImpl, parts: ['injuries', 'reference'] });
  const refCalls = calls.filter((u) => u.includes('prop-line'));
  assert.equal(refCalls.length, 1, 'one NFL book request');
  assert.ok(refCalls[0].includes('/football_nfl/') && new URL(refCalls[0]).searchParams.get('bookmakers').includes('hardrock'));
  assert.equal(mcp.reference.state, 'ok');
  assert.equal(mcp.reference.quotes.length, 4);
  assert.equal(mcp.reference.raw_events, undefined, 'no raw NFL copy is kept');
  assert.equal(mcp.reference.game_lines_state, 'skipped');
}

// --- Real lines: the coin-flip warning ------------------------------------------------------
{
  const evOf = (n, model, even) => ({ real_lines: { n, ece: 0.12, brier: { model, last10_hit_rate: 0.255, even } } });
  assert.equal(realLinesCheck(evOf(REAL_WARN_MIN - 1, 0.27, 0.25)), null, 'too few lines: no warning');
  assert.equal(realLinesCheck(evOf(120, 0.24, 0.25)), null, 'beating a coin flip: no warning');
  const w = realLinesCheck(evOf(120, 0.269, 0.25));
  assert.deepEqual(w, { trailing: true, n: 120, model_brier: 0.269, coin_flip_brier: 0.25, last10_brier: 0.255, ece: 0.12, final: false, final_at: 300 });
  assert.equal(realLinesCheck(evOf(320, 0.26, 0.25)).final, true);
  assert.equal(forecastStat({ sport: 'nba', stat: 'points', history: [], model: null }).status, 'not_calculated');
}

// --- NBA.com headers ------------------------------------------------------------------------
{
  const h = headersFor('https://cdn.nba.com/static/json/liveData/boxscore/boxscore_0022500001.json');
  assert.equal(h.Referer, 'https://www.nba.com/');
  assert.ok(/Mozilla/.test(h['User-Agent']));
  assert.equal(headersFor('https://github.com/sportsdataverse/hoopR-nba-data/x.csv')['User-Agent'], 'stonks-sports-research (private, non-commercial)');
}
console.log('sports-book-data-smoke: ok');
