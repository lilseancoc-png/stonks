// Offline checks for the buyout-target guard and the shadow-signal logger.
// No network, no data/, no AI. Run: node scripts/top-picks-guards-smoke.mjs
import { buyoutContextFor, BUYOUT_PRICE_MATCH_PCT } from "../lib/pending-buyout-guard.mjs";
import { buildShadowSignals, SHADOW_KEYS } from "../lib/shadow-signals.mjs";
import { spilloverGroupOf } from "./build.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } };

// --- buyout guard -----------------------------------------------------------
const deals = { deals: [
  { status: "pending", targetTicker: "TGT", targetPrice: 50, acquirer: "Big Co", dealType: "cash", considerationPerShare: 51, stage: "announced" },
  { status: "rumored", targetTicker: "RUM", targetPrice: 20, stage: "rumor" },
  { status: "pending", targetTicker: "DUP", targetPrice: 10, dealType: "stock", considerationPerShare: 10.5 },
] };
const tgt = buyoutContextFor(deals, "TGT", 50.4);
ok("buyout: confirmed target blocks", tgt && tgt.status === "pending" && tgt.block === true && tgt.acquirer === "Big Co");
ok("buyout: rumor is listed but never blocks", buyoutContextFor(deals, "RUM", 20)?.block === false);
ok("buyout: a name with no deal reads null", buyoutContextFor(deals, "NONE", 100) === null);
ok("buyout: no payload reads null", buyoutContextFor(null, "TGT", 50) === null);
const dup = buyoutContextFor(deals, "DUP", 40);
ok(`buyout: quoted price more than ${BUYOUT_PRICE_MATCH_PCT}% from our spot does not block (other listing)`, dup && dup.block === false && dup.priceGapPct > BUYOUT_PRICE_MATCH_PCT);
ok("buyout: missing spot still blocks a confirmed deal", buyoutContextFor(deals, "TGT", null)?.block === true);
ok("buyout: ticker match ignores case", buyoutContextFor(deals, "tgt", 50)?.block === true);

// --- shadow signals ---------------------------------------------------------
const builtAtIso = "2026-10-26T20:10:00Z";
const bars = (start, step, n = 40) => Array.from({ length: n }, (_, i) => ({ t: `d${i}`, c: start * (1 + step) ** i }));
const chains = {
  AAA: { spot: 100, _bars: bars(50, 0.01), ivRank: { iv: 0.40 },
    earningsHx: { events: [{ date: "2026-10-01", guidance: "raised" }, { date: "2026-07-01", guidance: "lowered" }] } },
  BBB: { spot: 50, priceSeries: { c: bars(40, -0.005).map((b) => b.c) }, ivRank: { iv: 0.30 },
    earningsHx: { events: [{ date: "2026-07-01", guidance: "lowered" }] } },
  CCC: { spot: 30, _bars: bars(30, 0.002), ivRank: { iv: 0.25 } },
  DDD: { spot: 20, _bars: bars(20, 0.003) },
  ETF: { spot: 400, _bars: bars(400, 0.001) },
  BAD: { spot: 0 },
};
const groupOf = (s) => (s === "ETF" ? null : "g1");
const oiTracker = { tickers: [{ symbol: "AAA", callWall: { strike: 110 }, putWall: { strike: 90 } }] };
const spillover = { upcoming: [
  { driver: "AAA", date: "2026-11-02", followers: [{ follower: "BBB", pairQualified: true }, { follower: "CCC", pairQualified: false }] },
  { driver: "AAA", date: "2026-12-30", followers: [{ follower: "DDD", pairQualified: true }] },
] };
const sh = buildShadowSignals(chains, { builtAtIso, groupOf, oiTracker, spillover });
const val = (sym, key) => sh.rows[sym]?.[sh.keys.indexOf(key)];
ok("shadow: keys are the documented set", JSON.stringify(sh.keys) === JSON.stringify(SHADOW_KEYS));
ok("shadow: a name without a price is skipped", !("BAD" in sh.rows));
const r21 = ((1.01 ** 39) / (1.01 ** 18) - 1) * 100;
ok("shadow: r21 is the 21-bar return from raw bars", Math.abs(val("AAA", "r21") - r21) < 0.02);
ok("shadow: r21 falls back to priceSeries closes", val("BBB", "r21") < 0);
ok("shadow: im21 is the leave-one-out peer mean", Math.abs(val("AAA", "im21") - (val("BBB", "r21") + val("CCC", "r21") + val("DDD", "r21")) / 3) < 0.02);
ok("shadow: an ETF has no industry group", val("ETF", "im21") == null);
ok("shadow: vrp = IV points minus realized vol (a steady trend has ~0 realized)", val("AAA", "vrp") > 39 && val("AAA", "vrp") <= 40);
ok("shadow: no IV means no vrp", val("DDD", "vrp") == null);
ok("shadow: call wall 10% above and put wall 10% below", val("AAA", "cw") === 10 && val("AAA", "pw") === 10);
ok("shadow: guidance from a print within 45 days", val("AAA", "pg") === 1);
ok("shadow: guidance older than 45 days is not used", val("BBB", "pg") == null);
ok("shadow: qualified peer events inside 14 days count", val("BBB", "pe14") === 1 && val("CCC", "pe14") === 0 && val("DDD", "pe14") === 0);
const bare = buildShadowSignals(chains, { builtAtIso });
ok("shadow: missing inputs leave keys empty, not zero", bare.rows.AAA[SHADOW_KEYS.indexOf("pe14")] == null && bare.rows.AAA[SHADOW_KEYS.indexOf("cw")] == null && bare.rows.AAA[SHADOW_KEYS.indexOf("im21")] == null);

ok("shadow: the bake's industry key is a string shared by peers, null for ETFs",
  typeof spilloverGroupOf("NVDA") === "string" && spilloverGroupOf("NVDA") === spilloverGroupOf("AMD")
  && spilloverGroupOf("JPM") !== spilloverGroupOf("NVDA") && spilloverGroupOf("SPY") === null);

console.log(`\n${pass}/${pass + fail} checks passed.`);
if (fail) process.exit(1);
