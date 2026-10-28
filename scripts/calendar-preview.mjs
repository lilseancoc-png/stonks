// Read-only local preview. All event data is synthetic and labeled in the UI.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCalendarPayload } from './build.mjs';

export async function createCalendarPreview({ port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const now = new Date().toISOString(), today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const payload = buildCalendarPayload({
    AAPL: { fundamentals: { nextEarningsDate: today, nextEarningsSession: 'PM' }, catalysts: [{
      date: today, title: 'Synthetic developer event', category: 'launch', evidenceVersion: 2,
      dateEvidence: 'Synthetic dated event for browser validation', sourceTitle: 'Synthetic announcement',
      sourceUrl: 'https://example.com/calendar-test', sourcePublishedAt: now,
    }] },
  }, [{ title: 'Synthetic macro announcement', publisher: 'Macro feed', publishedAt: now }], now, {
    reportEvents: [{ type: 'report', subtype: 'test-claims', title: 'Synthetic unemployment claims', date: today, time: '08:30 ET', source: 'ForexFactory', consensus: '200K', sourceKey: 'forex-factory' }],
    fomcMeetings: [{ date: today, label: 'Synthetic FOMC meeting' }],
    officialCalendar: { status: { bls: false, bea: true, 'census-2026': true }, events: [] },
  });
  // Deliberately injected legacy rows prove the browser rejects removed names
  // even before a new calendar snapshot has been published.
  payload.events.push({ type: 'earnings', date: today, symbol: 'RDDT', title: 'RDDT earnings' });
  let scenario = 'normal';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') return json({ error: 'Read-only preview' }, 405);
    if (url.pathname === '/api/auth/me') return json({ enabled: false, authenticated: false });
    const key = url.searchParams.get('data') || (/^\/(?:api\/)?data\//.test(url.pathname) ? url.pathname.replace(/^\/(?:api\/)?data\//, '') : null);
    if (key === 'calendar.json') {
      if (scenario === 'error') return json({ error: 'Synthetic outage' }, 503);
      if (scenario === 'stale') return json({ ...payload, builtAtIso: '2026-01-01T00:00:00Z' });
      return json(payload);
    }
    if (key) return json({});
    if (url.pathname.startsWith('/api/')) return json({});
    if (url.pathname.startsWith('/_vercel/')) return res.end('');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html','app.js','styles.css','favicon.svg','js/streaks.js','js/book-views.js'].includes(relative)) return json({ error: 'Not found' }, 404);
    try {
      let body = await readFile(resolve(root, relative));
      if (relative === 'index.html') body = Buffer.from(body.toString().replace('<body>', '<body><p style="padding:8px;text-align:center">Calendar preview · synthetic test events</p>'));
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(relative)] || 'application/octet-stream');
      res.end(body);
    } catch { json({ error: 'Not found' }, 404); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, base: 'http://127.0.0.1:' + server.address().port, payload, setScenario(value) { scenario = value; } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createCalendarPreview({ port: 4198 });
  console.log('Synthetic calendar preview: ' + preview.base + '/?tab=calendar');
}
