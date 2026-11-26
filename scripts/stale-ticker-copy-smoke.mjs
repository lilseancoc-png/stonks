// Offline checks for the failed ticker's last-good page (lib/stale-ticker-copy.mjs).
// Run: node scripts/stale-ticker-copy-smoke.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { collectStaleTickerCopies, isStaleTickerCopy, staleTickerCopy, STALE_COPY_MAX_DAYS } from "../lib/stale-ticker-copy.mjs";

const builtAtIso = "2026-11-26T16:00:00.000Z";
const good = (quoteAsOf = "2026-11-25T21:00:00.000Z") => ({
  spot: 100, quoteAsOf, marketState: "REGULAR", technicals: { rsi: 50 },
  chains: { 1780000000: { c: [{ s: 100, b: 1, a: 1.1 }], p: [{ s: 100, b: 1, a: 1.1 }] } },
  priceSeries: { t: Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`), c: Array.from({ length: 20 }, (_, i) => 100 + i) },
});

// A valid prior copy is kept, marked, with the first fresh quote as `since`.
const copy = staleTickerCopy(good(), { builtAtIso, why: "fetch failed" });
assert.ok(isStaleTickerCopy(copy));
assert.equal(copy.staleCopy.since, "2026-11-25T21:00:00.000Z");
assert.equal(copy.staleCopy.why, "fetch failed");
assert.equal(copy.spot, 100);
// Kept again on the next failed bake: `since` stays the first one.
const again = staleTickerCopy(copy, { builtAtIso: "2026-11-27T16:00:00.000Z" });
assert.equal(again.staleCopy.since, "2026-11-25T21:00:00.000Z");
// Not kept: missing, invalid, or past the limit.
assert.equal(staleTickerCopy(null, { builtAtIso }), null);
assert.equal(staleTickerCopy({ ...good(), chains: {} }, { builtAtIso }), null);
assert.equal(staleTickerCopy({ ...good(), spot: 0 }, { builtAtIso }), null);
const old = new Date(Date.parse(builtAtIso) - (STALE_COPY_MAX_DAYS + 1) * 86400000).toISOString();
assert.equal(staleTickerCopy(good(old), { builtAtIso }), null);
assert.equal(isStaleTickerCopy(good()), false);

// Only expected symbols missing from this run's chains are read.
const reads = [];
const copies = await collectStaleTickerCopies({
  expectedSymbols: ["AAPL", "MSFT", "NVDA", "GONE"],
  chains: { AAPL: { spot: 1 } },
  builtAtIso,
  readPrior: async (sym) => { reads.push(sym); if (sym === "GONE") throw new Error("ENOENT"); return good(); },
  whyOf: (sym) => (sym === "NVDA" ? "left out: input could not publish" : "fetch failed"),
});
assert.deepEqual(reads, ["MSFT", "NVDA", "GONE"]);
assert.deepEqual([...copies.keys()], ["MSFT", "NVDA"]);
assert.equal(copies.get("NVDA").staleCopy.why, "left out: input could not publish");

// The copy is written after the wipe, never into chains or the auto-picks,
// and every reader that builds signals from data/<SYM>.json skips it.
const src = async (p) => readFile(new URL(p, import.meta.url), "utf8");
const build = await src("./build.mjs");
const wcf = build.slice(build.indexOf("async function writeChainFiles("), build.indexOf("// ATM ~30-day IV snapshot per ticker."));
assert.match(wcf, /await writeAutoPicksFile\(ownerAutoPicks, builtAtIso\)/);
assert.ok(wcf.indexOf("for (const [sym, copy] of staleCopies") > wcf.indexOf("for (const [sym, data] of Object.entries(chains))"), "stale copies are written after the fresh files");
assert.doesNotMatch(wcf.slice(wcf.indexOf("for (const [sym, copy] of staleCopies")), /ownerAutoPicks\[sym\]/);
assert.doesNotMatch(build, /chains\[sym\]\s*=\s*copy/);
assert.match(build, /collectStaleTickerCopies\(\{\s*expectedSymbols: TICKERS,\s*chains,/);
const unusual = await src("./scan-unusual.mjs");
assert.equal((unusual.match(/isStaleTickerCopy\(/g) || []).length, 3, "volume, GEX and daily-volume readers skip a stale copy");
for (const f of ["./regen-picks.mjs", "./backfill-autopick.mjs", "./overnight-preopen.mjs", "./regen-brief.mjs"]) {
  assert.match(await src(f), /isStaleTickerCopy\(/, `${f} skips a stale copy`);
}
const verify = await src("./verify-data-freshness.mjs");
assert.match(verify, /isStaleTickerCopy\(payload\)\) staleCopies\.push/);
// The stock page says the numbers are from an earlier build.
const { renderStockPageJs } = await import("./render/stock-page-js.mjs");
const page = renderStockPageJs();
assert.match(page, /d\.staleCopy && d\.staleCopy\.since/);
assert.match(page, /Not updated in the latest build · data from /);

console.log("stale-ticker-copy smoke test passed");
