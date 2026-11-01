import { UPDATE_FEATURES,mergeWorkflowReports,summarizeWorkflowRun,inspectFeature } from '../../lib/update-checker.mjs';
import { BAKE_REQUIRED_REWRITTEN_FILES } from '../../lib/publication-outputs.mjs';
export const CHECKER_FIXTURE_TIME='2026-11-01T19:00:00Z';
export const CHECKER_REPO='lilseancoc-png/stonks';
export function fixtureRun({id=10,path='daily.yml',conclusion='failure',status='completed',jobs,created='2026-10-30T20:10:00Z',attempt=1}={}){
  return {run:{id,run_attempt:attempt,name:path,path:'.github/workflows/'+path,head_branch:'main',head_repository:{full_name:CHECKER_REPO},status,conclusion,head_sha:'a'.repeat(40),created_at:created,updated_at:created},
    jobs:jobs || [{id:101,name:'build',status:'completed',conclusion,steps:[{name:'Verify party control history',conclusion:'failure'},{name:'Build site',conclusion:'skipped'},{name:'Flush verified data to private store',conclusion:'skipped'}]}]};
}
export function healthyPayload(spec){
  const p={builtAtIso:CHECKER_FIXTURE_TIME};
  for(const field of spec.fields){const [path,type]=field.split(':');p[path]=type==='array'?[]:type==='string'?CHECKER_FIXTURE_TIME:{};}
  if(spec.key==='briefs.json')p.current={generatedAtIso:CHECKER_FIXTURE_TIME};
  return p;
}
export function fixtureArtifacts(){
  const entries=new Map(BAKE_REQUIRED_REWRITTEN_FILES.map(k=>[k,Buffer.from('{}')]));
  for(const spec of UPDATE_FEATURES.filter(s=>s.key))entries.set(spec.key,Buffer.from(JSON.stringify(healthyPayload(spec))));
  return entries;
}
export function fixtureReport(healthy=false){
  const fixture=fixtureRun({conclusion:healthy?'success':'failure'});
  if(healthy)fixture.jobs[0].steps=[{name:'Build site',conclusion:'success'},{name:'Flush verified data to private store',conclusion:'success'}];
  const r=summarizeWorkflowRun(fixture.run,fixture.jobs,CHECKER_REPO);r.logsChecked=true;r.diagnostics={findings:[],unavailableJobs:0};r.diagnosticsVersion=1;
  const report=mergeWorkflowReports(null,[r],CHECKER_FIXTURE_TIME);
  report.deployment={state:'success',sha:'a'.repeat(40),createdAt:CHECKER_FIXTURE_TIME};
  report.features=UPDATE_FEATURES.map(spec=>inspectFeature(spec,spec.key?healthyPayload(spec):null,Date.parse(CHECKER_FIXTURE_TIME)));
  report.artifacts={checked:80,total:80,issues:[],issueCount:0,complete:true};
  report.featureSummary={checkedAt:CHECKER_FIXTURE_TIME,issues:0,total:report.features.length};
  return report;
}
