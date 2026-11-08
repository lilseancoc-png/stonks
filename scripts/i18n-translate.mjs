// One-time (or after-a-big-UI-change) translation pass for the language
// picker. Fills ONLY the keys that i18n/zh-CN.json, ja.json and ko.json are
// missing, from i18n/source-strings.json (written by i18n-collect.mjs).
// Hand-written entries are never replaced. zh-TW is then rebuilt from zh-CN by
// i18n-build.mjs (OpenCC, no AI).
//
//   node scripts/i18n-translate.mjs --dry-run      # count what is missing, no calls
//   GEMINI_API_KEY=... node scripts/i18n-translate.mjs
//
// Knobs: I18N_MODEL (default gemini-3.1-flash-lite), I18N_BATCH (strings per
// call, default 40), I18N_MAX_CALLS (hard stop, default 150), I18N_RPM
// (default 30). One call returns all three languages for a batch. A batch whose
// answer drops a {0} number slot or a <0>…</0> tag marker loses only that
// string (i18n-build.mjs drops slot mismatches too). Nothing runs on page
// visits or in the scheduled builds: this script is started by hand or by the
// manual "Translate site" workflow, and its output is committed.
//
// Spend is recorded through the shared AI ledger (recordAiUsage) when a
// hydrated data/ai-usage.json is present; otherwise it is only printed.
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'i18n');
const LANGS = ['zh-CN', 'ja', 'ko'];
const NAMES = { 'zh-CN': 'Simplified Chinese (mainland)', ja: 'Japanese', ko: 'Korean' };
const MODEL = process.env.I18N_MODEL || 'gemini-3.1-flash-lite';
const BATCH = Math.max(5, Number(process.env.I18N_BATCH) || 40);
const MAX_CALLS = Math.max(1, Number(process.env.I18N_MAX_CALLS) || 150);
const RPM = Math.max(1, Number(process.env.I18N_RPM) || 30);
const dryRun = process.argv.includes('--dry-run');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const slots = (s) => (s.match(/\{\d+\}|<\/?\d+\/?>/g) || []).sort().join(' ');

const source = await readJson(resolve(DIR, 'source-strings.json'));
const keys = Array.isArray(source) ? source : Object.keys(source.strings || source);
const dicts = {};
for (const l of LANGS) dicts[l] = (await readJson(resolve(DIR, l + '.json'))).strings || {};
const missing = keys.filter((k) => LANGS.some((l) => !dicts[l][k]));
const chars = missing.reduce((n, k) => n + k.length, 0);
console.log(`${missing.length} of ${keys.length} strings missing in at least one language (${chars} characters).`);
const batches = [];
for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
console.log(`${batches.length} calls needed at ${BATCH} per call (cap ${MAX_CALLS}).`);
if (dryRun) process.exit(0);
if (!process.env.GEMINI_API_KEY) { console.log('No GEMINI_API_KEY; nothing translated.'); process.exit(0); }

const build = await import('./build.mjs');
let ledger = false;
try { await access(resolve(ROOT, 'data', 'ai-usage.json')); await build.loadAiUsageState(); ledger = true; } catch (_) {}
const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 120000 } });

const SYSTEM = `You translate the interface of Mingstreet, a US stock and options research website, from English.
Return JSON {"zh-CN": [...], "ja": [...], "ko": [...]}: each array has exactly one translation per input string, in the same order.
Rules:
- Natural, concise UI wording a finance reader in that market would expect (zh-CN: mainland Simplified Chinese; ja: Japanese; ko: Korean).
- Keep every {0}, {1}… placeholder and every <0>, </0>, <1/> style tag marker exactly once, unchanged; you may move them to fit the grammar.
- Keep tickers (AAPL, SPY), currency symbols, numbers, units and these terms in English: ETF, IV, RSI, MACD, EPS, P/E, OI, ATR, VIX, FOMC, CPI, PPI, ATM, OTM, ITM, DTE, LEAPS, Delta, Gamma, Theta, Vega, S&P 500, Nasdaq, Discord, Webull, Yahoo, Gemini.
- Use standard finance terms: call = 看涨期权/コール/콜, put = 看跌期权/プット/풋, strike = 行权价/権利行使価格/행사가, expiration = 到期日/満期/만기, spread = 价差/スプレッド/스프레드, Top Picks = 精选/トップピック/톱 픽, Track record = 业绩记录/実績/실적 기록, Owner = 所有者/オーナー/소유자.
- A string that is only a code name, file name, URL or symbol: return it unchanged.
- No explanations, no extra keys.`;

const schema = {
  type: 'object',
  properties: Object.fromEntries(LANGS.map((l) => [l, { type: 'array', items: { type: 'string' } }])),
  required: LANGS,
};

let calls = 0, filled = 0, dropped = 0, inTok = 0, outTok = 0;
const gap = Math.ceil(60000 / RPM);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(batch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const model = attempt === 0 ? MODEL : (build.aiModelForAttempt ? build.aiModelForAttempt(MODEL, attempt) : MODEL);
    try {
      calls += 1;
      const res = await ai.models.generateContent({
        model,
        config: { systemInstruction: SYSTEM, temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: 0 } },
        contents: JSON.stringify(batch),
      });
      const u = res?.usageMetadata || {};
      inTok += u.promptTokenCount || 0; outTok += u.candidatesTokenCount || 0;
      if (ledger) build.recordAiUsage({ model, callType: 'i18n-translate', usage: u });
      const parsed = JSON.parse(res.text);
      if (LANGS.some((l) => !Array.isArray(parsed[l]) || parsed[l].length !== batch.length)) throw new Error('length mismatch');
      return parsed;
    } catch (err) {
      console.log(`  retry ${attempt + 1}: ${err.message}`);
      if (calls >= MAX_CALLS) return null;
      await sleep(gap * (attempt + 2));
    }
  }
  return null;
}

for (const [i, batch] of batches.entries()) {
  if (calls >= MAX_CALLS) { console.log(`Stopped at the ${MAX_CALLS}-call cap; run again to continue.`); break; }
  const out = await translate(batch);
  if (out) {
    batch.forEach((k, j) => {
      for (const l of LANGS) {
        if (dicts[l][k]) continue;
        const v = String(out[l][j] || '').trim();
        if (!v || slots(v) !== slots(k)) { dropped += 1; continue; }
        dicts[l][k] = v; filled += 1;
      }
    });
    // Save after every batch so a stopped run keeps its work.
    for (const l of LANGS) await writeFile(resolve(DIR, l + '.json'), JSON.stringify({ lang: l, strings: dicts[l] }, null, 1) + '\n');
  }
  console.log(`batch ${i + 1}/${batches.length}: ${out ? 'ok' : 'skipped'} · ${filled} filled · ${calls} calls`);
  await sleep(gap);
}
if (ledger) await build.writeAiUsageState();
console.log(`Done: ${filled} translations added, ${dropped} dropped for a missing slot, ${calls} calls, ${inTok} in / ${outTok} out tokens.`);
const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'i18n-build.mjs')], { stdio: 'inherit' });
process.exit(r.status || 0);
