// Read-only source audit. --live uses public SEC filings and existing ticker
// mappings, never starts a data build, invokes AI, or writes the public store.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildPerFirm13FHoldings, build13FPayload, F13_FIRM_DIRECTORY } from './build.mjs';
import { ownershipBookClientFactory, packOwnershipBooks } from '../lib/ownership-books.mjs';

const args = process.argv.slice(2), value = key => args.find(a => a.startsWith(key + '='))?.slice(key.length + 1);
const now = new Date(), input = value('--input'), live = args.includes('--live');
let payload, published = null;
if (live) {
  const response = await fetch('https://mingstreet.app/api/auth/me?data=13f.json', { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Public ownership feed HTTP ' + response.status);
  published = await response.json();
  const result = await buildPerFirm13FHoldings(now, { priorPayload: published, cusipMapper: async () => new Map() });
  payload = build13FPayload({}, [], now, result);
} else if (input) {
  payload = JSON.parse(await readFile(resolve(input), 'utf8'));
  payload = await ownershipBookClientFactory(async key => JSON.parse(await readFile(resolve(dirname(resolve(input)), key), 'utf8'))).hydrate(payload);
} else throw new Error('Use --live or --input=/absolute/path/to/13f.json. Optional --output=/tmp/ownership-audit.json.');

const funds = F13_FIRM_DIRECTORY.map(meta => {
  const f = payload.perFirm?.[meta.firm];
  const rows = f?.holdings;
  if (!Array.isArray(rows)) return { firm: meta.firm, available: false, issue: payload.collectionIssues?.[meta.firm] || 'Full book unavailable' };
  const value = rows.reduce((n, r) => n + r.valueNow, 0);
  if (Math.abs(value - f.reportedValue) > 0.01) throw new Error(meta.firm + ': summary total differs from reported book value');
  return { firm: meta.firm, available: true, trackedCik: meta.cik, reportingCik: f.reportingCik || f.cik,
    scope: f.reportingScope || 'manager-book', status: f.collectionStatus || 'unknown', reportDate: f.reportDate,
    filingDate: f.filingDate, source: f.filingUrl, currentPositions: rows.filter(r => !r.isExit).length,
    mappedCurrentPositions: rows.filter(r => !r.isExit && r.ticker).length,
    disclosedSourceRows: rows.reduce((n, r) => n + (r.disclosures?.length || 0), 0),
    reportedValue: f.reportedValue, performanceAvailable: f.performance?.pct != null };
});
// Hydrated summaries already reference existing files and need no repacking.
const inline = Object.values(payload.perFirm || {}).some(f => f?.holdings?.some(r => r.disclosures));
const packed = inline ? packOwnershipBooks(payload) : null;
const report = { auditedAtIso: now.toISOString(), reportPeriod: payload.periodEndIso,
  method: live ? 'Read-only live SEC collection; existing ticker mappings reused, new OpenFIGI lookups deliberately skipped' : 'Local saved snapshot; no live collection performed',
  publishedBeforeAudit: published ? { builtAtIso: published.builtAtIso, summaryManagers: published.realFirms, trackedManagers: published.totalFirms, fullBookVersion: published.explorerVersion || null } : null,
  availableManagers: funds.filter(f => f.available).length, trackedManagers: funds.length,
  partCount: packed?.parts.size ?? null, largestPartBytes: packed ? Math.max(...[...packed.parts.values()].map(b => Buffer.byteLength(b))) : null,
  remainingDataLimits: ['Tracked directory contains 14 manager entries, not all institutions.', 'Unresolved identifiers require issuer-name or CUSIP searches until mapping succeeds.', 'AUM estimates have no verified as-of date; actual fund returns are not supplied.', '13F snapshots omit shorts, private assets and confidential holdings. Form 4 collection is separately capped.'], funds };
const json = JSON.stringify(report, null, 2);
if (value('--output')) await writeFile(resolve(value('--output')), json);
console.log(json);
