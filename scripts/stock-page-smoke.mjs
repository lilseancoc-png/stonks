// Smoke test for the public stock page and the shared chart kit.
// Pure: renders the page shell, app.js and the site map, no browser or network.
// Run: node scripts/stock-page-smoke.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SITE_SECTIONS } from "./render/site-map.mjs";
import { OWNER_PAGE_IDS } from "../lib/owner-access-policy.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { CHART_LIB } from "./render/chart-kit-js.mjs";

// The stock page is public and sits in the Stocks section.
const stocks = SITE_SECTIONS.find((s) => s.id === "stocks");
assert.ok(stocks.items.some((i) => i.id === "stock"), "Stocks section lists the stock page");
assert.ok(!OWNER_PAGE_IDS.includes("stock"), "the stock page is public");

// The chart library is vendored under js/ (the CSP allows only self and
// jsdelivr for scripts), with its licence beside it.
assert.ok(CHART_LIB.startsWith("js/vendor/"), "chart library is served from this site");
assert.ok(existsSync(new URL("../" + CHART_LIB, import.meta.url)), "vendored chart library exists");
assert.ok(existsSync(new URL("../js/vendor/lightweight-charts-4.2.3.LICENSE.txt", import.meta.url)), "chart library licence is shipped");
const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
assert.match(vercel, /script-src 'self'/, "CSP still allows same-origin scripts");

// app.js wires the page, the kit, the tab and public stock links.
const app = renderAppJs({ riskFreeRate: 0.04 });
assert.match(app, /var CHART_KIT = \(function\(\)\{/);
assert.match(app, /var STOCK_PAGE = \(function\(\)\{/);
assert.match(app, /var PAGE_TAB_IDS = \[[^\]]*'stock'/, "stock is a page tab");
assert.match(app, /if \(name === 'stock'\) STOCK_PAGE\.load\(\);/, "opening the tab loads the page");
assert.match(app, /if \(!HAS_OWNER_ACCESS\) return STOCK_PAGE\.href\(sym\);/, "public stock links point at the stock page");
assert.match(app, /else if \(params\.get\('s'\)\) tab = \(HAS_OWNER_ACCESS && validList\.indexOf\('grade'\) >= 0\) \? 'grade' : 'stock';/, "?s= opens the stock page for the public");
// The Owner tab reads Owner-only files only behind the Owner check.
const ownerTab = app.slice(app.indexOf("function tabOwner()"), app.indexOf("// --- events", app.indexOf("function tabOwner()")));
assert.match(ownerTab, /if \(!HAS_OWNER_ACCESS\) return '';/);
assert.ok(ownerTab.indexOf("picks-accuracy.json") > ownerTab.indexOf("HAS_OWNER_ACCESS"), "picks-accuracy.json is fetched after the Owner check");
// The grade tool is the stock page's Grade tab for Owners only; old Grade links redirect.
assert.match(app, /if \(HAS_OWNER_ACCESS\)\{ list\.splice\(1, 0, \['grade', 'Grade'\]\); list\.push\(\['owner', 'Top Picks trades'\]\); \}/);
assert.match(app, /function mountGrade\(body\)\{[\s\S]*?if \(!sec \|\| !HAS_OWNER_ACCESS\)/, "the grade only mounts for Owners");
assert.match(app, /if \(name === 'grade'\)\{\s*if \(HAS_OWNER_ACCESS && typeof STOCK_PAGE !== 'undefined'\) STOCK_PAGE\.showTab\('grade', true\);\s*name = 'stock';/, "old Grade links open the stock page");
assert.match(app, /function render\(root\)\{[\s\S]*?parkGrade\(\);\s*root\.innerHTML/, "the grade tool is parked before the page re-renders");
// Generated script parses.
new Function(app);
console.log("stock-page-smoke: ok");
