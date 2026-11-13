// Manual audit: run the Leadership collector against the live SEC for a few
// symbols and print what it found. No store access; writes only to --out.
//   node scripts/corporate-structure-live.mjs AAPL META GOOGL [--ai] [--out=dir] [--requests=600]
// --ai reads each proxy / 20-F with Gemini Flash-Lite (needs GEMINI_API_KEY;
// about one cent per document).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { refreshCorporateStructure } from '../lib/corporate-structure/collector.mjs';
import { buildCorporateViews } from '../lib/corporate-structure/assemble.mjs';

const args = process.argv.slice(2);
const symbols = args.filter((a) => !a.startsWith('--')).map((s) => s.toUpperCase());
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const useAi = args.includes('--ai');
const out = resolve(opt('out', 'out/corporate-live'));
const ua = process.env.SEC_USER_AGENT || 'Mingstreet holdings research https://mingstreet.app';
if (!symbols.length) { console.error('usage: node scripts/corporate-structure-live.mjs SYM [SYM…] [--ai]'); process.exit(2); }

const tick = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'user-agent': ua } })).json();
const cikMap = new Map(Object.values(tick).map((v) => [String(v.ticker).toUpperCase(), String(v.cik_str).padStart(10, '0')]));
let prior = null;
try { prior = JSON.parse(await readFile(resolve(out, 'state.json'), 'utf8')); } catch {}
const usage = [];
let deps = null;
if (useAi) {
  const { GoogleGenAI } = await import('@google/genai');
  deps = { GoogleGenAI, apiKey: process.env.GEMINI_API_KEY, recordAiUsage: (u) => usage.push(u), maxAttempts: 2 };
}
const t0 = Date.now();
const state = await refreshCorporateStructure({
  prior, universe: symbols, cikMap, userAgent: ua, gapMs: 140,
  maxRequests: Number(opt('requests', 600)), deadlineMs: Number(opt('seconds', 420)) * 1000, dailyRequests: 1e6, dailyBytes: 2e9,
  maxAi: symbols.length, dailyAi: 100,
  ai: useAi ? { enabled: !!process.env.GEMINI_API_KEY, model: process.env.AI_CORP_MODEL || 'gemini-3.1-flash-lite', deps } : null,
  log: (l) => console.log(l),
  // --debug-doc=TSM prints where the 20-F / proxy slice starts (layout checks).
  onDocText: (sym, text, fullLen) => { console.log(`doc ${sym}: ${fullLen} chars → slice ${text.length}`); if (opt('debug-doc', '').split(',').includes(sym)) console.log(`--- ${sym} slice head ---\n${text.slice(0, 1500)}\n--- end ---`); },
});
// Prices for the stake values: Yahoo's chart endpoint, best effort.
const prices = {};
for (const s of symbols) {
  try { const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1d&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0' } })).json(); prices[s] = j?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null; } catch {}
}
const views = buildCorporateViews(state, { prices, onError: (sym, err) => console.log(`VIEW ERROR ${sym}: ${err?.stack || err}`) });
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'state.json'), JSON.stringify(state));
await writeFile(resolve(out, 'views.json'), JSON.stringify(views, null, 1));
console.log(`\n${state.lastRun.requests} requests in ${Math.round((Date.now() - t0) / 1000)} s; errors: ${state.lastRun.errors.length}`);
for (const e of state.lastRun.errors) console.log(`  error ${e.stage} ${e.symbol || ""}: ${e.message}`);
for (const s of symbols) {
  const v = views[s], c = state.companies[s];
  if (!v) { console.log(`\n${s}: no view (${c ? 'collected ' + Object.keys(c.owners || {}).length + ' insiders' : 'not collected'})`); continue; }
  console.log(`\n${s} ${v.name} · ${v.people.length} current people, ${v.former.length} former, ${v.holders.length} large holders · doc ${v.source.doc ? v.source.doc.form + ' ' + v.source.doc.filed + ' kept ' + v.source.doc.kept + ' dropped ' + v.source.doc.dropped : 'none' + (v.source.docPending ? ' (pending ' + v.source.docPending.form + ')' : '')}`);
  console.log(`  control: ${v.control.summary}${v.control.gap ? ' ' + v.control.gap : ''}${v.control.votesNote ? ' [' + v.control.votesNote + ']' : ''}`);
  console.log(`  board: ${v.board.size} directors, ${v.board.independent ?? '?'} independent, avg tenure ${v.board.avgTenure ?? '?'}, CEO is chair: ${v.board.ceoIsChair}`);
  for (const p of v.people.slice(0, 14)) {
    console.log(`  - ${p.name}${p.title ? ' · ' + p.title : ''}${p.director ? ' · director' + (p.independent === true ? ' (independent)' : p.independent === false ? ' (not independent)' : '') : ''}${p.chair ? ' · CHAIR' : ''} · since ${p.boardSince || p.roleSince || (p.insiderSince || '').slice(0, 4) || (p.seenSince ? '≤' + p.seenSince.slice(0, 4) : '?')} · shares ${p.holdings?.total ?? '-'} (${p.holdings?.source || '-'}) · value ${p.value ?? '-'} · votes ${p.pctVoting ?? '-'}%${p.proxy?.votingPercent != null ? ' (proxy ' + p.proxy.votingPercent + '%)' : ''} · other ${p.other.filter((o) => o.active).map((o) => (o.ticker || o.name) + (o.role ? ' [' + o.role + ']' : '')).join(', ') || '-'} · boards ${(p.otherBoards || []).filter((b) => b.current).map((b) => b.company + (b.covered ? '*' : '')).join(', ') || '-'}${p.ceo ? ' · CEO' : ''}`);
  }
  if (v.holders.length) console.log('  holders: ' + v.holders.slice(0, 5).map((h) => `${h.name} ${h.pctOfClass ?? '?'}% class / ${h.pctVoting ?? '?'}% votes`).join('; '));
  if (c?.proxy?.dropped?.length) console.log('  dropped by the checker: ' + c.proxy.dropped.slice(0, 12).join('; '));
  console.log(`  sweep: found ${c?.sweep?.found ?? '?'}, read ${Object.keys(c?.read || {}).length}, pending ${(c?.sweep?.pending || []).length}, insiders ${Object.keys(c?.owners || {}).length}, form 3 dates ${Object.keys(c?.form3 || {}).length}`);
  if (v.interlocks.length) console.log('  interlocks: ' + v.interlocks.map((i) => i.symbol + ' (' + i.people.map((p) => p.name + ' via ' + p.via).join(', ') + ')').join('; '));
  if (v.source.lateChanges) console.log('  8-K after the proxy: ' + JSON.stringify(v.source.lateChanges));
  if (v.source.notes?.length) console.log('  notes: ' + v.source.notes.join(' | '));
}
if (usage.length) console.log(`\nAI: ${usage.length} call(s), ${usage.reduce((s, u) => s + (u.usage?.promptTokenCount || 0), 0)} input tokens, ${usage.reduce((s, u) => s + (u.usage?.candidatesTokenCount || 0), 0)} output tokens`);
