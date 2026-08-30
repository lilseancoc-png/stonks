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
import { contentAssetVersion } from "../lib/asset-version.mjs";

const temp = await mkdtemp(resolve(tmpdir(), "stonks-render-"));
try {
  const dataDir = resolve(temp, "data");
  await mkdir(dataDir);
  const html = renderHtml({
    symbols: [],
    builtAt: "test",
    builtAtIso: "2026-08-02T00:00:00.000Z",
    renderedAtIso: "2026-08-02T00:01:00.000Z",
    assetVersions: {
      styles: "sha256-styles",
      app: "sha256-app",
      streaks: "sha256-streaks",
    },
    unusual: { premiumSentinel: "must-not-inline" },
    dataDir,
  });
  assert.match(html, /"deferred":true/);
  assert.doesNotMatch(html, /must-not-inline/);
  assert.match(await readFile(resolve(dataDir, "manifest.json"), "utf8"), /must-not-inline/);
  const freeManifest = JSON.parse(await readFile(resolve(dataDir, "manifest-free.json"), "utf8"));
  assert.equal(freeManifest._meta.dataBuiltAtIso, "2026-08-02T00:00:00.000Z");
  assert.equal(freeManifest._meta.renderedAtIso, "2026-08-02T00:01:00.000Z");
  assert.match(html, /styles\.css\?v=sha256-styles/);
  assert.match(html, /app\.js\?v=sha256-app/);
  assert.match(html, /js\/streaks\.js\?v=sha256-streaks/);
  assert.equal(contentAssetVersion("unchanged"), contentAssetVersion("unchanged"));
  assert.notEqual(contentAssetVersion("unchanged"), contentAssetVersion("changed"));
  assert.equal(contentAssetVersion("same\r\nlines\r\n"), contentAssetVersion("same\nlines\n"));
  assert.equal((html.match(/id="picks-position"/g) || []).length, 1);
  assert.ok(html.indexOf('id="picks-position"') > html.indexOf('id="quant-section"'));
  assert.match(html, /data-nav-group="owner"[\s\S]*?side-nav-group-label">Owner[\s\S]*?data-page-tab="market"[\s\S]*?data-page-tab="picks"[\s\S]*?data-page-tab="stocks"[\s\S]*?data-page-tab="rotation"[\s\S]*?data-page-tab="levetf"[\s\S]*?data-page-tab="track"[\s\S]*?data-page-tab="quant"/);
  assert.doesNotMatch(html, /data-page-tab="daytrade"|data-page-tab="daytrack"|Day Trading Track Record/);
  const navGroups = html.match(/<details class="side-nav-group"[^>]*>/g) || [];
  assert.equal(navGroups.length, 9, "All sidebar navigation groups must render");
  assert.ok(navGroups.every((tag) => /\sopen(?:\s|>)/.test(tag)), "All sidebar navigation groups must start expanded");
  const ideasNav = html.match(/<details class="side-nav-group" data-nav-group="ideas"[\s\S]*?<\/details>/)?.[0] || "";
  assert.ok(ideasNav, "Ideas navigation group must render");
  assert.match(ideasNav, /data-page-tab="ma-tracker"[\s\S]*?data-page-tab="flow"/);
  assert.doesNotMatch(ideasNav, /data-page-tab="(?:picks|stocks|rotation|levetf|track)"/);
  assert.doesNotMatch(html.match(/<details class="side-nav-group" data-nav-group="desk"[\s\S]*?<\/details>/)?.[0] || "", /data-page-tab="market"/);
  assert.match(html, /data-page-tab="timeline"[\s\S]*?id="page-pane-timeline"/);
  assert.match(html, /08:30 ET[\s\S]*?Premarket Brief[\s\S]*?10:00, 11:00, 13:30, 15:30 &amp; 16:10 ET/);
  assert.match(html, /11:00 &amp; 15:30 ET[\s\S]*?Swing decision desks[\s\S]*?Friday 11:30 ET[\s\S]*?Weekly Alt Data/);
  assert.match(html, /id="time-zone-select" aria-label="Display time zone"[\s\S]*?<option value="local">Local<\/option>[\s\S]*?<option value="et">ET<\/option>[\s\S]*?<option value="ct">CT<\/option>[\s\S]*?<option value="mt">MT<\/option>[\s\S]*?<option value="pt">PT<\/option>[\s\S]*?<option value="utc">UTC<\/option>/);
  assert.match(html, /Market schedule · ET \(America\/New_York\)[\s\S]*?header&rsquo;s time-zone setting converts actual build, scan and headline timestamps/);
  assert.match(html, /id="footer-built-time" class="muted" data-built-at="2026-08-02T00:00:00\.000Z">checking&hellip;<\/span>/);
  assert.doesNotMatch(html, /\(NY\)/);
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
  assert.match(stylesCss, /\.bonds-context \{ --flow-decision-tone: var\(--accent\);/, "Bonds & USD primary actions must have a visible tone");
  assert.match(stylesCss, /\.time-zone-control\s*\{[\s\S]*?\.time-zone-control select\s*\{/);
  assert.match(stylesCss, /@media \(max-width: 560px\) \{[\s\S]*?\.brand-mark \{ display: none; \}[\s\S]*?\.site-nav \.donate-btn \{ display: none; \}[\s\S]*?\.time-zone-control \{ width: 42px;/, "mobile header must leave room for the timezone control and full wordmark");
  assert.doesNotMatch(stylesCss, /"rank (?:regime|scenario) (?:regime|scenario)"/);
  assert.doesNotMatch(stylesCss, /\.(?:ptc-regime|ptc-scenario|pick-pillars-regime|pick-scenario-overlay)\b/);

  const appJs = renderAppJs({});
  assert.match(appJs, /var DISPLAY_TIME_ZONE_KEY = 'stonks-display-time-zone';/);
  assert.match(appJs, /local: \{ label: 'Local', timeZone: null \}[\s\S]*?et: \{ label: 'ET', timeZone: 'America\/New_York' \}[\s\S]*?pt: \{ label: 'PT', timeZone: 'America\/Los_Angeles' \}[\s\S]*?utc: \{ label: 'UTC', timeZone: 'UTC' \}/);
  assert.match(appJs, /function formatDisplayInstant\(value, options\)[\s\S]*?opts\.timeZoneName = 'short'/);
  assert.match(appJs, /function bindTimeZoneSelect\(\)[\s\S]*?localStorage\.setItem\(DISPLAY_TIME_ZONE_KEY, next\)[\s\S]*?activePane = document\.querySelector\('\.page-pane:not\(\[hidden\]\)\[id\^="page-pane-"\]'\)[\s\S]*?url\.searchParams\.set\('tab', activeTab\)/);
  assert.match(appJs, /activeTab === 'grade' && state\.symbol[\s\S]*?buildShareUrl\(\)[\s\S]*?localStorage\.setItem\('stonks-theme', currentTheme\)[\s\S]*?select\.blur\(\)[\s\S]*?window\.setTimeout\(function\(\)\{ window\.location\.reload\(\); \}, 150\)/);
  assert.match(appJs, /function renderFooterBuiltTime\(\)[\s\S]*?formatDisplayInstant\(iso,[\s\S]*?el\.textContent = label/);
  assert.ok((appJs.match(/formatDisplayInstant\(/g) || []).length >= 20, "timestamped desks must use the shared display-timezone formatter");
  assert.doesNotMatch(appJs, /function fmtTapeTime\(iso\)\{[\s\S]{0,220}?America\/New_York/, "tape timestamps must use the user display zone");
  assert.doesNotMatch(appJs, /class="(?:ptc-regime|ptc-scenario|pick-pillars-regime|pick-scenario-overlay)\b/);
  assert.doesNotMatch(appJs, /function pickRegime(?:GradeNote|OverlayHtml|CompactHtml)\(/);
  assert.doesNotMatch(appJs, /data-narr-tab="market"/, "Narratives must not link to the owner-only Market Analysis tab");
  assert.doesNotMatch(appJs, /Open Market analysis/i, "Public desks must not link to the owner-only Market Analysis tab");
  assert.doesNotMatch(appJs, /data-brief-go="market"/, "Brief playbook must not send public readers to Market Analysis");
  assert.doesNotMatch(appJs, /data-cal-brief-go="market"/, "Calendar briefing must not send public readers to Market Analysis");
  assert.doesNotMatch(html, /Open VIX in Market analysis/i, "VIX gauge must not advertise Market Analysis");
  assert.match(appJs, /this\.input = \$\('symbol-input'\);[\s\S]*?else if \(q && this\.items\[0\] === q\)/, "Grade combobox Enter must commit an exact ticker match");
  assert.match(appJs, /var freshnessActiveTab = null;[\s\S]*?if \(activeTab\) freshnessActiveTab = activeTab;\s*else activeTab = freshnessActiveTab;/, "Freshness heartbeat must keep the active-tab override");
  assert.match(appJs, /function loadMaTracker\(\)[\s\S]*?ma-tracker\.json/);
  assert.match(appJs, /function maTrackerScore\([\s\S]*?proximity[\s\S]*?approach[\s\S]*?momentum/);
  assert.match(appJs, /name === 'ma-tracker'[\s\S]*?startMaTrackerLive/);
  assert.match(appJs, /function loadOwnerTools\(\)[\s\S]*?loadStocks\(\);[\s\S]*?loadSectorRotation\(\);[\s\S]*?loadLevEtf\(\);/);
  assert.match(appJs, /stkDcaBlock\(d, false\)/);
  assert.equal((appJs.match(/data-rot-account><\/label>/g) || []).length, 1);
  assert.equal((appJs.match(/data-lev-account><\/label>/g) || []).length, 1);
  assert.match(appJs, /function rotRecoveryProfile\(c\)[\s\S]*?qualified[\s\S]*?verify-first[\s\S]*?reject/);
  assert.match(appJs, /Quality Recovery Shortlist/);
  assert.match(appJs, /class="rot-recovery-filter"[\s\S]*?role="group" aria-label="Fundamental recovery profile"[\s\S]*?recoveryBtn\('qualified','Qualified'\)[\s\S]*?recoveryBtn\('verify-first','Verify first'\)/);
  assert.match(appJs, /function rotEffectiveDecision\(c, thresholds\)[\s\S]*?recovery\.status === 'reject'[\s\S]*?recovery\.status === 'verify-first'/);
  assert.match(appJs, /function rotGroupTape\(groups\)[\s\S]*?<details class="rot-tape"/);
  const recoveryProfileHelpers = appJs.match(/function rotRecoveryItemText\(value\)\{[\s\S]*?(?=\n  function rotRecoveryStatus\(c\))/)?.[0] || "";
  assert.ok(recoveryProfileHelpers, "Sector Rotation recovery-profile helpers must exist");
  const testRotNum = (value) => {
    const number = Number(value);
    return value !== "" && value != null && Number.isFinite(number) ? number : null;
  };
  const testRotValue = (obj, keys) => {
    if (!obj || typeof obj !== "object") return null;
    for (const key of keys) if (obj[key] != null && obj[key] !== "") return obj[key];
    return null;
  };
  const testRotText = (obj, keys) => {
    const value = testRotValue(obj, keys);
    return value == null || typeof value === "object" ? "" : String(value);
  };
  const testRotHuman = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  const testRotKey = (value) => String(value || "").toLowerCase().replace(/[_\s]+/g, "-");
  const testRotList = (value) => Array.isArray(value) ? value.filter((item) => item != null && item !== "") : typeof value === "string" && value ? [value] : [];
  const testRecoveryProfile = new Function("rotNum", "rotValue", "rotText", "rotHuman", "rotKey", "rotList", `${recoveryProfileHelpers}\nreturn rotRecoveryProfile;`)(
    testRotNum, testRotValue, testRotText, testRotHuman, testRotKey, testRotList,
  );
  const legacyMissingProfit = testRecoveryProfile({
    quality: [
      { key: "profit", ok: false, detail: "no profitability data on file" },
      { key: "debt", ok: true, detail: "debt manageable" },
      { key: "margins", ok: true, detail: "margins holding" },
      { key: "revenue", ok: true, detail: "revenue growing" },
    ],
    guards: {
      quality: { status: "block", detail: "Consistently profitable failed - no profitability data on file" },
      trend: { status: "block", detail: "pre-drop trend model is unavailable" },
    },
    blockedBy: ["quality", "trend"],
  });
  assert.equal(legacyMissingProfit.status, "verify-first", "missing legacy profitability evidence must require verification, not reject");
  assert.equal(legacyMissingProfit.coverage.available, 3);
  assert.equal(legacyMissingProfit.coverage.passed, 3);
  assert.deepEqual(legacyMissingProfit.coverage.missing, ["Profit"]);
  const legacyNegativeFcf = testRecoveryProfile({
    quality: [
      { key: "profit", ok: true, detail: "7.1% net margin · free cash flow negative" },
      { key: "debt", ok: true, detail: "debt manageable" },
      { key: "margins", ok: true, detail: "margins holding" },
      { key: "revenue", ok: true, detail: "revenue growing" },
    ],
  });
  assert.equal(legacyNegativeFcf.status, "reject", "explicitly negative legacy free cash flow is a known core failure");
  assert.equal(legacyNegativeFcf.coverage.available, 4);
  assert.equal(legacyNegativeFcf.coverage.passed, 3);
  for (const [key, detail, label] of [
    ["profit", "-2.4% net margin · free cash flow positive", "negative net margin"],
    ["profit", "0% net margin · free cash flow positive", "nonpositive net margin"],
    ["debt", "debt/equity -0.4x", "negative debt/equity"],
    ["debt", "negative equity", "negative equity"],
  ]) {
    const rows = [
      { key: "profit", ok: true, detail: "7.1% net margin · free cash flow positive" },
      { key: "debt", ok: true, detail: "debt manageable" },
      { key: "margins", ok: true, detail: "margins holding" },
      { key: "revenue", ok: true, detail: "revenue growing" },
    ];
    rows.find((row) => row.key === key).detail = detail;
    const profile = testRecoveryProfile({ quality: rows });
    assert.equal(profile.status, "reject", `explicit legacy ${label} is a known core failure`);
    assert.equal(profile.coverage.passed, 3);
  }
  const legacyCompleteLooking = testRecoveryProfile({
    quality: [
      { key: "profit", ok: true, detail: "7.1% net margin · free cash flow positive" },
      { key: "debt", ok: true, detail: "debt manageable" },
      { key: "margins", ok: true, detail: "margins holding" },
      { key: "revenue", ok: true, detail: "revenue growing" },
    ],
  });
  assert.equal(legacyCompleteLooking.status, "verify-first", "legacy payloads without recoveryProfile must never synthesize Qualified");
  assert.equal(legacyCompleteLooking.coverage.available, 4);
  assert.equal(legacyCompleteLooking.coverage.passed, 4);
  const recoveryCohortSource = appJs.match(/function rotRecoveryCohortRank\(c\)\{[\s\S]*?(?=\n  function rotPlanPoint\()/)?.[0] || "";
  assert.ok(recoveryCohortSource, "Sector Rotation recovery-cohort ranker must exist");
  const testRecoveryCohortRank = new Function("rotRecoveryProfile", "rotKey", "rotText", `${recoveryCohortSource}\nreturn rotRecoveryCohortRank;`)(
    testRecoveryProfile, testRotKey, testRotText,
  );
  assert.deepEqual([
    "qualified-improving", "qualified-durable", "verify-first", "reject",
  ].map((status) => testRecoveryCohortRank({ recoveryProfile: { status } })), [4, 3, 2, 1]);
  const recoveryComparatorSource = appJs.match(/function rotRecoveryPriorityCompare\(a, b, thresholds\)\{[\s\S]*?(?=\n  function rotList\()/)?.[0] || "";
  assert.ok(recoveryComparatorSource, "Sector Rotation recovery-priority comparator must exist");
  const testRecoveryComparator = new Function("rotRecoveryCohortRank", "rotEffectiveDecision", "rotRecoveryRank", "rotCandidateScore", `${recoveryComparatorSource}\nreturn rotRecoveryPriorityCompare;`)(
    testRecoveryCohortRank,
    (candidate) => ({ kind: candidate.testAction }),
    (candidate) => candidate.testRecoveryRank,
    (candidate) => candidate.testScore,
  );
  const richerPass = { id: "pass", recoveryProfile: { status: "qualified-durable" }, testAction: "pass", testRecoveryRank: 355, testScore: 95 };
  const leanerActionable = { id: "actionable", recoveryProfile: { status: "qualified-durable" }, testAction: "act", testRecoveryRank: 320, testScore: 70 };
  assert.deepEqual([richerPass, leanerActionable].sort((a, b) => testRecoveryComparator(a, b, {})).map((row) => row.id), ["actionable", "pass"], "effective action must outrank richer evidence within one recovery cohort");
  const improvingPass = { id: "improving", recoveryProfile: { status: "qualified-improving" }, testAction: "pass", testRecoveryRank: 310, testScore: 60 };
  assert.deepEqual([leanerActionable, improvingPass].sort((a, b) => testRecoveryComparator(a, b, {})).map((row) => row.id), ["improving", "actionable"], "discrete recovery cohort must outrank action");
  const rotationDeskSource = appJs.match(/function rotDeskBriefHtml\(d, candidates, thresholds\)\{[\s\S]*?(?=\n  function rotVisibleCandidates\()/)?.[0] || "";
  assert.match(rotationDeskSource, /ranked\.sort\([\s\S]*?rotRecoveryPriorityCompare\(a\.candidate, b\.candidate, thresholds\)[\s\S]*?var primary = actionable\[0\] \|\| waiting\[0\] \|\| passed\[0\] \|\| null;/, "Today's Decision focus must use the highest recovery-ranked member of the best available action cohort");
  assert.match(appJs, /id="rot-accountability" tabindex="-1"/);
  const rotationBindSource = appJs.match(/function bindRotationDesk\(root\)\{[\s\S]*?(?=\n  function renderSectorRotation\()/)?.[0] || "";
  assert.match(rotationBindSource, /data-rot-jump-record[\s\S]*?target\.scrollIntoView\(\{ behavior:'smooth', block:'start' \}\);[\s\S]*?target\.focus\(\{ preventScroll:true \}\)[\s\S]*?target\.focus\(\)/, "record jump must scroll and move keyboard focus to the accountability section");
  const rotationRenderSource = appJs.match(/function renderSectorRotation\(\)\{[\s\S]*?\n  \}\n  function renderOwnerRotationSizing/)?.[0] || "";
  assert.ok(rotationRenderSource, "Sector Rotation renderer must exist");
  assert.ok(rotationRenderSource.indexOf("rotShortlistHtml(d, candidates, thresholds)") < rotationRenderSource.indexOf("rotToolbarHtml(candidates, visible, groups, thresholds)"), "recovery shortlist must lead the detailed controls");
  assert.ok(rotationRenderSource.indexOf("+ grid + rotProcessHtml() + rotGroupTape(groups)") > rotationRenderSource.indexOf("rotToolbarHtml(candidates, visible, groups, thresholds)"), "process and group tape must follow the candidate board");
  assert.match(stylesCss, /\.rot-short-row\s*\{[\s\S]*?grid-template-columns/);
  assert.match(stylesCss, /@media \(max-width: 480px\)\s*\{[\s\S]*?\.rot-short-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(html, /How to use this fundamentals-first rebound desk[\s\S]*?Quality Recovery Shortlist/);
  const regenStaticSource = await readFile(resolve(process.cwd(), "scripts", "regen-static.mjs"), "utf8");
  assert.match(regenStaticSource, /existingShellManifest\?\.symbols[\s\S]*?new Set\(\[\.\.\.TICKERS, \.\.\.symbols, \.\.\.existingSymbols\]\)/, "renderer-only regeneration must preserve source and shell symbols missing from a partial hydrate");
  assert.match(appJs, /var OWNER_TABS = \{ market:1, picks:1, stocks:1, rotation:1, levetf:1, track:1, quant:1 \}/);
  assert.doesNotMatch(appJs, /day-trading\.json|day-trading-history\.json|loadDayTrading/);
  assert.match(appJs, /HAS_TRACK_RECORD = HAS_OWNER_ACCESS/);
  assert.match(appJs, /HAS_TOP_PICKS = HAS_OWNER_ACCESS/);
  assert.match(appJs, /HAS_OWNER_ACCESS = !!\(GATE_ON && me && me\.trackRecord && me\.topPicks\)/);
  assert.match(appJs, /if \(OWNER_TABS\[name\] && !HAS_OWNER_ACCESS\)/);
  assert.match(appJs, /if \(!HAS_OWNER_ACCESS\) return;[\s\S]*?fetch\(dataUrl\('auto-picks\.json'\)/);
  assert.match(appJs, /var lastAnalyticsTabPath = null;[\s\S]*?function trackPageTab\(name\)\{[\s\S]*?var path = '\/tabs\/' \+ name;[\s\S]*?if \(path === lastAnalyticsTabPath \|\| typeof window\.va !== 'function'\) return;[\s\S]*?window\.va\('pageview', \{ path: path \}\);[\s\S]*?lastAnalyticsTabPath = path;/);
  assert.match(appJs, /syncTabToUrl\(name, !!\(nav && nav\.replace\)\);\s*if \(name !== 'grade'\) document\.title = 'stonks';\s*trackPageTab\(name\);/);
  assert.match(html, /<title>stonks<\/title>/);
  assert.doesNotMatch(html, /<span class="brand-tag">Option Rater<\/span>/);

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
  assert.match(html, /id="heatmap-period-select"[\s\S]*?<option value="1w">1W<\/option>[\s\S]*?<option value="1m">1M<\/option>[\s\S]*?<option value="3m">3M<\/option>[\s\S]*?<option value="ytd">YTD<\/option>[\s\S]*?<option value="1y">1Y<\/option>/);
  assert.match(appJs, /var HEATMAP_PCT_SAT = \{ '1d':3, '1w':6, '1m':12, '3m':20, 'ytd':35, '1y':40 \}/);
  assert.match(appJs, /function heatmapEffectiveCh\(t\)[\s\S]*?var baseline = bakedSpot \/ factor;[\s\S]*?liveSpot \/ baseline/);
  assert.match(appJs, /if \(\(picksState\.data && !picksState\.data\.loadError\) \|\| picksState\.loading\)/);
  assert.match(appJs, /if \(\(accuracyState\.data && !accuracyState\.data\.loadError\) \|\| accuracyState\.loading\)/);
  assert.match(appJs, /id="ers-season-table-search"[\s\S]*?data-ers-table-search-submit[\s\S]*?id="ers-season-table-body"/);
  assert.match(appJs, /function updateSeasonTableSearch\(\)[\s\S]*?data-ers-haystack[\s\S]*?tableRows\[tr\]\.hidden = !show/);
  assert.match(appJs, /earningsState\.tableSearch = '';/);
  assert.match(appJs, /d\.recentlyReported/);
  assert.match(appJs, /<h3>Recently reported<\/h3>/);
  assert.match(appJs, /data-ers-recent-window="7"/);

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
  assert.match(appJs, /e\.signal !== 'wait-pullback' && e\.signal !== 'buy-dip'/);
  assert.match(appJs, /readyScore >= readyBar[\s\S]*?ready\.countertrendProof === true/);
  assert.match(appJs, /timing\.structure && timing\.structure\.clear === true[\s\S]*?e\.ai && e\.ai\.blocked === true/);
  assert.match(appJs, /var staleBuild = data\.stale === true;[\s\S]*?var picksRaw = !staleBuild/);
  const liveEntrySource = appJs.match(/function liveEntryOverlay\(p, spot\)\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(liveEntrySource, "live entry overlay must render");
  const liveEntryOverlay = Function(`${liveEntrySource}; return liveEntryOverlay;`)();
  const fullReadiness = {
    score: 2, bar: 2, independentFamilies: 2, directionConfirmed: true,
    structureOk: true, payoffOk: true, crowdedProof: true, countertrendProof: true,
  };
  const liveBase = {
    side: "call",
    entry: { now: false, signal: "buy-dip", trigger: 100, basis: "nearby structure", headline: "Wait", readiness: fullReadiness },
    entryTiming: { state: "wait", score: 2, hardVeto: null, deferKind: null, structure: { clear: true } },
  };
  assert.equal(liveEntryOverlay(liveBase, 99)?.kind, "go", "complete baked readiness may activate its live price trigger");
  assert.equal(liveEntryOverlay({ ...liveBase, entry: { ...liveBase.entry, readiness: { ...fullReadiness, independentFamilies: 1, directionConfirmed: false } } }, 99)?.kind, "arm", "price cannot promote incomplete readiness");
  assert.equal(liveEntryOverlay({ ...liveBase, entry: { ...liveBase.entry, signal: "wait-reversal" } }, 99), null, "price cannot promote a reversal wait");
  assert.equal(liveEntryOverlay({ ...liveBase, entry: { ...liveBase.entry, basis: "top-guard" } }, 99)?.kind, "arm", "price cannot waive a hard exhaustion guard");
  const ivPanelSource = appJs.match(/function pickIvCostPanelBody\(pil\)\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(ivPanelSource, "IV Cost panel must render");
  const pickIvCostPanelBody = Function("escapeHtml", "scenarioSigned", `${ivPanelSource}; return pickIvCostPanelBody;`)(
    (value) => String(value),
    (value, unit = "") => `${Number(value) >= 0 ? "+" : ""}${value}${unit}`,
  );
  const putRichIvPanel = pickIvCostPanelBody({
    score: 1,
    signals: [{ score: 1, contribution: 1, value: "rich put IV", note: "mirrored grade adjustment" }],
    context: {
      contribution: -1, method: "universe-relative", pctile: 82, ownZ: 1.7, currentIv: 0.44,
      rankAsOf: "2026-08-08", surfaceAsOf: "2026-08-08", universeN: 20,
    },
  });
  assert.match(putRichIvPanel, /premium headwind/i, "put-side panel uses direction-agnostic cost semantics");
  assert.doesNotMatch(putRichIvPanel, /Cheaper universe-relative premium/);
  assert.match(putRichIvPanel, /ATM ~30d IV 44\.0%[\s\S]*?own z \+1\.7σ[\s\S]*?rank as of 2026-08-08[\s\S]*?surface as of 2026-08-08/);
  assert.match(appJs, /fetch\('\/api\/auth\/logout', \{ method: 'POST', credentials: 'same-origin' \}\)/);
  assert.match(appJs, /window\.location\.assign\('\/welcome\.html'\)/);
  assert.doesNotMatch(appJs, /href="\/api\/auth\/logout"/);

  const welcomeSource = await readFile(resolve("welcome.html"), "utf8");
  assert.match(welcomeSource, /window\.va=window\.va\|\|function\(\)\{/);
  assert.equal((welcomeSource.match(/\/_vercel\/insights\/script\.js/g) || []).length, 1);
  assert.match(welcomeSource, /<script defer src="\/_vercel\/insights\/script\.js"><\/script>/);
  assert.doesNotMatch(welcomeSource, /data-disable-auto-track/);

  for (const key of ["grades.json", "TSLA.json", "trends.json", "trends-history.json", "briefs.json", "earnings-tracker.json", "index-calendar.json", "spillover-pairs.json", "ma-tracker.json", "unusual.json", "oi-tracker.json", "iv-history/TSLA.json", "manifest.json"]) {
    assert.equal(isPremiumKey(key), false, `${key} must take the public cache path`);
    assert.equal(roleClaimForKey(key), null, `${key} must not require a login`);
  }
  for (const key of ["market-analysis.json", "picks.json", "picks-open.json", "picks-0dte.json", "picks-0dte-accuracy.json", "auto-picks.json", "stock-picks.json", "sector-rotation.json", "sector-rotation-log.json", "leveraged-etfs.json", "leveraged-etfs-log.json", "picks-accuracy.json", "picks-changes.json", "picks-roster.json", "grades-history.json", "grades-daily.json", "quant.json", "quant-history.json", "day-trading.json", "day-trading-history.json", "day-trades.json", "day-trades-history.json", "picks-watchlist.json", "ai-usage.json"]) {
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
  const buildSource = (await readFile(resolve("scripts/build.mjs"), "utf8")).replace(/\r\n/g, "\n");
  assert.ok(BRIEF_ACCESS_POLICY_VERSION > 0);
  assert.match(buildSource, /briefsPrev\.current\.accessPolicyVersion === BRIEF_ACCESS_POLICY_VERSION/);
  assert.match(buildSource, /accessPolicyVersion: BRIEF_ACCESS_POLICY_VERSION/);
  const briefSources = buildSource.match(/const BRIEF_TOOL_SOURCES = \[[\s\S]*?\n\];/)?.[0] || "";
  assert.ok(briefSources, "Brief source allowlist must exist");
  for (const file of ["ma-tracker.json", "pending-buyouts.json"]) {
    assert.match(briefSources, new RegExp(file.replace(".", "\\.")), `${file} must feed the public Brief`);
  }
  for (const file of ["stock-picks.json", "sector-rotation.json", "leveraged-etfs.json"]) {
    assert.doesNotMatch(briefSources, new RegExp(file.replace(".", "\\.")), `${file} must not feed the public Brief`);
  }
  const coreTools = buildSource.match(/const coreTools = \[[\s\S]*?\n      \];/)?.[0] || "";
  assert.ok(coreTools, "Brief core-tool coverage list must exist");
  assert.doesNotMatch(coreTools, /Top picks/i);
  assert.doesNotMatch(briefSources, /market-analysis\.json/);
  const briefBuilder = buildSource.match(/export async function buildMarketBriefs\(opts\)[\s\S]*?\n}\n\nconst AI_SYSTEM_PROMPT/)?.[0] || "";
  assert.ok(briefBuilder, "Brief builder must exist");
  assert.doesNotMatch(briefBuilder, /picksChanges|\bpicks\b/);
  const briefCall = buildSource.match(/const briefRes = await buildMarketBriefs\(\{[\s\S]*?\n    \}\);/)?.[0] || "";
  assert.ok(briefCall, "Brief production call must exist");
  assert.doesNotMatch(briefCall, /picksChanges|\bpicks\s*:/);
  assert.match(buildSource, /writeAutoPicksFile\(ownerAutoPicks, builtAtIso\)/);
  assert.match(buildSource, /function buildIntradaySeries\(bars\)[\s\S]*?o: tail\.map[\s\S]*?h: tail\.map[\s\S]*?l: tail\.map/);
  assert.match(appJs, /opt-pc-candle-body[\s\S]*?opt-pc-fib-label[\s\S]*?opt-pc-vol-up/);
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
