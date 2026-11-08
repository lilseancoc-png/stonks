import { calendarHealth } from './calendar-policy.mjs';
import { ISSUER_NEWS_SOURCES, FDA_SPONSORS } from './free-news-sources.mjs';
import { producerReportsFailure } from './producer-health.mjs';
// Read-only diagnostics, independent of all producers and broker execution.
import { etClock, sessionForDate, previousTradingDate } from './us-equity-calendar.mjs';
import { UPDATE_FEATURES } from './update-checker-catalog.mjs';
export { UPDATE_FEATURES } from './update-checker-catalog.mjs';
export const UPDATE_STATUS_KEY = '_stonks/update-checker/status.json';
export const MONITORED_WORKFLOWS = Object.freeze([
  'daily.yml','unusual-flow.yml','oi-tracker.yml','search-interest.yml',
  'close-bake-fallback.yml','webull-eod.yml','webull-mirror.yml','seed-data.yml','wipe-history.yml','sports-data.yml','sports-props.yml','nba-prop-research.yml',
  'top-picks-watchdog.yml','stale-prs.yml','update-checker.yml','update-checker-tests.yml',
]);
export const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const stamp = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null;
export const isOutputIssue = row => !['available','reference','on-demand','monitor'].includes(row.status);
const clean = x => String(x || '').replace(/[\x00-\x1f]/g,' ').slice(0,180);
const get = (p,path) => path.split('.').reduce((v,k)=>v?.[k],p);
function matches(value,type) {
  return type==='array'?Array.isArray(value):type==='object'?record(value):type==='collection'?Array.isArray(value)||record(value):typeof value===type;
}
export function inspectFeature(spec,payload,now=Date.now(),error=null) {
  const base={id:spec.id,label:spec.label,key:spec.key,maxHours:spec.maxHours,mode:spec.mode || 'output',asOf:null};
  if (!spec.key) return {...base,status:spec.mode,detail:spec.mode==='on-demand'?'Request-driven feature. No scheduled data output; behavior is covered by release tests.':spec.mode==='monitor'?'This independent monitor checks itself for a missing heartbeat.':'Reference page. Covered by renderer and deployment checks; no scheduled data output.'};
  if (error==='invalid')return {...base,status:'invalid',detail:'Published output contains invalid JSON.'};
  if (error) return {...base,status:'unavailable',detail:'The published output could not be read.'};
  if (payload == null) return {...base,status:'missing',detail:'No published output found.'};
  if (!record(payload) || spec.fields.some(field=>{
    const [path,type]=field.split(':');const value=get(payload,path);return value==null || type && !matches(value,type);
  })) return {...base,status:'invalid',detail:'The output does not match its required structure.'};
  // Briefs carry their prior narrative inside a newly stamped build envelope.
  // Inspect that narrative rather than mistaking the wrapper for new content.
  const asOf=stamp(spec.key==='briefs.json'?payload.current?.generatedAtIso:payload.builtAtIso ?? payload.generatedAtIso ?? payload.scannedAt ?? payload.updatedAt ?? payload.asOf ?? payload._meta?.dataBuiltAtIso);
  if (!asOf) return {...base,status:'undated',detail:'No recognized content timestamp. Freshness is unknown.'};
  const age=now-Date.parse(asOf);
  if (age < -300000) return {...base,asOf,status:'invalid',detail:'The output timestamp is in the future.'};
  if (payload.stale===true || age>spec.maxHours*3600000) return {...base,asOf,status:'stale',detail:'The content is flagged stale or exceeds its '+spec.maxHours+'-hour window.'};
  if (producerReportsFailure(payload))
    return {...base,asOf,status:'degraded',detail:'The producer explicitly reports errors or incomplete coverage.'};
  if(spec.id==='calendar'){
    const sources=payload.coverage.officialSources;
    if(sources!=null && (!record(sources) || !Object.values(sources).every(s=>typeof s==='boolean')))return {...base,asOf,status:'invalid',detail:'Calendar source health does not match its required structure.'};
    const health=calendarHealth(payload,now);
    if(health.warnings.length)return {...base,asOf,status:'degraded',detail:[...health.warnings,...health.notices].join(' ')};
    if(health.notices.length)return {...base,asOf,status:'available',detail:health.notices.join(' ')};
  }
  if(spec.id==='news' && payload.sourceHealth!=null){
    if(!Array.isArray(payload.sourceHealth) || !payload.sourceHealth.every(s=>record(s) && ['ok','unchanged','cached','partial','failed','error','unavailable'].includes(s.status)))return {...base,asOf,status:'invalid',detail:'News source health does not match its required structure.'};
    const failed=payload.sourceHealth.filter(s=>s && (s.error || s.partial || ['partial','failed','error','unavailable'].includes(s.status)));
    if(failed.length){
      // Only registry labels and HTTP status codes may enter diagnostics.
      // Never echo arbitrary source labels, response bodies or error text.
      const labels=new Map([...ISSUER_NEWS_SOURCES.map(s=>[s.id,s.name]),...FDA_SPONSORS.map(s=>['fda-'+s.symbol.toLowerCase(),'FDA '+s.symbol]),['eia-crude','EIA crude inventories'],['eia-gas','EIA natural-gas storage']]);
      const names=failed.map(s=>{
        const name=labels.get(s.id) || 'Unrecognized source';
        const http=/\bHTTP ([45]\d{2})\b/.exec(String(s.error || ''))?.[1];
        return name+(http?' (HTTP '+http+')':s.partial || s.status==='partial'?' (partial collection)':' (unavailable)');
      });
      return {...base,asOf,status:'degraded',detail:'News source checks need review: '+[...new Set(names)].join(', ')+'. Other collected news remains available.'};
    }
    if(payload.sourceHealth.some(s=>s.fallback===true))return {...base,asOf,status:'available',detail:'A verified alternate official news feed is in use because its primary endpoint is unavailable. Original article dates are retained.'};
  }
  const summary=payload.summary;
  if (summary && Number.isFinite(summary.failed) && summary.failed>0 && summary.failed/Math.max(1,summary.scanned || summary.failed)>0.05)
    return {...base,asOf,status:'degraded',detail:'More than 5% of the scanner requests failed.'};
  if (spec.id==='owner-market-brief'){
    if(!payload.coverage.every(s=>record(s) && typeof s.status==='string'))return {...base,asOf,status:'invalid',detail:'Brief source coverage does not match its required structure.'};
    const failed=payload.coverage.filter(s=>s.status!=='available');
    if(failed.length){
      const names=failed.map(s=>UPDATE_FEATURES.find(f=>f.key && f.key===s.key)?.label || 'Unidentified source desk');
      return {...base,asOf,status:'degraded',detail:'Brief inputs need review: '+[...new Set(names)].join(', ')+'. Other dated desks remain available.'};
    }
  }
  return {...base,asOf,status:'available',detail:'Published content passes its structure, age and declared-error checks.'};
}
export function summarizeWorkflowRun(run,jobs,repo) {
  if (run.head_branch!=='main' || run.head_repository?.full_name!==repo) return null;
  const path=String(run.path || '').replace(/^\.github\/workflows\//,'').split('@')[0];
  if (!MONITORED_WORKFLOWS.includes(path) || !Number.isSafeInteger(run.id) || !stamp(run.updated_at) || !stamp(run.created_at)) return null;
  const build=jobs.find(j=>j.name==='build');
  const failures=jobs.filter(j=>['failure','timed_out','cancelled','action_required'].includes(j.conclusion)).map(j=>({job:clean(j.name),steps:(j.steps || []).filter(s=>['failure','timed_out','cancelled'].includes(s.conclusion)).map(s=>clean(s.name)).slice(0,10)}));
  const fullBuild=path==='daily.yml' && !!build && build.conclusion!=='skipped';
  const built=(build?.steps || []).find(s=>s.name==='Build site');
  const published=(build?.steps || []).find(s=>s.name==='Flush verified data to private store');
  return {id:run.id,attempt:run.run_attempt || 1,workflow:path,name:clean(run.name),status:run.status,
    conclusion:clean(run.conclusion || 'pending'),updatedAt:run.updated_at,createdAt:run.created_at,startedAt:stamp(run.run_started_at) || run.created_at,sha:clean(run.head_sha),
    url:'https://github.com/'+repo+'/actions/runs/'+run.id,failures,fullBuild,
    buildConclusion:fullBuild?build.conclusion || 'pending':null,siteBuild:fullBuild?built?.conclusion || 'not_reached':null,publication:fullBuild?published?.conclusion || 'not_reached':null,
    scope:fullBuild?'Full data build':path==='daily.yml'?'Brief, transcript or routing run':'Workflow'};
}
export const completed = r => !r.status || r.status==='completed';
export const successfulFullBuild = r => r.fullBuild && completed(r) && r.buildConclusion==='success' && r.siteBuild==='success' && r.publication==='success';
export function mergeWorkflowReports(previous,incoming,checkedAt) {
  if (previous && (previous.version!==1 || !Array.isArray(previous.runs))) throw new Error('Invalid saved checker report');
  const runs=new Map();
  for (const r of [...(previous?.runs || []),...incoming]) {
    if (!r) continue;const prior=runs.get(r.id);
    if (!prior || r.attempt>prior.attempt || r.attempt===prior.attempt && r.updatedAt>=prior.updatedAt) runs.set(r.id,r);
  }
  const ordered=[...runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt) || b.id-a.id),keep=new Set();
  for (const path of MONITORED_WORKFLOWS) ordered.filter(r=>r.workflow===path).slice(0,path==='daily.yml'?20:8).forEach(r=>keep.add(r.id));
  for (const test of [r=>r.fullBuild && completed(r),successfulFullBuild]) {const r=ordered.find(test);if(r)keep.add(r.id);}
  return {version:1,checkedAt,runs:ordered.filter(r=>keep.has(r.id))};
}
// A missing dispatch is a failure too. Allow 45 minutes for the due slot.
// Compare dispatch time, so a delayed morning completion cannot cover the close.
export function expectedBuildSlot(now,slots=[600,660,810,930,970],grace=45) {
  const clock=etClock(now),session=sessionForDate(clock.date);
  if(!session)return null;
  const due=session.open?slots.filter(m=>m+grace<=clock.minute).at(-1):null;
  if(due!=null)return {date:clock.date,minute:due};
  const date=previousTradingDate(clock.date);return date?{date,minute:slots.at(-1)}:null;
}
function coversSlot(run,slot) {const c=etClock(Date.parse(run.createdAt));return c.date>slot.date || c.date===slot.date && c.minute>=slot.minute;}
export function assessWorkflows(report,now=Date.now()) {
  if (!report || report.version!==1 || !stamp(report.checkedAt) || !Array.isArray(report.runs)) return {status:'unknown',detail:'No valid workflow report yet. The scheduled monitor has not reported.',workflows:[],fullBuild:null,lastSuccessfulFullBuild:null};
  const runs=report.runs,fullBuild=runs.find(r=>r.fullBuild && completed(r)) || null,lastSuccessfulFullBuild=runs.find(successfulFullBuild) || null;
  const workflows=MONITORED_WORKFLOWS.map(path=>({path,latest:runs.find(r=>r.workflow===path) || null,latestCompleted:runs.find(r=>r.workflow===path && completed(r)) || null}));
  const expected=expectedBuildSlot(now),missed=expected && !runs.some(r=>successfulFullBuild(r) && coversSlot(r,expected));
  const stuck=runs.filter(r=>!completed(r) && now-Date.parse(r.startedAt || r.createdAt)>90*60000);
  const failed=workflows.some(w=>w.latestCompleted && !['success','neutral','skipped'].includes(w.latestCompleted.conclusion)) || fullBuild && fullBuild.buildConclusion!=='success';
  const diagnosticRuns=workflows.map(w=>w.latestCompleted).filter(Boolean);
  if(fullBuild && !diagnosticRuns.includes(fullBuild))diagnosticRuns.push(fullBuild);
  const degraded=diagnosticRuns.some(r=>r.diagnostics?.findings?.length) || report.artifacts?.issueCount>0 || report.artifacts?.complete===false;
  const logsUnknown=diagnosticRuns.some(r=>r.logsChecked!==true);
  const age=now-Date.parse(report.checkedAt),stale=age>90*60000 || age < -300000;
  const deployment=report.deployment;
  const deploymentBad=deployment && (['failure','error','unknown'].includes(deployment.state) || deployment.state==='pending' && now-Date.parse(deployment.createdAt)>45*60000);
  const status=failed?'failed':stuck.length?'stuck':missed?'overdue':stale?'stale':degraded?'degraded':deploymentBad?'deployment':logsUnknown || !expected?'unknown':'available';
  const detail={failed:'One or more workflows need attention.',stuck:'A workflow has been queued or running for over 90 minutes.',overdue:'The latest scheduled full build has not published successfully.',stale:'The independent monitor has missed its 90-minute heartbeat.',degraded:'Workflow logs report errors or degraded output despite the run result.',deployment:'The current main code deployment needs review.',unknown:'Monitoring coverage is incomplete. Some logs or calendar dates could not be checked.',available:'No issue found in the observed workflows, logs and code deployment.'}[status];
  return {status,detail,checkedAt:report.checkedAt,monitorStale:stale,expectedSession:expected?.date,expectedSlot:expected,workflows,fullBuild,lastSuccessfulFullBuild,stuck,deployment};
}
export async function inspectPublishedFeatures(store,now=Date.now(),cache=new Map()) {
  const features=[];
  for(let i=0;i<UPDATE_FEATURES.length;i+=5)features.push(...await Promise.all(UPDATE_FEATURES.slice(i,i+5).map(async spec=>{
    if(!spec.key)return inspectFeature(spec,null,now);
    if(!cache.has(spec.key))cache.set(spec.key,(async()=>{try{const bytes=await store.get(spec.key);try{return {payload:bytes==null?null:JSON.parse(bytes.toString('utf8'))};}catch{return {error:'invalid'};}}catch{return {error:'unavailable'};}})());
    const {payload,error}=await cache.get(spec.key);return inspectFeature(spec,payload,now,error);
  })));
  return features;
}

// Cadence checks detect a single desk carried forward inside an otherwise green
// publication. Observation-only/date-only contexts keep their own age windows.
export async function checkFeatureCadence(features,cache,report,now=Date.now()) {
  const successful=report.runs.find(successfulFullBuild);
  for(const row of features){
    if(row.status!=='available' || !row.key)continue;
    const spec=UPDATE_FEATURES.find(f=>f.id===row.id),payload=(await cache.get(row.key))?.payload;
    let expected=null;
    if(spec.cadence==='full' && payload?.builtAtIso && !['brief','calls','f13','bonds-usd','fear-greed'].includes(spec.id) && successful){
      const c=etClock(Date.parse(successful.createdAt));expected={date:c.date,minute:c.minute};
    }
    if(spec.cadence==='swing')expected=expectedBuildSlot(now,[660,930]);
    if(spec.cadence==='scanner')expected=expectedBuildSlot(now,spec.id==='oi'?[510,1020]:[540,600,660,720,780,840,900,960]);
    if(spec.id==='brief')expected=expectedBuildSlot(now,[510,660,810,970]);
    if(spec.cadence==='weekly'){
      const c=etClock(now),d=new Date(c.date+'T12:00:00Z');let days=(d.getUTCDay()+2)%7;
      if(days===0 && c.minute<810)days=7;d.setUTCDate(d.getUTCDate()-days);expected={date:d.toISOString().slice(0,10),minute:690};
    }
    if(!expected || !row.asOf)continue;
    const datedOnly=/^\d{4}-\d{2}-\d{2}$/.test(row.asOf);
    const actual=datedOnly?{date:row.asOf}:etClock(Date.parse(row.asOf));
    if(actual.date<expected.date || !datedOnly && actual.date===expected.date && actual.minute+5<expected.minute){
      row.status='stale';row.detail='This feature missed its expected refresh: '+expected.date+' '+Math.floor(expected.minute/60)+':'+('0'+expected.minute%60).slice(-2)+' ET.';
    }
  }
  return features;
}
