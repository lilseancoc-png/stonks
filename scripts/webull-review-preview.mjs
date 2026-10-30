// Local-only fixture server. Does not contact Webull, authenticate a real user,
// read credentials, or change the production application's access controls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webullReviewFixture } from './fixtures/webull-review.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(['standard', 'edge', 'empty', 'open', 'retry', 'execution']);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
export async function createWebullPreview({ port = 0, fixtureTime = Date.now() } = {}) {
let retryRequests = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const requestedCase = url.searchParams.get('previewCase') || new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('previewCase');
  const previewCase = cases.has(requestedCase) ? requestedCase : 'standard';
  const fixture = webullReviewFixture(fixtureTime, previewCase);
  res.setHeader('Cache-Control', 'no-store');
  function json(value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
  if (req.method !== 'GET') return json({ error: 'Read-only synthetic preview' }, 405);
  if (url.pathname === '/api/auth/me' && !url.searchParams.has('data')) return json({ enabled: true, trackRecord: true, topPicks: true, authenticated: true, user: { name: 'Synthetic preview' } });
  if (url.pathname === '/api/auth/webull-mirror') {
    if (previewCase === 'retry' && retryRequests++ === 0) return json({ error: 'Synthetic one-time load failure' }, 503);
    if (url.searchParams.get('format') === 'orders') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="synthetic-webull-orders.csv"' }); return res.end(fixture.ordersCsv || 'trade_id,phase,attempt\n'); }
    if (url.searchParams.get('format') === 'csv') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="synthetic-webull-trades.csv"' }); return res.end(fixture.csv || 'trade_id,symbol,state,paper_pnl_pct\n' + fixture.mirror.trades.map(t => [t.tradeId, t.symbol, t.state, t.paperPnlPct ?? ''].join(',')).join('\n')); }
    return json(fixture.mirror);
  }
  if (url.pathname === '/api/auth/picks-fills') return json({ rows: [] });
  if (url.pathname === '/api/auth/track-record-data') {
    if (url.searchParams.get('key') === 'picks-accuracy.json') return json(fixture.accuracy);
    return json({});
  }
  const dataKey = url.pathname === '/api/auth/me' ? url.searchParams.get('data') : url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null;
  if (dataKey) {
    if (dataKey === 'picks-accuracy.json') return json(fixture.accuracy);
    if (dataKey === 'manifest.json' || dataKey === 'manifest-free.json') return json({ symbols: [], narratives: [] });
    if (dataKey === 'picks-changes.json') return json({ events: [] });
    if (dataKey === 'picks-roster.json') return json({ current: [], dropped: [] });
    return json({});
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) return json({});
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) return json({ error: 'Not found' }, 404);
  try {
    let content = await readFile(path);
    if (extname(path) === '.html') content = content.toString().replace('<body>', '<body><div style="position:fixed;bottom:0;left:0;right:0;z-index:99999;padding:8px;background:#f4df9b;color:#211a08;text-align:center;font:12px system-ui">Synthetic test data · ' + previewCase + ' case · No broker connection</div>');
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(content);
  } catch { json({ error: 'Not found' }, 404); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
return { server, base: 'http://127.0.0.1:' + server.address().port };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { base } = await createWebullPreview({ port: Number(process.env.WEBULL_PREVIEW_PORT || 4178) });
  console.log('Synthetic Webull preview: ' + base + '/?tab=track');
}
