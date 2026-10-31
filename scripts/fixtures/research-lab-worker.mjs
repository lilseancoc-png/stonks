import { fileFixtureStore } from './research-lab.mjs';
import { createLabRepository } from '../../lib/research-lab/repository.mjs';
import { advanceRun } from '../../lib/research-lab/worker.mjs';
const [directory, id, clock, stop] = process.argv.slice(2);
const repo = createLabRepository({ store: await fileFixtureStore(directory), owner: 'fixture-owner', clock: () => clock });
const result = await advanceRun(repo, id, stop === 'crash' ? { afterClaim: () => process.exit(73) } : {});
console.log(JSON.stringify(result));
