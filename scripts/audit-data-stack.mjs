// Read-only evidence collector for the 2026-10-27 research-platform review.
// Provider/model/broker writes are never performed. --production reads public
// HTTPS endpoints without cookies. --checks runs the listed offline suites.
// Usage: node scripts/audit-data-stack.mjs --checks --production --out <file>
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { SITE_SECTIONS } from './render/site-map.mjs';
import { TICKERS, publicChainFilePayload, buildStockChecklist, fundHistoryPoint } from './build.mjs';
import { buildGradeResearch, seriesFromChains, RESEARCH_KILL_DAYS, RESEARCH_EVALUATION_HORIZON } from '../lib/grade-research.mjs';
import { HISTORICAL_MARKETS, HISTORICAL_CONTEXT } from '../lib/historical-sources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const source = await readFile(resolve(root, 'scripts/build.mjs'), 'utf8');
const lines = source.split('\n');
const sourceFiles = [
  'scripts/build.mjs', 'scripts/render/site-map.mjs', 'lib/yahoo.mjs',
  'lib/quote-provenance.mjs', 'lib/freshness-policy.mjs', 'lib/datastore.mjs',
  'lib/historical-sources.mjs', 'lib/historical-data.mjs', 'lib/earnings-forecast.mjs',
  'lib/earnings-forecast-scenarios.mjs', 'scripts/refresh-earnings-forecast.mjs',
  'lib/company-research.mjs', 'lib/full-year-valuation.mjs',
  'lib/render-risk-free-rate.mjs', 'scripts/regen-static.mjs',
  'scripts/render/company-research-client.mjs',
  'lib/leaps-score.mjs', 'lib/unified-signal.mjs', 'lib/risk-stack.mjs',
  'lib/gex.mjs', 'lib/track-record-fills.mjs', 'lib/shadow-signals.mjs',
  'lib/evidence-record.mjs', 'lib/free-news-sources.mjs', 'scripts/scan-unusual.mjs',
  'lib/accelerator-prices.mjs', 'lib/central-bank-gold.mjs',
  'scripts/diagnose-grade-ic.mjs', 'scripts/backtest-picks.mjs',
  '.github/workflows/daily.yml', '.github/workflows/unusual-flow.yml',
  '.github/workflows/oi-tracker.yml', '.github/workflows/search-interest.yml',
];
const fingerprints = await Promise.all(sourceFiles.map(async path => ({
  path, sha256: createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'),
})));
const features = SITE_SECTIONS.flatMap(section => section.items.map(item => ({
  id: item.id, label: item.label, section: section.label, owner: section.owner === true,
  description: item.blurb,
})));
const local = [];
for (const name of (await readdir(resolve(root, 'data'))).filter(n => n.endsWith('.json')).sort()) {
  const bytes = await readFile(resolve(root, 'data', name));
  try {
    const j = JSON.parse(bytes);
    local.push({ name, bytes: bytes.length,
      builtAt: j.builtAtIso || j.scannedAt || j.asOf || j._meta?.builtAtIso || null,
      version: j.version ?? null,
    });
  } catch { local.push({ name, bytes: bytes.length, invalidJson: true }); }
}
const anchor = text => {
  const index = lines.findIndex(line => line.includes(text));
  return { path: 'scripts/build.mjs', line: index < 0 ? null : index + 1, text };
};
const historyPoint = fundHistoryPoint;
const missingPoint = historyPoint({ spot: 100, fundamentals: {
  trailingPE: null, totalDebt: null, freeCashFlow: null,
} });
const zeroPoint = historyPoint({ spot: 100, fundamentals: { totalDebt: 0 } });
const probes = {
  nullHistory: { input: { trailingPE: null, totalDebt: null, freeCashFlow: null },
    actual: missingPoint,
    missingBecameZero: missingPoint?.pe === 0 && missingPoint?.debt === 0 && missingPoint?.fcf === 0,
    trueZeroPreserved: zeroPoint?.debt === 0,
    location: anchor('function fundHistoryPoint('),
    limitation: 'Source reproduction; affected production records have not been established.',
  },
};
const checklist = buildStockChecklist('AAPL', { spot: 100, fundamentals: {
  freeCashFlow: 100, totalDebt: null, marketCap: 10000,
} }, {}, null, [], []);
const findDebtAnswer = value => {
  if (Array.isArray(value)) return value.flatMap(findDebtAnswer);
  if (!value || typeof value !== 'object') return [];
  const own = value.q && /free cash flow compare/i.test(value.q) ? [value] : [];
  return own.concat(Object.values(value).flatMap(findDebtAnswer));
};
probes.missingDebtChecklist = {
  inputDebt: null, answers: findDebtAnswer(checklist),
  location: anchor('export function buildStockChecklist('),
  limitation: 'Synthetic input to the actual checklist function; not an assertion about AAPL financials.',
};
// Replay the actual full-bake input shape versus its serialized counterpart.
// The artificial prices prove wiring/retention only, never investment returns.
const probeDates = [];
for (let d = new Date('2024-01-02T00:00:00Z'); probeDates.length < 280; d.setUTCDate(d.getUTCDate() + 1)) {
  if (![0, 6].includes(d.getUTCDay())) probeDates.push(d.toISOString().slice(0, 10));
}
const probeSymbols = ['SPY', ...Array.from({ length: 20 }, (_, i) => 'TEST' + i)];
const rawChains = Object.fromEntries(probeSymbols.map((symbol, i) => [symbol, {
  spot: 100 + i, _bars: probeDates.map((t, j) => ({ t, o: 100 + j, h: 101 + j,
    l: 99 + j, c: 100 + i + j * (0.1 + i / 100), v: 1000 })),
}]));
const persistedChains = Object.fromEntries(Object.entries(rawChains).map(([s, value]) => [s, publicChainFilePayload(value)]));
const days = probeDates.map(date => ({ date, totals: Object.fromEntries(probeSymbols.map((s, i) => [s, i - 10])) }));
const rawReport = buildGradeResearch({ days, series: seriesFromChains(rawChains), placeboDraws: 0 });
const persistedReport = buildGradeResearch({ days, series: seriesFromChains(persistedChains), placeboDraws: 0 });
probes.gradeResearchWiring = {
  rawBakeShapeNames: rawReport.sample.names,
  serializedShapeNames: persistedReport.sample.names,
  detail: 'Both raw _bars and persisted priceSeries are accepted at the evaluation boundary.',
  limitation: 'Executed pure functions with synthetic bars plus inspected production caller; no authenticated production grade-research payload read.',
};
probes.gradeResearchRetention = {
  gradeSnapshotCap: 280,
  priceBarsPerName: persistedChains.SPY.priceSeries.c.length,
  evaluationHorizon: RESEARCH_EVALUATION_HORIZON,
  nonOverlappingWindows: persistedReport.horizons[String(RESEARCH_EVALUATION_HORIZON)].residual.nonOverlappingDays,
  requiredWindows: RESEARCH_KILL_DAYS,
  established: persistedReport.killLine.established,
  detail: 'Current five-session evaluation threshold is assessed against the retained 252-close series. Paper-book holds remain separate.',
};
const suites = [
  'research-stack-smoke.mjs', 'grade-research-selftest.mjs',
  'earnings-forecast-smoke.mjs', 'leaps-score-smoke.mjs', 'unified-signal-smoke.mjs',
  'evidence-record-smoke.mjs', 'track-record-fills-smoke.mjs',
  'historical-data-smoke.mjs', 'historical-sources-smoke.mjs', 'risk-stack-smoke.mjs',
  'audit-historical-coverage.mjs', 'diagnose-grade-ic.mjs',
];
const checks = [];
if (args.includes('--checks')) for (const suite of suites) {
  const run = spawnSync(process.execPath, [resolve(root, 'scripts', suite)], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 2_000_000,
  });
  checks.push({ suite, exitCode: run.status, error: run.error?.message || null,
    output: (run.stdout + run.stderr).trim(),
    kind: suite === 'diagnose-grade-ic.mjs' ? 'sample availability diagnostic'
      : suite === 'audit-historical-coverage.mjs' ? 'actual local cache reconciliation' : 'offline behavior contract',
  });
}
const production = [];
if (args.includes('--production')) for (const path of [
  'manifest-free.json', 'manifest.json', 'AAPL.json', 'fundamentals-history/AAPL.json',
  'earnings-forecast.json', 'unified-signal.json',
]) {
  const url = 'https://mingstreet.app/api/data/' + path;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    const body = await response.text();
    let j; try { j = JSON.parse(body); } catch { /* summarize HTML/errors without exporting bodies */ }
    production.push({ url, checkedAt: new Date().toISOString(), status: response.status,
      cacheControl: response.headers.get('cache-control'), bytes: Buffer.byteLength(body),
      keys: j && typeof j === 'object' ? Object.keys(j).slice(0, 16) : [],
      meta: j?._meta || null, builtAtIso: j?.builtAtIso || null,
      sourceQuoteAt: j?.quoteAsOf || null, financialPeriod: j?.fundamentals?.totalDebtAsOf || null,
      revenueHistoryCount: j?.fundamentals?.revenueHistory?.length ?? null,
      fcfHistoryCount: j?.fundamentals?.fcfHistory?.length ?? null,
      historyEntries: j?.entries?.length ?? null, error: j?.error || null,
    });
  } catch (e) { production.push({ url, error: e.message }); }
}
const output = {
  reviewedAt: new Date().toISOString(),
  reviewDatePacific: '2026-10-27',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'All navigation destinations inventoried; selected core pipelines inspected. Not a certification of every page, production pipeline, or investment performance.',
  universe: { tickerCount: TICKERS.length, symbols: TICKERS,
    warning: 'Curated coverage is not a historical security master or delisted-stock database. Site sector labels alone cannot establish ETF status.' },
  navigation: { count: features.length, ownerCount: features.filter(f => f.owner).length, features },
  historyCatalog: { markets: HISTORICAL_MARKETS.length, macroSeries: HISTORICAL_CONTEXT.length },
  localArtifacts: local, probes, checks, production, fingerprints,
  anchors: ['const HISTORY_LOOKBACK_DAYS =', 'const PRICE_SERIES_BARS =',
    'const FUND_HISTORY_DIR =', 'const IV_HISTORY_MAX_ENTRIES =',
    'const MIN_SUCCESS_RATE =', 'async function fetchFundamentals(',
    'export function computeCapexQualityMetrics(',
  ].map(anchor),
};
const outAt = args.indexOf('--out');
if (outAt >= 0) {
  if (!args[outAt + 1]) throw Error('--out needs a filename');
  await writeFile(resolve(args[outAt + 1]), JSON.stringify(output, null, 2) + '\n');
}
console.log(JSON.stringify({ commit: output.commit, features: features.length,
  ownerDestinations: output.navigation.ownerCount, tickers: TICKERS.length,
  historicalDatasets: HISTORICAL_MARKETS.length + HISTORICAL_CONTEXT.length,
  nullHistoryReproduced: probes.nullHistory.missingBecameZero,
  gradeResearchWiring: probes.gradeResearchWiring,
  gradeResearchRetention: probes.gradeResearchRetention,
  checks: checks.map(c => ({ suite: c.suite, exitCode: c.exitCode, kind: c.kind })),
  production, evidenceFile: outAt >= 0 ? resolve(args[outAt + 1]) : null,
}, null, 2));
if (checks.some(check => check.exitCode !== 0)) process.exitCode = 1;
