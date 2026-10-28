// Export menu smoke (no browser): the button is Owner-only, sits beside the
// split-view and light / dark switches, its picture tool is vendored, and
// every page it names a data file for is a real, non-guide page.
// Run: node scripts/export-smoke.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SITE_SECTIONS } from "./render/site-map.mjs";
import { EXPORT_IMAGE_LIB, EXPORT_SOURCES } from "./render/export-js.mjs";
import { renderAppJs } from "./render/app-js.mjs";
import { renderStylesCss } from "./render/styles-css.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const indexHtml = read("index.html");
const htmlSrc = read("scripts/render/html.mjs");
const appJs = renderAppJs({});
const css = renderStylesCss();

for (const [name, html] of [["index.html", indexHtml], ["html.mjs", htmlSrc]]) {
  const btn = html.match(/<button id="export-toggle"[^>]*>/);
  assert.ok(btn, `${name}: Export button must exist`);
  assert.match(btn[0], /\shidden[\s>]/, `${name}: Export button starts hidden (Owner-only)`);
  assert.match(html, /id="export-toggle"[\s\S]{0,1400}id="split-toggle"[\s\S]{0,700}id="theme-toggle"/, `${name}: Export sits next to split view and the theme switch`);
}

// Client gate: shown only for the combined Owner session, never in a split pane.
assert.match(appJs, /exportBtn\.hidden = !HAS_OWNER_ACCESS \|\| IS_EMBED;/, "applyAuth must hide Export unless Owner");
assert.match(appJs, /function exportOwner\(\)\{ return HAS_OWNER_ACCESS && !IS_EMBED; \}/, "Every export action re-checks Owner access");
assert.ok((appJs.match(/if \(!exportOwner\(\)/g) || []).length >= 3, "open, run and source download each check Owner access");
// Source downloads read through dataUrl, i.e. the same server-side Owner gate.
assert.match(appJs, /fetch\(dataUrl\(key\)/, "Source data must be read through dataUrl");
// The old per-page CSV buttons share the row builders with the menu.
for (const fn of ["picksExportRows", "flowExportRows", "calendarExportRows"]) {
  assert.match(appJs, new RegExp(`function ${fn}\\(\\)\\{`), `${fn} must exist`);
}

// Picture tool: vendored from npm, served from this site (CSP 'self').
assert.ok(existsSync(new URL(EXPORT_IMAGE_LIB, root)), "vendored html-to-image must be committed");
assert.match(read(EXPORT_IMAGE_LIB), /^\/\*! html-to-image 1\.11\.11 \| MIT License/, "vendored file keeps its license header");
assert.ok(appJs.includes(`s.src = '${EXPORT_IMAGE_LIB}'`), "app.js loads the vendored picture tool");
const csp = JSON.parse(read("vercel.json")).headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy").value;
const connect = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src"));
assert.match(connect, /https:\/\/fonts\.googleapis\.com/, "pictures inline the site fonts (CSS)");
assert.match(connect, /https:\/\/fonts\.gstatic\.com/, "pictures inline the site fonts (files)");

// Every page with source data is a real page, and none is a guide.
const pageSection = new Map(SITE_SECTIONS.flatMap((s) => s.items.map((it) => [it.id, s.id])));
for (const [tab, keys] of Object.entries(EXPORT_SOURCES)) {
  assert.ok(pageSection.has(tab), `EXPORT_SOURCES names unknown page ${tab}`);
  assert.notEqual(pageSection.get(tab), "learn", `${tab} is a guide page`);
  assert.ok(Array.isArray(keys) && keys.length, `${tab} needs at least one data file`);
  for (const k of keys) assert.match(k, /^[a-z0-9-]+\.json$/, `${tab}: ${k} must be a top-level data file`);
}
assert.ok(EXPORT_SOURCES.picks.includes("picks.json") && EXPORT_SOURCES.track.includes("picks-accuracy.json"), "Top picks and the track record export their own files");

// Site-only controls (watch buttons, the Recommendation / Grade switch) stay out of pictures.
assert.match(appJs, /\.pick-watch-btn, \.pick-tabs/, "pictures hide the detail card's watchlist button and view switch");
assert.match(appJs, /cellStyle name="Normal"/, "Excel file carries the Normal cell style");

// Styles: hidden stays hidden, the print layout prints only the chosen part.
assert.match(css, /#export-toggle\[hidden\] \{ display: none; \}/);
assert.match(css, /\.acc-audit-actions \{[^}]*--flow-decision-tone:/, "Track record's primary button has a colour to draw with");
assert.match(css, /@media print \{[\s\S]*html\.exporting-print body \*:not\(\.export-print-path\)/);
console.log("export smoke: ok");
