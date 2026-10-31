import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url), files = (await readdir(new URL('lib/research-lab/', root))).filter(f => f.endsWith('.mjs'));
for (const file of files) {
  const source = await readFile(new URL('lib/research-lab/' + file, root), 'utf8');
  assert(!/\bfetch\s*\(|@google\/genai|\bOpenAI\b|@anthropic|generateContent|generateText|lib\/webull|portfolio-review|yahoo-finance/.test(source), 'No AI, provider or broker call from ' + file);
  for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert(m[1].startsWith('./') || m[1].startsWith('node:') || ['../session.mjs', '../streaks.mjs'].includes(m[1]), 'Audited dependency boundary: ' + file + ' -> ' + m[1]);
}
const client = await readFile(new URL('scripts/render/research-lab-client.mjs', root), 'utf8');
assert.equal((client.match(/win\.fetch\(/g) || []).length, 1);
assert(client.includes("win.fetch('/api/auth/me?'"), 'Browser only calls same-origin Lab API');
assert(!/openai\.com|anthropic\.com|generativelanguage\.googleapis|apiKey|api_key/.test(client));
for (const file of await readdir(new URL('.github/workflows/', root))) {
  const workflow = await readFile(new URL('.github/workflows/' + file, root), 'utf8');
  assert(!/research-lab-worker|research-lab-preview/.test(workflow), 'No automatically scheduled Lab workloads');
}
console.log('Research Lab cost/isolation: no AI SDK/call, provider fetch, broker dependency or scheduled workload; one same-origin browser API boundary. CPU/storage remain bounded separately.');
