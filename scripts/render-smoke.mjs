// Offline regression check that private-data rendering fails closed when its
// manifest sidecars cannot be written.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { renderHtml } from "./render/html.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { BRIEF_ACCESS_POLICY_VERSION, sanitizePublicJsonText } from "../lib/public-data-policy.mjs";

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
  assert.match(html, /data-nav-group="owner"[\s\S]*?side-nav-group-label">Owner[\s\S]*?data-page-tab="picks"[\s\S]*?data-page-tab="stocks"[\s\S]*?data-page-tab="rotation"[\s\S]*?data-page-tab="levetf"[\s\S]*?data-page-tab="track"[\s\S]*?data-page-tab="quant"/);
  const ideasNav = html.match(/<details class="side-nav-group" data-nav-group="ideas"[\s\S]*?<\/details>/)?.[0] || "";
  assert.ok(ideasNav, "Ideas navigation group must render");
  assert.doesNotMatch(ideasNav, /data-page-tab="(?:picks|stocks|rotation|levetf|track)"/);
  assert.match(html, /href="https:\/\/ko-fi\.com\/mingstreetapp"/);
  assert.match(html, /\/_vercel\/insights\/script\.js/);

  const appJs = renderAppJs({});
  assert.match(appJs, /function loadOwnerTools\(\)[\s\S]*?loadStocks\(\);[\s\S]*?loadSectorRotation\(\);[\s\S]*?loadLevEtf\(\);/);
  assert.match(appJs, /stkDcaBlock\(d, false\)/);
  assert.equal((appJs.match(/data-rot-account><\/label>/g) || []).length, 1);
  assert.equal((appJs.match(/data-lev-account><\/label>/g) || []).length, 1);
  assert.match(appJs, /var OWNER_TABS = \{ picks:1, stocks:1, rotation:1, levetf:1, track:1, quant:1 \}/);
  assert.match(appJs, /HAS_TRACK_RECORD = HAS_OWNER_ACCESS/);
  assert.match(appJs, /HAS_TOP_PICKS = HAS_OWNER_ACCESS/);
  assert.match(appJs, /HAS_OWNER_ACCESS = !!\(GATE_ON && me && me\.trackRecord && me\.topPicks\)/);
  assert.match(appJs, /if \(OWNER_TABS\[name\] && !HAS_OWNER_ACCESS\)/);
  assert.match(appJs, /if \(!HAS_OWNER_ACCESS\) return;[\s\S]*?fetch\(dataUrl\('auto-picks\.json'\)/);

  for (const key of ["grades.json", "TSLA.json", "trends.json", "trends-history.json", "market-analysis.json", "briefs.json", "earnings-tracker.json", "index-calendar.json", "spillover-pairs.json", "unusual.json", "oi-tracker.json", "iv-history/TSLA.json", "manifest.json"]) {
    assert.equal(isPremiumKey(key), false, `${key} must take the public cache path`);
    assert.equal(roleClaimForKey(key), null, `${key} must not require a login`);
  }
  for (const key of ["picks.json", "picks-open.json", "picks-0dte.json", "picks-0dte-accuracy.json", "auto-picks.json", "stock-picks.json", "sector-rotation.json", "sector-rotation-log.json", "leveraged-etfs.json", "leveraged-etfs-log.json", "picks-accuracy.json", "picks-changes.json", "picks-roster.json", "grades-history.json", "grades-daily.json", "quant.json", "quant-history.json", "day-trading.json", "day-trading-history.json", "day-trades.json", "day-trades-history.json", "picks-watchlist.json", "ai-usage.json"]) {
    assert.equal(isPremiumKey(key), true);
    assert.deepEqual(roleClaimForKey(key), ["tr", "tp"], `${key} must require both Owner claims`);
  }
  const watchlistSource = await readFile(resolve("api/watchlist.js"), "utf8");
  assert.match(watchlistSource, /session\.tr !== true \|\| session\.tp !== true/);
  assert.doesNotMatch(watchlistSource, /session\.tp === false/);
  const authSource = await readFile(resolve("api/auth/[action].js"), "utf8");
  assert.match(authSource, /const hasOwnerRole = roles\.some/);
  assert.match(authSource, /tr: true,[\s\S]*?tp: true,/);
  assert.doesNotMatch(authSource, /DISCORD_TRACKRECORD_ROLE_ID/);

  // The public Brief is a derived payload, so its build inputs and carried AI
  // prose need the same Owner-boundary regression coverage as direct reads.
  const buildSource = await readFile(resolve("scripts/build.mjs"), "utf8");
  assert.ok(BRIEF_ACCESS_POLICY_VERSION > 0);
  assert.match(buildSource, /briefsPrev\.current\.accessPolicyVersion === BRIEF_ACCESS_POLICY_VERSION/);
  assert.match(buildSource, /accessPolicyVersion: BRIEF_ACCESS_POLICY_VERSION/);
  const briefSources = buildSource.match(/const BRIEF_TOOL_SOURCES = \[[\s\S]*?\n\];/)?.[0] || "";
  assert.ok(briefSources, "Brief source allowlist must exist");
  for (const file of ["stock-picks.json", "sector-rotation.json", "leveraged-etfs.json"]) {
    assert.doesNotMatch(briefSources, new RegExp(file.replace(".", "\\.")), `${file} must not feed the public Brief`);
  }
  const coreTools = buildSource.match(/const coreTools = \[[\s\S]*?\n      \];/)?.[0] || "";
  assert.ok(coreTools, "Brief core-tool coverage list must exist");
  assert.doesNotMatch(coreTools, /Top picks/i);
  const briefBuilder = buildSource.match(/export async function buildMarketBriefs\(opts\)[\s\S]*?\n}\n\nconst AI_SYSTEM_PROMPT/)?.[0] || "";
  assert.ok(briefBuilder, "Brief builder must exist");
  assert.doesNotMatch(briefBuilder, /picksChanges|\bpicks\b/);
  const briefCall = buildSource.match(/const briefRes = await buildMarketBriefs\(\{[\s\S]*?\n    \}\);/)?.[0] || "";
  assert.ok(briefCall, "Brief production call must exist");
  assert.doesNotMatch(briefCall, /picksChanges|\bpicks\s*:/);
  assert.match(buildSource, /writeAutoPicksFile\(ownerAutoPicks, builtAtIso\)/);
  assert.match(buildSource, /autoPick: _legacyAutoPick, \.\.\.rest/);
  assert.doesNotMatch(buildSource, /JSON\.stringify\(\{ \.\.\.rest, priceSeries, intradaySeries, autoPick \}\)/);

  const publicTicker = JSON.parse(sanitizePublicJsonText("MSFT.json", JSON.stringify({ spot: 500, autoPick: { call: { strike: 510 } } })));
  assert.deepEqual(publicTicker, { spot: 500 });
  const staleBrief = JSON.parse(sanitizePublicJsonText("briefs.json", JSON.stringify({ builtAtIso: "x", current: { picks: ["secret"] } })));
  assert.deepEqual(staleBrief, { builtAtIso: "x" });
  assert.equal(sanitizePublicJsonText("briefs.json", JSON.stringify({ current: { accessPolicyVersion: BRIEF_ACCESS_POLICY_VERSION } })), null);
  const publicRegime = JSON.parse(sanitizePublicJsonText("regime-history.json", JSON.stringify({ days: [{ date: "x", state: "neutral", lean: "call", picks: { calls: 2 } }] })));
  assert.deepEqual(publicRegime, { days: [{ date: "x", state: "neutral" }] });

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
