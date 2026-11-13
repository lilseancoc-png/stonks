// Collects each covered company's people from free SEC sources, within a
// strict per-build and per-day request budget, and keeps everything in one
// state object that carries from build to build (corporate-structure.json).
//
//   1. Company submissions (data.sec.gov): the latest proxy (DEF 14A) or
//      annual report (20-F / 40-F / IPO prospectus), and 8-K item 5.02
//      filings (directors or officers joining or leaving).
//   2. EDGAR full-text search over the company's Forms 3, 4 and 5: who filed
//      (every director, officer and 10% owner), then the newest filing per
//      person is read for their role, holdings and trades.
//   3. The proxy or 20-F, read once per filing by Gemini Flash-Lite and
//      checked against the filing's own text (proxy.mjs).
//   4. Per person, EDGAR full-text search over their own Forms 3, 4 and 5:
//      every other public company they file at (other boards and jobs) and
//      the date they first became an insider at each.
//
// Nothing here throws on a source failure: the step is logged in
// state.lastRun.errors and the prior data stays.
import { parseOwnershipXml, parseEftsHits, archiveUrl, rawOwnershipFile, padCik, isEntityName, cleanTitle } from './forms.mjs';
import { foldFiling } from './holdings.mjs';
import { htmlToText, sliceProxy, slice20F, proxyUserMessage, checkProxyFacts, extractProxyFacts, PROXY_PROMPT_VERSION } from './proxy.mjs';

export const CORPORATE_STATE_VERSION = 2;
const DAY = 86_400_000;
const SWEEP_LOOKBACK_DAYS = 550;   // about 18 months: every director's annual grant
const ACTIVE_DAYS = 460;           // filed within ~15 months = still an insider
const PERSON_REFRESH_DAYS = 45;
const SUBMISSIONS_REFRESH_HOURS = 20;
const SWEEP_REFRESH_HOURS = 20;
const SEC_HOSTS = new Set(['data.sec.gov', 'www.sec.gov', 'efts.sec.gov']);
// EDGAR full-text search matches amended forms ("4/A") under their root form;
// listing "4/A" in the forms filter makes it return nothing at all.
const OWNERSHIP_FORMS = '3,4,5';
const DOC_MAX_BYTES = 48e6;        // a 20-F with inline XBRL can pass 20 MB

export function emptyCorporateState() {
  return { version: CORPORATE_STATE_VERSION, companies: {}, people: {}, daily: null, lastRun: null };
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, d) => isoDay(Date.parse(iso + 'T00:00:00Z') + d * DAY);

class BudgetStop extends Error {}

export async function refreshCorporateStructure({
  prior = null, universe = [], cikMap = null, skip = () => false, fetchImpl = globalThis.fetch, nowMs = Date.now(),
  userAgent = 'Mingstreet research (mingstreet.app)', gapMs = 150, retryMs = 1500,
  maxRequests = 400, deadlineMs = 150_000, dailyRequests = 3000, dailyBytes = 300e6,
  ai = null, maxAi = 6, dailyAi = 15, log = () => {}, onDocText = null,
} = {}) {
  const state = prior && prior.version === CORPORATE_STATE_VERSION ? structuredClone(prior) : emptyCorporateState();
  const started = Date.now();
  const today = isoDay(nowMs);
  if (!state.daily || state.daily.date !== today) state.daily = { date: today, requests: 0, bytes: 0, ai: 0 };
  const run = { at: new Date(nowMs).toISOString(), requests: 0, bytes: 0, filingsRead: 0, proxiesRead: 0, peopleChecked: 0, aiCalls: 0, errors: [], stoppedBy: null };
  let lastAt = 0;
  const overBudget = () => run.requests >= maxRequests || state.daily.requests >= dailyRequests || state.daily.bytes >= dailyBytes || Date.now() - started >= deadlineMs;

  async function get(url, { json = false, maxBytes = 4e6 } = {}) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !SEC_HOSTS.has(u.hostname)) throw new Error('Source host not permitted');
    if (overBudget()) throw new BudgetStop(run.requests >= maxRequests ? 'build request budget' : state.daily.requests >= dailyRequests ? 'daily request budget' : state.daily.bytes >= dailyBytes ? 'daily byte budget' : 'time budget');
    let res;
    // EDGAR's search answers a passing 500 now and then: one retry, later.
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = (attempt ? retryMs : 0) + gapMs - (Date.now() - lastAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      run.requests++; state.daily.requests++;
      res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: json ? 'application/json' : 'text/html,application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(20_000) });
      if (res.ok || res.status < 500 || overBudget()) break;
    }
    if (!res.ok) throw new Error('SEC HTTP ' + res.status);
    const body = await res.text();
    run.bytes += body.length; state.daily.bytes += body.length;
    if (body.length > maxBytes) throw new Error('SEC document larger than ' + Math.round(maxBytes / 1e6) + ' MB');
    if (/Request Rate Threshold Exceeded|Undeclared Automated Tool/i.test(body.slice(0, 4000))) throw new BudgetStop('SEC rate page');
    return json ? JSON.parse(body) : body;
  }
  const note = (stage, symbol, err) => { if (err instanceof BudgetStop) throw err; run.errors.push({ stage, symbol, message: String(err?.message || err).slice(0, 200) }); };

  const symbols = universe.filter((s) => !skip(s));
  for (const sym of Object.keys(state.companies)) if (!symbols.includes(sym)) delete state.companies[sym];
  const companies = symbols.map((sym) => {
    const c = state.companies[sym] ||= { symbol: sym, owners: {}, read: {} };
    const cik = cikMap?.get?.(sym) || c.cik || null;
    if (cik) c.cik = padCik(cik);
    return c;
  }).filter((c) => c.cik);
  const stale = (iso, hours) => !iso || nowMs - Date.parse(iso) >= hours * 3_600_000;
  const byAge = (key) => [...companies].sort((a, b) => String(key(a) || '').localeCompare(String(key(b) || '')) || a.symbol.localeCompare(b.symbol));
  const aiJobs = [];

  try {
    // 1. Submissions: the documents to read and leadership-change 8-Ks.
    for (const c of byAge((x) => x.sub?.at)) {
      if (!stale(c.sub?.at, SUBMISSIONS_REFRESH_HOURS)) continue;
      try {
        // Banks that issue notes daily have very large files (the body is
        // already downloaded by the time its size is known).
        const j = await get(`https://data.sec.gov/submissions/CIK${c.cik}.json`, { json: true, maxBytes: 80e6 });
        c.name = j.name || c.name || c.symbol;
        c.sub = { at: new Date(nowMs).toISOString(), ...readSubmissions(j, c.cik, nowMs) };
      } catch (err) { note('submissions', c.symbol, err); }
    }
    // 2. Ownership filing sweep (who filed), then the newest filing per person.
    for (const c of byAge((x) => x.sweep?.at)) {
      if (!stale(c.sweep?.at, SWEEP_REFRESH_HOURS)) continue;
      if (c.sub && c.sub.section16 === false) { c.sweep = { at: new Date(nowMs).toISOString(), through: today, pending: [] }; continue; }
      try { await sweepCompany(c); } catch (err) { note('sweep', c.symbol, err); }
    }
    // Read the chosen ownership filings, newest people first across companies.
    const queue = [];
    for (const c of companies) for (const item of chooseFilings(c)) queue.push({ c, item });
    queue.sort((a, b) => b.item.priority - a.item.priority || String(b.item.date).localeCompare(String(a.item.date)));
    for (const { c, item } of queue) {
      if (overBudget()) throw new BudgetStop('budget');
      try {
        const url = archiveUrl(c.cik, item.acc, rawOwnershipFile(item.file));
        const parsed = parseOwnershipXml(await get(url, { maxBytes: 3e6 }));
        c.read[item.acc] = item.date;
        c.sweep.pending = (c.sweep.pending || []).filter((p) => p.acc !== item.acc);
        run.filingsRead++;
        if (parsed?.issuer?.cik && parsed.issuer.cik !== c.cik) { (c.ownerOf ||= {})[parsed.issuer.cik] = item.date; continue; }
        if (!parsed) continue;
        foldFiling(c, parsed, { acc: item.acc, filed: item.date, form: item.form, url: url.replace(/[^/]+$/, '') + item.acc + '-index.htm' });
      } catch (err) { note('filing', c.symbol, err); if (!(err instanceof BudgetStop)) { c.read[item.acc] = item.date; } }
    }
    // 3. Proxy / 20-F facts: one Flash-Lite call per new document.
    const aiReady = ai && ai.enabled !== false && ai.deps?.apiKey;
    for (const c of byAge((x) => x.proxy?.at)) {
      const doc = c.sub?.doc;
      if (!doc) continue;
      const done = c.proxy && c.proxy.acc === doc.acc && c.proxy.v === PROXY_PROMPT_VERSION && c.proxy.status === 'ok';
      const triedToday = c.proxy && c.proxy.acc === doc.acc && c.proxy.v === PROXY_PROMPT_VERSION && String(c.proxy.at || '').slice(0, 10) === today;
      if (done || triedToday) continue;
      if (!aiReady) { c.proxy = { ...(c.proxy?.status === 'ok' ? c.proxy : {}), pending: doc.acc }; continue; }
      if (run.aiCalls >= maxAi || state.daily.ai >= dailyAi) break;
      try {
        const url = archiveUrl(c.cik, doc.acc, doc.file);
        const html = await get(url, { maxBytes: DOC_MAX_BYTES });
        const full = htmlToText(html);
        const text = /^(20-F|40-F)/.test(doc.form) ? slice20F(full) : sliceProxy(full);
        if (onDocText) onDocText(c.symbol, text, full.length);
        run.aiCalls++; state.daily.ai++;
        const prev = c.proxy?.status === 'ok' ? c.proxy : null;
        aiJobs.push(extractProxyFacts({ model: ai.model, deps: { ...ai.deps, symbol: c.symbol }, message: proxyUserMessage({ company: c.name || c.symbol, symbol: c.symbol, form: doc.form, filed: doc.filed, text }) })
          .then(({ json, usage }) => {
            const checked = checkProxyFacts(json, text);
            c.proxy = { v: PROXY_PROMPT_VERSION, status: 'ok', acc: doc.acc, form: doc.form, filed: doc.filed, url: url, at: new Date(nowMs).toISOString(), model: ai.model, facts: checked.facts, kept: checked.kept, dropped: checked.dropped.slice(0, 40), chars: text.length, tokens: usage ? { in: usage.promptTokenCount || 0, out: usage.candidatesTokenCount || 0 } : null };
            run.proxiesRead++;
          })
          .catch((err) => { c.proxy = { ...(prev || {}), v: prev?.v ?? PROXY_PROMPT_VERSION, status: prev ? 'ok' : 'failed', acc: prev ? prev.acc : doc.acc, at: new Date(nowMs).toISOString(), lastError: String(err?.message || err).slice(0, 200) }; if (prev) c.proxy.retry = { acc: doc.acc, at: new Date(nowMs).toISOString() }; run.errors.push({ stage: 'proxy-ai', symbol: c.symbol, message: String(err?.message || err).slice(0, 200) }); }));
      } catch (err) { note('proxy', c.symbol, err); }
    }
    // 4. Each current person's other companies and insider-since dates.
    const due = [];
    for (const c of companies) {
      for (const o of Object.values(c.owners || {})) {
        if (!o.cik || !o.last || nowMs - Date.parse(o.last) > ACTIVE_DAYS * DAY) continue;
        const p = state.people[o.cik];
        if (p && !stale(p.at, PERSON_REFRESH_DAYS * 24)) continue;
        due.push({ o, home: c.cik, p, rank: (o.roles?.officer ? 3 : 0) + (o.roles?.director ? 2 : 0) + (isEntityName(o.sec) ? -5 : 0) });
      }
    }
    const uniq = new Map();
    for (const d of due) if (!uniq.has(d.o.cik)) uniq.set(d.o.cik, d);
    const list = [...uniq.values()].sort((a, b) => Number(!!a.p) - Number(!!b.p) || b.rank - a.rank || String(a.p?.at || '').localeCompare(String(b.p?.at || '')));
    for (const { o, home } of list) {
      try { await checkPerson(o.cik, o.sec, home); run.peopleChecked++; } catch (err) { note('person', o.cik, err); }
    }
  } catch (err) {
    if (err instanceof BudgetStop) run.stoppedBy = err.message; else run.errors.push({ stage: 'run', message: String(err?.message || err).slice(0, 200) });
  }
  if (aiJobs.length) {
    const left = Math.max(30_000, deadlineMs + 90_000 - (Date.now() - started));
    let timer;
    await Promise.race([Promise.allSettled(aiJobs), new Promise((r) => { timer = setTimeout(r, left); })]);
    clearTimeout(timer);
  }
  pruneRead(state, nowMs);
  run.ms = Date.now() - started;
  state.lastRun = run;
  log(`Corporate structure: ${run.requests} SEC request(s), ${run.filingsRead} ownership filing(s), ${run.proxiesRead}/${run.aiCalls} proxy read(s), ${run.peopleChecked} people checked${run.stoppedBy ? ', stopped by ' + run.stoppedBy : ''}${run.errors.length ? ', ' + run.errors.length + ' error(s)' : ''}`);
  return state;

  // --- steps -------------------------------------------------------------------
  async function sweepCompany(c) {
    const from = c.sweep?.through ? addDays(c.sweep.through, -5) : addDays(today, -SWEEP_LOOKBACK_DAYS);
    const pending = new Map((c.sweep?.pending || []).map((p) => [p.acc, p]));
    let total = Infinity, found = 0;
    for (let page = 0; page * 100 < total && page < 12; page++) {
      const url = new URL('https://efts.sec.gov/LATEST/search-index');
      for (const [k, v] of Object.entries({ q: '', ciks: c.cik, forms: OWNERSHIP_FORMS, dateRange: 'custom', startdt: from, enddt: today, from: String(page * 100), size: '100' })) url.searchParams.set(k, v);
      const res = parseEftsHits(await get(url.toString(), { json: true }));
      total = res.total;
      found = res.total;
      for (const r of res.rows) {
        if (!r.ciks.includes(c.cik)) continue;
        const owners = r.ciks.filter((k) => k && k !== c.cik);
        if (!owners.length) continue;
        // The company itself filing as an owner of another issuer (a bank's
        // stakes): that issuer is known from an earlier read, so skip it.
        if (owners.some((k) => c.ownerOf?.[k])) continue;
        // A Form 3 is the day someone became an insider here: worth keeping
        // even when the filing itself is never read.
        if (/^3/.test(r.form || '') && r.date) for (const k of owners) { c.form3 ||= {}; if (!c.form3[k] || r.date < c.form3[k]) c.form3[k] = r.date; }
        // EDGAR's own filer names are always "LAST FIRST"; the filing XML
        // sometimes is not.
        for (const n of r.names) if (n.cik && n.cik !== c.cik && n.name) (c.names ||= {})[n.cik] = n.name;
        if (c.read[r.acc] || !r.file || !/\.xml$/i.test(r.file)) continue;
        pending.set(r.acc, { acc: r.acc, file: r.file, form: r.form, date: r.date, owners, names: r.names.filter((n) => n.cik !== c.cik).map((n) => n.name).slice(0, 3) });
      }
      if (res.rows.length < 100) break;
    }
    c.sweep = { at: new Date(nowMs).toISOString(), through: today, found, pending: [...pending.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 1500) };
    // From the first finished sweep on, every new filing is read, so trades
    // dated on or after this day form a complete record for the name.
    if (!c.completeFrom) c.completeFrom = today;
  }

  async function checkPerson(cik, secName, home) {
    // Work on a copy: the prior record stays whole (and its role cache
    // readable) until this check finishes, so a budget stop part way
    // through leaves the person as they were, to be checked next run.
    const prior = state.people[cik] || null;
    const rec = { ...(prior || { cik }), links: {} };
    const read = async (forms) => {
      const url = new URL('https://efts.sec.gov/LATEST/search-index');
      for (const [k, v] of Object.entries({ q: '', ciks: cik, forms, from: '0', size: '100' })) url.searchParams.set(k, v);
      return parseEftsHits(await get(url.toString(), { json: true }));
    };
    const fold = (rows) => {
      for (const r of rows) {
        for (const n of r.names) {
          if (!n.cik || n.cik === cik) continue;
          const l = rec.links[n.cik] ||= { cik: n.cik, name: n.name, ticker: n.ticker || null, first: r.date, last: r.date, n: 0 };
          if (n.ticker && !l.ticker) l.ticker = n.ticker;
          if (r.date && (!l.first || r.date < l.first)) l.first = r.date;
          if (r.date && (!l.last || r.date >= l.last)) { l.last = r.date; l.lastAcc = r.acc; l.lastFile = r.file; l.name = n.name || l.name; }
          if (/^3/.test(r.form || '') && (!l.form3 || r.date < l.form3)) l.form3 = r.date;
          l.n++;
        }
      }
    };
    // Newest 100 filings first (EDGAR sorts by filing date, newest first).
    const all = await read(OWNERSHIP_FORMS);
    fold(all.rows);
    rec.total = all.total;
    const oldest = all.rows.length ? all.rows[all.rows.length - 1].date : null;
    // Companies seen only in older filings: known from the search's company
    // counts, last filed before the oldest filing on this page.
    for (const e of all.entities) {
      if (e.cik === cik || rec.links[e.cik]) continue;
      rec.links[e.cik] = { cik: e.cik, name: e.name, ticker: e.ticker, first: null, last: null, before: oldest, n: e.n };
    }
    for (const e of all.entities) if (rec.links[e.cik] && e.ticker && !rec.links[e.cik].ticker) rec.links[e.cik].ticker = e.ticker;
    // Form 3 (one per company joined) gives each start date, however old.
    if (all.total > all.rows.length) fold((await read('3')).rows.map((r) => ({ ...r, form: '3' })));
    rec.at = new Date(nowMs).toISOString();
    rec.name = secName || rec.name;
    // The role at each other company that is still active, from that
    // company's newest filing (a few per person per run).
    let roleReads = 0;
    for (const l of Object.values(rec.links).sort((a, b) => String(b.last).localeCompare(String(a.last)))) {
      if (l.cik === home) { l.issuer = true; continue; }
      if (!l.lastAcc || !l.lastFile || nowMs - Date.parse(l.last) > ACTIVE_DAYS * DAY) continue;
      // Known from the last check: the same newest filing, or a co-filer.
      const priorLink = prior?.links?.[l.cik];
      if (priorLink?.roleAcc === l.lastAcc) { l.role = priorLink.role; l.roleAcc = priorLink.roleAcc; l.issuer = priorLink.issuer; continue; }
      if (priorLink?.coFiler) { l.coFiler = true; continue; }
      // A role changed since: keep the old one until it is read again.
      if (roleReads >= 4) { if (priorLink?.role) { l.role = priorLink.role; l.issuer = priorLink.issuer; } continue; }
      try {
        roleReads++;
        const parsed = parseOwnershipXml(await get(archiveUrl(l.cik, l.lastAcc, rawOwnershipFile(l.lastFile)), { maxBytes: 3e6 }));
        const me = parsed?.owners?.find((x) => x.cik === cik);
        if (parsed?.issuer?.cik && parsed.issuer.cik !== l.cik) { l.coFiler = true; continue; }
        if (me) { l.role = roleLabel(me); l.roleAcc = l.lastAcc; l.issuer = true; }
      } catch (err) { if (err instanceof BudgetStop) throw err; }
    }
    state.people[cik] = rec;
  }
}

export function roleLabel(r) {
  const out = [];
  if (r?.officer) out.push(cleanTitle(r.title) || 'Officer');
  if (r?.director) out.push('Director');
  if (r?.tenPct) out.push('10% owner');
  if (!out.length && r?.other) out.push(r.otherText || 'Insider');
  return out.join(' · ') || 'Insider';
}

// From a company's submissions file: which document to read for the board
// (the newest proxy within 20 months, else a 20-F / 40-F, else a recent IPO
// prospectus) and the 8-K item 5.02 filings of the last 18 months.
export function readSubmissions(j, cik, nowMs) {
  const r = j?.filings?.recent || {};
  const n = (r.form || []).length;
  const rows = [];
  for (let i = 0; i < n; i++) rows.push({ form: r.form[i], filed: r.filingDate?.[i], acc: r.accessionNumber?.[i], file: r.primaryDocument?.[i], items: r.items?.[i] || '' });
  const within = (row, days) => row.filed && nowMs - Date.parse(row.filed) <= days * DAY;
  const pick = (re, days) => rows.filter((x) => re.test(x.form) && within(x, days) && x.acc && x.file).sort((a, b) => String(b.filed).localeCompare(String(a.filed)))[0] || null;
  const doc = pick(/^DEF 14A$/, 600) || pick(/^(20-F|40-F)$/, 600) || pick(/^424B4$/, 540) || null;
  const events = rows.filter((x) => /^8-K/.test(x.form) && /\b5\.02\b/.test(x.items) && within(x, 550))
    .slice(0, 14).map((x) => ({ date: x.filed, acc: x.acc, url: archiveUrl(cik, x.acc, x.file) }));
  const section16 = rows.some((x) => /^[345](\/A)?$/.test(x.form)) || j?.insiderTransactionForIssuerExists === 1;
  return {
    doc: doc ? { form: doc.form, filed: doc.filed, acc: doc.acc, file: doc.file } : null,
    events,
    section16,
    foreign: rows.some((x) => /^(20-F|40-F|6-K)$/.test(x.form)) && !rows.some((x) => /^10-K$/.test(x.form)),
    tickers: Array.isArray(j?.tickers) ? j.tickers.slice(0, 6) : [],
    exchanges: Array.isArray(j?.exchanges) ? j.exchanges.slice(0, 6) : [],
  };
}

// Which ownership filings to read this build. Someone new: their newest three.
// Someone known: everything newer than what we have (at most ten). A person
// whose filings so far carried no share lines gets up to three older ones.
export function chooseFilings(c) {
  const byOwner = new Map();
  for (const p of c.sweep?.pending || []) {
    if (c.read[p.acc] || (p.owners || []).some((k) => c.ownerOf?.[k])) continue;
    const owner = p.owners[0];
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(p);
  }
  const out = [];
  for (const [owner, list] of byOwner) {
    list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const rec = c.owners?.[owner];
    if (!rec || !rec.last) { list.slice(0, 3).forEach((p, i) => out.push({ ...p, priority: i === 0 ? 3 : 1 })); continue; }
    const newer = list.filter((p) => p.date >= rec.last).slice(0, 10);
    newer.forEach((p) => out.push({ ...p, priority: 2 }));
    if (!Object.keys(rec.lines || {}).length) list.filter((p) => p.date < rec.last).slice(0, 3).forEach((p) => out.push({ ...p, priority: 0 }));
  }
  return out;
}

function pruneRead(state, nowMs) {
  const cut = isoDay(nowMs - (SWEEP_LOOKBACK_DAYS + 30) * DAY);
  for (const c of Object.values(state.companies)) {
    for (const [acc, d] of Object.entries(c.read || {})) if (!d || d < cut) delete c.read[acc];
    for (const [k, d] of Object.entries(c.ownerOf || {})) if (!d || d < cut) delete c.ownerOf[k];
    if (c.sweep?.pending) c.sweep.pending = c.sweep.pending.filter((p) => !c.read[p.acc] && p.date >= cut && !(p.owners || []).some((k) => c.ownerOf?.[k]));
  }
  // People who are nobody's current insider any more.
  const keep = new Set();
  for (const c of Object.values(state.companies)) {
    for (const o of Object.values(c.owners || {})) keep.add(o.cik);
    const waiting = new Set((c.sweep?.pending || []).flatMap((p) => p.owners || []));
    if (c.names) for (const k of Object.keys(c.names)) if (!c.owners?.[k] && !waiting.has(k)) delete c.names[k];
  }
  for (const k of Object.keys(state.people)) if (!keep.has(k)) delete state.people[k];
}
