// Re-fit report for the overnight scorer (overnight review, 2026-10-26).
//
// Reads the saved, graded call log (data/overnight-log.json) and reports how
// each part of the scorer did against SPY, next to the base rates, so the
// thresholds in lib/overnight-tone.mjs can be re-fit on real calls instead of
// guesses. Read-only: it never changes the log or the scorer.
//
// Usage: node scripts/overnight-fit.mjs [--file=path] [--live-only] [--json]

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERNIGHT_TONE } from "../lib/overnight-tone.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
function pct(x) { return x == null ? "—" : `${Math.round(x * 1000) / 10}%`; }
function rate(rows) {
  const n = rows.length;
  const hits = rows.filter(Boolean).length;
  return { n, hitRate: n ? hits / n : null };
}

// Two-sided binomial check against 50%: how surprising the hit count is if the
// call had no edge at all. A normal approximation is fine at the n this needs.
function pValue(hits, n) {
  if (!n) return null;
  const z = (hits - n / 2) / Math.sqrt(n / 4);
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return Math.min(1, 2 * tail);
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export function fitReport(entries) {
  const graded = entries.filter((e) => e?.outcome?.spy && e.tone?.buckets);
  const spy = (e) => e.outcome.spy;
  const summary = OVERNIGHT_TONE.summarize(graded);

  // Each bucket's own sign, at several |z| floors.
  const floors = [0.25, 0.5, 1, 1.5];
  const buckets = {};
  for (const spec of OVERNIGHT_TONE.BUCKETS) {
    buckets[spec.key] = floors.map((floor) => {
      const rows = graded
        .map((e) => ({ e, b: e.tone.buckets.find((x) => x.key === spec.key) }))
        .filter(({ b }) => b?.present && b.z != null && Math.abs(b.z) >= floor);
      const gap = rate(rows.map(({ e, b }) => sgn(spy(e).gapPct) === sgn(b.z)));
      const session = rate(rows.map(({ e, b }) => sgn(spy(e).sessionPct) === sgn(b.z)));
      return { floor, n: rows.length, gap: gap.hitRate, session: session.hitRate };
    });
  }

  // Re-score the saved bucket z-scores with other vote and label cut-offs.
  // The rates "shock only" and flight-to-safety rules are kept as saved
  // (their saved votes), so this sweeps the generic thresholds only.
  const sweep = [];
  for (const voteZ of [0.25, 0.5, 0.75, 1]) {
    for (const cut of [1, 2, 3]) {
      const calls = graded.map((e) => {
        let score = 0, present = 0;
        for (const b of e.tone.buckets) {
          if (!b.present) continue;
          present++;
          if (b.key === "rates") score += b.vote || 0;
          else if (b.z != null && Math.abs(b.z) >= voteZ) score += sgn(b.z);
        }
        return present >= OVERNIGHT_TONE.MIN_BUCKETS && Math.abs(score) >= cut ? sgn(score) : 0;
      });
      const called = graded.map((e, i) => ({ e, dir: calls[i] })).filter((x) => x.dir !== 0);
      const gap = rate(called.map(({ e, dir }) => sgn(spy(e).gapPct) === dir));
      const session = rate(called.map(({ e, dir }) => sgn(spy(e).sessionPct) === dir));
      sweep.push({ voteZ, cut, called: called.length, coverage: graded.length ? called.length / graded.length : null, gap: gap.hitRate, session: session.hitRate });
    }
  }

  // Gap call flat band.
  const bands = [0.05, 0.1, 0.15, 0.2, 0.3].map((band) => {
    const rows = graded.filter((e) => e.tone.gap?.movePct != null && Math.abs(e.tone.gap.movePct) >= band);
    const hit = rate(rows.map((e) => sgn(spy(e).gapPct) === sgn(e.tone.gap.movePct)));
    return { band, n: rows.length, hitRate: hit.hitRate };
  });

  // Does the size of the overnight move carry into the session? (score and
  // futures move vs the SPY session return). Near zero means no edge.
  const withFut = graded.filter((e) => e.tone.gap?.movePct != null);
  const corr = {
    scoreVsSession: pearson(graded.map((e) => e.tone.score), graded.map((e) => spy(e).sessionPct)),
    futuresVsGap: pearson(withFut.map((e) => e.tone.gap.movePct), withFut.map((e) => spy(e).gapPct)),
    futuresVsSession: pearson(withFut.map((e) => e.tone.gap.movePct), withFut.map((e) => spy(e).sessionPct)),
  };

  const sess = summary.toneSession;
  return {
    n: graded.length,
    rebuilt: graded.filter((e) => e.reconstructed).length,
    summary,
    sessionPValue: pValue(sess.hits, sess.n),
    buckets,
    sweep,
    bands,
    corr,
  };
}

function render(r) {
  const s = r.summary;
  const lines = [];
  lines.push(`Overnight scorer fit: ${r.n} graded sessions (${r.rebuilt} rebuilt by the bake, ${r.n - r.rebuilt} live).`);
  lines.push(`Base rates: SPY opened up ${pct(s.base.gapUp)}, closed above its open ${pct(s.base.sessionUp)}.`);
  lines.push(`Gap call right ${pct(s.gapCall.hitRate)} (n ${s.gapCall.n}); tone right on the gap ${pct(s.toneGap.hitRate)}, on the session ${pct(s.toneSession.hitRate)} (n ${s.toneSession.n}, p ${r.sessionPValue == null ? "—" : r.sessionPValue.toFixed(2)} vs a coin flip), close to close ${pct(s.toneCc.hitRate)}.`);
  lines.push(`Correlations: futures move vs SPY gap ${r.corr.futuresVsGap?.toFixed(2) ?? "—"}, vs SPY session ${r.corr.futuresVsSession?.toFixed(2) ?? "—"}; tone score vs session ${r.corr.scoreVsSession?.toFixed(2) ?? "—"}.`);
  lines.push("");
  lines.push("Per group, by |z| floor (gap / session hit rate, n):");
  for (const [key, rows] of Object.entries(r.buckets)) {
    lines.push(`  ${key.padEnd(9)} ${rows.map((x) => `≥${x.floor}: ${pct(x.gap)} / ${pct(x.session)} (${x.n})`).join("  ")}`);
  }
  lines.push("");
  lines.push("Vote z × label cut (called days, coverage, gap / session hit rate):");
  for (const x of r.sweep) {
    lines.push(`  z ${String(x.voteZ).padEnd(4)} cut ±${x.cut}: ${String(x.called).padStart(3)} days (${pct(x.coverage)}), ${pct(x.gap)} / ${pct(x.session)}`);
  }
  lines.push("");
  lines.push(`Gap flat band: ${r.bands.map((b) => `±${b.band}%: ${pct(b.hitRate)} (${b.n})`).join("  ")}`);
  lines.push("");
  lines.push(`The session call goes live only at n ≥ ${OVERNIGHT_TONE.SESSION_MIN_N} and ≥ ${pct(OVERNIGHT_TONE.SESSION_MIN_HIT)}. Change thresholds only on live calls and a clear margin over the base rate.`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="));
  const file = fileArg ? resolve(fileArg.slice(7)) : resolve(__dirname, "..", "data", "overnight-log.json");
  const log = JSON.parse(await readFile(file, "utf8"));
  let entries = log.entries || [];
  if (args.includes("--live-only")) entries = entries.filter((e) => !e.reconstructed);
  const report = fitReport(entries);
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : render(report));
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
