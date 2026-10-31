// On-demand worker. No scheduled runs, model SDK, data-provider or broker access.
import { store } from '../lib/datastore.mjs';
import { createLabRepository } from '../lib/research-lab/repository.mjs';
import { advanceRun } from '../lib/research-lab/worker.mjs';
import { researchLabEnabled } from '../lib/research-lab/access.mjs';
import { terminal } from '../lib/research-lab/service.mjs';

const owner = process.argv.find(a => a.startsWith('--owner='))?.slice(8);
const requestedRun = process.argv.find(a => a.startsWith('--run='))?.slice(6);
if (!owner || !researchLabEnabled({ sub: owner, tr: true, tp: true })) throw new Error('Worker disabled or owner not allowlisted. Use --owner=DISCORD_ID.');
const repo = createLabRepository({ store, owner });
for (let steps = 0; steps < 80; steps++) {
  if (!researchLabEnabled({ sub: owner, tr: true, tp: true })) break;
  const state = await repo.read(), run = requestedRun ? state.runs.find(r => r.id === requestedRun) : state.runs.find(r => !terminal(r.status));
  if (!run || terminal(run.status)) break;
  const status = await advanceRun(repo, run.id);
  console.log(JSON.stringify({ run_id: status.id, status: status.status, completed_nodes: status.completed_nodes.length }));
  if (status.status === 'RUNNING' && status.completed_nodes.length === run.cursor) break;
}
