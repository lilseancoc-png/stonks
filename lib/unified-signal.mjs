// Owner research over existing observations. No provider, model, or broker calls.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pickDisplayDecision } from './research-display.mjs';
import { marketSession, etClock, previousTradingDate } from './us-equity-calendar.mjs';
import { OPTION_ENTRY_POLICY_VERSION, OPTION_ENTRY_HORIZON_DAYS } from './option-entry-economics.mjs';
import { UNIFIED_SIGNAL_KEY, isUnifiedSignalArchiveKey } from './data-ownership.mjs';
import { unifiedSignalDisplayFactory } from './unified-signal-display.mjs';
import { buildInvestmentPerspective } from './investment-perspective.mjs';
import { buildTradingPerspective } from './trading-perspective.mjs';

export { UNIFIED_SIGNAL_KEY, isUnifiedSignalArchiveKey };
export const UNIFIED_SIGNAL_VERSION = 1;
export const UNIFIED_SIGNAL_MODEL = '2026-10-27-perspectives-v3';
export const UNIFIED_SIGNAL_TTL_MS = 60 * 60 * 1000;
export const UNIFIED_SIGNAL_MAX_BYTES = 4_000_000;
const DAY = 86400000;
const FAMILY_NAMES = { fundamentals: 'Business', technicals: 'Price structure', mechanicals: 'Positioning', narrative: 'News and catalysts' };
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = value => Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
const stamp = value => { const ms = Date.parse(value || ''); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; };
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
const text = value => typeof value === 'string' ? value.trim().slice(0, 800) : '';
const rows = value => Array.isArray(value) ? value : [];

function quoteRead(chain, builtAtIso) {
  const price = number(chain?.spot), provenance = chain?.quoteProvenance;
  // Legacy regular-session timestamps are usable, but never invent currency,
  // a selected upstream field, or a timestamp for an extended-session fallback.
  const asOf = stamp(provenance ? provenance.asOf : chain?.quoteAsOf);
  const marketState = text(provenance?.marketState || chain?.marketState) || null;
  const sourceMs = asOf ? Date.parse(asOf) : null, now = Date.parse(builtAtIso);
  const session = marketSession(now), ageMinutes = sourceMs == null ? null : (now - sourceMs) / 60000;
  const sameDate = sourceMs != null && etClock(sourceMs).date === session.date;
  const referenceDate = session.open && session.minute >= 570 ? session.date : previousTradingDate(session.date);
  const reference = sourceMs != null && etClock(sourceMs).date === referenceDate;
  const usable = price > 0 && sourceMs != null && ageMinutes >= -5 && (sameDate || reference);
  const current = usable && session.trading && marketState === 'REGULAR' && provenance?.field === 'regularMarketPrice' && sameDate && ageMinutes <= 60;
  return { value: price > 0 ? price : null, provider: 'Yahoo Finance', currency: provenance?.currency || null,
    field: provenance?.field || null, asOf, fetchedAt: stamp(provenance?.fetchedAt), marketState,
    exchange: provenance?.exchange || null, ageMinutes: round(ageMinutes), usable, current,
    validUntil: current ? new Date(Math.min(sourceMs + UNIFIED_SIGNAL_TTL_MS, now + (session.closeMinute - session.minute) * 60000 - now % 60000)).toISOString() : null,
    basis: 'Observed market price, not an engine valuation',
    reason: !usable ? 'The price or its source time is missing, future-dated, or outside the latest session.'
      : !current ? 'Reference price only. A current regular-session quote is required before entry.'
        : 'Regular-session observation within the build-time freshness limit.',
    fallback: provenance?.fallback || null };
}

function evidenceFor(symbol, grade, chain, sources, builtAtIso, side) {
  const observations = [], seen = new Set(), now = Date.parse(builtAtIso), direction = side === 'put' ? -1 : 1;
  const add = item => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    const asOf = item.asOf || null, ms = asOf ? Date.parse(asOf) : NaN;
    const future = Number.isFinite(ms) && ms > now + 5 * 60000;
    observations.push({ ...item, asOf, timePrecision: asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? 'day' : 'timestamp') : 'unknown',
      effect: future || !side ? 'context' : item.effect || 'context', unavailable: future || item.unavailable === true });
  };
  for (const [key, label] of Object.entries(FAMILY_NAMES)) {
    const pillar = grade?.pillars?.[key];
    for (const signal of rows(pillar?.signals)) {
      const score = number(signal.score);
      add({ id: `grade:${key}:${signal.key || signal.label}`, family: label, source: 'grades.json',
        sourceField: `${symbol}.pillars.${key}.${signal.key || ''}`, kind: 'interpretation',
        title: text(signal.label) || label, detail: [signal.value == null ? '' : String(signal.value), text(signal.note)].filter(Boolean).join(' · '),
        timeBasis: 'computed-assessment',
        score, value: signal.value ?? null, asOf: builtAtIso,
        effect: signal.available === false || score == null || score === 0 ? 'context' : score * direction > 0 ? 'supports' : 'opposes',
        unavailable: signal.available === false, parent: `pillar:${key}` });
    }
  }
  const headlineSeen = new Set();
  for (const headline of rows(chain?.news?.headlines).slice(0, 12)) {
    const published = stamp(headline.publishedAt), ms = published ? Date.parse(published) : null;
    if (ms == null || ms > now || now - ms > 7 * DAY) continue;
    const identity = text(headline.title).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!identity || headlineSeen.has(identity)) continue;
    headlineSeen.add(identity);
    add({ id: `news:${identity}`, family: 'News and catalysts', source: text(headline.publisher || headline.source) || 'Ticker news',
      title: text(headline.title), detail: 'Original headline context. Already represented in the narrative rubric; not another vote.',
      url: safeUrl(headline.link || headline.url), asOf: published, kind: 'observation', parent: 'pillar:narrative' });
  }
  for (const piece of rows(sources.evidence?.names?.[symbol])) {
    const metricNames = { 'sr-pos':'Position in the support/resistance range', 'sma-gap':'Distance from the moving average', flow:'Signed options activity', volume:'Directional unusual volume', gamma:'Open-interest call/put ratio', 'iv-z':'Implied volatility deviation', 'iv-5d':'Five-day implied volatility change', short:'Short interest change', ats:'Delayed alternative-venue participation', insider:'Net insider purchases', inst:'Institutional holding changes', news:'News tone', earnings:'Earnings evidence', narrative:'Narrative activity', rotation:'Sector rotation', peers:'Peer behavior', inputs:'Business input prices', macro:'Market stress', attention:'Social attention' };
    const sourceNames = { 'finra-si':'FINRA short interest', 'finra-ats':'FINRA delayed venue volume', 'iv-trend':'Implied volatility trend', oi:'Open interest', unusual:'Unusual options activity', volume:'Unusual stock volume', '13f':'SEC institutional filings', form4:'SEC insider filings' };
    add({ id: `record:${piece.src}:${piece.id}`, family: 'Evidence timeline', source: 'Evidence Record', kind: 'measurement',
      title: `${metricNames[piece.id] || 'Recorded measurement'} · ${text(piece.dir) || 'pending'}`, value: number(piece.v),
      detail: `${sourceNames[piece.src] || 'Recorded source'}. ${piece.firstSeen ? `First seen ${piece.firstSeen}. ` : ''}Up/down describes this measurement, not a stock forecast.`,
      asOf: piece.asOf, parent: `measurement:${piece.src}:${piece.id}` });
  }
  for (const [key, label] of [['sigma','Price deviation'],['vrp','Volatility premium'],['surface','Volatility surface'],['ped','Post-earnings behavior']]) {
    const row = rows(sources.quant?.[key]?.rows).find(item => (item.symbol || item.sym) === symbol);
    if (!row) continue;
    const values = Object.entries(row).filter(([k,v]) => !['symbol','sym'].includes(k) && typeof v === 'number' && Number.isFinite(v)).slice(0, 6);
    add({ id: `quant:${key}`, family: 'Quant context', source: 'quant.json', title: label, kind: 'measurement',
      detail: values.map(([k,v]) => `${k}: ${round(v)}`).join(' · ') || 'Research screen observation; not a separate directional vote.',
      asOf: sources.quant.builtAtIso, parent: `shared:${key === 'sigma' ? 'price-bars' : 'option-chain'}` });
  }
  const links = rows(sources.linkMap?.edges).filter(edge => edge.to === `ticker:${symbol}` || edge.from === `ticker:${symbol}`).slice(0, 8);
  for (const edge of links) {
    const id = edge.to === `ticker:${symbol}` ? edge.from : edge.to;
    const node = sources.linkMap.nodes?.[id];
    add({ id: `link:${edge.from}:${edge.to}:${edge.src}`, family: 'Company relationships', source: 'link-map.json', kind: 'exposure',
      title: text(node?.label || id), detail: `${text(edge.kind)} · Exposure relationship, not a causal return prediction.`,
      asOf: edge.asOf, parent: `link:${id}` });
  }
  const sensitivity = rows(sources.scenario?.sensitivities).find(row => row.symbol === symbol);
  if (sensitivity) add({ id: 'market:scenario', family: 'Market context', source: 'market-analysis.json', kind: 'interpretation',
    title: 'Conditional market scenarios', detail: text(sensitivity.decision?.note) || 'Scenario risk context; weights are not calibrated odds.',
    asOf: sources.scenario.builtAtIso, parent: 'shared:macro-regime' });
  const rotation = rows(sources.rotation?.candidates).find(row => row.symbol === symbol);
  if (rotation) add({ id: 'sector:rotation', family: 'Sector context', source: 'sector-rotation.json', kind: 'interpretation',
    title: 'Sector Rotation research candidate', detail: 'Sector and peer context. Shares inputs with the existing grade; not an extra vote.',
    asOf: sources.rotation.builtAtIso, parent: 'shared:sector-price-bars' });
  for (const event of rows(chain?.catalysts).slice(0, 5)) {
    add({ id: `catalyst:${event.date}:${event.title || event.event || event.type}`, family: 'Events', source: 'Ticker catalysts', kind: 'observation',
      title: text(event.title || event.event || event.type) || 'Upcoming catalyst',
      detail: `${event.date || 'Date unverified'}. Event date is not publication time.`, asOf: event.sourcePublishedAt || null, parent: 'pillar:narrative' });
  }
  return observations;
}

function stockPlan(grade, quote, side) {
  const structure = grade?.pillars?.timing?.structure;
  const entry = quote.value, target = number(structure?.target), invalidation = number(structure?.invalidation);
  const direction = side === 'call' ? 1 : side === 'put' ? -1 : 0;
  const risk = direction && entry > 0 && invalidation > 0 ? (entry - invalidation) * direction : null;
  const reward = direction && entry > 0 && target > 0 ? (target - entry) * direction : null;
  const valid = risk > 0 && reward > 0 && structure?.clear === true;
  // Keep the admission value at full precision. Round only when displaying it.
  return { entry, target, invalidation, valid, riskReward: valid ? reward / risk : null,
    targetMovePct: valid ? round(reward / entry * 100) : null, invalidationMovePct: valid ? round(-risk / entry * 100) : null,
    method: structure?.targetKind || null, anchor: structure?.anchorKind || null,
    warning: 'The invalidation is a review/exit rule. Gaps and execution can lose more than the planned distance.' };
}

function vehiclesFor(pick, side, plan, allowed) {
  const cash = { kind: 'cash', label: 'Wait / keep cash', eligible: true, detail: 'No new trade. Interest and inflation are not modeled.' };
  const shares = { kind: 'shares', label: side === 'put' ? 'Short shares not assessed' : 'Shares',
    eligible: allowed && side === 'call' && plan.valid, detail: side === 'put' ? 'Borrow availability, cost, margin, and short-sale risk are not assessed.'
      : 'Conditional stock payoff. Bid/ask, slippage, fees, and dividends are not estimated.',
    targetReturnPct: plan.valid && side === 'call' ? plan.targetMovePct : null,
    invalidationReturnPct: plan.valid && side === 'call' ? plan.invalidationMovePct : null, costsEstimated: false };
  const economics = pick?.optionEconomics || pick?.entry?.economics, contract = pick?.contract;
  const maxLoss = number(economics?.maximumLoss);
  const option = { kind: 'option', label: pick?.strategy?.label || 'Options not qualified', eligible: allowed && !!contract && economics?.eligible === true,
    detail: contract ? 'Existing owner-selected contract. Future marks are modeled, not fills. Returns below use maximum quoted loss as the risk denominator.'
      : 'No current owner-qualified contract. A directional grade alone does not choose an option.',
    structure: contract?.structure || null, expiry: number(contract?.expiry), strike: number(contract?.strike),
    legs: rows(contract?.legs).map(leg => ({ type: leg.type, qty: leg.qty, strike: leg.strike, bid: leg.bid, ask: leg.ask, iv: leg.iv, expiry: leg.expiry || contract.expiry })),
    bid: number(contract?.bid), ask: number(contract?.ask), entryPerShare: number(economics?.entryPrice), maximumLossPerContract: maxLoss > 0 ? round(maxLoss * 100) : null,
    feesEstimated: economics?.feesEstimated === true, reason: economics?.reason || null,
    scenarios: rows(economics?.scenarios).map(row => ({ label: row.label, ivMultiplier: row.ivMultiplier,
      atTargetPctOfRisk: maxLoss > 0 && number(row.atTarget?.pnlPerShare) != null ? round(row.atTarget.pnlPerShare / maxLoss * 100) : null,
      atInvalidationPctOfRisk: maxLoss > 0 && number(row.atInvalidation?.pnlPerShare) != null ? round(row.atInvalidation.pnlPerShare / maxLoss * 100) : null })),
    horizonDays: economics?.horizonDays || null, model: economics?.model || null, expectedReturn: null,
    limitations: ['No calibrated outcome probabilities.', 'Per-contract quote time is unverified.', 'American exercise, assignment and dividend effects are not fully modeled.'] };
  return { choices: [shares, option, cash], preferred: option.eligible ? 'option' : shares.eligible ? 'shares' : 'cash',
    reason: option.eligible ? 'The existing owner strategy and entry checks qualify this option expression. Shares are shown as an alternative; no expected-return optimizer is claimed.'
      : 'Wait for a qualified entry. Conditional payoffs alone do not establish a positive expected return.' };
}

function decisionFor(symbol, grade, chain, sources, builtAtIso, previous) {
  const side = ['call','put'].includes(grade?.side) ? grade.side : null;
  const quote = quoteRead(chain, builtAtIso), timing = grade?.pillars?.timing;
  const currentPicks = stamp(sources.picks?.builtAtIso) === builtAtIso;
  const pick = currentPicks ? rows(sources.picks.picks).find(row => row.symbol === symbol && row.side === side) : null;
  const publishedReady = !!pick && pickDisplayDecision(pick).ready;
  const aiRejected = currentPicks && rows(sources.picks.rosterMeta?.aiVetoed).includes(symbol);
  const evidence = evidenceFor(symbol, grade, chain, sources, builtAtIso, side);
  const supports = evidence.filter(row => row.effect === 'supports' && !row.unavailable);
  const opposes = evidence.filter(row => row.effect === 'opposes' && !row.unavailable);
  const families = [...new Set(supports.map(row => row.family))];
  const plan = stockPlan(grade, quote, side);
  const blocks = [];
  if (!quote.usable) blocks.push(quote.reason);
  if (!grade || number(grade.total) == null) blocks.push('The directional grade is unavailable.');
  if (!side) blocks.push('The existing grade has no qualified directional side.');
  if (!quote.current) blocks.push('A current regular-session price must be checked before entry.');
  if (!quote.currency) blocks.push('The quote currency is unverified.');
  if (!plan.valid) blocks.push('A valid entry, target and invalidation are not available.');
  else if (plan.riskReward < 1.5) blocks.push('The reference reward/risk is below the existing 1.5:1 entry floor.');
  if (aiRejected) blocks.push('The current AI grader rejected this thesis.');
  if (timing?.state === 'avoid' || timing?.hardVeto) blocks.push(text(timing.headline) || 'An entry risk veto is active.');
  if (timing?.state !== 'go' && !publishedReady) blocks.push(text(timing?.headline) || 'Entry timing is not confirmed.');
  const readiness = timing?.readiness;
  if (number(timing?.score) == null || number(timing.score) < 0 || !(number(readiness?.independentFamilies) >= 2)
    || !['directionConfirmed','structureOk','payoffOk','crowdedProof','countertrendProof'].every(key => readiness?.[key] === true)) {
    blocks.push('The full deterministic entry-readiness record is missing or did not clear.');
  }
  if (!pick) blocks.push('No matching current owner trade passed the full entry, strategy and book gates.');
  else if (!pickDisplayDecision(pick).ready) blocks.push(pickDisplayDecision(pick).reason);
  if (pick && (pick.entryPolicyVersion !== OPTION_ENTRY_POLICY_VERSION || (pick.optionEconomics || pick.entry?.economics)?.version !== OPTION_ENTRY_POLICY_VERSION)) blocks.push('The option entry policy version is missing or outdated.');
  if (families.length < 2) blocks.push('Fewer than two supporting rubric families are available.');
  const allowed = blocks.length === 0;
  const status = !quote.usable || !grade || number(grade.total) == null ? 'insufficient-data'
    : aiRejected || timing?.state === 'avoid' || timing?.hardVeto ? 'avoid'
      : allowed ? 'eligible' : side && (timing?.state === 'wait' || pick) ? 'wait' : 'watch';
  const direction = side === 'call' ? 'bullish' : side === 'put' ? 'bearish' : 'mixed';
  const missing = [...new Set([
    ...(!chain?.fundamentals ? ['Company fundamentals'] : []),
    ...(!chain?.news || chain.news.stale || chain.news.fallback ? ['Current source-supported news'] : []),
    ...(!quote.currency ? ['Verified quote currency'] : []),
    ...(!sources.evidence?.names?.[symbol] ? ['Evidence timeline'] : []),
    ...(!sources.scenario || sources.scenario.unavailable ? ['Market scenario context'] : []),
    ...(!currentPicks ? ['A coherent owner trade decision'] : []),
  ])];
  const sensitivities = rows(sources.scenario?.sensitivities).find(row => row.symbol === symbol);
  const stressPaths = rows(sources.scenario?.scenarios).map(scenario => {
    const impact = sensitivities?.scenarios?.[scenario.key];
    return { name: scenario.name, low: quote.value > 0 && number(impact?.low) != null ? round(quote.value * (1 + impact.low / 100)) : null,
      high: quote.value > 0 && number(impact?.high) != null ? round(quote.value * (1 + impact.high / 100)) : null };
  }).filter(row => row.low > 0 && row.high >= row.low);
  const changes = [];
  if (previous) {
    if (previous.direction !== direction) changes.push(`Direction changed from ${previous.direction} to ${direction}.`);
    if (previous.status !== status) changes.push(`Policy state changed from ${previous.status} to ${status}.`);
    if (number(previous.grade) !== number(grade?.total)) changes.push(`Existing grade changed from ${previous.grade ?? 'unavailable'} to ${grade?.total ?? 'unavailable'}.`);
    if (previous.quote?.value !== quote.value) changes.push('The observed stock price changed.');
    const old = new Set(rows(previous.evidence).map(row => row.id));
    const added = evidence.filter(row => !old.has(row.id));
    if (added.length) changes.push(`${added.length} observation(s) were added to this view.`);
    const currentIds = new Set(evidence.map(row => row.id));
    const removed = rows(previous.evidence).filter(row => !currentIds.has(row.id));
    if (removed.length) changes.push(`${removed.length} observation(s) were removed from this view; their support or context is no longer present.`);
    const oldBy = new Map(rows(previous.evidence).map(row => [row.id, row]));
    const meaning = row => JSON.stringify([row.score ?? null, row.value ?? null, row.effect, row.detail, row.unavailable]);
    const changed = evidence.filter(row => oldBy.has(row.id) && meaning(oldBy.get(row.id)) !== meaning(row));
    if (changed.length) changes.push(`${changed.length} existing observation(s) changed value or interpretation.`);
    if (sources.previous.engineVersion !== UNIFIED_SIGNAL_MODEL) changes.push('The research engine version changed; compare rule versions before attributing the result to market evidence.');
  }
  const f = chain?.fundamentals;
  const perspectiveAsOf = sources.assessmentAtIso || builtAtIso;
  const perspectiveQuote = quoteRead(chain, perspectiveAsOf);
  const perspectives = { version: 1, quote: perspectiveQuote,
    investment: buildInvestmentPerspective({ symbol, chain, quote: perspectiveQuote, forecast: sources.forecast, chains: sources.chains, asOf: perspectiveAsOf }),
    trading: buildTradingPerspective({ symbol, chain, quote: perspectiveQuote, chains: sources.chains, ivTrending: sources.ivTrending,
      picks: sources.picks, asOf: perspectiveAsOf, legacyStatus: status, legacySide: side }) };
  if (previous?.perspectives?.investment.status !== undefined && previous.perspectives.investment.status !== perspectives.investment.status) changes.push(`Investment perspective changed from ${previous.perspectives.investment.label} to ${perspectives.investment.label}.`);
  if (previous?.perspectives?.trading.status !== undefined && previous.perspectives.trading.status !== perspectives.trading.status) changes.push(`Trading perspective changed from ${previous.perspectives.trading.label} to ${perspectives.trading.label}.`);
  return { symbol, direction, status, grade: number(grade?.total), sector: grade?.sector || null,
    summary: side ? `${direction === 'bullish' ? 'Bullish' : 'Bearish'} swing research. ${supports.slice(0, 2).map(row => row.title).join(' and ') || 'Supporting evidence is limited'}.`
      : 'The existing evidence does not qualify a directional swing thesis.',
    quote, plan, perspectives, evidence, supportingFamilies: families, supporting: supports.map(row => row.id), opposing: opposes.map(row => row.id),
    blocks: [...new Set(blocks)], vehicles: vehiclesFor(pick, side, plan, allowed),
    uncertainty: { missing, disagreement: opposes.length ? `${opposes.length} rubric observation(s) oppose this direction.` : 'No opposing rubric contribution is recorded; this is not proof of certainty.',
      calibration: 'Unproven', probability: null, expectedReturn: null, accountFit: 'Not assessed. Live holdings, cash and account risk constraints are not connected.',
      dependency: 'Supporting families are related rubric groups, not statistically independent votes. Context records are not added to the grade.' },
    valuation: { intrinsicValue: null, status: 'not-estimated', analystMean: number(f?.targetMeanPrice), analystLow: number(f?.targetLowPrice), analystHigh: number(f?.targetHighPrice),
      analystCount: number(f?.numberOfAnalystOpinions), explanation: 'Analyst consensus is external context. Independent business valuation and a calibrated stock forecast are not available.' },
    stress: { horizon: sources.scenario?.horizon || null, paths: stressPaths, label: 'Conditional macro stress ranges, not a stock forecast or calibrated odds' },
    ai: pick?.finalGrade ? { tier: pick.finalGrade.tier, source: pick.finalGrade.source, reason: pick.finalGrade.reason || null } : null,
    thesis: { summary: text(pick?.thesisCard?.ai?.summary) || null, source: 'Existing owner thesis, reused without another AI call' },
    review: { invalidation: plan.invalidation, invalidators: rows(pick?.thesisCard?.invalidators).map(row => text(row.trigger)).filter(Boolean).slice(0,6), trigger: number(pick?.entry?.trigger), next: 'Next 11:00 or 15:30 ET decision build; review sooner if the thesis or invalidation breaks.' },
    changes: { priorSnapshot: previous ? sources.previous?.snapshotId || null : null, items: changes, firstObservation: !previous } };
}

export function buildUnifiedSignalEngine({ builtAtIso, grades = {}, chains = {}, previous = null, ...sources } = {}) {
  const built = stamp(builtAtIso);
  if (!built) throw new Error('Unified Signal Engine requires a valid decision timestamp');
  if (sources.assessmentAtIso && (!stamp(sources.assessmentAtIso) || Date.parse(sources.assessmentAtIso) < Date.parse(built))) throw new Error('Perspective assessment time must be a valid timestamp at or after the decision build');
  const prior = unifiedSignalDisplayFactory().valid(previous) && Date.parse(previous.builtAtIso) < Date.parse(built) ? previous : null;
  const priorBy = new Map(rows(prior?.decisions).map(row => [row.symbol, row]));
  const symbols = [...new Set([...Object.keys(grades), ...Object.keys(chains)])].sort();
  const decisions = symbols.map(symbol => decisionFor(symbol, grades[symbol], chains[symbol], { ...sources, chains, previous: prior }, built, priorBy.get(symbol)));
  const order = { eligible: 0, wait: 1, watch: 2, avoid: 3, 'insufficient-data': 4 };
  decisions.sort((a,b) => order[a.status] - order[b.status] || Math.abs(b.grade || 0) - Math.abs(a.grade || 0) || a.symbol.localeCompare(b.symbol));
  const payload = { version: UNIFIED_SIGNAL_VERSION, engineVersion: UNIFIED_SIGNAL_MODEL, entryPolicyVersion: OPTION_ENTRY_POLICY_VERSION,
    builtAtIso: built, validUntil: new Date(Date.parse(built) + UNIFIED_SIGNAL_TTL_MS).toISOString(),
    sourceVersions: { perspectives: 1, gradeModel: sources.gradeModelVersion || null, entryTiming: grades.entryTimingVersion || sources.picks?.entryTimingVersion || null,
      picksModelEpoch: sources.picks?.modelEpoch || null },
    horizon: { days: OPTION_ENTRY_HORIZON_DAYS, unit: 'calendar days', label: '14-day swing research' },
    cadence: '11:00 and 15:30 ET decision builds', status: decisions.length ? 'ready' : 'unavailable',
    ranking: 'Existing grade magnitude within policy state; no new composite score or calibrated probability.',
    validation: 'Research / unproven. This version has no independent forward performance record.',
    coverage: Object.fromEntries(['eligible','wait','watch','avoid','insufficient-data'].map(state => [state, decisions.filter(row => row.status === state).length])), decisions };
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0,16);
  const snapshotId = built.replace(/[:.]/g, '-') + '-' + hash;
  return { ...payload, snapshotId, snapshotKey: `signal-decisions/${snapshotId}.json` };
}

export async function writeUnifiedSignalEngine(dataDir, payload) {
  if (!isUnifiedSignalArchiveKey(payload?.snapshotKey) || !unifiedSignalDisplayFactory().valid(payload)) throw new Error('Invalid unified decision snapshot');
  const { snapshotId, snapshotKey, ...content } = payload;
  const expected = content.builtAtIso.replace(/[:.]/g, '-') + '-' + createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0,16);
  if (snapshotId !== expected || snapshotKey !== `signal-decisions/${expected}.json`) throw new Error('Unified decision snapshot does not match its content hash');
  const body = JSON.stringify(payload), snapshot = resolve(dataDir, payload.snapshotKey);
  if (Buffer.byteLength(body) > UNIFIED_SIGNAL_MAX_BYTES) throw new Error('Unified decision snapshot exceeds the 4 MB research budget');
  await mkdir(dirname(snapshot), { recursive: true });
  try { await writeFile(snapshot, body, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || await readFile(snapshot, 'utf8') !== body) throw error;
  }
  // The immutable record must exist before the current view points at it.
  await writeFile(resolve(dataDir, UNIFIED_SIGNAL_KEY), body);
  return { key: UNIFIED_SIGNAL_KEY, snapshotKey: payload.snapshotKey, count: payload.decisions.length };
}
