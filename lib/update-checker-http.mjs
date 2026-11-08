import { getSession } from './session.mjs';
import { UPDATE_STATUS_KEY,UPDATE_FEATURES,assessWorkflows,isOutputIssue } from './update-checker.mjs';
export async function handleUpdateChecker(req,res,dependencies={}) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');
  const env=dependencies.env || process.env;
  if(env.PRIVATE_DATA_ENABLED!=='1')return res.status(404).json({error:'Update Checker requires private data storage'});
  const session=await (dependencies.getSession || getSession)(req).catch(()=>null);
  if(!session || session.tr!==true || session.tp!==true)return res.status(401).json({error:'Owner session required'});
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Read-only endpoint'});}
  if(!['status','summary'].includes(req.query?.checker) || req.query.data!=null || req.query.lab!=null)return res.status(400).json({error:'Invalid checker request'});
  try {
    const store=dependencies.store || (await import('./datastore.mjs')).store,now=dependencies.now ?? Date.now();
    let report=null;const bytes=await store.rawGet(UPDATE_STATUS_KEY);if(bytes)report=JSON.parse(bytes.toString('utf8'));
    const monitor=assessWorkflows(report,now);
    const observed=new Map((Array.isArray(report?.features)?report.features:[]).map(f=>[f.id,f]));
    const features=UPDATE_FEATURES.map(f=>observed.get(f.id) || {...f,status:f.key?'unknown':f.mode,asOf:null,detail:'Awaiting the next independent scan.'});
    const issues=features.filter(isOutputIssue).length,artifactIssues=report?.artifacts?.issueCount ?? report?.artifacts?.issues?.length ?? 0;
    const attentionCount=issues+artifactIssues;
    if(req.query.checker==='summary')return res.status(200).json({version:1,monitor,issues,attentionCount});
    // Data source health (lib/source-health.mjs, written by the bake): which
    // outside feeds are carried forward and for how long. Optional; an
    // unreadable file leaves the section out rather than failing the status.
    let sources=null;
    try{const sb=await store.get('source-health.json');if(sb){const parsed=JSON.parse(sb.toString('utf8'));if(parsed && Array.isArray(parsed.sources))sources={builtAtIso:parsed.builtAtIso || null,reviewStreak:parsed.reviewStreak ?? 3,counts:parsed.counts || null,sources:parsed.sources.map(r=>({id:r.id,label:r.label,provider:r.provider,cadence:r.cadence,state:r.state,at:r.at || null,ageHours:r.ageHours ?? null,carried:r.carried ?? 0,flagged:r.flagged ?? 0,failed:r.failed ?? 0,badDays30:r.badDays30 ?? 0,streak:r.streak ?? 0,review:r.review===true,detail:String(r.detail || '').slice(0,200)}))};}}catch{sources=null;}
    return res.status(200).json({version:1,observedAt:report?.checkedAt || null,status:attentionCount || monitor.status!=='available'?'attention':'available',issues,attentionCount,monitor,features,artifacts:report?.artifacts || null,sources,
      limitation:'Every site feature is accounted for. Scheduled outputs, workflow diagnostics and stored JSON artifacts are checked automatically. Reference pages and request-driven interactions are identified separately and covered by release tests. These checks cannot prove every calculation, source fact, live API response or broker fill.'});
  }catch{return res.status(503).json({error:'Update Checker is unavailable. Try again.'});}
}
