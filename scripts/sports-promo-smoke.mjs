// Pick'em promos, promo lines, the parlay check and the PrizePicks mirror
// seed (2026-11-20). Offline: the promo PDF's worked examples, synthetic
// clearance and zero tables, the fixture league, a fake mirror snapshot.
//   node scripts/sports-promo-smoke.mjs
import assert from 'node:assert/strict';
import { cleanPromo, promoReturn, promoValue, promoLineProblem, clearanceTable, zeroTable, promoChance, normalLineRate, BUCKET_MIN } from '../lib/sports/promo.mjs';
import { parlayCheck, chanceTrust } from '../lib/sports/parlay-check.mjs';
import { evaluateEntry, saveEntry, journalView, promoKindOf, withBookCheck } from '../lib/sports/journal.mjs';
import { ingestLeague } from '../lib/sports/ingest.mjs';
import { NBA_SOURCE, HOOPR_URLS } from '../lib/sports/hoopr.mjs';
import { recordLoader } from '../lib/sports/http.mjs';
import { SPORTS_PREFIX } from '../lib/sports/store.mjs';
import { encodePrefill, decodePrefill } from '../lib/sports/prefill.mjs';
import { mirrorLinesFrom, loadMirrorLines, mirrorSeedPath, MIRROR_FIELDS } from '../lib/sports/mirror-seed.mjs';
import { seedFromSnapshots, teamOf } from './sports-mirror-seed.mjs';
import { SCHEDULE_2026, SCHEDULE_2027, BOX_2026, BOX_2027 } from './fixtures/sports-nba.mjs';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, tol = 1e-4) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`); checks++; };

// --- entry promos: the PDF's worked examples -------------------------------
{
  const boost = cleanPromo({ type: 'profit_boost', boost_pct: 50 }).promo;
  eq(boost, { type: 'profit_boost', boost_pct: 50 }, 'a 50% profit boost');
  // 3-pick Power at 6x, every pick 50%: 12.5% to hit, -25% without, +6.25% with.
  const rows = [[0.125, 6], [0.875, 0]];
  const v = promoValue({ promo: boost, rows, stake: 10 });
  near(v.expected_roi_without, -0.25, 'PDF: 3-pick power at 50% each, no boost');
  near(v.expected_roi_with, 0.0625, 'PDF: +6.25% with a 50% boost');
  near(v.breakeven_boost_pct, 40, 'boost that breaks even: 0.25 / (0.125 x 5) = 40%', 0.05);
  near(promoReturn(boost, 6, 10), 8.5, 'boosted 6x pays 8.5x');
  eq(promoReturn(boost, 0, 10), 0, 'a loss is not boosted');
  eq(promoReturn(boost, 1, 10), 1, 'a break-even result is not boosted');
  near(promoReturn({ ...boost, max_boost: 20 }, 6, 10), 8, 'a $20 cap on $10: at most +2x extra');
  // 4-pick Flex {4: 6, 3: 1.5} at 50% each, protected at 40%: +2.5%.
  const flexRows = [[1 / 16, 6], [4 / 16, 1.5], [11 / 16, 0]];
  const prot = cleanPromo({ type: 'protected', conversion: 0.4 }).promo;
  const pv = promoValue({ promo: prot, rows: flexRows, stake: 10 });
  near(pv.expected_roi_without, -0.25, 'PDF flex: -25% without');
  near(pv.expected_roi_with, 0.025, 'PDF flex: +2.5% protected at 40%');
  near(pv.breakeven_conversion, 0.3636, 'PDF: break-even conversion 36.4%');
  near(pv.expected_net_loss_share, 0.6875, 'PDF: 68.75% of the stake is a net loss on average');
  eq(cleanPromo({ type: 'protected' }).promo, { type: 'protected', conversion: 0.4, conversion_assumed: true }, 'an unknown conversion is 0.4 and says so');
  near(promoReturn({ type: 'protected', conversion: 0.5, max_bonus: 2 }, 0, 10), 0.1, 'a $2 bonus cap on a $10 loss: 0.5 x 0.2');
  eq(cleanPromo(null), { promo: null, problems: [] }, 'no promo');
  eq(cleanPromo({ type: 'none' }).promo, null, 'promo none');
  ok(cleanPromo({ type: 'profit_boost', boost_pct: 0 }).problems.length === 1, 'a 0% boost is refused');
  ok(cleanPromo({ type: 'protected', conversion: 1.5 }).problems.length === 1, 'a conversion above 1 is refused');
  ok(cleanPromo({ type: 'free_money' }).problems.length === 1, 'an unknown promo type is refused');
}

// --- promo lines -------------------------------------------------------------
eq(promoLineProblem('guarantee', 'over', 0.5, 24.5), null, 'a guarantee is over 0.5');
ok(/More/.test(promoLineProblem('guarantee', 'under', 0.5)), 'a guarantee under is refused');
ok(/0\.5/.test(promoLineProblem('guarantee', 'over', 1.5)), 'a guarantee is the 0.5 line');
eq(promoLineProblem('discount', 'over', 14.5, 22.5), null, 'a discount below the normal line');
ok(/normal line/.test(promoLineProblem('discount', 'over', 14.5, null)), 'a discount needs the normal line');
ok(/normal line/.test(promoLineProblem('discount', 'over', 22.5, 14.5)), 'the normal line must be above it');
eq(promoLineProblem(undefined, 'under', 3.5), null, 'a normal pick has no promo check');

// Clearance table: 1,000 lines at 10.5 to 30.5, value = line + noise.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pairs = Array.from({ length: 1000 }, (_, i) => { const line = 10.5 + (i % 21); return [line, Math.max(0, Math.round(line + (rnd() - 0.5) * 2 * line * 0.6))]; });
const clear = clearanceTable(pairs);
eq(clear.n, 1000, 'every line counted');
eq(clear.buckets.reduce((a, b) => a + b.n, 0), 1000, 'every line is in one bucket');
ok(clear.buckets.every((b) => b.n >= BUCKET_MIN), 'every bucket has enough lines');
ok(clear.buckets.every((b, i) => i === 0 || b.lo > clear.buckets[i - 1].hi), 'one line value in one bucket');
ok(clear.all.cleared.every((x, i) => i === 0 || x <= clear.all.cleared[i - 1]), 'cleared falls as the line rises');
eq(clearanceTable(pairs.slice(0, 50)), null, 'under 100 lines: no table');
{
  // A small tail bucket joins the one before it, so no line is left out.
  const tail = [...Array.from({ length: 260 }, (_, i) => [5.5 + (i % 3), 6]), ...Array.from({ length: 190 }, () => [30.5, 31])];
  const t = clearanceTable(tail);
  eq(t.buckets.map((b) => b.n), [450], 'a 190-line tail joins the bucket before it');
}
const zeroRecs = Array.from({ length: 2000 }, (_, i) => { const mu = 2 + (i % 200) / 10; return [mu, rnd() < 0.3 / mu ? 0 : Math.round(mu), Math.exp(-mu)]; });
const zero = zeroTable(zeroRecs);
eq(zero.bins.length, 10, 'ten zero bins');
ok(zero.bins[0].zero > zero.bins[9].zero, 'low forecasts score none more often');
eq(zeroTable(zeroRecs.slice(0, 50)), null, 'too few records: no zero table');
const tables = { points: { clearance: clear, zero } };
{
  const g = promoChance({ tables, stat: 'points', offer: 'guarantee', threshold: 0.5, normalLine: 20.5, forecastMean: zero.bins[3].mean });
  near(g.chance, 1 - zero.bins[3].zero, 'guarantee at a bin mean: one minus its zero rate');
  ok(g.range.low <= g.chance && g.range.high >= g.chance, 'the range holds the rate');
  near(g.at_normal_line, normalLineRate({ tables, stat: 'points', normalLine: 20.5 }).chance, 'and the normal line’s own rate');
  const lo = promoChance({ tables, stat: 'points', offer: 'guarantee', threshold: 0.5, forecastMean: 0.1 });
  near(lo.zero_rate, zero.bins[0].zero, 'below the bins: the first bin');
  eq(promoChance({ tables, stat: 'points', offer: 'guarantee', threshold: 0.5, forecastMean: null }).chance, null, 'no forecast and no normal line: no guarantee chance');
  near(promoChance({ tables, stat: 'points', offer: 'guarantee', threshold: 0.5, normalLine: zero.bins[5].mean }).zero_rate, zero.bins[5].zero, 'no forecast: the normal line stands in');
  eq(promoChance({ tables: {}, stat: 'points', offer: 'guarantee', threshold: 0.5, forecastMean: 10 }).chance, null, 'no table: no chance');
  const d = promoChance({ tables, stat: 'points', offer: 'discount', threshold: 14.5, normalLine: 20.5 });
  ok(d.chance > d.at_normal_line, 'a discounted line clears more often than the normal one');
  near(d.discount_pct, 29.3, 'about 29% lower', 0.05);
  ok(d.n >= BUCKET_MIN, 'read from a full bucket');
  eq(promoChance({ tables, stat: 'points', offer: 'discount', threshold: 22.5, normalLine: 20.5 }).chance, null, 'a discount above the normal line is not priced');
  eq(promoChance({ tables, stat: 'rebounds', offer: 'discount', threshold: 4.5, normalLine: 6.5 }).chance, null, 'a stat with no table is not priced');
}

// --- the parlay check ----------------------------------------------------------
eq(chanceTrust({ probability: 0.5, probability_source: 'book' }).level, 'market');
eq(chanceTrust({ probability: 0.5, probability_source: 'measured' }).level, 'measured');
eq(chanceTrust({ probability: 0.5, probability_source: 'model', model: { quality: 'validated', real_lines_check: { trailing: true, n: 400 } } }).level, 'model_untested', 'a model stat that trails a coin flip at real lines is untested');
eq(chanceTrust({ probability: 0.5, probability_source: 'model', model: { quality: 'validated' } }).level, 'model');
eq(chanceTrust({ probability: null }).level, 'none');
{
  // PDF: a 2-pick power at 3x with a 55% partner: the discounted pick needs 60.61%.
  const legs = [{ player_name: 'A', side: 'over', threshold: 14.5, stat: 'points', offer_type: 'discount', normal_line: 20.5, probability: 0.7, probability_source: 'measured', push: 0 },
    { player_name: 'B', side: 'over', threshold: 5.5, stat: 'assists', probability: 0.55, probability_source: 'book', push: 0 }];
  const evaluation = { joint_probability: 0.385, breakeven_probability: 1 / 3, expected_roi: 0.155, ev_check: { verdict: 'positive_ev' } };
  const pc = parlayCheck({ evaluation, legs, format: 'power', payouts: { 2: 3 }, stake: 10 });
  near(pc.picks[0].needs, 0.6061, 'PDF: the discounted pick needs 60.61%');
  near(pc.picks[0].gap_pts, 9.4, 'and clears it by 9.4 points', 0.05);
  eq([pc.verdict, pc.trust], ['plus_ev', 'market'], 'positive on a measured and a market chance: plus_ev');
  ok(/Both hit 38\.5% against 33\.3% needed/.test(pc.summary), 'the summary says the chance both hit');
  eq(pc.picks[0].offer, 'discount', 'the promo line is labeled');
  // The same entry with a model chance on a trailing stat: unproven.
  const untested = parlayCheck({ evaluation, legs: [{ ...legs[0], probability_source: 'model', model: { status: 'ok', probability: 0.7, quality: 'validated', real_lines_check: { trailing: true, n: 500 } } }, legs[1]], format: 'power', payouts: { 2: 3 }, stake: 10 });
  eq([untested.verdict, untested.untested_model_picks], ['plus_ev_untested', [1]], 'a trailing model chance makes it unproven');
  // The books' prices lose: books disagree.
  const disagree = parlayCheck({ evaluation, legs: [{ ...legs[0], probability_source: 'owner' }, legs[1]], format: 'power', payouts: { 2: 3 }, stake: 10, alt: { book: { expected_roi: -0.12, joint_probability: 0.29 } } });
  eq(disagree.verdict, 'plus_ev_books_disagree', 'positive on the owner’s chance but negative at the books');
  eq(disagree.at_book_chances, { expected_roi: -0.12, chance_all_hit: 0.29 });
  // Negative stays negative.
  eq(parlayCheck({ evaluation: { ...evaluation, expected_roi: -0.1 }, legs, format: 'power', payouts: { 2: 3 }, stake: 10 }).verdict, 'negative_ev');
  // Parlay odds: each pick needs one over its decimal odds.
  near(parlayCheck({ evaluation, legs, format: 'parlay', payouts: {}, prices: [1.8, 2.5], stake: 10 }).picks[1].needs, 0.4, 'a 2.5 parlay leg needs 40%');
  // A flex: each pick's needed chance pays back exactly with the others fixed.
  const flexLegs = [0.5, 0.5, 0.5, 0.5].map((p, i) => ({ player_name: 'P' + i, side: 'over', threshold: 1.5, stat: 'points', probability: p, probability_source: 'book', push: 0 }));
  const fx = parlayCheck({ evaluation: { expected_roi: -0.25 }, legs: flexLegs, format: 'flex', payouts: { 4: 6, 3: 1.5 }, stake: 10 });
  const q = fx.picks[0].needs; // others at 50%: P(3 others hit) = 1/8, P(2) = 3/8
  near((q * 6 + (1 - q) * 1.5) / 8 + (q * 1.5) * 3 / 8, 1, 'flex needed chance breaks even', 1e-3);
  // With the protected promo the same flex needs less.
  const fxp = parlayCheck({ evaluation: { expected_roi: -0.25, promo: { expected_roi_with: 0.025 } }, legs: flexLegs, format: 'flex', payouts: { 4: 6, 3: 1.5 }, stake: 10, promo: { type: 'protected', conversion: 0.4 } });
  ok(fxp.picks[0].needs < q, 'the promo lowers what each pick needs');
  eq(fxp.verdict, 'plus_ev', 'positive with the promo at market chances');
}

// --- end to end on the fixture league ------------------------------------------
function fakeR2() {
  const objects = new Map(), held = new Set();
  return {
    objects, backend: 'r2',
    rawGet: async (k) => (objects.has(k) ? Buffer.from(objects.get(k)) : null),
    rawPut: async (k, v) => { objects.set(k, String(v)); },
    async withLease(name, fn) { if (held.has(name)) return { busy: true }; held.add(name); try { return { busy: false, result: await fn(() => {}) }; } finally { held.delete(name); } },
  };
}
const files = new Map([[HOOPR_URLS.schedule(2025), SCHEDULE_2026], [HOOPR_URLS.schedule(2026), SCHEDULE_2027], [HOOPR_URLS.box(2025), BOX_2026], [HOOPR_URLS.box(2026), BOX_2027]]);
const NOW = Date.parse('2026-11-02T18:00:00Z');
const st = fakeR2();
await ingestLeague({ adapter: NBA_SOURCE, store: st, fetchText: async (u) => files.get(u) ?? null, now: NOW });
const modelKey = SPORTS_PREFIX + 'nba/model.json';
const stored = JSON.parse(st.objects.get(modelKey));
ok(stored.promo_tables && stored.promo_tables.version === 1, 'the refit writes promo tables');
st.objects.set(modelKey, JSON.stringify({ ...stored, promo_tables: { ...stored.promo_tables, points: { clearance: clear, zero } } }));
const load = () => recordLoader(st);
const curry = (extra = {}) => ({ sport: 'nba', player_id: '3975', game_id: '401900003', stat: 'points', side: 'over', threshold: 24.5, ...extra });
const lebron = (extra = {}) => ({ sport: 'nba', player_id: '1966', game_id: '401900004', stat: 'points', side: 'over', threshold: 25.5, ...extra });
{
  const base = { operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 } };
  const plain = await evaluateEntry({ load: load(), body: { ...base, legs: [curry({ probability: 0.5 }), lebron({ probability: 0.5 })] }, now: NOW });
  near(plain.evaluation.expected_roi, -0.25, 'two 50% picks at 3x: -25%');
  eq(plain.evaluation.promo, undefined, 'no promo, no promo block');
  const boosted = await evaluateEntry({ load: load(), body: { ...base, promo: { type: 'profit_boost', boost_pct: 100 }, legs: [curry({ probability: 0.5 }), lebron({ probability: 0.5 })] }, now: NOW });
  near(boosted.evaluation.promo.expected_roi_with, 0.25, 'a 100% boost: 0.25 x 5 = +25%');
  eq(boosted.promo, { type: 'profit_boost', boost_pct: 100 }, 'the promo is on the entry');
  eq(boosted.evaluation.parlay_check.verdict, 'plus_ev_unconfirmed', 'positive with the boost, but on the owner’s chances');
  near(boosted.evaluation.parlay_check.expected_roi_with_promo, 0.25, 'the parlay check reads the boosted return');
  // A guarantee line priced from the measured zero table.
  const g = await evaluateEntry({ load: load(), body: { ...base, legs: [curry({ threshold: 0.5, offer_type: 'guarantee', normal_line: 24.5 }), lebron({ probability: 0.5 })] }, now: NOW });
  const leg = g.legs[0];
  ok(typeof leg.promo_line?.chance === 'number', 'the guarantee pick gets a measured chance');
  near(leg.promo_line.chance, promoChance({ tables, stat: 'points', offer: 'guarantee', threshold: 0.5, normalLine: 24.5, forecastMean: leg.model?.status === 'ok' ? leg.model.mean : null }).chance, 'from the zero table at the forecast (or the normal line)');
  eq(g.evaluation.status, 'needs_probabilities', 'a measured rate is shown, not filled in on its own');
  const gm = await evaluateEntry({ load: load(), body: { ...base, legs: [curry({ threshold: 0.5, offer_type: 'guarantee', normal_line: 24.5, probability: leg.promo_line.chance, probability_source: 'measured' }), lebron({ probability: 0.5 })] }, now: NOW });
  eq(gm.legs[0].probability_source, 'measured', 'the measured rate keeps its label');
  near(gm.evaluation.expected_roi, Math.round((leg.promo_line.chance * 0.5 * 3 - 1) * 10000) / 10000, 'priced at the measured rate', 2e-4);
  ok(gm.evaluation.at_normal_lines && gm.evaluation.at_normal_lines.picks[0].line === 24.5, 'and at the normal line for comparison');
  eq(gm.evaluation.parlay_check.picks[0].trust, 'measured', 'a measured promo chance is trusted as an outcome rate');
  // A measured label on a chance that is not the measured rate falls back to the owner's.
  const wrong = await evaluateEntry({ load: load(), body: { ...base, legs: [curry({ threshold: 0.5, offer_type: 'guarantee', normal_line: 24.5, probability: 0.42, probability_source: 'measured' }), lebron({ probability: 0.5 })] }, now: NOW });
  eq(wrong.legs[0].probability_source, 'owner', 'a made-up measured chance is the owner’s');
  // Book chances reprice the entry for the check.
  const withBooks = await withBookCheck({ load: load(), ev: boosted, book: [0.4, 0.4] });
  near(withBooks.evaluation.parlay_check.at_book_chances.expected_roi, -0.52, 'at the books: 0.16 x 3 - 1');
  near(withBooks.evaluation.parlay_check.at_book_chances.expected_roi_with_promo, -0.2, 'with the boost: 0.16 x 5 - 1');
  eq(withBooks.evaluation.parlay_check.verdict, 'plus_ev_books_disagree', 'books say it loses');
  // Bad promo inputs are refused.
  await assert.rejects(evaluateEntry({ load: load(), body: { ...base, legs: [curry({ threshold: 0.5, offer_type: 'guarantee', side: 'under' })] }, now: NOW }), (e) => e.status === 400 && /More/.test(e.message)); checks++;
  await assert.rejects(evaluateEntry({ load: load(), body: { ...base, legs: [curry({ threshold: 14.5, offer_type: 'discount' })] }, now: NOW }), (e) => e.status === 400 && /normal line/.test(e.message)); checks++;
  const bad = await evaluateEntry({ load: load(), body: { ...base, promo: { type: 'profit_boost', boost_pct: 900 }, legs: [curry({ probability: 0.5 })] }, now: NOW });
  ok(bad.evaluation.status === 'needs_payout' && bad.evaluation.problems.some((p) => /boost/.test(p)), 'a 900% boost is a problem, not a price');
  // Saved entries carry the promo; the journal reads promo entries apart.
  const save = async (body) => saveEntry({ store: st, load: load(), body, now: NOW, sub: 'owner-1' });
  await save({ ...base, legs: [curry({ probability: 0.5 }), lebron({ probability: 0.5 })] });
  const saved = await save({ ...base, promo: { type: 'protected', conversion: 0.5 }, legs: [curry({ probability: 0.5 }), lebron({ probability: 0.5 })] });
  eq([saved.promo.type, saved.promo_kind], ['protected', 'protected'], 'the saved entry keeps its promo');
  eq(Object.keys(saved.evaluation.parlay_check), ['verdict', 'trust'], 'the saved evaluation keeps only the check’s verdict');
  eq(promoKindOf({ legs: [{ offer_type: 'discount' }] }), 'discount', 'a promo line names the entry’s kind');
  eq(promoKindOf({ legs: [{ offer_type: 'goblin' }] }), 'normal', 'a goblin is a normal entry');
  const view = await journalView({ load: load(), now: NOW, sub: 'owner-1' });
  eq([view.by_promo.normal.entries, view.by_promo.promo.entries, view.by_promo.kinds.protected.entries], [1, 1, 1], 'one normal and one protected entry, read apart');
}

// --- prefill links carry promos, never chances -----------------------------------
{
  const link = encodePrefill({ operator: 'prizepicks', format: 'power', stake: 10, payouts: { 2: 3 }, promo: { type: 'protected', conversion: 0.4, conversion_assumed: true },
    legs: [curry({ threshold: 0.5, offer_type: 'guarantee', normal_line: 24.5, probability: 0.99 }), { ...curry({ threshold: 14.5, offer_type: 'discount', normal_line: 20.5 }), sport: 'nfl' }] });
  const back = decodePrefill(link);
  eq(back.promo, { type: 'protected' }, 'an assumed conversion is not carried');
  eq([back.legs[0].offer_type, back.legs[0].normal_line, back.legs[0].probability], ['guarantee', 24.5, undefined], 'a guarantee line and its normal line, no chance');
  eq([back.legs[1].offer_type, back.legs[1].normal_line], ['discount', 20.5], 'NFL promo lines too');
  eq(decodePrefill(encodePrefill({ legs: [curry({ offer_type: 'discount', side: 'under', normal_line: 30.5 })] })), null, 'a promo line under is refused');
  const raw = (body) => Buffer.from(JSON.stringify({ v: 1, ...body })).toString('base64url');
  eq(decodePrefill(raw({ legs: [{ ...curry({ offer_type: 'goblin' }), sport: 'nfl' }] })), null, 'an NFL goblin is refused');
  eq(encodePrefill({ legs: [{ ...curry({ offer_type: 'goblin' }), sport: 'nfl' }] }), encodePrefill({ legs: [{ ...curry(), sport: 'nfl' }] }), 'and never written');
  eq(decodePrefill(raw({ legs: [curry({ offer_type: 'discount', normal_line: 10.5 })] })).legs[0].normal_line, undefined, 'a normal line below the pick is dropped');
  eq(decodePrefill(encodePrefill({ legs: [curry()], promo: { type: 'profit_boost', boost_pct: 30, max_boost: 25 } })).promo, { type: 'profit_boost', boost_pct: 30, max_boost: 25 });
}

// --- the PrizePicks mirror seed ------------------------------------------------------
{
  eq(MIRROR_FIELDS, ['date', 'game_id', 'player_id', 'stat', 'line']);
  ok(mirrorSeedPath('nba').endsWith('research/sports/prizepicks-mirror/nba.json.gz'), 'seed path');
  const doc = { schema_version: 1, sport: 'nba', rows: [['2026-01-02', 'g1', 'p1', 'points', 20.5], ['2026-01-02', 'g1', 'p2', 'points', 20.25], ['2026-01-02', 'g2', 'p1', 'points', -1], ['bad'], ['2026-01-03', 'g3', 'p3', 'rebounds', 7]] };
  eq(mirrorLinesFrom(doc, { sport: 'nba' }), [{ game_id: 'g1', player_id: 'p1', stat: 'points', threshold: 20.5, source: 'mirror' }, { game_id: 'g3', player_id: 'p3', stat: 'rebounds', threshold: 7, source: 'mirror' }], 'only whole and half lines');
  eq(mirrorLinesFrom(doc, { sport: 'nfl' }), [], 'another sport’s seed is not read');
  eq(mirrorLinesFrom(doc, { sport: 'nba', gameIds: ['g3'] }).length, 1, 'filtered to games');
  eq(mirrorLinesFrom({ ...doc, schema_version: 2 }, { sport: 'nba' }), [], 'an unknown version is not read');
  const committed = await loadMirrorLines('nba');
  ok(committed.length > 1000 && committed.every((l) => l.source === 'mirror'), 'the committed NBA seed loads');
  eq(await loadMirrorLines('nba', { root: '/nonexistent' }), [], 'a missing seed is no lines');
  // The seed builder: one snapshot, one game, one player.
  const team = teamOf('nba');
  eq([team('SAS'), team('San Antonio Spurs'), team('LA Clippers'), team('GSW')], ['sa', 'sa', 'lac', 'gs'], 'mirror team codes and names');
  const game = { game_id: 'g9', home_team: 'lac', away_team: 'sa', start_utc: '2026-11-20T01:00:00Z' };
  const rows = [{ player_id: 'w1', date: '2026-11-17', team: 'sa' }, { player_id: 'w2', date: '2026-11-17', team: 'lac' }];
  const players = [{ player_id: 'w1', name: 'Victor Wembanyama' }, { player_id: 'w2', name: 'Kawhi Leonard' }];
  const prop = (o) => ({ player: 'Victor Wembanyama', stat: 'Points', line: '29.5', oddsType: 'standard', status: 'pre_game', startTimeIso: '2026-11-19T20:00:00.000-05:00', teamCode: 'SAS', opponentCode: 'LAC', ...o });
  const snap = (props, scrapedAt = '2026-11-19T12:07:02.791Z', committedAt = '2026-11-19T12:07:05Z') => ({ committed: committedAt, data: { scrapedAt, collectionStatus: { ok: true }, props } });
  const one = seedFromSnapshots({ sport: 'nba', snapshots: [snap([prop(), prop({ stat: 'Fantasy Score' }), prop({ oddsType: 'goblin' }), prop({ player: 'Kawhi Leonard', teamCode: 'SAS' })])], games: [game], rows, players });
  eq(one.rows, [['2026-11-19', 'g9', 'w1', 'points', 29.5]], 'one standard line matched to the stored game and player');
  eq([one.audit.other_stat, one.audit.nonstandard, one.audit.player_unmatched], [1, 1, 1], 'other stats, goblins and a player on the wrong team are counted, not kept');
  eq(seedFromSnapshots({ sport: 'nba', snapshots: [snap([prop()], '2026-11-19T12:07:02Z', '2026-11-19T15:00:00Z')], games: [game], rows, players }).audit.untrusted_capture_time, 1, 'a capture time far from its commit is not trusted');
  eq(seedFromSnapshots({ sport: 'nba', snapshots: [snap([prop(), prop({ line: '30.5' })])], games: [game], rows, players }).rows, [], 'two lines for one player on one board: dropped');
  eq(seedFromSnapshots({ sport: 'nba', snapshots: [snap([prop()]), snap([prop({ line: '31.5' })], '2026-11-19T18:00:00Z', '2026-11-19T18:00:04Z')], games: [game], rows, players }).rows[0][4], 29.5, 'the first line seen is kept');
  eq(seedFromSnapshots({ sport: 'nba', snapshots: [snap([prop({ startTimeIso: '2026-11-19T22:00:00.000-05:00' })])], games: [game], rows, players }).audit.schedule_mismatch, 1, 'a start two hours off is another game');
}

console.log(`Sports promo smoke passed (${checks} checks).`);
