// Read-only local preview. Defaults to cached data; fixtures are test-only.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patternLabFixture } from './fixtures/pattern-lab.mjs';
import { streaksFixture } from './fixtures/streaks.mjs';

export async function createStreaksPreview({port = 0, fixture = false} = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  const payload = fixture ? streaksFixture() : JSON.parse(await readFile(resolve(root, 'data/streaks.json'), 'utf8'));
  const pattern = fixture ? patternLabFixture() : JSON.parse(await readFile(resolve(root, 'data/pattern-recognition.json'), 'utf8'));
  const sectors = fixture ? Object.fromEntries(payload.tickers.map((t, i) => [t.symbol, i % 2 ? 'Technology' : 'Healthcare'])) : shell.sectors;
  const manifest = {...shell, sectors, symbols: [], narratives: [], deferred: false};
  let scenario = 'normal';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET') return json({error: 'Read-only preview'}, 405);
    const key = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
    if (key === 'pattern-recognition.json') return scenario === 'error' ? json({}, 503) : json(pattern);
    if (key === 'streaks.json') return scenario === 'error' ? json({}, 503) : json(scenario === 'empty' ? {...payload, tickers: []} : payload);
    if (key === 'manifest.json' || key === 'manifest-free.json') return json(manifest);
    if (url.pathname === '/api/auth/me') return json({enabled: false, authenticated: false});
    if (key || url.pathname.startsWith('/api/')) return json({});
    if (url.pathname.startsWith('/_vercel/')) return res.end('');
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return json({}, 404);
    try {
      const body = await readFile(path);
      res.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}[extname(path)] || 'application/octet-stream');
      res.end(extname(path) === '.html' ? body.toString().replace(/window\.STONKS_MANIFEST=\{.*\};<\/script>/,
        'window.STONKS_MANIFEST=' + JSON.stringify(manifest) + ';</script>').replace('<body>', '<body><div style="padding:8px;font:12px system-ui;text-align:center">Local research preview · ' + (fixture ? 'synthetic test data' : 'cached data, not a live market refresh') + '</div>') : body);
    } catch { json({}, 404); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return {server, base: 'http://127.0.0.1:' + server.address().port, payload, setScenario(value) { scenario = value; }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createStreaksPreview({port: Number(process.env.STREAKS_PREVIEW_PORT || 4193), fixture: process.env.STREAKS_PREVIEW_FIXTURE === '1'});
  console.log(preview.base + '/?tab=streaks');
}
