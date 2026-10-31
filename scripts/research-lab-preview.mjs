// Local-only synthetic preview: actual Lab API, storage contracts and worker.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleResearchRequest } from '../lib/research-lab/http.mjs';
import { createLabRepository } from '../lib/research-lab/repository.mjs';
import { fixtureSnapshot, memoryStore, sourceFiles, FIXTURE_NOW } from './fixtures/research-lab.mjs';

export async function createResearchLabPreview({ port = 0 } = {}) {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url))), html = await readFile(resolve(root, 'index.html'), 'utf8');
  const shell = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
  const store = memoryStore(sourceFiles(fixtureSnapshot())), session = { sub: 'fixture-owner', tr: true, tp: true };
  store.objects.set('market-analysis.json', Buffer.from(JSON.stringify({ builtAtIso: FIXTURE_NOW, macroRegime: { state: 'risk-off', score: 61, fragile: true }, secret: 'DO_NOT_EXPORT_FIXTURE' })));
  const env = { PRIVATE_DATA_ENABLED: '1', RESEARCH_LAB_ENABLED: '1', RESEARCH_LAB_OWNER_IDS: session.sub };
  let scenario = 'owner', labRequests = 0;
  const repo = createLabRepository({ store, owner: session.sub, clock: () => FIXTURE_NOW });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const owner = !['anonymous', 'partial', 'foreign'].includes(scenario);
    const enabled = scenario !== 'disabled';
    if (url.pathname === '/api/auth/me' && url.searchParams.has('lab')) {
      labRequests++;
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 170000) return json({ error: 'Body limit' }, 413); chunks.push(chunk); }
      let body; try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined; } catch { return json({ error: 'JSON required' }, 400); }
      res.status = n => { res.statusCode = n; return res; }; res.json = v => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); return res; };
      if (scenario === 'slow' && url.searchParams.get('lab') === 'advance') await new Promise(r => setTimeout(r, 250));
      return handleResearchRequest({ method: req.method, query: Object.fromEntries(url.searchParams), body, headers: { ...req.headers, 'x-forwarded-proto': 'http' } }, res,
        { store, env: { ...env, RESEARCH_LAB_ENABLED: enabled ? '1' : '0' }, getSession: async () => scenario === 'anonymous' ? null : scenario === 'partial' ? { ...session, tp: false } : scenario === 'foreign' ? { ...session, sub: 'foreign-owner' } : session, clock: () => FIXTURE_NOW });
    }
    const key = url.searchParams.get('data') || (url.pathname.startsWith('/data/') ? url.pathname.slice(6) : null);
    if (url.pathname === '/api/auth/me' && !key) return json({ enabled: true, authed: owner, trackRecord: owner || scenario === 'partial', topPicks: owner, sub: owner ? session.sub : null, name: 'Synthetic fixture owner', researchLab: owner && enabled });
    if (key === 'manifest.json' || key === 'manifest-free.json') return json({ ...shell, symbols: [], narratives: [], deferred: false });
    if (key || url.pathname.startsWith('/api/')) return json({});
    if (url.pathname.startsWith('/_vercel/')) return res.end('');
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + '/')) return json({ error: 'Not found' }, 404);
    try {
      const bytes = await readFile(path); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
      if (extname(path) === '.html') return res.end(bytes.toString().replace('<body>', '<body><div style="padding:7px;text-align:center;font:11px system-ui;background:#edf2ef;color:#354c3e">LOCAL FIXTURE · fictional prices and returns · simulated owner · no remote services</div>'));
      res.end(bytes);
    } catch { return json({ error: 'Not found' }, 404); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { server, base: 'http://127.0.0.1:' + server.address().port, repo, store, setScenario(value) { scenario = value; }, get requests() { return labRequests; } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await createResearchLabPreview({ port: Number(process.env.RESEARCH_LAB_PREVIEW_PORT || 4209) });
  console.log('Research Lab fictional-data preview: ' + preview.base + '/?tab=research-lab');
}
