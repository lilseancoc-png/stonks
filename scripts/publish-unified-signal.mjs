import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildUnifiedSignalEngine, writeUnifiedSignalEngine } from '../lib/unified-signal.mjs';
import { etClock } from '../lib/us-equity-calendar.mjs';

// Reuse the completed bake's local artifacts. No remote hydration or AI work.
export async function publishUnifiedSignal({ dataDir, builtAtIso, chains, grades, previous = null } = {}) {
  const read = async key => { try { return JSON.parse(await readFile(resolve(dataDir, key), 'utf8')); } catch { return null; } };
  const day = etClock(Date.parse(builtAtIso)).date;
  const [picks, market, evidence, quant, linkMap, rotation, gradeSource] = await Promise.all([
    read('picks.json'), read('market-analysis.json'), read(`evidence/${day}.json`),
    read('quant.json'), read('link-map.json'), read('sector-rotation.json'), read('grades.json'),
  ]);
  const payload = buildUnifiedSignalEngine({ builtAtIso, chains, grades, previous, picks,
    scenario: market?.scenarioEngine || market?.scenario || null, evidence, quant, linkMap, rotation, gradeModelVersion: gradeSource?.gradeModelVersion || null });
  await writeUnifiedSignalEngine(dataDir, payload);
  return payload;
}
