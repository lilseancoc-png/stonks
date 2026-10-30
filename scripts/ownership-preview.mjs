// Read-only local preview. Every ownership figure is a synthetic fixture.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownershipFixture } from './fixtures/ownership.mjs';
import { packOwnershipBooks } from '../lib/ownership-books.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
export async function createOwnershipPreview({ port = 0, snapshotPath = null, gated = false } = {}) {
  let mode = 'full';
  const data = snapshotPath ? JSON.parse(await readFile(snapshotPath, 'utf8')) : ownershipFixture().data;
  const packed = packOwnershipBooks(data, snapshotPath ? 750000 : 6000);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') return json({}, 405);
    if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json({ enabled: gated, authenticated: false });
    const key = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
    if (key === '13f.json') {
      if (mode === 'failure') return json({}, 503);
      if (mode === 'malformed') return json({});
      if (mode === 'legacy') return json({ ...data, perFirm: { Old: { firm: 'Old', topBought: [{ ticker: 'ATLS', valueNow: 100 }] } }, topFirms: [{ firm: 'Old', cik: '9', aumBillions: 5 }] });
      return json(packed.payload);
    }
    if (key && packed.parts.has(key)) {
      if (mode === 'part-failure' || mode === 'source-failure' && key.includes('/disclosures-')) return json({}, 503);
      if (mode === 'corrupt-part') return json({ version: 1, rows: [] });
      return json(JSON.parse(packed.parts.get(key)));
    }
    if (key === 'manifest.json' || key === 'manifest-free.json') return json({ symbols: [], narratives: [], deferred: false });
    if (key || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return json({});
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) return json({}, 404);
    try {
      let body = await readFile(path);
      if (extname(path) === '.html') body = body.toString().replace(/window\.STONKS_MANIFEST=\{.*\};<\/script>/, 'window.STONKS_MANIFEST={"symbols":[],"narratives":[],"deferred":false};</script>');
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { json({}, 404); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { server, base: 'http://127.0.0.1:' + server.address().port, setMode: value => { mode = value; } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createOwnershipPreview({ port: Number(process.env.OWNERSHIP_PREVIEW_PORT || 4187) });
  console.log('Synthetic ownership preview: ' + preview.base + '/?tab=f13');
}
