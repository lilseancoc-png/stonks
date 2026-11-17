// Strategy builder payoff math (generated app.js). Run: node scripts/strategy-builder-smoke.mjs
// Pulls the payoff functions out of app.js and checks that max gain, max loss
// and breakevens are exact at the strikes, that a sample on $0 P/L counts as
// one breakeven, and that a put's cap at the stock going to $0 is reported.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
let failed = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`ok   ${label}`);
  else { failed++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
};

function extract(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

const src = ["stratLegValueAt", "stratPayoffAt", "stratNearestExpSec", "stratSweepPayoff"].map(extract).join("\n");
const make = new Function("stratState", "stratBsPrice", "RFR", `${src}\nreturn { stratSweepPayoff, stratPayoffAt };`);
const state = { spot: 100 };
const { stratSweepPayoff } = make(state, () => 0, 0.04);

const EXP = 2000000000;
// One enriched leg: buy/sell, call/put, strike, entry price per share, qty.
const leg = (side, type, strike, price, qty = 1) => ({
  leg: { side, type, strike, expSec: EXP }, price, sign: side === "buy" ? 1 : -1, qty,
});
const enrich = (legs) => ({ legs, netCostPerShare: legs.reduce((a, l) => a + l.sign * l.qty * l.price, 0) });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// 1) A $5-wide call butterfly on a $500 stock: the even 1% grid steps $5 and
//    used to land beside the peak at $502.50, halving the shown max gain.
state.spot = 500;
const fly = enrich([leg("buy", "call", 497.5, 6.0), leg("sell", "call", 502.5, 3.6, 2), leg("buy", "call", 507.5, 2.0)]);
const flySweep = stratSweepPayoff(fly);
const flyDebit = 6.0 - 7.2 + 2.0; // 0.80 a share
ok("butterfly max gain is exact at the body strike", near(flySweep.max, (5 - flyDebit) * 100), `got ${flySweep.max}`);
ok("butterfly max loss is the debit", near(flySweep.min, -flyDebit * 100), `got ${flySweep.min}`);
ok("butterfly breakevens are exact", flySweep.breakevens.length === 2
  && near(flySweep.breakevens[0], 497.5 + flyDebit) && near(flySweep.breakevens[1], 507.5 - flyDebit),
  JSON.stringify(flySweep.breakevens));
ok("the strikes are sampled", [497.5, 502.5, 507.5].every((k) => flySweep.xs.includes(k)));
ok("samples stay sorted", flySweep.xs.every((x, i) => i === 0 || x > flySweep.xs[i - 1]));

// 2) A call debit spread whose breakeven sits exactly on spot (a sample):
//    one breakeven, not two.
state.spot = 102;
const vert = enrich([leg("buy", "call", 100, 3), leg("sell", "call", 105, 1)]);
const vSweep = stratSweepPayoff(vert);
ok("a $0 sample is one breakeven", vSweep.breakevens.length === 1 && near(vSweep.breakevens[0], 102), JSON.stringify(vSweep.breakevens));
ok("P/L at spot is exact", near(vSweep.atSpot, 0), `got ${vSweep.atSpot}`);
ok("vertical max gain / loss", near(vSweep.max, 300) && near(vSweep.min, -200));
ok("no put leg, no $0 figure", vSweep.atZero === null);

// 3) A long put: gain is capped at the stock going to $0, not unlimited.
state.spot = 100;
const put = enrich([leg("buy", "put", 100, 4)]);
const pSweep = stratSweepPayoff(put);
ok("long put flags the down tail", pSweep.unboundedGainDown === true && pSweep.unlimitedGainUp === false);
ok("long put P/L at $0 is strike minus premium", near(pSweep.atZero, 9600), `got ${pSweep.atZero}`);
ok("the chart band alone understates it", pSweep.max < pSweep.atZero);

// 4) A short put: loss at $0 is reported for the summary.
const sput = enrich([leg("sell", "put", 95, 2)]);
const sSweep = stratSweepPayoff(sput);
ok("short put loss at $0", sSweep.unboundedLossDown === true && near(sSweep.atZero, -9300), `got ${sSweep.atZero}`);

// 5) The score reads its direction from the page's grade-first direction read.
const score = extract("stratScore");
ok("directional fit reads stratDirectionRead", /stratDirectionRead\(\)/.test(score));
ok("the old RSI/MACD-only note is gone", !/matches RSI\/MACD tilt/.test(score));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nstrategy builder smoke: all passed");
