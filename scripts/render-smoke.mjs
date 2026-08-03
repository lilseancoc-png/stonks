// Offline regression check that private-data rendering fails closed when its
// manifest sidecars cannot be written.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { renderHtml } from "./render/html.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { renderStylesCss } from "./render/styles-css.mjs";
import { isPremiumKey, roleClaimForKey } from "../lib/premium-keys.mjs";
import { BRIEF_ACCESS_POLICY_VERSION, sanitizePublicJsonText } from "../lib/public-data-policy.mjs";
import { DISCORD_INVITE_URL } from "../lib/links.mjs";

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
  assert.ok(html.includes(`class="discord-btn" href="${DISCORD_INVITE_URL}"`));
  assert.ok(html.includes(`class="foot-discord" href="${DISCORD_INVITE_URL}"`));
  assert.match(html, /Join Discord/);
  assert.match(html, /Discuss the research in our Discord/);
  assert.match(html, /window\.va=window\.va\|\|function\(\)\{/);
  assert.equal((html.match(/\/_vercel\/insights\/script\.js/g) || []).length, 1);
  assert.match(html, /<script defer data-disable-auto-track="1" src="\/_vercel\/insights\/script\.js"><\/script>/);

  const stylesCss = renderStylesCss();
  assert.match(stylesCss, /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.side-nav\s*\{[\s\S]*?top: 0;[\s\S]*?z-index: 65;[\s\S]*?\.side-nav-backdrop\s*\{[\s\S]*?inset: 0;/);

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
  assert.match(appJs, /var lastAnalyticsTabPath = null;[\s\S]*?function trackPageTab\(name\)\{[\s\S]*?var path = '\/tabs\/' \+ name;[\s\S]*?if \(path === lastAnalyticsTabPath \|\| typeof window\.va !== 'function'\) return;[\s\S]*?window\.va\('pageview', \{ path: path \}\);[\s\S]*?lastAnalyticsTabPath = path;/);
  assert.match(appJs, /syncTabToUrl\(name, !!\(nav && nav\.replace\)\);\s*if \(name !== 'grade'\) document\.title = 'stonks · Option Contract Rater';\s*trackPageTab\(name\);/);

  // Client regression coverage: URL cleanup, DST-aware option expiry, stale
  // requests, retryable tab loads, market-session filtering, and POST logout.
  assert.match(appJs, /\['tab', 's', 'exp', 'k', 't'\]\.forEach\(function\(key\)\{ url\.searchParams\.delete\(key\); \}\)/);
  assert.match(appJs, /function pushUrlState\(\)\{[\s\S]*?var gradePane = \$\('page-pane-grade'\);[\s\S]*?if \(gradePane && gradePane\.hidden\) return;/);
  assert.doesNotMatch(appJs, /EXPIRY_CLOSE_OFFSET/);
  const expiryHelperSource = appJs.match(/function etCloseEpochSec\(yyyymmdd\)\{[\s\S]*?function chainExpiryCloseEpochSec\(epochSec\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(expiryHelperSource, "generated expiry helpers must exist");
  const expiryHelpers = new Function(`${expiryHelperSource}\nreturn { chainExpiryCloseEpochSec, cache: CHAIN_EXPIRY_CLOSE_CACHE };`)();
  const winterExpiry = Date.parse("2026-01-16T00:00:00Z") / 1000;
  const summerExpiry = Date.parse("2026-07-17T00:00:00Z") / 1000;
  assert.equal(expiryHelpers.chainExpiryCloseEpochSec(winterExpiry), Date.parse("2026-01-16T21:00:00Z") / 1000);
  assert.equal(expiryHelpers.chainExpiryCloseEpochSec(summerExpiry), Date.parse("2026-07-17T20:00:00Z") / 1000);
  expiryHelpers.chainExpiryCloseEpochSec(winterExpiry);
  assert.equal(Object.keys(expiryHelpers.cache).length, 2, "expiry-close conversions should cache by date");

  const gradeLoadSource = appJs.match(/function loadChain\(\)\{[\s\S]*?\n  \}\n\n  \/\/ --- Live spot/)?.[0] || "";
  assert.ok(gradeLoadSource, "generated Grade chain loader must exist");
  assert.match(gradeLoadSource, /var requestSeq = \+\+state\.chainRequestSeq;/);
  assert.equal((gradeLoadSource.match(/requestSeq !== state\.chainRequestSeq \|\| state\.symbol !== symbol/g) || []).length, 2);
  assert.match(appJs, /var livePollRequest = null;\s*var livePollQueued = null;/);
  assert.match(appJs, /livePollQueued = \{ symbol: symbol, exp: exp \};[\s\S]*?livePollRequest\.controller\.abort\(\)/);
  assert.match(appJs, /var wasAborted = !!\(livePollRequest\.controller[\s\S]*?livePollQueued = wasAborted \? \{ symbol: symbol, exp: exp \} : null;/);
  assert.match(appJs, /Install\/reset the timer BEFORE the immediate[\s\S]*?startLivePolling\(\);[\s\S]*?if \(regularSession && state\.symbol === symbol && state\.currentExp\) \{\s*refreshLiveChain\(symbol, state\.currentExp\);/);
  assert.doesNotMatch(appJs, /livePollInFlight/);

  const strategyLoadSource = appJs.match(/function stratLoadSymbol\(symbol\)\{[\s\S]*?\n  \}\n\n  \/\/ --- Combobox/)?.[0] || "";
  assert.ok(strategyLoadSource, "generated strategy loader must exist");
  assert.match(strategyLoadSource, /var requestSeq = \+\+stratState\.requestSeq;/);
  assert.match(strategyLoadSource, /fetchChain\(symbol\)\.then\(function\(entry\)\{\s*if \(requestSeq !== stratState\.requestSeq\) return;/);
  assert.match(strategyLoadSource, /\.catch\(function\(err\)\{\s*if \(requestSeq !== stratState\.requestSeq\) return;/);

  assert.match(appJs, /action:'open-narrative', payload: n\.name, sector: sector/);
  assert.match(appJs, /setTimeout\(function\(\)\{ jumpToNarrative\(it\.sector, it\.payload\); \}, 0\);/);
  assert.match(appJs, /if \(heatmapState\.data && !heatmapState\.data\.loadError\)/);
  assert.match(appJs, /if \(\(picksState\.data && !picksState\.data\.loadError\) \|\| picksState\.loading\)/);
  assert.match(appJs, /if \(\(accuracyState\.data && !accuracyState\.data\.loadError\) \|\| accuracyState\.loading\)/);

  assert.match(appJs, /opts\.onQuotes\(quotes\.filter\(isRegularMarketQuote\), marketState\)/);
  assert.match(appJs, /quotes = quotes\.filter\(isRegularMarketQuote\);[\s\S]*?showing baked close/);
  assert.match(appJs, /var live = liveCandidate && liveCandidate\.marketState === 'REGULAR' \? liveCandidate : null;/);
  assert.match(appJs, /if \(lv && lv\.marketState === 'REGULAR' && lv\.changePct/);
  assert.match(appJs, /var regularSession = String\(q\.marketState \|\| ''\)\.toUpperCase\(\) === 'REGULAR';/);
  assert.match(appJs, /if \(r\.marketState !== 'REGULAR'\) \{[\s\S]*?stopLivePolling\(\);[\s\S]*?return;/);
  assert.match(appJs, /var marketClosedForEntry = !!decisionMarketState && decisionMarketState !== 'REGULAR';/);
  assert.match(appJs, /marketClosedForEntry[\s\S]*?wait for the option market to reopen/);
  assert.match(appJs, /Model entry, stop, target, R:R, and size are regular-session[\s\S]*?String\(q\.marketState \|\| ''\)\.toUpperCase\(\) === 'REGULAR'[\s\S]*?rotationState\.quotes = map/);
  assert.match(appJs, /if \(!q \|\| String\(q\.marketState \|\| ''\)\.toUpperCase\(\) !== 'REGULAR' \|\| token !== gexState\.token/);
  assert.match(appJs, /Share caps and daily-reset tracking are regular-session decisions;[\s\S]*?String\(q\.marketState \|\| ''\)\.toUpperCase\(\) === 'REGULAR'[\s\S]*?levState\.quotes = map/);
  assert.match(appJs, /var picksLive = \{ quotes: \{\}, marketState: '' \}/);
  assert.match(appJs, /leftRegularSession[\s\S]*?renderPicks\(true\)/);
  assert.match(appJs, /fetch\('\/api\/auth\/logout', \{ method: 'POST', credentials: 'same-origin' \}\)/);
  assert.match(appJs, /window\.location\.assign\('\/welcome\.html'\)/);
  assert.doesNotMatch(appJs, /href="\/api\/auth\/logout"/);

  const welcomeSource = await readFile(resolve("welcome.html"), "utf8");
  assert.match(welcomeSource, /window\.va=window\.va\|\|function\(\)\{/);
  assert.equal((welcomeSource.match(/\/_vercel\/insights\/script\.js/g) || []).length, 1);
  assert.match(welcomeSource, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
  assert.doesNotMatch(welcomeSource, /data-disable-auto-track/);

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
