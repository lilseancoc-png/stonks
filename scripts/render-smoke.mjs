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
  assert.match(html, /data-nav-group="owner"[\s\S]*?side-nav-group-label">Owner</);
  for (const tab of ["market", "brief", "narratives", "tickers", "grade", "compare", "strategies", "stocks", "rotation", "levetf", "flow", "volume", "oi", "iv-trend", "streaks", "spillover", "index-cal", "picks", "track", "quant"]) {
    assert.match(html, new RegExp(`data-role-group="owner"[\\s\\S]*?data-page-tab="${tab}"`));
  }

  const appJs = renderAppJs({});
  assert.match(appJs, /function loadOwnerTools\(\)[\s\S]*?loadStocks\(\);[\s\S]*?loadSectorRotation\(\);[\s\S]*?loadLevEtf\(\);/);
  assert.match(appJs, /stkDcaBlock\(d, false\)/);
  assert.equal((appJs.match(/data-rot-account><\/label>/g) || []).length, 1);
  assert.equal((appJs.match(/data-lev-account><\/label>/g) || []).length, 1);
  assert.match(appJs, /var OWNER_TABS = \{[\s\S]*?stocks:1/);
  assert.match(appJs, /var OWNER_TABS = \{[\s\S]*?strategies:1/);
  assert.match(appJs, /HAS_OWNER_ACCESS = !!\(GATE_ON && me && me\.trackRecord && me\.topPicks\)/);
  assert.match(appJs, /if \(OWNER_TABS\[name\] && !HAS_OWNER_ACCESS\)/);

  for (const key of ["grades.json", "TSLA.json", "trends.json", "trends-history.json", "stock-picks.json", "market-analysis.json", "briefs.json", "index-calendar.json", "spillover-pairs.json", "unusual.json", "oi-tracker.json", "iv-history/TSLA.json"]) {
    assert.equal(isPremiumKey(key), true, `${key} must not take the public cache path`);
    assert.deepEqual(roleClaimForKey(key), ["tr", "tp"], `${key} must require both Owner claims`);
  }
  for (const key of ["earnings-tracker.json"]) {
    assert.equal(isPremiumKey(key), true);
    assert.equal(roleClaimForKey(key), null, `${key} remains ordinary premium research`);
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
