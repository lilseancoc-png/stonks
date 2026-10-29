// Offline browser-asset regeneration. Preserve the published research snapshot
// and embedded risk-free-rate provenance instead of running a new data bake.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';

const root = new URL('../', import.meta.url);
const [oldApp, oldCss, original] = await Promise.all(['app.js', 'styles.css', 'index.html'].map(f => readFile(new URL(f, root), 'utf8')));
const rate = oldApp.match(/var RFR = ([^;]+);/)?.[1], meta = oldApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta && Number.isFinite(Number(rate)), 'existing rate provenance required');
function replaceSection(current, rendered, first, last) {
  const start = current.indexOf(first), end = current.indexOf(last, start);
  const renderedStart = rendered.indexOf(first), renderedEnd = rendered.indexOf(last, renderedStart);
  assert(start >= 0 && end > start && renderedStart >= 0 && renderedEnd > renderedStart, 'Webull section markers required');
  return current.slice(0, start) + rendered.slice(renderedStart, renderedEnd) + current.slice(end);
}
const rendered = renderAppJs({ riskFreeRate: Number(rate), riskFreeRateMeta: JSON.parse(meta) });
const app = replaceSection(oldApp, rendered, '  var wbTest = ', '  // --- Per-pick "Strategy & entry details"');
new vm.Script(app);
const css = replaceSection(oldCss, renderStylesCss(), '.wb-diag {', '.acc-eq-area.up {');
let html = original;
for (const [name, content] of [['app.js', app], ['styles.css', css]]) {
  const pattern = new RegExp('(' + name.replace('.', '\\.') + '\\?v=)[^"\\s]+', 'g');
  assert(pattern.test(html), name + ' must already be linked');
  html = html.replace(pattern, '$1' + contentAssetVersion(content));
}
assert.equal(html.replace(/(?:app\.js|styles\.css)\?v=[^"\s]+/g, 'ASSET'), original.replace(/(?:app\.js|styles\.css)\?v=[^"\s]+/g, 'ASSET'));
await writeFile(new URL('app.js', root), app);
await writeFile(new URL('styles.css', root), css);
await writeFile(new URL('index.html', root), html);
console.log('Regenerated Webull browser assets; published data and rate provenance preserved.');
