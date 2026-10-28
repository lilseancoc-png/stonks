// Replays the overnight call on past mornings from Yahoo bars (overnight
// review, 2026-10-26). Read-only: public market data in, a report out; it never
// touches the private store or the saved log.
//
// For every US session in the last ~8 weeks (Yahoo keeps ~60 days of 15-minute
// bars) it rebuilds the 09:05 ET call exactly as the bake does, grades it
// against SPY, and scores the OLD rules (the 7-vote tab tone before
// 2026-10-26) on the same mornings for comparison. The old tone read each
// market's last daily change, so cash VIX and the 10Y used the prior day's move.
//
// Usage: node scripts/overnight-replay.mjs [--json] [--out=path]

import { writeFile } from "node:fs/promises";
import YahooFinance from "yahoo-finance2";
import { fetchOvernightSeries } from "../lib/overnight-fetch.mjs";
import { buildOvernightCall, buildOvernightInputs, preOpenCutoffMs, usCloseMs } from "../lib/overnight-inputs.mjs";
import { mergeOvernightLog } from "../lib/overnight-log.mjs";
import { OVERNIGHT_TONE } from "../lib/overnight-tone.mjs";
import { fitReport } from "./overnight-fit.mjs";

const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const pct = (x) => (x == null ? "—" : `${Math.round(x * 1000) / 10}%`);

// The pre-2026-10-26 tab tone (deriveGlobalTone), fed what it saw at 09:05 ET:
// 24h markets' move since the prior close, Asia's session, and the prior
// day's daily change for cash VIX and the 10Y (they had not printed yet).
function oldTone(inputs, series, priorDate) {
  const mv = (s) => (inputs[s]?.fresh ? inputs[s].movePct : null);
  const dailyChange = (sym) => {
    const bars = (series[sym]?.daily || []).filter((b) => b.t <= priorDate);
    if (bars.length < 2) return null;
    const a = bars.at(-2).c, b = bars.at(-1).c;
    return { pct: (b / a - 1) * 100, bp: (b - a) * 100 };
  };
  let score = 0;
  const fut = ["ES=F", "NQ=F"].map(mv).filter((v) => v != null);
  if (fut.length) { const a = fut.reduce((s, v) => s + v, 0) / fut.length; if (a <= -0.4) score--; else if (a >= 0.4) score++; }
  const vix = dailyChange("^VIX")?.pct;
  if (vix != null) { if (vix >= 5) score--; else if (vix <= -5) score++; }
  const jpy = mv("JPY=X");
  if (jpy != null) { if (jpy <= -0.6) score--; else if (jpy >= 0.6) score++; }
  const asia = ["^KS11", "005930.KS", "000660.KS", "^TWII", "2330.TW", "^N225", "8035.T", "6857.T", "9984.T", "^HSI"]
    .map((s) => inputs[s]?.movePct ?? null).filter((v) => v != null); // old rule used stale sessions too
  if (asia.length >= 3) { const a = asia.reduce((s, v) => s + v, 0) / asia.length; if (a <= -0.6) score--; else if (a >= 0.6) score++; }
  const tnx = dailyChange("^TNX");
  if (tnx) { const bp = tnx.bp * (series["^TNX"]?.daily?.at(-1)?.c > 20 ? 0.1 : 1); if (bp >= 8) score--; else if (bp <= -8) score++; }
  const cu = mv("HG=F");
  if (cu != null) { if (cu <= -1) score--; else if (cu >= 1) score++; }
  const dxy = mv("DX-Y.NYB");
  if (dxy != null) { if (dxy >= 0.5) score--; else if (dxy <= -0.5) score++; }
  return score >= 3 ? "risk-on" : score <= -3 ? "risk-off" : score >= 1 ? "leaning risk-on" : score <= -1 ? "leaning risk-off" : "mixed";
}

function rate(rows) {
  const n = rows.length, hits = rows.filter(Boolean).length;
  return { n, hits, hitRate: n ? hits / n : null };
}

async function main() {
  const args = process.argv.slice(2);
  const nowMs = Date.now();
  const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"], validation: { logErrors: false } });
  const { series, failed } = await fetchOvernightSeries(yahooFinance, { nowMs, intradayDays: 58, concurrency: 3 });
  const spyDaily = series.SPY?.daily || [];
  const esBars = series["ES=F"]?.intraday || [];
  if (!spyDaily.length || !esBars.length) throw new Error("replay needs SPY daily and ES 15-minute bars");
  const firstMs = esBars[0].ms;
  const calls = [];
  const old = [];
  for (const bar of spyDaily) {
    const cutoffMs = preOpenCutoffMs(bar.t);
    if (cutoffMs - firstMs < 2 * 86400000 || usCloseMs(bar.t) > nowMs) continue;
    const call = buildOvernightCall({ series, callDate: bar.t, cutoffMs, reconstructed: true, capturedAtIso: new Date(cutoffMs).toISOString() });
    if (!call) continue;
    calls.push(call);
    const built = buildOvernightInputs({ series, callDate: bar.t, cutoffMs });
    old.push({ date: bar.t, label: oldTone(built.inputs, series, built.prior.date) });
  }
  const log = mergeOvernightLog(null, { calls, spyBars: spyDaily, qqqBars: series.QQQ?.daily || [] });
  const fit = fitReport(log.entries);
  const byDate = new Map(log.entries.map((e) => [e.date, e]));
  const oldRows = old.map((o) => ({ ...o, e: byDate.get(o.date) })).filter((o) => o.e?.outcome?.spy);
  const oldDir = (l) => OVERNIGHT_TONE.toneDirection(l);
  const oldCalled = oldRows.filter((o) => oldDir(o.label) !== 0);
  const oldStats = {
    called: oldCalled.length,
    gap: rate(oldCalled.map((o) => sgn(o.e.outcome.spy.gapPct) === oldDir(o.label))),
    session: rate(oldCalled.map((o) => sgn(o.e.outcome.spy.sessionPct) === oldDir(o.label))),
    cc: rate(oldCalled.map((o) => sgn(o.e.outcome.spy.ccPct) === oldDir(o.label))),
  };
  const s = fit.summary;
  const report = {
    sessions: fit.n,
    from: log.entries[0]?.date, to: log.entries.at(-1)?.date,
    fetchFailures: failed.length,
    base: s.base,
    newRules: {
      called: s.toneSession.n,
      gapCall: s.gapCall, toneGap: s.toneGap, toneSession: s.toneSession, toneCc: s.toneCc,
      strongToneSession: s.strongToneSession, sessionPValue: fit.sessionPValue,
    },
    oldRules: oldStats,
    insufficientDays: log.entries.filter((e) => e.tone?.label === "insufficient").length,
    labels: log.entries.reduce((m, e) => ((m[e.tone.label] = (m[e.tone.label] || 0) + 1), m), {}),
    corr: fit.corr,
    buckets: fit.buckets,
    sweep: fit.sweep,
    bands: fit.bands,
    days: log.entries.map((e) => ({
      date: e.date, label: e.tone.label, score: e.tone.score, gap: e.tone.gap.call, futPct: e.tone.gap.movePct,
      spyGap: e.outcome?.spy?.gapPct ?? null, spySession: e.outcome?.spy?.sessionPct ?? null,
      old: old.find((o) => o.date === e.date)?.label || null,
      excluded: e.tone.excluded.length,
    })),
  };
  const outArg = args.find((a) => a.startsWith("--out="));
  if (outArg) await writeFile(outArg.slice(6), JSON.stringify(report, null, 2));
  if (args.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Overnight replay ${report.from} to ${report.to}: ${report.sessions} graded sessions (${failed.length} failed requests).`);
  console.log(`Base rates: SPY opened up ${pct(s.base.gapUp)}, closed above its open ${pct(s.base.sessionUp)}.`);
  console.log(`New rules: gap call ${pct(s.gapCall.hitRate)} (n ${s.gapCall.n}); tone on gap ${pct(s.toneGap.hitRate)}, session ${pct(s.toneSession.hitRate)} (n ${s.toneSession.n}, p ${fit.sessionPValue?.toFixed(2) ?? "—"}), close to close ${pct(s.toneCc.hitRate)}; strong days session ${pct(s.strongToneSession.hitRate)} (n ${s.strongToneSession.n}).`);
  console.log(`Old rules: called ${oldStats.called} days; gap ${pct(oldStats.gap.hitRate)}, session ${pct(oldStats.session.hitRate)}, close to close ${pct(oldStats.cc.hitRate)}.`);
  console.log(`Labels: ${JSON.stringify(report.labels)}`);
  console.log(`Correlations: futures vs gap ${fit.corr.futuresVsGap?.toFixed(2)}, futures vs session ${fit.corr.futuresVsSession?.toFixed(2)}, score vs session ${fit.corr.scoreVsSession?.toFixed(2)}.`);
  for (const [k, rows] of Object.entries(fit.buckets)) console.log(`  ${k}: ${rows.map((x) => `≥${x.floor} ${pct(x.gap)}/${pct(x.session)} (${x.n})`).join("  ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
