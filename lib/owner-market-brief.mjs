// Read-only synthesis. Source desks own their signals, entry policy and timestamps.
import { BRIEF_ACCESS_POLICY_VERSION } from './public-data-policy.mjs';
import { unifiedSignalDisplayFactory } from './unified-signal-display.mjs';
import { ownerMarketBriefDisplayFactory } from './owner-market-brief-display.mjs';
import { etClock } from './us-equity-calendar.mjs';
export const OWNER_BRIEF_KEY = 'owner-market-brief.json';
export const OWNER_BRIEF_VERSION = 1;
const HOUR = 3600000;
const display = ownerMarketBriefDisplayFactory();
const unifiedDisplay = unifiedSignalDisplayFactory();
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const records = v => Array.isArray(v) ? v.filter(record) : [];
const rows = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 650) : '';
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
const descriptor = (id, label, key, maxHours = 96, tab = id) => Object.freeze({ id, label, key, maxHours, tab });
// Every Owner destination has an explicit adapter or a shared-source explanation.
export const OWNER_BRIEF_SOURCES = Object.freeze([
  descriptor('market','Market analysis','market-analysis.json'),
  descriptor('risk','Risk analysis','market-analysis.json'),
  descriptor('unified-signal-engine','Unified Signal Engine','unified-signal.json'),
  descriptor('bottom-tracker','Bottom tracker','bottom-tracker.json'),
  descriptor('earnings-forecast','Earnings Forecast','earnings-forecast.json',192),
  descriptor('narratives','Market themes','trends.json'),
  descriptor('grade','Grades','grades.json'),
  descriptor('strategies','Strategy calculator','grades.json'),
  descriptor('picks','Top picks','picks.json'),
  descriptor('leaps','LEAPS','leaps-picks.json'),
  descriptor('stocks','Stock picks','stock-picks.json'),
  descriptor('rotation','Sector rotation','sector-rotation.json'),
  descriptor('levetf','Leveraged ETFs','leveraged-etfs.json'),
  descriptor('open-picks','Open picks','picks-open.json'),
  descriptor('track','Track record','picks-accuracy.json'),
  descriptor('quant','Owner Lab','quant.json'),
  descriptor('historical-data','Historical Data','historical-data.json',192),
  descriptor('party-tracker','Party tracker','party-tracker.json',192),
  descriptor('forced-liquidation','Forced Liquidation Tracker','forced-liquidation.json',192),
  descriptor('leverage-distress','Leverage distress','leverage-distress.json',48,'forced-liquidation'),
]);
export function sourceStatus(payload, now, maxHours = 96) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status:'missing', asOf:null };
  const asOf = stamp(Object.hasOwn(payload,'asOf') ? payload.asOf : payload.generatedAtIso ?? payload.builtAtIso);
  const age = asOf ? now - Date.parse(asOf) : NaN;
  return { status: !Number.isFinite(age) ? 'undated' : age < -300000 ? 'future' : payload.stale === true || age >= maxHours * HOUR ? 'stale' : 'available', asOf };
}
// Translate the published Calendar contract into the Brief's compact inputs.
export function ownerBriefCalendar(calendar, builtAtIso, releases = []) {
  const today = etClock(Date.parse(builtAtIso)).date;
  const events = records(calendar?.events).filter(e=>stamp(e.date) && e.date >= today && e.stale !== true);
  const earnings = events.filter(e=>e.type==='earnings' && text(e.symbol));
  const reports = events.filter(e=>e.type==='report');
  const next = records(calendar?.fomc?.meetings).filter(m=>stamp(m.date) && m.date>=today).sort((a,b)=>a.date.localeCompare(b.date))[0];
  return {
    todayEarnings:earnings.filter(e=>e.date===today).map(e=>({sym:e.symbol,session:e.session || 'TBD'})),
    upcomingEarn:earnings.filter(e=>e.date>today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6).map(e=>({sym:e.symbol,date:e.date,session:e.session || 'TBD'})),
    todayReports:reports.filter(e=>e.date===today).map(e=>({title:e.title,subtype:e.subtype || null,actual:e.actual ?? null,consensus:e.consensus ?? null,previous:e.previous ?? null})),
    upcomingReports:reports.filter(e=>e.date>today).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5).map(e=>({title:e.title,date:e.date})),
    releases:records(releases),
    nextFomc:next ? {date:next.date,daysOut:Math.round((Date.parse(next.date)-Date.parse(today))/86400000)} : null,
  };
}
function supportedForecast(company, now) {
  const f = company.forecast;
  if (company.former || !['ready','partial'].includes(f?.status)) return false;
  const cutoff = stamp(f.cutoffAt);
  if (!cutoff || Date.parse(cutoff) > now || now-Date.parse(cutoff) >= 45*86400000) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.target?.end || '') || !stamp(f.target.end) || !/^[A-Z]{3}$/.test(f.currency || '')) return false;
  if (num(f.outputs?.revenue) === null && num(f.outputs?.eps) === null) return false;
  const resolved = records(company.evaluations).some(e=>e.runId===f.id && stamp(e.firstSeenAt || e.actualAvailableAt) && Date.parse(e.firstSeenAt || e.actualAvailableAt)<=now);
  const reported = rows(f.warnings).some(w=>typeof w==='string' && w.includes('later vendor reporting period'));
  return !resolved && !reported;
}
export function buildOwnerMarketBrief({ builtAtIso, payloads = {}, publicScan = null, publicCore = null, previous = null } = {}) {
  const now = Date.parse(builtAtIso);
  if (!Number.isFinite(now)) throw new Error('Owner brief requires a valid timestamp');
  const coverage = OWNER_BRIEF_SOURCES.map(s => {
    const p = payloads[s.key];
    // These desks have a separate observation cutoff; rebuilding the envelope
    // cannot refresh the observations that produced their interpretation.
    const observationAt = s.id === 'historical-data' ? p?.sourceBuiltAtIso || p?.cutoff : p?.asOf;
    const status = sourceStatus(observationAt !== undefined ? {...p,asOf:observationAt} : p,now,s.maxHours);
    if (status.status === 'available' && s.id === 'unified-signal-engine' && !unifiedDisplay.valid(p)) status.status = 'invalid';
    return { ...s, ...status, assembledAt:stamp(p?.builtAtIso), audience:'owner' };
  });
  const get = id => coverage.find(s => s.id === id)?.status === 'available' ? payloads[coverage.find(s => s.id === id).key] : null;
  const findings = [];
  const add = (id, title, detail, priority = 2, symbol = null) => {
    if (!text(detail)) return;
    const source = coverage.find(s => s.id === id);
    findings.push({ id: id + ':' + (symbol || findings.filter(f=>f.source===source.label).length), tab:source.tab, source:source.label, asOf:source.asOf, title:text(title), detail:text(detail), priority, symbol });
  };
  const market = get('market');
  const rawRegime = market?.macroRegime;
  const regime = rawRegime?.dataQuality?.sufficient !== false && ['risk-on','neutral','risk-off','severe-risk-off'].includes(rawRegime?.state) ? rawRegime : null;
  if (regime && regime.dataQuality?.sufficient !== false && regime.state !== 'insufficient-data') {
    add('market', 'Market posture · ' + (regime.state || 'unclassified'), [rows(regime.drivers).join(', '), regime.fragile ? 'Internals are fragile; index strength needs broader confirmation.' : '', sourceStatus(market.scenarioEngine,now).status === 'available' ? market.scenarioEngine?.decision?.note : ''].filter(Boolean).join(' '), 0);
  }
  // These are existing conditional paths; weights are deliberately not recast as odds.
  const scenarioEngine = market?.scenarioEngine;
  const scenarioStatus = sourceStatus(scenarioEngine, now);
  const scenarios = scenarioStatus.status === 'available' && scenarioEngine?.dataQuality?.sufficient !== false ? records(scenarioEngine.scenarios).slice(0,3).map(s => ({
    name:text(s.name), driver:text(s.driver), horizon:text(scenarioEngine.horizon) || '5–10 sessions',
    asOf:scenarioStatus.asOf, paths:records(s.paths).slice(0,3).map(p => ({ label:text(p.label), condition:text(p.condition), outcome:rows(p.reactions).map(text).filter(Boolean).join(' ') })),
  })).filter(s => s.paths.length) : [];
  const catalysts = (scenarioStatus.status === 'available' ? records(scenarioEngine?.catalysts) : []).filter(c => {
    const date = stamp(c.date); return date && c.date.slice(0,10) >= etClock(now).date && Date.parse(c.date) <= now + 14 * 86400000;
  }).slice(0,8).map(c => ({ title:text(c.label || c.title || c.name || c.type), date:c.date, source:'Market scenario calendar', tab:'calendar' }));
  const bottom = get('bottom-tracker');
  if (bottom?.verdict) add('bottom-tracker', 'Recovery checklist · ' + bottom.verdict, bottom.summary || bottom.method, ['potential','emerging','confirmed'].includes(bottom.verdict) ? 1 : 2);
  const themes = get('narratives');
  for (const theme of records(themes?.narratives).slice(0,3)) add('narratives', theme.name || theme.title || 'Active theme', theme.thesis || theme.summary || theme.description, 2);
  const grades = get('grade')?.grades;
  if (grades && typeof grades === 'object') add('grade','Grade coverage', `${Object.values(grades).filter(g=>g?.pillars).length} stored grades available. Use the linked breakdown to separate business quality, price structure, positioning and news; grade magnitude is not a win probability.`, 3);
  if (get('strategies')) add('strategies','Choose the vehicle after the thesis', 'The calculator uses your selected contract and assumptions. It adds no independent market signal; review liquidity, implied volatility and maximum loss for the chosen structure.', 4);
  const unified = get('unified-signal-engine');
  const decisions = records(unified?.decisions);
  const policyCurrent = !!unified && !unifiedDisplay.expired(unified,now);
  const ideas = decisions.filter(d => d.symbol && ['eligible','wait','watch','avoid'].includes(d.status)).slice(0,8).map(d => {
    const supporting = records(d.evidence).filter(e => e.effect === 'supports' && !e.unavailable).slice(0,3);
    const opposing = records(d.evidence).filter(e => e.effect === 'opposes' && !e.unavailable).slice(0,3);
    const plan = d.plan?.valid === true ? d.plan : null;
    const quoteExpiry = stamp(d.quote?.validUntil);
    const policyValidUntil = quoteExpiry ? new Date(Math.min(Date.parse(unified.validUntil),Date.parse(quoteExpiry))).toISOString() : null;
    const rowCurrent = policyCurrent && !!policyValidUntil && now < Date.parse(policyValidUntil) && unifiedDisplay.status(d,unified,now) === d.status;
    return { symbol:text(d.symbol), direction:text(d.direction), status:d.status, policyCurrent:rowCurrent, policyValidUntil, asOf:unified.builtAtIso,
      summary:text(d.summary), thesis:text(d.thesis?.summary), support:supporting.map(e=>text(e.title + ': ' + (e.detail || ''))),
      challenges:opposing.map(e=>text(e.title + ': ' + (e.detail || ''))), blocks:rows(d.blocks).map(text).filter(Boolean).slice(0,5),
      next:text(d.review?.next), invalidators:rows(d.review?.invalidators).map(text).filter(Boolean).slice(0,3),
      trigger:num(d.review?.trigger), target:num(plan?.target), invalidation:num(plan?.invalidation), currency:text(d.quote?.currency),
      horizon:text(unified.horizon?.label), investment:text(d.perspectives?.investment?.label), trading:text(d.perspectives?.trading?.label),
      changes:rows(d.changes?.items).map(text).filter(Boolean).slice(0,3),
      suggestion: d.status === 'avoid' ? 'Keep this off the entry shortlist while its existing blockers remain.' : !rowCurrent ? 'Reference research only. Refresh the decision desk before considering an entry.' : d.status !== 'eligible' ? 'Watch for the published confirmation conditions; the current desk has not qualified an entry.' : 'Review the existing qualified plan, current quote and account risk before considering it. This brief supplies no new approval.',
    };
  });
  if (unified) add('unified-signal-engine','Decision desk priorities', `${decisions.filter(d=>d.status==='eligible').length} ideas qualified at the source build; ${decisions.filter(d=>d.status==='wait').length} waiting. These are source-build states, not a current approval. Review each idea's quote and policy expiry before considering it.`, 1);
  for (const id of ['picks','leaps','stocks','rotation','levetf']) {
    const p = get(id); if (!p) continue;
    const listKey = id === 'levetf' ? 'ideas' : ['stocks','rotation'].includes(id) ? 'candidates' : 'picks';
    if (!Array.isArray(p[listKey])) { add(id,'Roster unavailable','The stored roster could not be read. Open the source after its next successful refresh.',3); continue; }
    const list = records(p[listKey]);
    const watchCount = records(p.watch).length;
    add(id, coverage.find(s=>s.id===id).label + ' roster', list.length ? `${list.length} published idea${list.length === 1 ? '' : 's'}${watchCount ? ` and ${watchCount} watch candidate${watchCount === 1 ? '' : 's'}` : ''}. ${list.slice(0,5).map(r=>text(r.symbol || r.sym || r.etf)).filter(Boolean).join(', ')}. These desks share research inputs; repeated names are not independent confirmation. Check the source for its own horizon and entry state.` : `No ideas in the current published roster${watchCount ? `; ${watchCount} watch candidates remain` : ''}. An empty roster does not establish a market direction.`, 3);
  }
  const open = get('open-picks');
  if (open) add('open-picks','Review existing exposure first', `${rows(open.open).length} open model positions. Review their source plans and invalidations before adding correlated exposure. Model positions do not establish your live holdings.`, 1);
  const track = get('track');
  if (track) add('track','Outcome discipline', `${rows(track.closed).length} closed model records in this payload. Use the source's matching policy era, costs and sample definition before interpreting performance. Historical outcomes are not a success probability for today's idea.`, 3);
  const forecastSource = get('earnings-forecast');
  const forecast = forecastSource?.enabled === false ? null : forecastSource;
  const forecasts = records(forecast?.companies).filter(c=>supportedForecast(c,now)).slice(0,5).map(c => ({
    symbol:text(c.symbol), cutoffAt:c.forecast.cutoffAt, period:text(c.forecast.target?.end), currency:text(c.forecast.currency), status:c.forecast.status,
    revenue:num(c.forecast.outputs?.revenue), eps:num(c.forecast.outputs?.eps), warnings:rows(c.forecast.warnings).map(text).filter(Boolean).slice(0,3),
  }));
  if (forecast) add('earnings-forecast','Upcoming earnings assumptions', `${forecasts.length} supported company forecasts shown from ${rows(forecast.companies).length} covered records. Frozen cutoffs and target fiscal quarters remain attached. Unavailable, former, stale and awaiting-source forecasts do not supply numerical predictions here.`, 2);
  const liquidation = get('forced-liquidation');
  if (liquidation) add('forced-liquidation','Pledges and leverage', `${rows(liquidation.rows).length} disclosed research rows. ${liquidation.coverage?.scanHealthy === false ? 'Collection coverage is incomplete. ' : ''}Disclosed pledges and estimated thresholds are conditional risks; they do not prove a margin call or forced sale.`, 1);
  const leverage = get('leverage-distress');
  if (leverage) {
    const hf = leverage.hotFunds;
    if (rows(leverage.errors).length || sourceStatus(hf,now,48).status !== 'available' || num(hf?.counts?.pressure) === null || num(hf?.counts?.deleveraging) === null) add('leverage-distress','Leverage scan needs review','Collection errors or an old underlying fund scan prevent current fund-pressure highlights. Open the source for its coverage and last verified observations.',1);
    else add('leverage-distress','Fund pressure and rebalance context', `${num(hf.counts?.pressure) ?? 0} screened funds under pressure; ${num(hf.counts?.deleveraging) ?? 0} with deleveraging risk. These are inferred from delayed disclosed holdings, not observed forced sales. ETF rebalance estimates and selloff clusters remain source-specific conditional context.`,1);
  }
  const quant = get('quant');
  if (quant) {
    const screens = ['sigma','vrp','pairs','surface','ped'].map(k=>[k,records(quant[k]?.rows).length]).filter(([,n])=>n);
    if (num(quant.dispersion?.impliedCorr) !== null) screens.push(['dispersion proxy',1]);
    add('quant','Owner Lab research context', screens.length ? screens.map(([k,n])=>`${k}: ${n} observations`).join(' · ') + '. Screens share prices and options inputs with the grade. Extremes alone do not establish a reversal.' : 'No populated research screens in the current snapshot.', 3);
  }
  const historical = get('historical-data');
  if (historical) add('historical-data','Historical context', `${Object.keys(historical.indexes || {}).length} index histories. Historical analogs and seasonal paths are descriptive; revised data, overlapping samples and selection limit their forecasting value.`, 4);
  if (get('party-tracker')) add('party-tracker','Political-cycle context','Historical party comparisons describe past returns. Small regime samples and economic confounders prevent a causal or directional prediction from party control alone.',4);
  // Explain the derived risk page rather than fabricate its browser-only live desk inputs.
  if (get('risk')) add('risk','Reconcile the risk desks','Risk analysis combines market, breadth, volume, overnight, gamma and seasonal desks in the browser. Review that live comparison for disagreement; this saved brief does not claim to reproduce its live vote.',2);
  const publicBrief = payloads['briefs.json']?.current;
  const publicState = sourceStatus(publicBrief,now,36);
  const publicRead = publicState.status === 'available' && stamp(publicBrief.generatedAtIso) && publicBrief.accessPolicyVersion === BRIEF_ACCESS_POLICY_VERSION && publicBrief.date === etClock(now).date && display.marketCardValid(publicBrief) ? structuredClone(publicBrief) : null;
  const publicFacts = records(publicScan?.facts).map((f,i)=>({id:'public:'+i,tab:text(f.tab),source:text(f.source),title:'Public research',detail:text(f.text),asOf:null,priority:3}));
  const publicSource = new Map(records(publicScan?.sources).map(s=>[s.label,s]));
  const publicCoverage = [...[...rows(publicScan?.checked),...rows(publicScan?.coreChecked)].filter(label=>label!=='Narratives').map(label=>({label,status:'available',audience:'public',asOf:stamp(publicSource.get(label)?.asOf),maxHours:num(publicSource.get(label)?.maxHours)})), ...rows(publicScan?.missing).filter(label=>label!=='Narratives').map(label=>({label,status:'missing',audience:'public'}))];
  const core = display.marketCardValid(publicCore) ? publicCore : {};
  const breadth = core.breadth && num(core.breadth.up) != null && num(core.breadth.down) != null ? core.breadth : null;
  if (regime && breadth) {
    const total = breadth.up + breadth.down + (num(breadth.flat) || 0);
    if (total > 0 && ((regime.state === 'risk-on' && breadth.down > breadth.up) || (['risk-off','severe-risk-off'].includes(regime.state) && breadth.up > breadth.down))) {
      add('risk','Market and breadth disagree', `The cross-asset regime reads ${regime.state}, while tracked breadth has ${breadth.up} advances and ${breadth.down} declines. Confirm participation and credit before extending the regime's direction to individual stocks.`,0);
    }
  }
  const expiryTimes = coverage.filter(s=>s.status==='available').map(s=>Date.parse(s.asOf)+s.maxHours*HOUR);
  for(const source of publicCoverage)if(source.status==='available' && stamp(source.asOf) && num(source.maxHours)!==null)expiryTimes.push(Date.parse(source.asOf)+source.maxHours*HOUR);
  if (leverage && sourceStatus(leverage.hotFunds,now,48).status==='available') expiryTimes.push(Date.parse(sourceStatus(leverage.hotFunds,now,48).asOf)+48*HOUR);
  if(publicRead)expiryTimes.push(Date.parse(publicRead.generatedAtIso)+36*HOUR);
  if(scenarios.length)expiryTimes.push(Date.parse(scenarioStatus.asOf)+96*HOUR);
  for(const f of forecasts)expiryTimes.push(Date.parse(f.cutoffAt)+45*86400000);
  const validUntil = new Date(Math.min(now+24*HOUR,...expiryTimes.filter(t=>t>now))).toISOString();
  const available = coverage.filter(s=>s.status==='available').length;
  findings.sort((a,b)=>a.priority-b.priority);
  const material = findings.filter(f=>f.priority<=1);
  const headline = material[0]?.title || 'Owner research needs fresh evidence';
  const changes = previous?.version === OWNER_BRIEF_VERSION && Date.parse(previous.builtAtIso) < now ? findings.filter(f=> {
    const before = records(previous.findings).find(p=>p.id===f.id); return before && (before.detail!==f.detail || before.title!==f.title);
  }).slice(0,6).map(f=>({tab:f.tab,title:f.title,detail:f.detail})) : [];
  const report = { version:OWNER_BRIEF_VERSION, builtAtIso, date:etClock(now).date, validUntil,
    status:available ? 'ready':'insufficient-data', headline,
    summary: `${available} of ${coverage.length} Owner desks have usable dated snapshots. ${scenarios.length ? 'The scenario desk supplies conditional paths for the next several sessions.' : 'No fresh conditional market paths are available.'} ${ideas.length ? 'Review the shortlist alongside counterevidence and source entry restrictions.' : 'No usable decision shortlist is available.'}`,
    publicRead, publicCore: structuredClone(core),
    findings, publicFacts:publicFacts.slice(0,32), coverage:[...coverage,...publicCoverage],
    scenarios, catalysts, ideas, forecasts, changes,
    priorities: material.slice(0,4),
    limits:['Conditional outcomes are research scenarios, not calibrated probabilities or price forecasts.', 'Owner desks often reuse the same prices, filings and rubric. Agreement is not independent confirmation.', 'Research timestamps and frozen forecast cutoffs are preserved. A newly assembled brief does not refresh its inputs.', 'This brief does not change grades, entry approvals, sizing, exits or broker orders. Live account fit is not assessed.'],
    methodology:'Curated from existing public and Owner research on each full site build. No additional provider requests or model calls.',
  };
  if (!display.valid(report)) throw new Error('Owner brief failed its serialized data contract');
  return report;
}
