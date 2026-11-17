#!/usr/bin/env node
// Turns the 1971-2026 engine history test (run by hand outside the repo; its
// scripts and write-up live in the Owner's research folder) into the
// aggregates-only file the site reads: research/engines-history/latest.json.
//
//   node scripts/engines-history-import.mjs --from <dir with summary.json, regime.json, trend.json>
//
// Only averages, counts and rates are copied. No trade row, ticker, contract
// or date of a single trade is written: the repo is public. lib/engines-history.mjs
// re-checks that on every read (validateEnginesHistory).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINES_HISTORY_RESULTS, validateEnginesHistory, STYLE_IDS } from "../lib/engines-history.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const from = arg("--from");
if (!from) { console.error("usage: node scripts/engines-history-import.mjs --from <dir>"); process.exit(2); }
const read = (f) => JSON.parse(readFileSync(resolve(from, f), "utf8"));
const summary = read("summary.json"), regime = read("regime.json"), trend = read("trend.json");

const r1 = (x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const cell = (x) => (x && typeof x === "object" ? { n: x.n ?? null, avg: r1(x.avg), rand: r1(x.rand), win: x.win ?? null } : null);
const styles = (obj) => Object.fromEntries(STYLE_IDS.map((id) => [id, cell(obj?.[id])]));

const totals = Object.fromEntries(STYLE_IDS.map((id) => {
  const t = summary.totals[id] || {};
  const acc = summary.account?.[id] || {};
  const decades = Object.fromEntries(["d70", "d80", "d90", "d00", "d10", "d20"].map((k) => [k, t[k] ? { n: t[k].n, avg: r1(t[k].avg) } : null]));
  return [id, {
    n: t.n, avg: r1(t.avg), t: r1(t.t), win: t.win, rand: r1(t.rand), stock: r1(t.stock),
    before2007: t.pre ? { n: t.pre.n, avg: r1(t.pre.avg) } : null, since2007: t.post ? { n: t.post.n, avg: r1(t.post.avg) } : null,
    decades, calls: { n: t.callN, avg: r1(t.calls) }, puts: { n: t.putN, avg: r1(t.puts) },
    account: { end: acc.end ?? null, maxDrawdownPct: r1(acc.maxDd) },
  }];
}));

const byState = Object.fromEntries(STYLE_IDS.map((id) => {
  const src = regime.byState?.[id] || {};
  return [id, Object.fromEntries(Object.entries(src).map(([dim, groups]) => [dim, Object.fromEntries(Object.entries(groups)
    // "up/null" is a handful of days with no VIX reading; not a market state.
    .filter(([k]) => !/null/.test(k))
    .map(([k, v]) => [k, { n: v.n, avg: r1(v.avg), t: r1(v.t) }]))]))];
}));
const gate = Object.fromEntries(STYLE_IDS.map((id) => [id, regime.gate?.[id] || null]));

const out = {
  version: 1,
  ranAt: "2026-11-16",
  from: "1971-01-01", to: summary.eras.at(-1)?.to || null,
  unit: "Average option profit or loss per trade, in percent of the premium paid, after 3.5 points of costs.",
  caveats: [
    "1971-2006 uses about 100 large US stocks that were still listed in 2017 (survivors only), so single-stock results before 2007 lean optimistic.",
    "Earnings, Fundamentals and Flow have no deep data: they were tested with price-only stand-ins (gap drift, quality-momentum rank, volume flow), not their live rules.",
    "Option prices are modeled from volatility, not real quotes. Before 1986 the VIX is 1.42 times 21-day realized volatility.",
    "Every setup was taken, with no learning. A $10,000 account putting 2% into each trade trails buy-and-hold for every style.",
  ],
  styles: totals,
  eras: summary.eras.map((e) => ({ key: e.key, from: e.from, to: e.to, data: e.data, spy: r1(e.spy), styles: styles(e.e) })),
  years: summary.years.map((y) => ({ y: y.y, spy: r1(y.spy), styles: Object.fromEntries(STYLE_IDS.map((id) => [id, y.e?.[id] ? { n: y.e[id].n, avg: r1(y.e[id].avg) } : null])) })),
  regime: { byState, gate },
  trendSwitch: {
    rule: "Hold the S&P 500 while it closes above its 200-day average, else 10-year Treasuries.",
    cagr: { buyHold: r1(trend.cagr?.bh), trendSwitch: r1(trend.cagr?.tf) },
    maxDrawdown: { buyHold: r1(trend.mdd?.bh), trendSwitch: r1(trend.mdd?.tf) },
    eras: Object.entries(trend.eras || {}).map(([key, v]) => ({ key, buyHold: r1(v.bh), trendSwitch: r1(v.tf) })),
  },
};
const check = validateEnginesHistory(out);
if (!check.ok) { console.error("refusing to write:", check.errors.join("; ")); process.exit(1); }
const file = resolve(ROOT, ENGINES_HISTORY_RESULTS);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${ENGINES_HISTORY_RESULTS}: ${out.eras.length} eras, ${out.years.length} years, ${STYLE_IDS.length} styles`);
