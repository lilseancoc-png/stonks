// Offline checks for lib/shadow-research.mjs: a planted signal is found on the
// universe and after the grade, a grade-copy reads near zero after the grade,
// noise stays "collecting" or "fail", trades are read from entry snapshots,
// market gauges get a time-series read, and the evidence board carries it.
import { buildShadowResearch, partialSpearman, keyStatus, tradeRead, eventTradeRead, gaugeValue, GAUGE_VALID_FROM_VERSION, SHADOW_PASS } from "../lib/shadow-research.mjs";
import { buildShadowSignals, shadowValue, shadowMarketGauges, SHADOW_KEYS, altDataGauges, resemblesGauges, insiderFromStructure } from "../lib/shadow-signals.mjs";
import { buildEntrySnapshot } from "../lib/trade-snapshot.mjs";
import { buildPicksRunRecord } from "../lib/picks-run-archive.mjs";
import { buildEvidenceBoard } from "../lib/evidence-board.mjs";

let failed = 0;
const ok = (name, cond) => { console.log(`${cond ? "✓" : "✗"} ${name}`); if (!cond) failed++; };

// ---- synthetic universe: 40 names, 120 sessions ----------------------------
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const N = 40, DAYS = 120;
const dates = [];
{ const d = new Date(Date.UTC(2026, 0, 5)); while (dates.length < DAYS) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }
const syms = Array.from({ length: N }, (_, i) => `S${String(i).padStart(2, "0")}`);
// Each day each name gets a hidden "quality" q; the planted key equals q plus
// noise and the next 10 sessions' return leans on q. The grade is independent
// noise except for the "copy" key, which equals the grade.
const quality = {}; // sym -> array per day
const series = {};
for (const s of syms) {
  quality[s] = Array.from({ length: DAYS }, () => rnd() * 2 - 1);
  const closes = [100];
  for (let i = 1; i < DAYS; i++) {
    // forward-looking drift: the return into day i leans on quality from ~10 days earlier
    const q = quality[s][Math.max(0, i - 10)];
    closes.push(closes[i - 1] * (1 + q * 0.004 + (rnd() - 0.5) * 0.01));
  }
  series[s] = { dates, closes };
}
series.SPY = { dates, closes: Array.from({ length: DAYS }, (_, i) => 400 + i * 0.3 + Math.sin(i / 7)) };
const keys = ["plant", "noise", "copy", "flat"];
const days = dates.slice(0, 100).map((date, i) => {
  const totals = {}, rows = {};
  for (const s of syms) {
    const grade = Math.round((rnd() * 10 - 5) * 10) / 10;
    totals[s] = grade;
    rows[s] = [quality[s][i] + (rnd() - 0.5) * 0.3, rnd() * 2 - 1, grade, 1];
  }
  return { date, totals, shadow: { v: 9, keys, rows, mkt: { g1: Math.sin(i / 5), g2: quality.S00[i] } } };
});
const closed = [];
for (let i = 0; i < 40; i++) {
  const side = i % 2 ? "put" : "call";
  const v = rnd() * 2 - 1;
  const pnl = (side === "put" ? -v : v) * 40 + (rnd() - 0.5) * 10;
  closed.push({ symbol: syms[i % N], side, outcome: pnl > 0 ? "win" : "loss", optionPnlPct: pnl, entrySnapshot: { v: 2, shadow: { plant: v, noise: rnd() * 2 - 1 } } });
}
closed.push({ symbol: "X", side: "call", outcome: "void", optionPnlPct: null, entrySnapshot: { shadow: { plant: 1 } } });

const res = buildShadowResearch({ days, series, closed });
const byKey = Object.fromEntries(res.keys.map((k) => [k.key, k]));
ok("every logged key is reported, the constant key included", res.keys.length === 4 && byKey.flat);
ok("shadow days counted with first and last date", res.days === 100 && res.first === dates[0] && res.last === dates[99]);
const plant10 = byKey.plant.read["10"];
ok("the planted key shows a clearly positive 10-day IC, t from non-overlapping days", plant10.ic > 0.15 && plant10.days >= 80 && plant10.t > 2 && plant10.nonOverlap.days >= 8);
ok("both halves agree for the planted key", plant10.half1 > 0 && plant10.half2 > 0);
ok("the planted key keeps its read after the grade", plant10.partial > 0.1);
ok("the non-overlapping sub-read is kept", plant10.nonOverlap && plant10.nonOverlap.days < plant10.days && plant10.nonOverlap.ic > 0);
ok("the grade copy reads about zero after the grade", Math.abs(byKey.copy.read["10"].partial ?? 0) < 0.05);
ok("the constant key has no rank read", byKey.flat.read["10"].ic == null && byKey.flat.read["10"].days === 0);
ok("noise is not passed", byKey.noise.status !== "pass");
ok("trade read: 40 decided trades, void left out, side-signed value tracks the P&L", byKey.plant.trades.n === 40 && byKey.plant.trades.ic > 0.5 && byKey.noise.trades.n === 40);
ok("the planted key clears the bar", byKey.plant.status === "pass" && res.counts.pass === 1);
ok("decided trades with a snapshot counted", res.decidedTrades === 40 && res.pass.days === SHADOW_PASS.days);
const g = Object.fromEntries(res.gauges.map((x) => [x.key, x]));
ok("market gauges get a non-overlapping time-series read against SPY", g.g1 && g.g1.n >= 8 && typeof g.g1.rho === "number" && g.g2.latest != null && g.g2.latestDate === dates[99]);
ok("keyStatus: too few trades keeps collecting", keyStatus({ "10": { days: 60, ic: 0.1, half1: 0.1, half2: 0.1, partial: 0.1 } }, { n: 10 }) === "collecting");
ok("keyStatus: a sign flip between halves fails", keyStatus({ "10": { days: 60, ic: 0.05, half1: 0.1, half2: -0.02, partial: 0.05 } }, { n: 40 }) === "fail");
ok("keyStatus: a read the grade already explains is inconclusive", keyStatus({ "10": { days: 60, ic: 0.05, half1: 0.05, half2: 0.05, partial: 0.005 } }, { n: 40 }) === "inconclusive");
ok("partial Spearman of x with y given z=x is null (nothing left)", partialSpearman([{ x: 1, y: 2, z: 1 }, { x: 2, y: 1, z: 2 }, { x: 3, y: 5, z: 3 }, { x: 4, y: 4, z: 4 }]) === null);
ok("tradeRead ignores trades without the key", tradeRead([{ side: "call", outcome: "win", optionPnlPct: 5, entrySnapshot: { shadow: {} } }], "plant").n === 0);
ok("an empty input yields an empty, well-formed report", (() => { const r = buildShadowResearch({}); return r.days === 0 && r.keys.length === 0 && r.gauges.length === 0 && r.counts.pass === 0; })());

// ---- shadow v3 with crowd facts and the market gauges ----------------------
const bars = Array.from({ length: 60 }, (_, i) => ({ c: 100 + i, v: 1000 }));
const crowd = {
  etDate: "2026-11-09",
  rollup: [{ symbol: "AAA", shortPct: 55.5, shortZ20: 1.8, borrowFeePct: 6.25, redditMentions: 30, redditVsAvg7: 3.5, wikiRatio30: 2.1, watchersPct7d: 4, perpFundingAnnualPct: 35, perpVsClosePct: -2.5, redditMentionsPctile: 90, wikiRatio30Pctile: 80, watchersPct7dPctile: 70 },
    { symbol: "BBB", shortPct: 40, shortZ20: -0.2 }],
  putCall: { stats: { equity: { value: 0.72, avg20: 0.65, z250: 1.1, pct250: 84 }, total: { value: 1.05 } } },
  cot: { contracts: { ES: { groups: { levFund: { net: -150000, z3y: -1.4 }, assetMgr: { z3y: 0.9 } } }, NQ: { groups: { levFund: { z3y: 0.3 } } }, VX: { groups: { levFund: { net: -60000, z3y: -0.5 } } } } },
  marginDebt: { summary: { yoyPct: 18.2, momPct: 1.1, peak: { fromPeakPct: -2 } } },
  levFlows: { totals: { bullUsd5d: 1.2e9, bearUsd5d: -3e8 } },
  builtAtIso: "2026-11-09T16:10:00.000Z",
  kalshi: { series: { KXINX: { headline: { impliedMean: 7000, band80: [6790, 7140] }, events: [{ closeTime: "2026-11-13T21:00:00.000Z" }] }, KXRECSSNBER: { headline: { prob: 0.2 } } } },
  shortVolume: { market: { latest: ["2026-11-06", 47.3] } },
};
const chains = { AAA: { spot: 160, _bars: bars }, BBB: { spot: 50, _bars: bars } };
const sh = buildShadowSignals(chains, { builtAtIso: "2026-11-09T16:10:00Z", crowd });
ok("v5 keys carry the crowd keys and the rows use them", sh.v === 5 && sh.keys.length === SHADOW_KEYS.length && shadowValue(sh, "AAA", "sv") === 55.5 && shadowValue(sh, "AAA", "bf") === 6.25 && shadowValue(sh, "AAA", "pgp") === -2.5);
ok("attention is the mean percentile of the three attention reads", shadowValue(sh, "AAA", "att") === 80);
ok("a name without a crowd row leaves the crowd keys empty", shadowValue(sh, "BBB", "bf") == null && shadowValue(sh, "BBB", "sv") === 40);
ok("market gauges ride the block once", sh.mkt && sh.mkt.pc === 0.72 && sh.mkt.pcp === 84 && sh.mkt.cotEsZ === -1.4 && sh.mkt.mdYoy === 18.2 && sh.mkt.levBull5 === 1.2e9 && sh.mkt.kxWid === 2.44 && sh.mkt.kxRec === 20 && sh.mkt.svm === 47.3);
ok("no crowd payload: no gauges, rows unchanged", !("mkt" in buildShadowSignals(chains, { builtAtIso: "2026-11-09T16:10:00Z" })) && shadowMarketGauges(null) === null);
{
  const bb = buildShadowSignals(chains, { builtAtIso: "2026-11-09T16:10:00Z", defaultChance: { AAA: 12.345 }, buildout: { score: 4.5, credit: { baa: 1.51 } } });
  ok("booms & busts: epd per name and the sign score + Baa spread as gauges", shadowValue(bb, "AAA", "epd") === 12.35 && shadowValue(bb, "BBB", "epd") == null && bb.mkt.bsl === 4.5 && bb.mkt.baa === 1.51 && !("pc" in bb.mkt));
}
{
  // ---- version 5: borrow, leverage distress, insider, Alt Data, Resembles now
  const ch5 = { AAA: { spot: 160, _bars: bars, impliedBorrow: { ratePct: 3.456 } }, BBB: { spot: 50, _bars: bars }, CCC: { spot: 20, _bars: bars } };
  const forcedLiquidation = { rows: [
    { symbol: "AAA", current: true, pledge: { confirmed: true }, stress: { score: 40 } },
    { symbol: "AAA", current: true, pledge: { confirmed: true }, stress: { score: 55 } },
    { symbol: "BBB", current: true, pledge: { confirmed: false }, stress: { score: 90 } },
  ] };
  const leverageDistress = {
    hotFunds: { funds: [{ cik: "1" }], coverage: { bulk: { status: "ok" } }, stockLinks: [{ symbol: "AAA", stressedDaysOfVolume: 1.25 }] },
    rebalance: { rows: [{ underlying: "AAA", pctOfAdv: 4.5, side: "sell" }, { underlying: "BBB", pctOfAdv: 2, side: "buy" }] },
    clusters: { today: { names: [{ symbol: "CCC" }] } },
  };
  const structure = { companies: { AAA: { completeFrom: "2026-09-01", owners: { a: { tx: [{ date: "2026-11-01", code: "P" }] }, b: { tx: [{ date: "2026-11-02", code: "P" }, { date: "2026-10-30", code: "S" }] }, c: { tx: [{ date: "2026-11-03", code: "A" }] } } },
    BBB: { completeFrom: "2026-11-01", owners: { a: { tx: [{ date: "2026-11-05", code: "S" }] } } } } };
  const ins = insiderFromStructure(structure, "2026-11-09T16:10:00Z");
  ok("insider counts distinct open-market buyers and sellers, only on a fully covered window", ins.AAA.buyers === 2 && ins.AAA.sellers === 1 && !("BBB" in ins) && insiderFromStructure(null, "2026-11-09T16:10:00Z") === null);
  const extra = { ...altDataGauges({ accelerators: { summary: { focus: { change30dPct: 23.2 } } }, ram: { spot: { items: [{ m1Pct: 3.7 }, { m1Pct: 15.9 }, { m1Pct: -1 }] } }, aiCapex: { totals: { yoyPct: 64.7 } } }),
    ...resemblesGauges({ matches: [{ id: "war", study: "war" }, { id: "witching", study: "witching" }, { id: "crash", study: "crash" }], studies: { war: { summary: { d20: { medianPct: 1.5 } } }, crash: { summary: { d20: { medianPct: -2.5 } } } } }) };
  ok("alt-data and resembles gauges: GPU 30d, DRAM median, capex y/y, stress analogs only", extra.gpu30 === 23.2 && extra.dram30 === 3.7 && extra.cxYoy === 64.7 && extra.rnw === 2 && extra.rnf === -0.5);
  ok("stale alt data is left out", !("gpu30" in altDataGauges({ accelerators: { stale: true, summary: { focus: { change30dPct: 5 } } } })));
  const v5 = buildShadowSignals(ch5, { builtAtIso: "2026-11-09T16:10:00Z", forcedLiquidation, leverageDistress, insider: ins, marketExtra: extra });
  ok("v5: implied borrow, highest confirmed pledge stress, pressured hot-fund days", shadowValue(v5, "AAA", "ibr") === 3.46 && shadowValue(v5, "AAA", "fls") === 55 && shadowValue(v5, "BBB", "fls") == null && shadowValue(v5, "AAA", "hfp") === 1.25 && shadowValue(v5, "BBB", "hfp") === 0);
  ok("v5: signed rebalance, cluster hit flag, insider net", shadowValue(v5, "AAA", "lrb") === -4.5 && shadowValue(v5, "BBB", "lrb") === 2 && shadowValue(v5, "CCC", "lrb") == null && shadowValue(v5, "CCC", "csh") === 1 && shadowValue(v5, "AAA", "csh") === 0 && shadowValue(v5, "AAA", "ins") === 1 && shadowValue(v5, "BBB", "ins") == null);
  ok("v5: the extra gauges ride the market row", v5.mkt.gpu30 === 23.2 && v5.mkt.rnw === 2);
  const failedScreen = buildShadowSignals(ch5, { builtAtIso: "2026-11-09T16:10:00Z", leverageDistress: { hotFunds: { funds: [], coverage: { bulk: { status: "failed" } } } } });
  ok("v5: a failed 13F screen logs no hot-fund zeros", shadowValue(failedScreen, "BBB", "hfp") == null);
  const evt = eventTradeRead([
    { side: "call", outcome: "win", optionPnlPct: 30, eventPlay: { kind: "earnings" }, entrySnapshot: { shadow: { att: 80 } } },
    { side: "put", outcome: "loss", optionPnlPct: -50, eventPlay: { kind: "earnings" }, entrySnapshot: { shadow: { att: 90 } } },
    { side: "call", outcome: "loss", optionPnlPct: -50, eventPlay: { kind: "macro" }, entrySnapshot: { shadow: { att: 10 } } },
  ], "att");
  ok("earnings event-play read: side-signed means for winners and losers, macro plays left out", evt.n === 2 && evt.winMean === 80 && evt.lossMean === -90);
  const oldDay = { date: "2026-11-10", shadow: { v: 4, mkt: { levBull5: 0, pc: 0.6 } } }, newDay = { date: "2026-11-13", shadow: { v: 5, mkt: { levBull5: 5e8 } } };
  ok("gauge values logged before the fixing version are ignored", GAUGE_VALID_FROM_VERSION.levBull5 === 5 && gaugeValue(oldDay, "levBull5") === null && gaugeValue(oldDay, "pc") === 0.6 && gaugeValue(newDay, "levBull5") === 5e8);
}
const snap = buildEntrySnapshot({ symbol: "AAA", pillars: {} }, chains.AAA, { shadow: sh });
ok("entry snapshot v2 copies the crowd keys and the market gauges", snap.v === 2 && snap.shadow.bf === 6.25 && snap.shadow.att === 80 && snap.mkt.pcp === 84);
const snapNoMkt = buildEntrySnapshot({ symbol: "AAA", pillars: {} }, chains.AAA, { shadow: sh, market: false });
ok("market=false leaves the gauges out", !("mkt" in snapNoMkt) && snapNoMkt.shadow.sv === 55.5);
const run = buildPicksRunRecord({ builtAtIso: "2026-11-09T16:10:00Z", scored: [{ sym: "AAA", total: 5, side: "call", pillars: {}, data: chains.AAA }], picks: { rosterMeta: {} }, shadow: sh });
ok("run archive rows carry the shadow row and the run carries the gauges once", run.rows[0].shadow.bf === 6.25 && !("mkt" in run.rows[0]) && run.mkt.pc === 0.72);
const board = buildEvidenceBoard({ closed: [], shadowDays: 100, builtAtIso: "2026-11-09T16:10:00Z", today: "2026-11-09", shadow: res });
const row = board.tests.find((t) => t.id === "shadow-signals");
ok("evidence board: the shadow test reads the research and the table rides the board", row.read.keys === 4 && row.read.passing.join() === "plant" && row.verdict === "pass" && board.shadow.keys.length === 4);
const boardEmpty = buildEvidenceBoard({ closed: [], shadowDays: 12, builtAtIso: "2026-11-09T16:10:00Z", today: "2026-11-09" });
ok("evidence board without research keeps collecting", boardEmpty.tests.find((t) => t.id === "shadow-signals").status === "collecting" && boardEmpty.shadow === null);

if (failed) { console.error(`${failed} shadow research check(s) failed`); process.exit(1); }
console.log("shadow research smoke: ok");
