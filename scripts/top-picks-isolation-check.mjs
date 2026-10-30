// Rerunnable semantic comparison with the branch's actual main base. No network.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'top-picks-isolation-'));
const ref=execFileSync('git',['merge-base','main','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const snapshotScript=`
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-30T16:00:00Z']));}static now(){return RealDate.parse('2026-10-30T16:00:00Z');}};
globalThis.fetch=async()=>{throw Error('Network disabled for isolation check');};
const b=await import('./scripts/build.mjs');
const {entryPolicyFixture}=await import('./scripts/entry-policy-smoke.mjs');
const {buildLeapsScorePayload}=await import('./lib/leaps-score.mjs');
const fixture=entryPolicyFixture();
const chains=Object.fromEntries(['NVDA','AAPL','AMZN','JPM','WMT','MSFT','SPY','GLD'].map((s,i)=>[s,{...structuredClone(fixture.data),spot:80+i*2,technicals:{rsi:20+i*2,sma:{sma20:100,sma50:110}},fundamentals:{sector:'Technology',profitMargin:20,freeCashFlow:1e9,totalCash:2e9,totalDebt:1e9,debtToEquity:50,revenueGrowthYoy:10,revenue:1e10,fiftyTwoWeekHigh:150,netMarginHistory:Array.from({length:5},()=>({value:20}))}}]));
const at=new Date().toISOString();
const macro={asOf:at,indexes:{spy:{pctChange1d:-1,pctChange5d:-3,aboveSma20:false},qqq:{pctChange1d:-2,pctChange5d:-4,aboveSma20:false}},vix:{value:25,trend:'rising'},dxy:{pctChange1d:0},tenY:{bpsChange1d:0}};
macro.macroRegime=b.computeMacroRegime(macro);
const grades=b.buildGradesIndex(chains,[],null,null,macro,null,{builtAtIso:at});
const scored=b.scoreAllTickers(chains,[],null,null,macro,null,{builtAtIso:at});
const {riskStack}=await import('./lib/risk-stack.mjs');
const result={market:macro.macroRegime,grades,timing:b.computeEntryTiming('call',fixture.data,100,{regime:'risk-off'}),stockPicks:b.buildStockPicks(chains,grades,at),rotation:b.buildSectorRotationRebounds(chains,grades,at),leaps:buildLeapsScorePayload(scored,at),leveraged:b.buildLeveragedEtfPicks(chains,grades,at),risk:riskStack.assess([{id:'market',name:'Market',layer:'backdrop',status:'ready',stance:-1},{id:'heatmap',name:'Heatmap',layer:'session',status:'ready',stance:-1},{id:'gamma',name:'Gamma',layer:'structure',status:'ready',stance:0}])};
process.stdout.write(JSON.stringify(result));
`;
try {
  const archive=execFileSync('git',['archive',ref,'lib','scripts','package.json'],{cwd:root,maxBuffer:32*1024*1024});
  const tar=join(temp,'baseline.tar');await writeFile(tar,archive);
  execFileSync('tar',['-xf',tar,'-C',temp]);
  await symlink(resolve(root,'node_modules'),join(temp,'node_modules'),'dir');
  await writeFile(join(temp,'compare.mjs'),snapshotScript);
  const baseline=JSON.parse(execFileSync(process.execPath,[join(temp,'compare.mjs')],{cwd:temp,maxBuffer:8*1024*1024,encoding:'utf8'}));
  // Keep the runner outside the checkout; absolute file imports preserve the
  // current source's package resolution without writing a temporary repo file.
  const currentScript=snapshotScript.replaceAll("import('./",`import('${root.replaceAll('\\','/')}`);
  await writeFile(join(temp,'current.mjs'),currentScript);
  const current=JSON.parse(execFileSync(process.execPath,[join(temp,'current.mjs')],{cwd:root,maxBuffer:8*1024*1024,encoding:'utf8'}));
  for(const key of Object.keys(baseline))assert.deepEqual(current[key],baseline[key],key+' changed outside Top Picks');
  assert(baseline.stockPicks.candidates.length>0,'Isolation fixture must exercise nonempty share recommendations');
  const priorApp=execFileSync('git',['show',ref+':app.js'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  const app=await readFile(join(root,'app.js'),'utf8');
  const calculators=['gradeSpread','gradeLiquidity','gradeVolRegime','gradeDelta','gradeTheta','shouldBuy','findAlternative','reconcileVerdict','buildResultHtml','computeMaxPain','computeTermStructure','computeLiveMacroRegime','computeGexFlip','computeGex','maTrackerScore','heatmapSquarify','heatmapColorParts'];
  function fn(text,name){const start=text.indexOf('  function '+name+'(');assert(start>=0);const lineEnd=text.indexOf('\n',start),end=text.slice(start,lineEnd).trimEnd().endsWith('}')?lineEnd:text.indexOf('\n  }',start)+4;return text.slice(start,end).trim();}
  for(const name of calculators)assert.equal(fn(app,name),fn(priorApp,name),'Unchanged browser calculator: '+name);
  for(const name of ['RFR','RFR_META'])assert.equal(app.match(new RegExp('var '+name+' = ([^;]+);'))?.[1],priorApp.match(new RegExp('var '+name+' = ([^;]+);'))?.[1],name+' provenance changed');
  const html=await readFile(join(root,'index.html'),'utf8'),priorHtml=execFileSync('git',['show',ref+':index.html'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  const manifest=doc=>doc.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)?.[1];
  assert(manifest(html));assert.equal(manifest(html),manifest(priorHtml),'Published research manifest changed');
  const evidence={base:ref,checkedAt:new Date().toISOString(),equal:Object.keys(baseline),browserCalculators:calculators,preserved:['RFR','RFR_META','STONKS_MANIFEST']};
  await writeFile(join(tmpdir(),'top-picks-isolation-result.json'),JSON.stringify(evidence,null,2));
  console.log('Unchanged against '+ref.slice(0,9)+': '+Object.keys(baseline).join(', '));
}finally{await rm(temp,{recursive:true,force:true});}
