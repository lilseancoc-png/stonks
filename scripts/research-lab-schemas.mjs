import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { graphSchema, evaluationPlanSchema, interpretationSchema } from '../lib/research-lab/schemas.mjs';
import { SITE_SECTIONS } from './render/site-map.mjs';
const directory = new URL('../docs/research-lab/schemas/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, schema] of Object.entries({ graph: graphSchema, 'evaluation-plan': evaluationPlanSchema, interpretation: interpretationSchema })) {
  const bytes = JSON.stringify(schema, null, 2) + '\n', path = new URL(name + '.json', directory);
  if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), bytes, 'Schema drift: ' + name);
  else await writeFile(path, bytes);
}
console.log('Research Lab JSON schemas ' + (process.argv.includes('--check') ? 'verified.' : 'generated.'));
const catalog = '// Generated from scripts/render/site-map.mjs; checked by research-lab-schemas.mjs.\nexport const siteCatalog = ' + JSON.stringify(SITE_SECTIONS.flatMap(s => s.items.map(i => ({ id: i.id, label: i.label, description: i.blurb, category: s.label }))), null, 2) + ';\n';
const catalogPath = new URL('../lib/research-lab/site-catalog.mjs', import.meta.url);
if (process.argv.includes('--check')) assert.equal(await readFile(catalogPath, 'utf8'), catalog, 'Site catalog drift'); else await writeFile(catalogPath, catalog);
