import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { graphSchema, evaluationPlanSchema, interpretationSchema } from '../lib/research-lab/schemas.mjs';
const directory = new URL('../docs/research-lab/schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries({ graph: graphSchema, 'evaluation-plan': evaluationPlanSchema, interpretation: interpretationSchema })) {
  const bytes = JSON.stringify(schema, null, 2) + '\n', path = new URL(name + '.json', directory);
  if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), bytes, 'Schema drift: ' + name);
  else await writeFile(path, bytes);
}
console.log('Research Lab JSON schemas ' + (process.argv.includes('--check') ? 'verified.' : 'generated.'));
