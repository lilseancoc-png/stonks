// Local-only preview. Simulates an Owner session; never contacts auth, trading,
// data providers, or the private store. Optional input is an existing close cache.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHistoricalData, packHistoricalData } from '../lib/historical-data.mjs';
import { historicalFixtureBars } from './fixtures/historical-data.mjs';
import { readHistoricalSourceCache } from './collect-historical-sources.mjs';
export async function createHistoricalPreview({ historyFile = null, port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const fixture = historyFile ? null : historicalFixtureBars();
  const history = historyFile ? JSON.parse(await readFile(historyFile, 'utf8')) : { symbols: Object.fromEntries(['SPY', 'QQQ', 'IWM', 'SHY'].map(s => [s, s === 'SHY' ? fixture.map((r,i)=>({...r,c:100+Math.sin(i*.03)*.1})) : fixture])) };
  const sourceCache = historyFile ? await readHistoricalSourceCache(resolve(root, 'data')) : {};
  const payload = buildHistoricalData({ symbols: historyFile ? {} : history.symbols, sourceCache, builtAtIso: historyFile ? new Date().toISOString() : '2026-10-24T22:00:00Z', sourceBuiltAtIso: sourceCache.builtAtIso || null });
  const wire = packHistoricalData(payload);
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  const manifest = { ...shell, symbols: [], narratives: [], deferred: false };
  let scenario = 'owner', requests = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') return json({ error: 'Read-only local preview' }, 405);
    const key = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
    if (url.pathname === '/api/auth/me' && !key) return json({ enabled: scenario !== 'disabled', trackRecord: !['anonymous','tp-only'].includes(scenario), topPicks: !['anonymous','tr-only'].includes(scenario), authenticated: scenario !== 'anonymous', role: 'owner' });
    if (key === 'historical-data.json') {
      requests++;
      if (['anonymous','tp-only','tr-only','disabled'].includes(scenario)) return json({ error: 'Owner role required' }, 401);
      if (scenario === 'error') return json({ error: 'Unavailable fixture' }, 503);
      if (scenario === 'missing') return json({ error: 'Not yet built' }, 404);
      if (scenario === 'malformed') return json({ version: 1, indexes: { SPY: {} } });
      if (scenario === 'empty') return json({ ...wire, indexes: {} });
      if (scenario === 'stale') return json({ ...wire, indexes: Object.fromEntries(Object.entries(wire.indexes).map(([s, i]) => [s, { ...i, ageDays: 9 }])) });
      return json(wire);
    }
    if (key === 'manifest.json' || key === 'manifest-free.json') return json(manifest);
    if (key) return json({});
    if (url.pathname.startsWith('/api/')) return json({ entries: [], items: [] });
    if (url.pathname.startsWith('/_vercel/')) return res.end('');
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + '/')) return json({ error: 'Not found' }, 404);
    try {
      const content = await readFile(path);
      res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png' })[extname(path)] || 'application/octet-stream');
      if (extname(path) === '.html') return res.end(content.toString().replace('<body>', '<body><div style="padding:8px;text-align:center;font:12px system-ui;background:var(--surface-2);color:var(--muted-strong)">Local preview · ' + (historyFile ? 'existing cached market observations' : 'synthetic test data, not market performance') + ' · simulated Owner session</div>'));
      res.end(content);
    } catch { json({ error: 'Not found' }, 404); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port, payload, setScenario(value) { scenario = value; }, get requests() { return requests; } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createHistoricalPreview({ historyFile: process.env.HISTORICAL_HISTORY_FILE || null, port: Number(process.env.HISTORICAL_PREVIEW_PORT || 4187) });
  console.log('Historical Data local preview: ' + preview.base + '/?tab=historical-data');
}
