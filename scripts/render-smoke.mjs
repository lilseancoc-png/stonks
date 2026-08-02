// Offline regression check that private-data rendering fails closed when its
// manifest sidecars cannot be written.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { renderHtml } from "./render/html.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";

const temp = await mkdtemp(resolve(tmpdir(), "stonks-render-"));
try {
  const dataDir = resolve(temp, "data");
  await mkdir(dataDir);
  const html = renderHtml({
    symbols: [],
    builtAt: "test",
    builtAtIso: "2026-08-02T00:00:00.000Z",
    unusual: { premiumSentinel: "must-not-inline" },
    dataDir,
  });
  assert.match(html, /"deferred":true/);
  assert.doesNotMatch(html, /must-not-inline/);
  assert.match(await readFile(resolve(dataDir, "manifest.json"), "utf8"), /must-not-inline/);
  assert.equal((html.match(/id="picks-position"/g) || []).length, 1);
  assert.ok(html.indexOf('id="picks-position"') > html.indexOf('id="quant-section"'));
  assert.match(html, /data-nav-group="owner"[\s\S]*?side-nav-group-label">Owner[\s\S]*?data-page-tab="quant"/);
  assert.doesNotMatch(html, /data-role-group="owner"[\s\S]*?data-page-tab="picks"/);
  assert.match(html, /href="https:\/\/ko-fi\.com\/mingstreetapp"/);
  assert.match(html, /\/_vercel\/insights\/script\.js/);

  const appJs = renderAppJs({});
  assert.match(appJs, /function loadOwnerTools\(\)[\s\S]*?loadStocks\(\);[\s\S]*?loadSectorRotation\(\);[\s\S]*?loadLevEtf\(\);/);
  assert.match(appJs, /stkDcaBlock\(d, false\)/);
  assert.equal((appJs.match(/data-rot-account><\/label>/g) || []).length, 1);
  assert.equal((appJs.match(/data-lev-account><\/label>/g) || []).length, 1);
  assert.match(appJs, /var OWNER_TABS = \{ quant:1 \}/);
  assert.match(appJs, /HAS_OWNER_ACCESS = !!\(GATE_ON && me && me\.trackRecord && me\.topPicks\)/);
  assert.match(appJs, /if \(OWNER_TABS\[name\] && !HAS_OWNER_ACCESS\)/);

  for (const key of ["grades.json", "TSLA.json", "trends.json", "trends-history.json", "stock-picks.json", "market-analysis.json", "briefs.json", "earnings-tracker.json", "index-calendar.json", "spillover-pairs.json", "unusual.json", "oi-tracker.json", "iv-history/TSLA.json", "manifest.json"]) {
    assert.equal(isPremiumKey(key), false, `${key} must take the public cache path`);
    assert.equal(roleClaimForKey(key), null, `${key} must not require a login`);
  }
  for (const key of ["quant.json", "quant-history.json", "day-trading.json", "day-trading-history.json", "picks-watchlist.json", "ai-usage.json"]) {
    assert.equal(isPremiumKey(key), true);
    assert.deepEqual(roleClaimForKey(key), ["tr", "tp"], `${key} must require both Owner claims`);
  }
  const watchlistSource = await readFile(resolve("api/watchlist.js"), "utf8");
  assert.match(watchlistSource, /session\.tr !== true \|\| session\.tp !== true/);
  assert.doesNotMatch(watchlistSource, /session\.tp === false/);

  const blocker = resolve(temp, "not-a-directory");
  await writeFile(blocker, "block", "utf8");
  assert.throws(
    () => renderHtml({
      symbols: [],
      builtAt: "test",
      builtAtIso: "2026-08-02T00:00:00.000Z",
      unusual: { premiumSentinel: "must-not-inline" },
      dataDir: blocker,
    }),
    /manifest sidecar write failed/,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("render fail-closed smoke test passed");
