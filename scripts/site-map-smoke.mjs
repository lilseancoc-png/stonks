// Site map + wayfinding smoke: every page the app can open sits in exactly one
// sidebar section, Owner pages stay in the Owner section only, and the shared
// chart helpers (round axis ticks, sparkline area) behave.
import assert from "node:assert/strict";
import { SITE_SECTIONS, TAB_BAR_SECTIONS, siteMapForClient } from "./render/site-map.mjs";
import { renderAppJs } from "./render/app-js.mjs";

const appJs = renderAppJs({});

function arrayLiteral(name) {
  const m = appJs.match(new RegExp(`var ${name} = (\\[[^\\]]*\\]);`));
  assert.ok(m, `${name} must be declared in app.js`);
  return JSON.parse(m[1].replace(/'/g, '"'));
}
const pageTabs = arrayLiteral("PAGE_TAB_IDS");
const ownerTabs = Object.keys(JSON.parse(appJs.match(/var OWNER_TABS = (\{[^}]*\});/)[1]
  .replace(/'([^']+)'/g, '"$1"').replace(/([{,]\s*)([a-z][a-z-]*)\s*:/g, '$1"$2":')));

const mapIds = SITE_SECTIONS.flatMap((sec) => sec.items.map((it) => it.id));
assert.equal(new Set(mapIds).size, mapIds.length, "A page may appear in only one section");
assert.deepEqual([...mapIds].sort(), [...pageTabs].sort(), "The site map must list every page tab, and nothing else");

const ownerSection = SITE_SECTIONS.find((sec) => sec.owner);
assert.ok(ownerSection, "An Owner section must exist");
assert.deepEqual(ownerSection.items.map((it) => it.id).sort(), [...ownerTabs].sort(), "The Owner section holds exactly the Owner tabs");
for (const sec of SITE_SECTIONS.filter((s) => !s.owner)) {
  for (const it of sec.items) assert.ok(!ownerTabs.includes(it.id), `${it.id} is Owner-only and must not sit in ${sec.id}`);
}
for (const sec of SITE_SECTIONS) {
  assert.ok(sec.label && sec.short && sec.desc, `${sec.id} needs a label, short label and description`);
  for (const it of sec.items) {
    assert.ok(it.label, `${it.id} needs a label`);
    assert.ok(it.blurb && it.blurb.length <= 140, `${it.id} needs a one-line blurb`);
  }
}
for (const id of TAB_BAR_SECTIONS) assert.ok(SITE_SECTIONS.some((s) => s.id === id && !s.owner), `Tab bar section ${id} must be public`);
assert.equal(JSON.parse(appJs.match(/var SITE_MAP = (.*);\n/)[1]).length, siteMapForClient().length);

function helper(name) {
  const a = appJs.indexOf(`  function ${name}(`);
  assert.ok(a >= 0, `${name} must exist`);
  const b = appJs.indexOf("\n  }\n", a) + 4;
  return new Function(`${appJs.slice(a, b)}; return ${name};`)();
}
const niceTicks = helper("niceTicks");
assert.deepEqual(niceTicks(198.4, 237.9, 5), { values: [200, 210, 220, 230], decimals: 0 });
assert.deepEqual(niceTicks(4.31, 4.62, 5).values, [4.4, 4.5, 4.6]);
assert.deepEqual(niceTicks(5, 5, 5).values, []);
for (const [lo, hi] of [[0.013, 0.021], [-3.2, 4.1], [1200, 98000]]) {
  const t = niceTicks(lo, hi, 5);
  assert.ok(t.values.length >= 2 && t.values.length <= 12, `ticks for ${lo}..${hi}`);
  assert.ok(t.values.every((v) => v >= lo - 1e-9 && v <= hi + 1e-9), `ticks stay inside ${lo}..${hi}`);
}
const sparkAreaHtml = helper("sparkAreaHtml");
assert.equal(sparkAreaHtml("0,10 50,4 100,8", 30), '<polygon class="spark-area" points="0,30 0,10 50,4 100,8 100,30"/>');
assert.equal(sparkAreaHtml("5,5", 30), "");

console.log("site map smoke passed");
