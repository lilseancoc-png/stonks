// Shared pieces for the browser checks (2026-11-08): a local server that
// serves the committed site with synthetic or failing data, and the page
// checks every browser test runs (no page errors, no raw "undefined" / "NaN"
// text, no sideways scroll). Imported by outage-drill-browser.mjs and
// layout-check-browser.mjs; nothing here contacts a provider, an account or
// the production store.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

// mode.data: Map/object key -> payload | (key) => payload | null (404).
// mode.failData / mode.failApi: every /data and /api request answers 503.
// mode.owner(): whether /api/auth/me reports the Owner session.
export async function startSiteServer(mode = {}) {
  const asks = { data: [], api: [] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (v, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(v)); };
    const dataKey = /^\/(?:api\/)?data\//.test(url.pathname) ? url.pathname.replace(/^\/(?:api\/)?data\//, '') : url.pathname === '/api/auth/me' && url.searchParams.has('data') ? url.searchParams.get('data') : null;
    if (dataKey != null) {
      asks.data.push(dataKey);
      if (mode.failData) return json({ error: 'store unavailable' }, 503);
      const payload = typeof mode.data === 'function' ? await mode.data(dataKey) : mode.data instanceof Map ? mode.data.get(dataKey) : mode.data?.[dataKey];
      return payload == null ? json({ error: 'Not found' }, 404) : json(payload);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) {
      asks.api.push(url.pathname + url.search);
      if (mode.failApi) return json({ error: 'service unavailable' }, 503);
      if (url.pathname === '/api/auth/me') {
        const owner = typeof mode.owner === 'function' ? mode.owner() : !!mode.owner;
        return json(owner ? { enabled: true, authed: true, authenticated: true, trackRecord: true, topPicks: true, user: { name: 'Synthetic owner' } } : { enabled: true, authed: false, authenticated: false });
      }
      if (req.method === 'POST') return json({ error: 'read-only' }, 405);
      return json({});
    }
    // A page with known problems, so a test can prove the checks catch them.
    if (url.pathname === '/__harness-selftest.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Self test</title></head><body style="margin:0"><p>Price: undefined and NaN points for a page that is long enough to count as having text on it for the blank check.</p><div style="width:3000px;height:10px;background:red"></div></body></html>');
    }
    const path = resolve(ROOT, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return json({ error: 'Not found' }, 404);
    try {
      let content = await readFile(path);
      if (extname(path) === '.html') content = content.toString().replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:6px;background:#f4df9b;color:#211a08;text-align:center;font:12px system-ui">Synthetic test data</div>');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(content);
    } catch { json({ error: 'Not found' }, 404); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, asks, close: () => new Promise((r) => server.close(r)) };
}

export async function launchBrowser() {
  const mod = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const chromium = mod.chromium || mod.default?.chromium;
  return chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
}

// Opens one page. Off-origin requests (fonts, CDN) answer empty so the test
// never leaves the machine. Collects page errors and console errors.
export async function openTab(browser, base, { width = 1440, height = 1000, theme = 'light', tab = 'home', extra = '', now = null, offline = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [], consoleErrors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|the server responded with a status/.test(m.text())) consoleErrors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('stonks-theme', t); } catch {} }, theme);
  if (now) await page.clock.install({ time: new Date(now) });
  await page.route('**/*', (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: '' })));
  if (offline) await context.setOffline(true);
  await page.goto(tab === '__selftest' ? base + '/__harness-selftest.html' : base + '/?tab=' + tab + extra, { waitUntil: 'domcontentloaded' });
  return { page, context, errors, consoleErrors, tab };
}

const JUNK_RE = /(^|[\s(>:,])(undefined|NaN|\[object Object\])([\s)<.,]|$)/;

// Structural checks on the open page. Returns a list of problems (empty = ok).
export async function pageProblems({ page, errors, consoleErrors }, { allowOverflow = false } = {}) {
  const problems = [];
  errors.forEach((e) => problems.push('page error: ' + e.split('\n')[0]));
  consoleErrors.forEach((e) => problems.push('console error: ' + e.split('\n')[0]));
  const r = await page.evaluate((junkSource) => {
    const junk = new RegExp(junkSource);
    const out = { overflow: document.documentElement.scrollWidth > innerWidth + 1, junk: [], wide: [], blank: false, brokenImages: 0 };
    const text = document.body.innerText || '';
    out.blank = text.replace(/\s+/g, ' ').trim().length < 80;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && out.junk.length < 5) {
      const v = n.nodeValue;
      if (!v || !junk.test(v)) continue;
      const el = n.parentElement;
      if (!el || ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden]')) continue;
      out.junk.push((el.id ? '#' + el.id : el.tagName.toLowerCase()) + ': ' + v.trim().slice(0, 80));
    }
    const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length && out.wide.length < 5; i++) {
      const el = all[i];
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'svg', 'path'].includes(el.tagName)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right > innerWidth + 2 && rect.left >= 0 && !scrolls(el) && getComputedStyle(el).position !== 'fixed') {
        out.wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '')) + ' right=' + Math.round(rect.right));
      }
    }
    document.querySelectorAll('img[src]').forEach((img) => { if (img.complete && img.naturalWidth === 0 && !/^data:/.test(img.getAttribute('src') || '')) out.brokenImages++; });
    return out;
  }, JUNK_RE.source);
  if (r.overflow && !allowOverflow) problems.push('sideways scroll: page wider than the viewport');
  r.wide.forEach((w) => problems.push('element past the right edge: ' + w));
  r.junk.forEach((j) => problems.push('raw value in text: ' + j));
  if (r.blank) problems.push('page is blank (under 80 characters of text)');
  if (r.brokenImages) problems.push(r.brokenImages + ' broken image(s)');
  return problems;
}

// Proves the checks are not vacuous: the built-in bad page must fail them.
export async function selfTest(browser, base) {
  const s = await openTab(browser, base, { width: 800, tab: '__selftest' });
  const problems = await pageProblems(s);
  await s.context.close();
  const hit = (re) => problems.some((p) => re.test(p));
  if (!hit(/raw value in text/) || !hit(/sideways scroll|past the right edge/)) throw new Error('browser harness self-test failed: ' + JSON.stringify(problems));
}

export async function settle(page, ms = 600) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(ms);
}
