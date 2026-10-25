// Read-only audit of real local source caches and the actual published shape.
// No provider calls, model calls, production writes, or paid integrations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHistoricalData, packHistoricalData } from '../lib/historical-data.mjs';
import { HISTORICAL_MARKETS, HISTORICAL_CONTEXT, HISTORICAL_SOURCE_KEY } from '../lib/historical-sources.mjs';
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const read = async file => JSON.parse(await readFile(resolve(dataDir, file), 'utf8'));
const [sourceCache, published] = await Promise.all([read(HISTORICAL_SOURCE_KEY),read('historical-data.json')]);
const canonical = buildHistoricalData({ sourceCache, sourceBuiltAtIso: sourceCache.builtAtIso, builtAtIso: published.builtAtIso, analyzedAtIso: published.analyzedAtIso });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(hash(published), hash(packHistoricalData(canonical)), 'actual serialized snapshot matches the collected sources and build stamp');
assert.equal(canonical.coverage.total, HISTORICAL_MARKETS.length + HISTORICAL_CONTEXT.length);
assert.equal(canonical.coverage.ready, canonical.coverage.total, 'every catalogued dataset must pass the minimum history rule');
for (const s of [...canonical.coverage.markets,...canonical.coverage.context]) {
  assert.equal(s.status,'ready'); assert(s.years>=10);
  assert(s.lastDate >= `${Number(s.firstDate.slice(0,4))+10}${s.firstDate.slice(4)}`);
  if (s.excludedEarlyObservations) assert(s.rawFirstDate < s.firstDate, s.id+' reports its earlier excluded history');
}
assert.equal(sourceCache.version,2,'market histories require recorded source confirmation');
let windows=0,medians=0;
for (const series of canonical.coverage.context) {
  const from=`${Number(series.lastDate.slice(0,4))-10}${series.lastDate.slice(4)}`;
  const values=sourceCache.context[series.id].rows.filter(r=>r.t>=from&&r.t<=series.lastDate).map(r=>r.v).sort((a,b)=>a-b);
  const mid=Math.floor(values.length/2), expected=values.length%2?values[mid]:(values[mid-1]+values[mid])/2;
  assert(Math.abs(series.median10y-expected)<1e-8,series.id+' median averages both middle observations when needed');medians++;
}
for (const [symbol,index] of Object.entries(canonical.indexes)) {
  const rows=sourceCache.symbols[symbol];
  assert(index.asOf<=sourceCache.records[symbol].confirmedThrough,'accepted close cannot exceed the actual source confirmation');
  const closes=new Map(rows.map(r=>[r.t,r.c]));
  for(const study of index.studies) for(const sample of Object.values(study.ranges)) {
    assert.equal(sample.n,sample.years.length);
    for(const y of sample.years) {
      assert(y.year < study.comparison.year, 'comparison year stays out of historical samples');
      assert(y.end <= canonical.cutoff);
      const expected=(closes.get(y.end)/closes.get(y.baseline)-1)*100;
      assert(Number.isFinite(expected)); assert(Math.abs(expected-y.returnPct)<.000051, symbol+' '+study.id+' '+y.year+' matches actual closes'); windows++;
    }
  }
}
const bytes=Buffer.byteLength(JSON.stringify(published));
assert(bytes<4_150_000,'actual function response stays within the publisher guard');
console.log(JSON.stringify({datasetsVerified:canonical.coverage.ready,markets:Object.keys(canonical.indexes).length,contextSeries:canonical.coverage.context.length,windowReturnsReconciled:windows,contextMediansReconciled:medians,minimumMarketYears:Math.min(...canonical.coverage.markets.map(s=>s.years)),minimumContextYears:Math.min(...canonical.coverage.context.map(s=>s.years)),responseBytes:bytes,providerSubscriptionUsd:canonical.coverage.providerFeeUsd,cutoff:canonical.cutoff},null,2));
