// Keep the command outside refresh-forced-liquidation.mjs. The build imports
// that module; a top-level await importing the build back into it deadlocks.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {TICKERS} from './build.mjs';
import {yahooFinance} from '../lib/yahoo.mjs';
import {readForcedLiquidation,refreshForcedLiquidation,writeForcedLiquidation} from './refresh-forced-liquidation.mjs';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  // Reads public sources and writes this local key only. Publication remains
  // the existing bake pipeline's responsibility. No trading or AI calls.
  const dataDir=resolve(process.env.LIQUIDATION_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url)));
  const prior=await readForcedLiquidation(dataDir),chains={};
  for(const symbol of TICKERS)try{chains[symbol]=JSON.parse(await readFile(resolve(dataDir,symbol+'.json'),'utf8'));}catch{}
  const payload=await refreshForcedLiquidation({prior,universe:TICKERS,chains,quoteClient:yahooFinance,builtAtIso:new Date().toISOString()});
  await writeForcedLiquidation(dataDir,payload);
  console.log(`Forced Liquidation Tracker: ${payload.rows.length} disclosures; SEC ${payload.coverage.status}; ${payload.coverage.requestsThisRun} source requests; ${payload.coverage.pendingFilings?.length||0} pending documents; no publication.`);
}
