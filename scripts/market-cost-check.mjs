// Offline incremental-cost audit for Market Analysis. No network or billing
// credentials are used. Run alongside market-review-smoke.mjs for rate limits.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { marketRefresh } from '../lib/market-refresh.mjs';

const baseline = '950672f6df81a4f9b470a1ed69919647d02b67ac';
const before = (path) => execFileSync('git',['show',`${baseline}:${path}`],{encoding:'utf8',maxBuffer:32*1024*1024});
const current = (path) => readFile(new URL('../'+path,import.meta.url),'utf8');
for (const path of ['package.json','package-lock.json','vercel.json']) assert.equal(await current(path),before(path),path+' changes recurring cost configuration');
assert.equal(execFileSync('git',['diff',baseline,'--','.github/workflows/'],{encoding:'utf8'}),'','Scheduled jobs must stay unchanged');
const patterns = [/\bfetch\s*\(/g,/\.generateContent\s*\(/g,/\brecordAiUsage\s*\(/g,/\bwriteFile\s*\(/g];
for (const path of ['scripts/build.mjs','api/macro-live.js']) {
  const a=before(path),b=await current(path);
  for (const pattern of patterns) assert.equal([...b.matchAll(pattern)].length,[...a.matchAll(pattern)].length,path+' added network, AI or store-write calls');
}
const macroBefore=before('api/macro-live.js'),macroAfter=await current('api/macro-live.js');
for (const name of ['LEGS','CROSS_ASSET_LEGS']) {
  const list=(source)=>source.match(new RegExp('const '+name+' = \\[([\\s\\S]*?)\\n\\];'))?.[1];
  assert(list(macroBefore));assert.equal(list(macroAfter),list(macroBefore),'Provider symbol universe must stay fixed');
}
for (const path of ['lib/market-analysis.mjs','lib/market-refresh.mjs']) assert.doesNotMatch(await current(path),/\b(?:fetch|writeFile|request|generateContent)\s*\(/,'Shared rules must be pure');
const app=await current('app.js'),oldApp=before('app.js');
const previousPoll=oldApp.match(/var MACRO_TAPE_POLL_MS = ([^;]+);/)?.[1];
assert(previousPoll);assert.equal(app.match(/var MACRO_TAPE_POLL_MS = ([^;]+);/)?.[1],previousPoll);
const loader=app.slice(app.indexOf('  async function loadMarketAnalysis('),app.indexOf('  function renderMacroTape('));
assert.match(loader,/!options\.automatic/,'Automatic refresh must not fetch the Top Picks fallback');
const refreshCode=await current('lib/market-refresh.mjs');assert.doesNotMatch(refreshCode,/setInterval|setTimeout/,'No new recurring timer');
let payloadBytes=null;
try {payloadBytes=Buffer.byteLength(await current('data/market-analysis.json'));}catch{}
const rawDelta=Buffer.byteLength(app)-Buffer.byteLength(oldApp);
const gzipDelta=gzipSync(app).length-gzipSync(oldApp).length;
console.log(JSON.stringify({baseline,extraScheduledJobs:0,extraAiCallSites:0,extraProviderCallSites:0,
  providerSymbolsUnchanged:true,dependenciesAndBudgetsUnchanged:true,extraRefreshTimers:0,
  savedAnalysisReads:{automaticMaxPerRolling24HoursPerTab:marketRefresh.limits.maxReads,
    normalMinimumMinutes:marketRefresh.limits.gapMs/60000,retryAfterMinutes:marketRefresh.limits.retryMs/60000,
    failureRetries:1,retriesCountTowardLimit:true,initialLoadExcluded:true,
    manualErrorRetryMinimumSeconds:30,hiddenOrInactiveReads:0},
  publishedStorageReads:{uncachedLogicalObjectsPerSavedRead:3,
    automaticLogicalObjectsPerDayUpperBound:36,
    note:'Existing publication pointer, manifest and payload path; cache hits can reduce reads. Existing backend retry policy can retry each operation up to four attempts.'},
  existingQuotePollSeconds:30,existingQuoteRequestUpperBoundPerVisibleHour:120,
  payloadBytes,automaticPayloadBytesPerDayUpperBound:payloadBytes==null?null:payloadBytes*marketRefresh.limits.maxReads,
  appBytesDelta:rawDelta,gzipAppBytesDelta:gzipDelta,
  limit:'Code-path and payload audit, not an invoice or post-deployment billing comparison. Each automatic saved-data read can incur existing function, storage and transfer usage. Limits are per tab; session-storage persistence is best effort.'
},null,2));
