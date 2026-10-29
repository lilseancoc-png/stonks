// Regenerate only the Track Record controls, preserving published research,
// data timestamps and the embedded risk-free-rate provenance. No network.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderAppJs } from './render/app-js.mjs';
import { renderStylesCss } from './render/styles-css.mjs';
import { trackRecordSection } from './render/html.mjs';
import { contentAssetVersion } from '../lib/asset-version.mjs';

const root = new URL('../', import.meta.url);
const [oldApp, oldCss, oldHtml] = await Promise.all(['app.js', 'styles.css', 'index.html'].map(f => readFile(new URL(f, root), 'utf8')));
const rate = oldApp.match(/var RFR = ([^;]+);/)?.[1], meta = oldApp.match(/var RFR_META = ([^;]+);/)?.[1];
assert(rate && meta, 'existing rate provenance required');
const rendered = renderAppJs({ riskFreeRate: Number(rate), riskFreeRateMeta: JSON.parse(meta) });
function section(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert(first >= 0 && last > first, 'Track Record markers required');
  return text.slice(first, last);
}
const app = rendered;
new vm.Script(app);
const cssBlock = section(renderStylesCss(), '/* Track Record resets */', '.wb-diag {');
const css = oldCss.replace(/\/\* Track Record resets \*\/[\s\S]*?(?=\.wb-diag \{)/, '').replace('.wb-diag {', cssBlock + '.wb-diag {');
const record = oldHtml.match(/<section class="card" id="accuracy-section">[\s\S]*?<\/section>/)?.[0];
assert(record, 'existing Track Record section required');
let html = oldHtml.replace(record, trackRecordSection());
for (const [name, content] of [['app.js', app], ['styles.css', css]]) {
  html = html.replace(new RegExp('(' + name.replace('.', '\\.') + '\\?v=)[^"\\s]+', 'g'), '$1' + contentAssetVersion(content));
}
await Promise.all([['app.js', app], ['styles.css', css], ['index.html', html]].map(([name, content]) => writeFile(new URL(name, root), content)));
console.log('Regenerated Track Record controls; research data and rate provenance preserved.');
