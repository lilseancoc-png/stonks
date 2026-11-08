// Replay the Top Picks grade's price half (technicals + mechanicals the bars can
// rebuild; no fundamentals, news or flow, which have no point-in-time history)
// on every 5th session 2008-2026 for the covered names. Output feeds stocks.mjs,
// which compares the grade with and without the macro fit by environment.
//
// Needs a scratch copy of the engine with computeTechnicals exported, so the
// real scripts/build.mjs stays untouched:
//   cp -r scripts lib package.json $ENG/ && ln -s $PWD/node_modules $ENG/node_modules
//   echo 'export { computeTechnicals as __computeTechnicals };' >> $ENG/scripts/build.mjs
//   node research/macro-backtest/engine-replay.mjs --eng $ENG --data <dir> --out <dir>
import fs from "node:fs";
import { loadLongHistory } from "./common.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const ENG = arg("eng", null);
if (!ENG) throw new Error("--eng <scratch engine copy> is required");
const DATA = arg("data", null);
const OUT = arg("out", null);
if (!DATA || !OUT) throw new Error("--data <long-history dir> and --out <results dir> are required");
const B = await import(ENG + "/scripts/build.mjs");
const { computeStreakForTicker } = await import(ENG + "/lib/streaks.mjs");
const H = loadLongHistory(DATA);
const { bars, CAL } = H;
const ETFS = new Set(["SPY", "QQQ", "IWM", "SMH", "UVXY", "TLT", "USO", "GLD", "SLV", "KWEB", "EWY", "DRAM", "SPCX"]);
const syms = B.TICKERS.filter((s) => bars[s]);
const idx = Object.fromEntries(syms.map((s) => [s, new Map(bars[s].t.map((t, i) => [t, i]))]));
const start = CAL.findIndex((d) => d >= "2008-01-02");
const out = {};
let n = 0;
for (let ci = start; ci < CAL.length; ci += 5) {
  const day = CAL[ci];
  const chains = {}, streaks = {};
  for (const s of syms) {
    const i = idx[s].get(day); if (i == null || i < 260) continue;
    const b = bars[s]; const lo = Math.max(0, i - 320);
    const bb = []; for (let k = lo; k <= i; k++) bb.push({ t: b.t[k], o: b.o[k], h: b.h[k], l: b.l[k], c: b.c[k], v: b.v[k] });
    if (bb.some((x) => !(x.c > 0))) continue;
    chains[s] = {
      spot: bb[bb.length - 1].c, chains: { replay: true }, marketState: "REGULAR",
      priceSeries: { t: bb.map((x) => x.t), c: bb.map((x) => x.c), h: bb.map((x) => x.h), l: bb.map((x) => x.l), v: bb.map((x) => x.v) },
      _bars: bb, technicals: B.__computeTechnicals(bb),
      fundamentals: ETFS.has(s) ? { quoteType: "ETF" } : { sector: null, nextEarningsDate: null },
    };
    streaks[s] = computeStreakForTicker(s, bb.slice(0, -1));
  }
  const { scored } = B.scoreAllTickers(chains, null, streaks, null, null, null, { builtAtIso: day + "T19:30:00.000Z" });
  out[day] = Object.fromEntries(scored.map((r) => [r.sym, r.base]));
  if (++n % 100 === 0) console.error(`replayed ${n} ${day}`);
}
fs.writeFileSync(OUT + "/engine-price-half.json", JSON.stringify({ built: new Date().toISOString(), note: "price-half base grade per name, every 5th session", days: out }));
console.log("done", Object.keys(out).length, "days");
