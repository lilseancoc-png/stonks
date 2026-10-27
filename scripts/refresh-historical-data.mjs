// Rebuild from the existing long-close cache only. No provider or model calls.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHistoricalData, packHistoricalData } from '../lib/historical-data.mjs';
import { readFile } from 'node:fs/promises';
import { readHistoricalSourceCache } from './collect-historical-sources.mjs';

// inputs: headline hits and squeeze-style moves from the bake (see
// buildHistoricalEvents). An offline rebuild reuses the published ones.
export async function writeHistoricalDataFile({ dataDir, builtAtIso = new Date().toISOString(), analyzedAtIso = builtAtIso, sourceCache = null, inputs = null }) {
  const cache = sourceCache || await readHistoricalSourceCache(dataDir);
  if (!inputs) { try { inputs = JSON.parse(await readFile(resolve(dataDir, 'historical-data.json'), 'utf8')).events?.inputs || {}; } catch { inputs = {}; } }
  const payload = buildHistoricalData({ sourceCache: cache, sourceBuiltAtIso: cache.builtAtIso || null, builtAtIso, analyzedAtIso, inputs });
  const text = JSON.stringify(packHistoricalData(payload));
  if (Buffer.byteLength(text) > 4_150_000) throw new Error('Historical Data exceeds the safe function response size; split the payload before publishing');
  await writeFile(resolve(dataDir, 'historical-data.json'), text, 'utf8');
  return { bytes: Buffer.byteLength(text), indexes: Object.keys(payload.indexes).length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
  const result = await writeHistoricalDataFile({ dataDir });
  console.log(`Historical Data: ${result.indexes} markets; ${result.bytes} bytes; no network or AI calls.`);
}
