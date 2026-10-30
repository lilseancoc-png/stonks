// Offline chronological comparison. Reads only stored point-in-time evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {summarizeMarketStudy} from '../lib/top-picks-market-study.mjs';
const args=process.argv.slice(2),arg=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
const input=arg('--input')||'data/top-picks-market-study.json';
const data=JSON.parse(await readFile(input,'utf8'));
const study=data.marketStudy||data;
if(!Array.isArray(study.rows))throw Error('No point-in-time market-policy study in this input. Historical states will not be inferred.');
const result={input,method:study.method,historicalCoverage:study.historicalCoverage,reports:Object.fromEntries([5,10,20].map(h=>[h,summarizeMarketStudy(study,h)]))};
const output=arg('--output');if(output)await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
