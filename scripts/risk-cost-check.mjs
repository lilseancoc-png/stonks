// Offline, repeatable incremental-cost check against a Git revision.
// Usage: node scripts/risk-cost-check.mjs [baseline-ref, default HEAD]
// No provider credentials, billing access or production writes are used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as current from './build.mjs';
import { entryPolicyFixture } from './entry-policy-smoke.mjs';
import { bsPrice, yearsToExpiry } from '../lib/greeks.mjs';
import { entryVolatilityRisk } from '../lib/entry-volatility-risk.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const ref=process.argv[2]||'HEAD';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const original=git('show',ref+':scripts/build.mjs');
const working=await readFile(resolve(root,'scripts/build.mjs'),'utf8');
const constant=(source,name)=>source.split('\n').find(line=>new RegExp('^(export )?const '+name+'\\b').test(line));
for(const name of ['PICKS_MAX_AI_THESES','AI_THESIS_MODEL','THESIS_CACHE_MAX_AGE_MS','PICKS_MIN_DTE','PICKS_MAX_DTE']){
  assert(constant(original,name),'baseline constant required: '+name);
  assert.equal(constant(working,name),constant(original,name),name+' must retain its existing budget / data window');
}
for(const pattern of [/\bfetch\s*\(/g,/\.generateContent\s*\(/g,/\brecordAiUsage\s*\(/g,/\bwriteFile\s*\(/g])
  assert.equal([...working.matchAll(pattern)].length,[...original.matchAll(pattern)].length,'network/model/write call sites must stay unchanged: '+pattern);
const changed=git('diff',ref,'--name-only').split('\n').filter(Boolean);
const recurringCostChanges=changed.filter(path=>path.startsWith('.github/workflows/') || path.startsWith('api/')
  || /(?:package-lock\.json|vercel\.json|ai-budget|ai-ledger|private-store|data-store)/.test(path));
assert.deepEqual(recurringCostChanges,[],'No schedules, endpoints, dependencies, storage operations or provider budgets should change');
for(const name of ['lib/entry-volatility-risk.mjs','lib/option-entry-economics.mjs']){
  const source=await readFile(resolve(root,name),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|writeFile|request|generateContent)\s*\(/,'new math modules must remain local');
}
// Rebind the old build's imports to this checkout so its pure functions can
// run beside the working version without switching branches or touching data.
const scratch=await mkdtemp(resolve(tmpdir(),'stonks-risk-cost-'));
let attempts=0;
const savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{attempts++;throw new Error('Cost check prohibits network requests');};
try{
  const moduleSource=original.replace(/^(import(?:\s*\{[^}]*\}|\s+[^\n;]+?)\s+from\s+)(["'])([^"']+)\2/gm,(whole,prefix,quote,specifier)=>{
    if(specifier.startsWith('node:'))return whole;
    const url=specifier.startsWith('.') ? new URL(specifier,new URL('scripts/build.mjs',pathToFileURL(root))).href : import.meta.resolve(specifier);
    return prefix+quote+url+quote;
  });
  const modulePath=resolve(scratch,'baseline.mjs');
  await writeFile(modulePath,moduleSource);
  const baseline=await import(pathToFileURL(modulePath).href);
  assert.equal(current.buildThesisUserMessage.toString(),baseline.buildThesisUserMessage.toString(),'candidate and volatility audits must not expand AI prompts');
  const {data,timing,expiry}=entryPolicyFixture();
  // Timing/vehicle changes must not silently rewrite stock-quality grades.
  for (const macroState of ['neutral','risk-on','risk-off','severe-risk-off']) {
    const universe={};
    for(let i=0;i<8;i++) {
      const candidate=structuredClone(data);
      candidate.fundamentals={...candidate.fundamentals,trailingPE:8+i*8,revenueGrowth:(i-3)*.1,earningsGrowth:(i-4)*.15};
      for(const bar of candidate._bars) {bar.c*=1+(i-4)*.003;bar.h*=1+(i-4)*.003;bar.l*=1+(i-4)*.003;}
      universe['AUDIT'+i]=candidate;
    }
    const backdrop={macroRegime:{state:macroState}};
    const grade=engine=>engine.scoreAllTickers(structuredClone(universe),[],{},null,backdrop,null).scored.map(r=>({symbol:r.sym,total:r.total,side:r.side,recommendation:r.recommendation,
      pillars:Object.fromEntries(Object.entries(r.pillars).filter(([key])=>key!=='timing'))}));
    assert.deepEqual(grade(current),grade(baseline),'Stock-quality grades must remain unchanged in '+macroState);
  }

  const crowded=structuredClone(data);crowded.chains={};
  for(let i=0;i<14;i++){
    const exp=expiry+(i-7)*4*86400,T=yearsToExpiry(exp);
    const chain={c:[],p:[]};
    for(let strike=70;strike<=130;strike++)for(const [type,key]of [['call','c'],['put','p']]){
      const mid=bsPrice(type,100,strike,T,.4,.045)*2;
      chain[key].push({s:strike,b:mid*.99,a:mid*1.01,iv:.4,oi:1000,v:50});
    }
    crowded.chains[exp]=chain;
  }
  const strategy={type:'long',reason:'benchmark'};
  const time=(fn,rounds=30)=>{
    for(let i=0;i<3;i++)fn();
    const times=[];
    for(let i=0;i<rounds;i++){const start=performance.now();fn();times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);
    return {meanMs:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(3),p95Ms:+times[Math.floor(times.length*.95)].toFixed(3)};
  };
  const plan=timing.structure;
  const timingBefore=time(()=>baseline.computeEntryTiming('call',data,100,{}));
  const timingAfter=time(()=>current.computeEntryTiming('call',data,100,{}));
  const selectionBefore=time(()=>baseline.buildPickContract('call',data,.045,strategy));
  const selectionAfter=time(()=>current.buildPickContract('call',data,.045,strategy,{evaluateEconomics:true,stockPlan:plan}));
  const stressBefore=time(()=>baseline.buildPickContract('call',crowded,.045,strategy));
  const stressAfter=time(()=>current.buildPickContract('call',crowded,.045,strategy,{evaluateEconomics:true,stockPlan:plan}));
  const result=current.buildPickContract('call',crowded,.045,strategy,{evaluateEconomics:true,stockPlan:plan});
  const comparisonBytes=Buffer.byteLength(JSON.stringify(result.economics.comparison));
  const volatilityBytes=Buffer.byteLength(JSON.stringify(entryVolatilityRisk({c:data._bars.slice(0,-1).map(b=>b.c),h:data._bars.slice(0,-1).map(b=>b.h),l:data._bars.slice(0,-1).map(b=>b.l)},'call')));
  const beforePrompt=baseline.buildThesisUserMessage({...entryPolicyFixture().row,timing:baseline.computeEntryTiming('call',data,100,{})},'call',null);
  const afterPrompt=current.buildThesisUserMessage(entryPolicyFixture().row,'call',null);
  assert.equal(attempts,0);
  console.log(JSON.stringify({baselineRef:git('rev-parse',ref),networkRequests:attempts,
    extraScheduledJobs:0,extraDataFetches:0,extraStorageOperations:0,newModelCallSites:0,
    providerBudgetsModelsAndDependenciesUnchanged:true,stockGradesMatchBaselineAcross32Cases:true,
    timing:{baseline:timingBefore,current:timingAfter},
    oneExpirySelection:{baseline:selectionBefore,current:selectionAfter},
    fourteenFetchedExpirations:{baseline:stressBefore,current:stressAfter,contractsEvaluated:result.economics.comparison.evaluated},
    incrementalAuditBytes:{comparisonPerCopy:comparisonBytes,volatilityPerTiming:volatilityBytes},
    promptCharacters:{before:beforePrompt.length,after:afterPrompt.length},
    limits:'Synthetic local CPU/payload measurements, not billing. Changed eligibility and policy signatures may refresh existing capped AI slots. No additional model calls per alternative.'
  },null,2));
}finally{
  globalThis.fetch=savedFetch;
  await rm(scratch,{recursive:true,force:true});
}
