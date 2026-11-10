// Trusted default-branch code only. No provider calls, broker operations,
// messages, issue writes, or raw log/payload contents in the saved report.
import { readFile,appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MONITORED_WORKFLOWS, UPDATE_STATUS_KEY, summarizeWorkflowRun, mergeWorkflowReports, inspectPublishedFeatures, isOutputIssue, completed, checkFeatureCadence, assessWorkflows } from '../lib/update-checker.mjs';
import { DIAGNOSTICS_VERSION, inspectWorkflowLog, readBoundedText, scanPublishedArtifacts } from '../lib/update-checker-diagnostics.mjs';
export async function collectUpdateStatus({repo,token,fetchImpl=fetch,now=()=>new Date().toISOString(),store,dryRun=false,currentRunId=null}) {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !token)throw new Error('GitHub repository and token required');
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  async function response(path){const res=await fetchImpl('https://api.github.com/repos/'+repo+path,{headers,signal:AbortSignal.timeout(25000)});if(!res.ok)throw Object.assign(new Error('GitHub metadata request failed: '+res.status),{status:res.status});return res;}
  async function get(path){return (await response(path)).json();}
  let previous=null;
  if(!dryRun){if(store.backend!=='r2')throw new Error('Checker requires existing R2 storage');const bytes=await store.rawGet(UPDATE_STATUS_KEY);if(bytes)previous=JSON.parse(bytes.toString('utf8'));}
  const chosen=new Map();
  for(const path of MONITORED_WORKFLOWS){
    const data=await get('/actions/workflows/'+path+'/runs?branch=main&per_page='+(path==='daily.yml'?20:3));
    for(const run of data.workflow_runs){if(String(run.id)!==String(currentRunId))chosen.set(run.id,run);}
  }
  const incoming=[];
  for(const run of chosen.values()){
    const saved=previous?.runs.find(r=>r.id===run.id && r.attempt===(run.run_attempt || 1) && r.updatedAt===run.updated_at && completed(r) && r.diagnosticsVersion===DIAGNOSTICS_VERSION && r.logsChecked===true);
    if(saved){incoming.push(saved);continue;}
    const jobs=[];
    for(let page=1;page<=5;page++){const batch=await get('/actions/runs/'+run.id+'/jobs?filter=latest&per_page=100&page='+page);jobs.push(...batch.jobs);if(jobs.length>=batch.total_count)break;if(page===5)throw new Error('Job metadata exceeds checker limit');}
    const summary=summarizeWorkflowRun(run,jobs,repo);if(!summary)continue;
    summary.logsChecked=true;summary.diagnostics={findings:[],unavailableJobs:0,expiredJobs:0};summary.diagnosticsVersion=DIAGNOSTICS_VERSION;
    for(const job of jobs.filter(j=>j.status!=='queued' && j.conclusion && j.conclusion!=='skipped')){
      try{const text=await readBoundedText(await response('/actions/jobs/'+job.id+'/logs'));summary.diagnostics.findings.push(...inspectWorkflowLog(text).findings);}
      // GitHub answers 410 Gone once a completed run's logs pass the retention
      // window. Nothing can be checked again, so that is a known end state,
      // not missing coverage (it kept old manual runs "unknown" forever).
      catch(e){if(e?.status===410 && completed(summary))summary.diagnostics.expiredJobs++;else{summary.logsChecked=false;summary.diagnostics.unavailableJobs++;}}
    }
    incoming.push(summary);
  }
  const report=mergeWorkflowReports(previous,incoming,now());
  const commit=await get('/commits/main'),statuses=await get('/commits/'+commit.sha+'/status');
  const vercel=statuses.statuses.find(s=>/^vercel(?:$|[ /-])/i.test(s.context));
  report.deployment={sha:commit.sha,state:vercel?.state || 'unknown',createdAt:vercel?.created_at || commit.commit?.committer?.date || now(),checkedAt:now()};
  if(dryRun)return report;
  const cache=new Map();
  try{report.artifacts=await scanPublishedArtifacts(store,cache,Date.parse(now()));}
  catch{report.artifacts={checked:0,total:0,issues:[{key:'inventory',status:'unavailable',detail:'The published inventory could not be read.'}],issueCount:1,complete:false};}
  report.features=await checkFeatureCadence(await inspectPublishedFeatures(store,Date.parse(now()),cache),cache,report,Date.parse(now()));
  report.featureSummary={checkedAt:report.checkedAt,issues:report.features.filter(isOutputIssue).length,total:report.features.length};
  const result=await store.withLease('update-checker',async guard=>{
    // Merge again under the lease: an event-triggered scan can overlap a manual
    // run. Older observations never erase a newer attempt or newer heartbeat.
    const bytes=await store.rawGet(UPDATE_STATUS_KEY),latest=bytes?JSON.parse(bytes.toString('utf8')):null;
    if(latest?.checkedAt>report.checkedAt)return latest;
    report.runs=mergeWorkflowReports(latest,report.runs,report.checkedAt).runs;
    guard();await store.rawPut(UPDATE_STATUS_KEY,Buffer.from(JSON.stringify(report)));return report;
  });
  if(result.busy)throw new Error('Another checker collection is in progress');return result.result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.env.GITHUB_EVENT_NAME==='workflow_run'){
    const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
    if(event.workflow_run?.head_branch!=='main' || event.workflow_run?.head_repository?.full_name!==process.env.GITHUB_REPOSITORY)throw new Error('Untrusted workflow event');
  }
  const {store}=await import('../lib/datastore.mjs');
  const report=await collectUpdateStatus({repo:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN,store,dryRun:process.argv.includes('--dry-run'),currentRunId:process.env.GITHUB_RUN_ID});
  if(process.argv.includes('--dry-run'))console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'### Update Checker\n\nStatus: '+assessWorkflows(report).status+'\n\n'+report.runs.length+' workflow observations; '+(report.features?.length ?? 0)+' features; '+(report.artifacts?.checked ?? 0)+' published artifacts.\n');
  console.log('Update Checker saved: '+report.runs.length+' runs, '+(report.features?.length ?? 0)+' features, '+(report.artifacts?.checked ?? 0)+' stored artifacts; feature issues '+(report.featureSummary?.issues ?? 'not scanned')+', artifact issues '+(report.artifacts?.issueCount ?? 'not scanned')+'.');
}
