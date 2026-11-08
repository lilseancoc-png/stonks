// Lists every English string the site shows, in the exact form the browser
// translator looks up (scripts/render/i18n-client.mjs), and writes them to
// i18n/source-strings.json. Run after rendering index.html / app.js, then
// translate the new keys and rebuild with scripts/i18n-build.mjs.
//
//   node scripts/i18n-collect.mjs            # all three passes
//   node scripts/i18n-collect.mjs --report   # also print keys missing per language
//
// Passes: (1) the static page with app.js held back, so every pane's markup
// is read before the app removes Owner panes; (2) each page opened with
// app.js running (a stand-in Owner session, no market data), so empty and
// error states and other app-drawn labels are read; (3) HTML fragments and
// label-like literals in app.js, read the same way. No network, no AI.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { i18nRuntime, I18N_LANGS, I18N_STORAGE_KEY } from './render/i18n-client.mjs';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { TICKERS } from './build.mjs';

const TICKER_RE = new RegExp('\\b(?:' + TICKERS.map(String).filter((t) => t.length > 1).map((t) => t.replace(/[.^]/g, '\\$&')).join('|') + ')\\b');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const OWNER = { enabled: true, authed: true, trackRecord: true, topPicks: true, researchLab: true, sub: 'collector' };

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/auth/me' && !url.searchParams.toString()) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(OWNER));
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) { res.writeHead(404); return res.end(); }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      const body = await readFile(resolve(ROOT, '.' + decodeURIComponent(path)));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

const runtimeSrc = `(${i18nRuntime.toString()})(window, document, { langs: ${JSON.stringify(I18N_LANGS.map((l) => l.code))}, storageKey: '${I18N_STORAGE_KEY}', base: 'i18n/', lang: 'en' });`;

// Literals in app.js that hold markup or read like a label or sentence.
function appLiterals(src) {
  const out = new Set();
  const re = /'((?:[^'\\\n]|\\.){2,})'|"((?:[^"\\\n]|\\.){2,})"|`([^`$\\]{2,})`/g;
  let m;
  while ((m = re.exec(src))) {
    let s = m[1] ?? m[2] ?? m[3];
    s = s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (/<[a-z][^>]*>[^<]*[A-Za-z]{2}/i.test(s)) { out.add(JSON.stringify(['html', s])); continue; }
    if (/[<>{}=;]|^\s*[.#\[]|\b(?:var|function|return)\b|https?:|\/\//.test(s)) continue;
    // Plain text: capitalised words or a sentence, never a class name or key.
    if (!/^[A-Z][a-z]/.test(s.trim()) && !/^[a-z]+(?: [a-z']+){2,}[.!?…]?$/.test(s.trim())) continue;
    if (/^[\w-]+$/.test(s) && /[-_]/.test(s)) continue;
    out.add(JSON.stringify(['text', s]));
  }
  return [...out].map((x) => JSON.parse(x));
}

// A literal that is only part of a sentence the app joins at run time
// ("Names are grouped by sector and") never matches what the page shows.
function looksWhole(k, strict) {
  if (/^[,.;:)\]!?%]/.test(k)) return false;
  if (strict && !/^[A-Z0-9"“‘'(\[$<{#~±+\-–—•·①-⑳←→✓☆○]/.test(k)) return false;
  if (/(?:\b(?:and|or|the|of|to|a|an|in|for|with|from|by|at|on|is|are|than|vs\.?)|[,(:;—–\-·/+])$/.test(k)) return false;
  // Ticker symbols and per-ticker labels ("Add NVDA to Compare") stay as is.
  if (/^(?:<\d+><\/\d+>)?[A-Z^.]{1,6}$/.test(k) || TICKER_RE.test(k)) return false;
  return true;
}

async function main() {
  const report = process.argv.includes('--report');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const all = new Map();
  const add = (list, src) => { for (const [k] of list) if (!all.has(k) && looksWhole(k, src === 'app.js')) all.set(k, src); };

  // Pass 1: the static markup.
  {
    const page = await browser.newPage();
    await page.route('**/app.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.route('**/js/*.js*', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: runtimeSrc });
    add(await page.evaluate(() => {
      const list = window.__stonksI18n.scan(document.body);
      return list.concat(window.__stonksI18n.scan(document.querySelector('title')));
    }), 'static');
    await page.close();
  }
  const afterStatic = all.size;

  // Pass 2: every page with the app running.
  const tabs = SITE_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  for (const tab of tabs) {
    try {
      await page.goto(`${base}/?tab=${encodeURIComponent(tab)}`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(1200);
      add(await page.evaluate(() => window.__stonksI18n ? window.__stonksI18n.scan(document.body) : []), 'app:' + tab);
    } catch (e) { console.warn('skip', tab, e.message); }
  }
  const afterApp = all.size;

  // Pass 3: fragments and labels written in app.js.
  const lits = appLiterals(await readFile(resolve(ROOT, 'app.js'), 'utf8'));
  add(await page.evaluate((items) => {
    let out = [];
    for (const [kind, s] of items) {
      const div = document.createElement('div');
      if (kind === 'html') div.innerHTML = s; else div.textContent = s;
      out = window.__stonksI18n.scan(div);
    }
    return out;
  }, lits), 'app.js');
  await browser.close();
  server.close();

  const keys = [...all.keys()].sort((a, b) => a.localeCompare(b));
  await writeFile(resolve(ROOT, 'i18n', 'source-origins.json'), JSON.stringify(Object.fromEntries(keys.map((k) => [k, all.get(k)])), null, 0).replace(/","/g, '",\n"') + '\n');
  await writeFile(resolve(ROOT, 'i18n', 'source-strings.json'), JSON.stringify(keys, null, 0).replace(/","/g, '",\n"') + '\n');
  console.log(`${keys.length} strings (static ${afterStatic}, app pages +${afterApp - afterStatic}, app.js literals +${keys.length - afterApp}).`);
  if (report) {
    for (const l of I18N_LANGS) {
      if (l.code === 'en') continue;
      let have = {};
      try { have = JSON.parse(await readFile(resolve(ROOT, 'i18n', l.code + '.json'), 'utf8')).strings || {}; } catch {}
      const missing = keys.filter((k) => !(k in have));
      console.log(`${l.code}: ${keys.length - missing.length}/${keys.length} translated`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
