// Reproducible, offline reference-label evaluation. No network, AI or data/ writes.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parseEiaCrude,parseEiaGas,parseFdaApprovals,FDA_SPONSORS,issuerEventClass} from '../lib/free-news-sources.mjs';
import {headlineDirection,matchingSignalHeadline,supportedCatalyst} from '../lib/news-policy.mjs';
const referenceText=await readFile(new URL('./fixtures/news/reference.json',import.meta.url),'utf8');
const reference=JSON.parse(referenceText);
const referenceSha256=createHash('sha256').update(referenceText).digest('hex');
const asOf=Date.parse(reference.asOf), publishedAt=new Date(asOf-3600000).toISOString();
const outcomes=[];
function record(group,row,actual){outcomes.push({group,id:row.id,title:row.title || row.body,expected:row.expected,actual,pass:actual===row.expected,...(row.url?{sourceUrl:row.url}:{})});}
for(const row of reference.issuers)record('issuer-event',row,issuerEventClass(row.title));
for(const row of reference.direction)record('headline-direction',row,headlineDirection(row.title));
for(const row of reference.signals){const signal={evidence:row.title,[row.kind==='contract'?'status':'direction']:row.value};record('scoring-support',row,!!matchingSignalHeadline(signal,[{title:row.title,publishedAt}],row.kind,asOf));}
for(const row of reference.catalysts)record('catalyst-date',row,!!supportedCatalyst({title:row.title,date:row.date,sourceTitle:'Acme investor day announcement'},[{title:'Acme investor day announcement',body:row.body,publishedAt,link:'https://www.apple.com/newsroom/investor-day'}],asOf));
const official=JSON.parse(await readFile(new URL('./fixtures/news/official-data.json',import.meta.url),'utf8'));
for(const [name,event,expected] of [
  ['crude',parseEiaCrude(official.crude,['USO'],asOf).events[0],{actual:412517,previous:415577,change:-3060,units:'thousand barrels',period:'2026-10-16',releaseDate:'2026-10-21',consensus:null,surprise:null}],
  ['gas',parseEiaGas(official.gas,['VST'],asOf).events[0],{actual:3644,previous:3567,change:77,units:'billion cubic feet',period:'2026-10-16',releaseDate:'2026-10-22',consensus:null,surprise:null}],
])for(const [field,value] of Object.entries(expected))record('official-energy-fields',{id:name+'-'+field,title:name+' '+field,expected:value,url:official.sources[name]},event.facts[field]);
const approval=parseFdaApprovals(official.fda,FDA_SPONSORS[0],['LLY'],Date.parse('2010-11-24T20:00:00Z')).events[0];
for(const [field,value] of Object.entries({applicationNumber:'NDA022504',sponsor:'ELI LILLY AND CO',action:'original-approval',actionDate:'2010-11-23'}))record('historical-fda-fields',{id:'fda-'+field,title:'Historical FDA replay '+field,expected:value,url:official.sources.fda},approval.facts[field]);
const groups=Object.fromEntries([...new Set(outcomes.map(r=>r.group))].map(group=>{const rows=outcomes.filter(r=>r.group===group);return [group,{correct:rows.filter(r=>r.pass).length,total:rows.length,agreementPct:Math.round(10000*rows.filter(r=>r.pass).length/rows.length)/100}];}));
const issuer=outcomes.filter(r=>r.group==='issuer-event');
const tp=issuer.filter(r=>r.expected!==null&&r.actual!==null).length,fp=issuer.filter(r=>r.expected===null&&r.actual!==null).length,fn=issuer.filter(r=>r.expected!==null&&r.actual===null).length;
const report={version:1,referenceSha256,asOf:reference.asOf,method:reference.method,groups,issuerAdmission:{truePositive:tp,falsePositive:fp,falseNegative:fn,precisionPct:tp+fp?100*tp/(tp+fp):null,recallPct:tp+fn?100*tp/(tp+fn):null},failures:outcomes.filter(r=>!r.pass),outcomes};
const arg=process.argv.indexOf('--output');
if(arg>=0){if(!process.argv[arg+1])throw Error('--output requires a path');await writeFile(process.argv[arg+1],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({groups,issuerAdmission:report.issuerAdmission,failures:report.failures},null,2));
if(report.failures.length)process.exitCode=1;
