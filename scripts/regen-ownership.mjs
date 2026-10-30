// Offline regeneration limited to ownership UI and cache keys. Preserve other
// work in this shared checkout, research data, timestamps and rate provenance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderAppJs } from './render/app-js.mjs';
import { renderOwnershipExplorerCss } from './render/ownership-explorer-css.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';

const root = new URL('../', import.meta.url);
const [originalApp, originalCss, originalHtml] = await Promise.all(['app.js', 'styles.css', 'index.html'].map(f => readFile(new URL(f, root), 'utf8')));
const rate = originalApp.match(/var RFR = ([^;]+);/)?.[1], meta = originalApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta, 'existing rate provenance required');
const rendered = renderAppJs({ riskFreeRate: Number(rate), riskFreeRateMeta: JSON.parse(meta) });
const first = '  // --- 13F filings tab ', last = '  // --- Fear & Greed tab ';
function section(text) {
  const start = text.indexOf(first), end = text.indexOf(last, start);
  assert(start >= 0 && end > start, 'ownership section markers required');
  return text.slice(start, end);
}
const app = originalApp.replace(section(originalApp), () => section(rendered));
new vm.Script(app);
const css = renderOwnershipExplorerCss() + originalCss.replace(/\/\* Ownership explorer \*\/[\s\S]*?\/\* End ownership explorer \*\/\n/, '');
let html = originalHtml.replace('<h2 class="card-title">SEC ownership filings</h2>', '<h2 class="card-title">Who owns what</h2>');
for (const [name, body] of [['app.js', app], ['styles.css', css]]) {
  html = html.replace(new RegExp('(' + name.replace('.', '\\.') + '\\?v=)[^"\\s]+', 'g'), '$1' + contentAssetVersion(body));
}
for (const [name, body] of [['app.js', app], ['styles.css', css], ['index.html', html]]) await writeFile(new URL(name, root), body);
console.log('Regenerated ownership UI. Research data, timestamps and other page sections preserved.');
