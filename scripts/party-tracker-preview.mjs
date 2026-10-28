// Local preview. Simulates an Owner session and never contacts auth or the store.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPartyTracker, nextDay, partyOn, PRESIDENT_CONTROL } from '../lib/party-tracker.mjs';

function fixtureBars() {
  const end = '2026-10-27';
  const out = [];
  let price = 100;
  for (let t = '2001-01-19'; t <= end; t = nextDay(t)) {
    price *= partyOn(PRESIDENT_CONTROL, t)?.party === 'D' ? 1.0004 : 1.0002;
    out.push({ t, v: Math.round(price * 1000) / 1000 });
  }
  return out;
}

export async function createPartyPreview({ port = 0, payload = null } = {}) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const bars = fixtureBars();
  const synthetic = !payload;
  const body = payload || buildPartyTracker({
    series: { SPY: bars, QQQ: bars, DIA: bars, IWM: bars, XLK: bars, XLF: bars, XLV: bars, XLE: bars, XLI: bars, XLY: bars, XLP: bars, XLB: bars, XLU: bars },
    builtAtIso: '2026-10-28T12:00:00.000Z',
  });
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*?\});<\/script>/s)[1]);
  const manifest = { ...shell, symbols: [], narratives: [], deferred: false };
  let scenario = 'owner';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') return json({ error: 'Read-only local preview' }, 405);
    const key = url.searchParams.get('data');
    if (url.pathname === '/api/auth/me' && !key) {
      const open = !['anonymous', 'tp-only', 'tr-only', 'disabled'].includes(scenario);
      return json({ enabled: scenario !== 'disabled', trackRecord: open, topPicks: open, authenticated: scenario !== 'anonymous' });
    }
    if (key === 'party-tracker.json') {
      if (['anonymous', 'tp-only', 'tr-only', 'disabled'].includes(scenario)) return json({ error: 'Owner role required' }, 401);
      return json(body);
    }
    if (key === 'manifest.json' || key === 'manifest-free.json') return json(manifest);
    if (key) return json({});
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return json({ entries: [], items: [] });
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + '/')) return json({ error: 'Not found' }, 404);
    try {
      const content = await readFile(path);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[extname(path)] || 'application/octet-stream');
      if (extname(path) === '.html') {
        const banner = synthetic ? 'synthetic party-tracker prices, not live market performance' : 'Yahoo adjusted closes through ' + body.asOf;
        return res.end(content.toString().replace('<body>', '<body><div style="padding:8px;text-align:center;font:12px system-ui;background:var(--surface-2);color:var(--muted-strong)">Local preview · ' + banner + ' · simulated Owner session</div>'));
      }
      res.end(content);
    } catch { json({ error: 'Not found' }, 404); }
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return { server, base: 'http://127.0.0.1:' + server.address().port, payload: body, setScenario(value) { scenario = value; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.env.PARTY_TRACKER_FILE;
  const payload = file ? JSON.parse(await readFile(file, 'utf8')) : null;
  const preview = await createPartyPreview({ port: Number(process.env.PARTY_PREVIEW_PORT || 4188), payload });
  console.log('Party tracker local preview: ' + preview.base + '/?tab=party-tracker');
}
