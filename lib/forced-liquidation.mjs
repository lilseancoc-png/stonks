// No network or persistence here. A pledged holding is not a margin call, and
// a credit limit is not the principal actually outstanding against that holding.
import { completedCloseCutoff, isHistoricalTradingDate } from './historical-market-calendar.mjs';
export const LIQUIDATION_KEY = 'forced-liquidation.json';
export const LIQUIDATION_VERSION = 1;
export const LIQUIDATION_EVIDENCE_VERSION = 5;
export const LIQUIDATION_POLICY = Object.freeze({
  scenarioLtvs: [0.35, 0.5, 0.65], nearTriggerPct: 15, volumeWarningPct: 20,
  quoteMaxAgeHours: 96, engineEvidenceMaxAgeDays: 90, observationMaxAgeDays: 400,
  evidenceVersion: LIQUIDATION_EVIDENCE_VERSION,
});
const DAY = 86400000;
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const dayKey = date => new Date(date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const liquidationObservationId = r => `${r.accessionNumber}:${r.fragmentId}`;
// A reported margin call, pledgee sale or foreclosure counts as current for
// this many days after its fact (or filing) date.
export const LIQUIDATION_EVENT_RECENT_DAYS = 30;
export const PLEDGE_STRESS_BANDS = Object.freeze({ high: 60, elevated: 35 });

// Completed daily closes from the chain, plus the dated quote. Used to read
// how far a pledged stock has fallen since the pledge was disclosed.
export function liquidationPriceContext(chain, sinceDate, now) {
  if (!chain) return null;
  const bars = chain._bars || chain.priceSeries || chain.technicals?.dailyBars || chain.bars;
  let rows = [];
  if (Array.isArray(bars)) rows = bars.map(b => ({ t: b?.t ?? b?.date, c: b?.c ?? b?.close }));
  else if (Array.isArray(bars?.t)) rows = bars.t.map((t, i) => ({ t, c: bars.c?.[i] }));
  const cutoff = completedCloseCutoff(now), closes = new Map();
  for (const r of rows) {
    const stamp = typeof r.t === 'number' ? new Date(r.t < 1e12 ? r.t * 1000 : r.t) : null;
    const date = stamp ? (Number.isFinite(stamp.getTime()) ? stamp.toISOString().slice(0, 10) : '') : String(r.t || '').slice(0, 10);
    if (isHistoricalTradingDate(date) && date <= cutoff && positive(r.c)) closes.set(date, r.c);
  }
  const series = [...closes].sort(([a], [b]) => a.localeCompare(b));
  if (!series.length) return null;
  const last = positive(chain.spot) ? chain.spot : series.at(-1)[1];
  const yearAgo = new Date(Date.parse(now) - 365 * DAY).toISOString().slice(0, 10);
  const high52 = Math.max(...series.filter(([d]) => d >= yearAgo).map(([, c]) => c), last);
  const since = typeof sinceDate === 'string' ? sinceDate.slice(0, 10) : null;
  const anchor = since ? series.filter(([d]) => d <= since).at(-1) : null;
  return { last, high52,
    closeAtDisclosure: anchor ? anchor[1] : null, disclosureCloseDate: anchor ? anchor[0] : null,
    changeSinceDisclosurePct: anchor ? (last / anchor[1] - 1) * 100 : null,
    fromHighPct: high52 > 0 ? (last / high52 - 1) * 100 : null };
}

// Research-only pressure score for a disclosed pledge (0-100). It needs no
// loan balance or LTV: price damage since the disclosure, damage from the
// 52-week high, how many days of volume the pledged block is, how much of
// the float it is, a modeled trigger when one exists, and any recent forced-
// sale report on the same stock. Missing inputs score zero and are listed, so
// the score is a floor, never a probability.
export function pledgeStressScore({ row, price = null, recentEvent = null }) {
  if (!row?.pledge?.confirmed || row.state === 'released' || row.state === 'stale') return null;
  const parts = [], missing = [];
  const add = (key, label, points, value) => parts.push({ key, label, points: Math.round(points * 10) / 10, value });
  const drop = price?.changeSinceDisclosurePct;
  if (Number.isFinite(drop)) add('since-disclosure', 'Price change since the pledge was disclosed', Math.min(35, Math.max(0, -drop) * 0.7), drop);
  else missing.push('Price at the disclosure date');
  const fromHigh = price?.fromHighPct;
  if (Number.isFinite(fromHigh)) add('from-high', 'Distance below the 52-week high', Math.min(15, Math.max(0, -fromHigh) * 0.25), fromHigh);
  else missing.push('52-week price range');
  const days = row.pledgedToAdvPct == null ? null : row.pledgedToAdvPct / 100;
  if (Number.isFinite(days)) add('days-volume', 'Pledged shares in days of average volume', Math.min(20, 20 * Math.log10(1 + Math.max(0, days)) / Math.log10(31)), days);
  else missing.push('Pledged shares versus daily volume');
  if (Number.isFinite(row.pledgedToFloatPct)) add('float', 'Pledged shares as a share of float', Math.min(10, Math.max(0, row.pledgedToFloatPct)), row.pledgedToFloatPct);
  else missing.push('Pledged share of float');
  if (Number.isFinite(row.distancePct)) add('trigger', 'Distance to the modeled trigger', row.distancePct <= 0 ? 20 : row.distancePct <= LIQUIDATION_POLICY.nearTriggerPct ? 10 : 0, row.distancePct);
  if (recentEvent) add('event', 'Forced-sale report on this stock in the last 30 days', 20, recentEvent);
  const score = Math.min(100, Math.round(parts.reduce((t, p) => t + p.points, 0)));
  return { score, band: score >= PLEDGE_STRESS_BANDS.high ? 'high' : score >= PLEDGE_STRESS_BANDS.elevated ? 'elevated' : 'low',
    parts, missing, priceAsOf: price ? 'chain' : null,
    note: 'Research screen only. It ranks visible pressure and is not a probability of a margin call. It never changes Top Picks decisions.' };
}

// Shared with the browser. Pledge awareness is independent of loan modeling.
// Keep this function self-contained so the same rule can be serialized.
export function liquidationPledgeDisclosure(observation, evidenceVersion) {
  const r=observation, confirmed=r.kind==='equity-pledge' && r.issuerVerified===true && r.status!=='released';
  const currentParser=r.parserVersion===evidenceVersion;
  const candidates=r.fieldEvidence?.shares;
  const candidate=r.disclosedShares ?? r.sharesPledged ?? (candidates?.length===1?candidates[0]:null);
  const shareBasis=r.disclosedShareBasis || r.shareBasis || 'undisclosed';
  const usable=currentParser && !['ambiguous','unresolved-after-release','percentage-only','undisclosed'].includes(shareBasis);
  const shares=usable && typeof candidate==='number' && Number.isFinite(candidate) && candidate>0?candidate:null;
  return {confirmed,shares,shareBasis,securityClass:r.securityClass || null,
    quoteComparable:r.shareBasis==='stated-current' && !r.splitUnresolved,
    asOfDate:r.asOfDate || null,filingDate:r.filingDate,sourceUrl:r.url};
}

export function liquidationTrigger(principal, shares, maintenanceLtv) {
  if (!positive(principal) || !positive(shares) || !positive(maintenanceLtv) || maintenanceLtv >= 1) return null;
  const price=principal / (shares * maintenanceLtv);
  return positive(price)?price:null;
}
export function distanceToLiquidation(price, trigger) {
  if(!positive(price)||!positive(trigger))return null;
  const distance=(price-trigger)/price*100;
  return Number.isFinite(distance)?distance:null;
}
function ageDays(date, now) {
  if(typeof date!=='string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date))return null;
  const day=date.slice(0,10),dayStamp=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(dayStamp)||new Date(dayStamp).toISOString().slice(0,10)!==day)return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? (Date.parse(now) - t) / DAY : null;
}
function sourceCurrent(r, now, maxDays = LIQUIDATION_POLICY.observationMaxAgeDays) {
  const age = ageDays(r.asOfDate || r.filingDate, now);
  return age != null && age >= 0 && age <= maxDays && r.filingDate <= now.slice(0, 10);
}
function observationKey(r) {
  // Unresolved facilities remain separate. Never sum possibly overlapping
  // collateral from a proxy, a 13D and a Form 4.
  return r.facilityKey && r.borrower && r.symbol && r.securityClass
    ? `${r.symbol}|${r.borrower.toLowerCase()}|${r.facilityKey}|${r.securityClass.toLowerCase()}`
    : liquidationObservationId(r);
}
export function mergeLiquidationObservations(prior = [], fresh = []) {
  const rows = new Map();
  for (const r of [...prior, ...fresh]) {
    if (!r?.accessionNumber || r.fragmentId == null || !r.filingDate || !r.url?.startsWith('https://www.sec.gov/Archives/edgar/data/')) continue;
    rows.set(liquidationObservationId(r), r);
  }
  return [...rows.values()].sort((a,b) => a.filingDate.localeCompare(b.filingDate) || liquidationObservationId(a).localeCompare(liquidationObservationId(b)));
}
function comparable(a, b) {
  return a && b && a.facilityKey && observationKey(a) === observationKey(b)
    && a.currency === 'USD' && b.currency === 'USD'
    && a.principalBasis === 'outstanding' && b.principalBasis === 'outstanding'
    && a.shareBasis === b.shareBasis && a.shareBasis === 'stated-current'
    && a.issuerVerified && b.issuerVerified
    && a.kind==='equity-pledge' && b.kind==='equity-pledge' && a.status!=='released' && b.status!=='released'
    && a.parserVersion===LIQUIDATION_EVIDENCE_VERSION && b.parserVersion===LIQUIDATION_EVIDENCE_VERSION
    && !a.splitUnresolved && !b.splitUnresolved
    && a.asOfDate && b.asOfDate && a.asOfDate !== b.asOfDate;
}
export function liquidationVelocity(previous, latest) {
  if (!comparable(previous, latest)) return null;
  const days = (Date.parse(latest.asOfDate) - Date.parse(previous.asOfDate)) / DAY;
  if (days <= 0 || days > 400 || ![previous.principalBorrowed,latest.principalBorrowed,previous.sharesPledged,latest.sharesPledged].every(positive)) return null;
  const debtChangePct = (latest.principalBorrowed / previous.principalBorrowed - 1) * 100;
  const sharesChangePct = (latest.sharesPledged / previous.sharesPledged - 1) * 100;
  const debtPerShareChangePct = ((latest.principalBorrowed / latest.sharesPledged) / (previous.principalBorrowed / previous.sharesPledged) - 1) * 100;
  if(![debtChangePct,sharesChangePct,debtPerShareChangePct,debtPerShareChangePct*30/days].every(Number.isFinite))return null;
  return { days, debtChangePct, sharesChangePct, debtPerShareChangePct,
    leverageVelocityPct30d: debtPerShareChangePct * 30 / days,
    collateralTopUp: sharesChangePct > 1 && debtChangePct <= 0.5 && debtChangePct >= -0.5,
    previousDate: previous.asOfDate, latestDate: latest.asOfDate,
    interpretation: 'Disclosure-to-disclosure changes, not proof of a lender demand. Splits, refinancing and changes in scope need review.',
  };
}

export function liquidationMarketFromChain(chain, now) {
  if (!chain) return null;
  const bars = chain._bars || chain.priceSeries || chain.technicals?.dailyBars || chain.bars;
  let rows = [];
  if (Array.isArray(bars)) rows = bars;
  else if (Array.isArray(bars?.t)) rows = bars.t.map((t,i) => ({ t, v: bars.v?.[i] }));
  const cutoff = completedCloseCutoff(now);
  const dated = new Map();
  for (const r of rows) {
    const raw = r.t ?? r.date;
    const stamp=typeof raw==='number'?new Date(raw<1e12?raw*1000:raw):null;
    if(stamp&&!Number.isFinite(stamp.getTime()))continue;
    const date=stamp?stamp.toISOString().slice(0,10):String(raw||'').slice(0,10),volume=r.v??r.volume;
    if (isHistoricalTradingDate(date) && date <= cutoff && typeof volume==='number' && Number.isFinite(volume) && volume>=0) dated.set(date, volume);
  }
  const completed = [...dated].sort(([a],[b]) => a.localeCompare(b)).slice(-20);
  const volumeAsOf = completed.at(-1)?.[0] || null;
  const volumeFresh = volumeAsOf && ageDays(volumeAsOf, now) <= 7;
  return { price: positive(chain.spot) ? chain.spot : null, quoteAsOf: chain.quoteAsOf || null,
    averageDailyVolume: completed.length === 20 && volumeFresh ? completed.reduce((s,[,v])=>s+v,0)/20 : null,
    volumeSessions: completed.length, volumeAsOf,
    floatShares: positive(chain.fundamentals?.floatShares) ? chain.fundamentals.floatShares : null,
    source: 'Yahoo Finance regular-session quote and 20 completed daily volume bars',
  };
}

export function assessLiquidationObservation(r, { market = null, previous = null, now, scanHealthy = false } = {}) {
  const missing = [], warnings = [];
  const current = sourceCurrent(r, now);
  const evidenceCurrent=r.parserVersion===LIQUIDATION_EVIDENCE_VERSION;
  const priceAge = market?.quoteAsOf ? ageDays(market.quoteAsOf, now) : null;
  const priceFresh = positive(market?.price) && priceAge != null && priceAge >= -5/1440 && priceAge * 24 <= LIQUIDATION_POLICY.quoteMaxAgeHours;
  const active = r.kind === 'equity-pledge' && r.status !== 'released';
  const event = r.kind === 'liquidation-event';
  const principal = evidenceCurrent && positive(r.principalBorrowed) && r.principalBasis === 'outstanding' && r.currency === 'USD' ? r.principalBorrowed : null;
  const shares = evidenceCurrent && positive(r.sharesPledged) && r.shareBasis === 'stated-current' ? r.sharesPledged : null;
  const maintenance = positive(r.maintenanceLtv) && r.maintenanceLtv < 1 ? r.maintenanceLtv : null;
  if (!principal) missing.push(r.principalBasis === 'capacity' ? 'Outstanding principal, not facility capacity' : 'Outstanding principal in USD');
  if (!shares) missing.push('Current shares pledged to this facility');
  if (!maintenance) missing.push('Disclosed maintenance LTV');
  if (r.collateralBasis !== 'sole-listed-equity') missing.push('Confirmation this stock is the sole collateral');
  if (!r.facilityKey) missing.push('Comparable borrower / facility identity');
  if (!priceFresh || !positive(market?.price)) missing.push('Fresh dated stock quote');
  if (!scanHealthy) warnings.push('Latest SEC scan is incomplete or unavailable. Retained disclosures may have been superseded.');
  if (!current) warnings.push('Disclosure is stale or undated; it is retained for research only.');
  if (!evidenceCurrent) warnings.push('Retained extraction needs a refresh with the current parser. Its numeric fields cannot establish a trigger or entry decision.');
  if(market?.errors?.length)warnings.push('Latest market refresh had missing fields. Retained values keep their original observation dates.');
  if (r.splitUnresolved) warnings.push('Share-count basis needs corporate-action review.');
  if (!r.issuerVerified) warnings.push('Collateral issuer attribution needs review.');
  if (r.collateralBasis === 'mixed') warnings.push('Other collateral prevents a single-stock trigger calculation.');
  const canModel = active && current && r.issuerVerified && !r.splitUnresolved && principal && shares && r.collateralBasis !== 'mixed';
  const candidateTrigger=canModel && maintenance && r.collateralBasis === 'sole-listed-equity' ? liquidationTrigger(principal,shares,maintenance) : null;
  const disclosed = positive(candidateTrigger);
  // Even disclosed loan terms yield an estimate. Cure periods, interest,
  // lender discretion and private amendments can change actual liquidation.
  const scenarios = canModel ? LIQUIDATION_POLICY.scenarioLtvs.map(ltv => ({ ltv,
    price: liquidationTrigger(principal, shares, ltv),
    distancePct: priceFresh ? distanceToLiquidation(market?.price, liquidationTrigger(principal, shares, ltv)) : null,
  })).filter(s=>positive(s.price)) : [];
  const triggerPrice = disclosed ? candidateTrigger : null;
  const distancePct = priceFresh ? distanceToLiquidation(market?.price, triggerPrice) : null;
  const volumeAge=ageDays(market?.volumeAsOf,now);
  const volumeCurrent=market?.volumeSessions===20&&volumeAge!=null&&volumeAge>=0&&volumeAge<=7;
  const liquidityShares=active && current && r.issuerVerified && !r.splitUnresolved ? shares : null;
  const pledgedToAdvPct = liquidityShares && volumeCurrent && positive(market?.averageDailyVolume) ? liquidityShares / market.averageDailyVolume * 100 : null;
  if(market?.averageDailyVolume!=null&&!volumeCurrent)warnings.push('Daily volume is stale or incomplete. Pledged-share liquidity ratios are withheld.');
  const pledgedToFloatPct = liquidityShares && positive(market?.floatShares) ? liquidityShares / market.floatShares * 100 : null;
  const velocity = active && current ? liquidationVelocity(previous, r) : null;
  const engineEligible = !!(disclosed && r.borrower && r.securityClass && r.facilityKey && r.asOfDate && scanHealthy && priceFresh && distancePct!=null && sourceCurrent(r, now, LIQUIDATION_POLICY.engineEvidenceMaxAgeDays));
  const nearTrigger = distancePct != null && distancePct <= LIQUIDATION_POLICY.nearTriggerPct;
  const liquidityWarning = pledgedToAdvPct != null && pledgedToAdvPct > LIQUIDATION_POLICY.volumeWarningPct;
  const eventAge = event ? ageDays(r.asOfDate || r.filingDate, now) : null;
  if (event) missing.length = 0;
  // A Form 144 names a sale date up to ten days ahead; a pending sale is current.
  const state = event ? eventAge != null && eventAge >= -10 && eventAge <= LIQUIDATION_EVENT_RECENT_DAYS ? 'forced-sale-event' : 'past-event'
    : !active ? r.status === 'released' ? 'released' : 'debt-context'
    : !current ? 'stale' : disclosed && !priceFresh ? 'stale-quote' : disclosed && priceFresh && distancePct!=null ? distancePct <= 0 ? 'modeled-breach' : nearTrigger ? 'near-trigger' : 'monitor'
    : scenarios.length ? 'scenario-only' : 'needs-terms';
  return { id: liquidationObservationId(r), symbol:r.symbol, company:r.company, borrower:r.borrower,
    facilityKey:r.facilityKey, securityClass:r.securityClass, observation:r, state, current,
    pledge:liquidationPledgeDisclosure(r,LIQUIDATION_EVIDENCE_VERSION),
    principalBorrowed:principal, sharesPledged:shares, maintenanceLtv:maintenance,
    estimateBasis:disclosed ? 'disclosed-terms' : scenarios.length ? 'assumed-ltv-and-collateral' : 'unavailable',
    triggerPrice, distancePct, scenarios, market, priceFresh, pledgedToAdvPct, pledgedToFloatPct,
    liquidationDaysAt100PctAdv:pledgedToAdvPct == null ? null : pledgedToAdvPct/100,
    velocity, liquidityWarning, missing, warnings, engineEligible,
    vetoLong:engineEligible && nearTrigger,
  };
}

export function buildForcedLiquidationPayload({ observations = [], priorSnapshots = [], coverage = {}, chains = {}, markets = {}, universe = null, builtAtIso } = {}) {
  const tracked = universe == null ? null : new Set(universe);
  const history = mergeLiquidationObservations([], observations).filter(r => r.filingDate <= builtAtIso.slice(0,10) && (!tracked || tracked.has(r.symbol)));
  const groups = new Map();
  for (const r of history) {
    const key = observationKey(r);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  const snapshots = [...priorSnapshots].filter(r => groups.has(r.key) && r.date >= new Date(Date.parse(builtAtIso)-400*DAY).toISOString().slice(0,10));
  const scanAge = ageDays(coverage.lastSuccessAt, builtAtIso);
  const scanHealthy = coverage.status === 'ok' && scanAge != null && scanAge >= 0 && scanAge <= 3;
  const rows = [];
  for (const [key, group] of groups) {
    group.sort((a,b) => (a.asOfDate || a.filingDate).localeCompare(b.asOfDate || b.filingDate) || a.filingDate.localeCompare(b.filingDate));
    const latest = group.at(-1),chainMarket=liquidationMarketFromChain(chains[latest.symbol],builtAtIso),external=markets[latest.symbol];
    const market=external&&(!chainMarket||(Date.parse(external.quoteAsOf)||0)>(Date.parse(chainMarket.quoteAsOf)||0))?external:chainMarket||external||null;
    const previous=group.slice(0,-1).reverse().find(r=>comparable(r,latest));
    const row = assessLiquidationObservation(latest, { market, previous, now:builtAtIso, scanHealthy });
    row.history = group.slice(-12);
    const quoteDay=row.priceFresh?dayKey(market.quoteAsOf):null;
    const past = snapshots.filter(s=>s.key===key && s.quoteAsOf && quoteDay && s.date < quoteDay && Date.parse(s.quoteAsOf)<Date.parse(market.quoteAsOf)).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
    const deltaDays = past ? (Date.parse(market.quoteAsOf)-Date.parse(past.quoteAsOf))/DAY : null;
    // Distance acceleration requires unchanged terms. A top-up itself lowers
    // the trigger and cannot be mistaken for price-driven acceleration.
    row.distanceVelocityPpPerDay = past && deltaDays > 0 && deltaDays <= 10 && row.distancePct != null && past.distancePct != null && past.observationId === row.id
      ? (row.distancePct - past.distancePct) / deltaDays : null;
    row.reflexivityWatch = !!(row.distanceVelocityPpPerDay < -1 && row.liquidityWarning && (row.velocity?.collateralTopUp || row.velocity?.leverageVelocityPct30d > 0));
    if (row.current && row.priceFresh && row.distancePct != null) {
      const s = { key, observationId:row.id, date:quoteDay, quoteAsOf:market.quoteAsOf, distancePct:row.distancePct, price:market.price };
      const i = snapshots.findIndex(p=>p.key===key && p.date===s.date); if(i<0) snapshots.push(s); else snapshots[i]=s;
    }
    rows.push(row);
  }
  // Pledge stress needs the stock's own closes and any recent forced-sale
  // report on the same stock, so it is attached once all rows exist.
  const eventsBySymbol = new Map();
  for (const r of rows) if (r.state === 'forced-sale-event' && r.observation.issuerVerified) eventsBySymbol.set(r.symbol, r.observation.asOfDate || r.observation.filingDate);
  for (const r of rows) {
    const price = r.priceFresh ? liquidationPriceContext(chains[r.symbol], r.observation.asOfDate || r.observation.filingDate, builtAtIso) : null;
    r.stress = r.pledge.confirmed ? pledgeStressScore({ row: r, price, recentEvent: eventsBySymbol.get(r.symbol) || null }) : null;
    if (r.stress && price) r.stress.price = { changeSinceDisclosurePct: price.changeSinceDisclosurePct, disclosureCloseDate: price.disclosureCloseDate, closeAtDisclosure: price.closeAtDisclosure, fromHighPct: price.fromHighPct, high52: price.high52 };
  }
  const rank = { 'forced-sale-event':-1,'modeled-breach':0,'near-trigger':1,monitor:2,'scenario-only':3,'needs-terms':4,'stale-quote':5,stale:6,'past-event':6.5,'debt-context':7,released:8 };
  rows.sort((a,b)=>(rank[a.state]-rank[b.state]) || (a.distancePct ?? Infinity)-(b.distancePct ?? Infinity) || String(a.symbol).localeCompare(String(b.symbol)));
  return { version:LIQUIDATION_VERSION, builtAtIso, policy:LIQUIDATION_POLICY, coverage:{...coverage,scanHealthy}, rows, observations:history, snapshots,
    summary:{ tracked:rows.filter(r=>r.pledge.confirmed).length,
      pledgedStocks:new Set(rows.filter(r=>r.pledge.confirmed).map(r=>r.symbol)).size,
      modeled:rows.filter(r=>r.triggerPrice!=null).length, nearTrigger:rows.filter(r=>r.current && r.priceFresh && r.distancePct!=null && r.distancePct<=LIQUIDATION_POLICY.nearTriggerPct).length,
      assessable:rows.filter(r=>r.current && r.priceFresh && r.distancePct!=null).length,
      comparable:rows.filter(r=>r.current && r.velocity!=null).length,
      topUps:rows.filter(r=>r.velocity?.collateralTopUp).length, needsTerms:rows.filter(r=>r.pledge.confirmed && r.triggerPrice==null).length,
      events:rows.filter(r=>r.state==='forced-sale-event').length, stressHigh:rows.filter(r=>r.stress?.band==='high').length,
      stressScored:rows.filter(r=>r.stress).length },
  };
}

// Reassess against the current decision-run quote. Never trust persisted
// eligibility flags, a stale build stamp or an old distance percentage.
export function forcedLiquidationContext(payload, symbol, chain, now) {
  if (payload?.version !== LIQUIDATION_VERSION || !Array.isArray(payload.observations)) return null;
  const fresh = buildForcedLiquidationPayload({ observations:payload.observations.filter(r=>r.symbol===symbol),
    coverage:payload.coverage, chains:{[symbol]:chain}, builtAtIso:now, priorSnapshots:payload.snapshots || [] });
  const active = fresh.rows.filter(r=>r.observation.kind==='equity-pledge' && r.state!=='released');
  if (!active.length) return null;
  const eligible = active.filter(r=>r.engineEligible);
  const risk = eligible.find(r=>r.vetoLong) || eligible[0] || active[0];
  return { symbol, state:risk.state, engineEligible:risk.engineEligible, vetoLong:risk.vetoLong,
    borrower:risk.borrower, principalBorrowed:risk.principalBorrowed, sharesPledged:risk.sharesPledged,
    maintenanceLtv:risk.maintenanceLtv, triggerPrice:risk.triggerPrice, distancePct:risk.distancePct,
    pledgedToAdvPct:risk.pledgedToAdvPct, pledgedToFloatPct:risk.pledgedToFloatPct,
    collateralTopUp:!!risk.velocity?.collateralTopUp, leverageVelocityPct30d:risk.velocity?.leverageVelocityPct30d ?? null,
    reflexivityWatch:risk.reflexivityWatch, asOfDate:risk.observation.asOfDate || risk.observation.filingDate,
    sourceUrl:risk.observation.url, estimateBasis:risk.estimateBasis,
    note:risk.engineEligible ? 'SEC-disclosed terms, estimated maintenance threshold. A breach is not proof of a margin call or forced sale.' : 'Research only. Missing, stale or ambiguous terms cannot establish a forced-liquidation trigger or change an entry decision.',
  };
}
