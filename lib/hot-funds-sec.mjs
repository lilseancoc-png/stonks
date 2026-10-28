// SEC Form 13F data sets for the hot-fund screen. Network and file handling
// live here; every number is computed by lib/leverage-distress.mjs.
//
// The SEC publishes every 13F information table as one zip per three-month
// filing window (Dec-Feb, Mar-May, Jun-Aug, Sep-Nov). Each window holds the
// quarter that ended in its first month (Dec 31, Mar 31, Jun 30, Sep 30).
// A quarter's implied return needs the book held at the start (the earlier
// window) priced at the end (the later window). Windows are read newest
// first, one per build, so each pass already has the next quarter's prices:
//   pass(P) saves P's prices and, when P+1's prices are saved, the return of
//   every book held at P over the quarter ending P+1.
// A new quarter therefore costs two reads: its own window, then the prior
// window again. Only derived figures and one or two price tables persist.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createInflateRaw } from 'node:zlib';
import { HOT_FUND_POLICY, bookStats, collapseBookRows, impliedQuarterReturn, issuerNameKey, normalizePutCall, parse13FInfoTableXml, topBookRows } from './leverage-distress.mjs';

export const HOT_FUND_PARSER_VERSION = 1;
export const F13_DATA_SETS_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const DAY = 86400000;
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

// ---------------------------------------------------------------------------
// Discovery and planning

// Links look like .../form-13f-data-sets/01jun2026-31aug2026_form13f.zip. The
// folder has moved before (structureddata -> datastandardsinnovation), so the
// page is read rather than the URL guessed.
export function parse13FDataSetLinks(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="([^"]*?form-13f-data-sets\/(\d{2})([a-z]{3})(\d{4})-(\d{2})([a-z]{3})(\d{4})_form13f\.zip)"/gi)) {
    const [, href, d1, m1, y1] = m;
    const month = MONTHS.indexOf(m1.toLowerCase());
    if (d1 !== '01' || ![2, 5, 8, 11].includes(month)) continue;
    const period = new Date(Date.UTC(Number(y1), month + 1, 0)).toISOString().slice(0, 10);
    const url = new URL(href, 'https://www.sec.gov').href;
    if (!/^https:\/\/www\.sec\.gov\//.test(url)) continue;
    out.set(period, { period, url, label: `${m[2]}${m[3]}${m[4]}-${m[5]}${m[6]}${m[7]}` });
  }
  return [...out.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function previousQuarterEnd(period) {
  const d = new Date(period + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 0)).toISOString().slice(0, 10);
}

// The quarters the screen needs: last December through the newest published
// quarter (a full prior year when the newest is a December).
export function neededPeriods(windows) {
  const periods = (windows || []).map(w => w.period).sort();
  const latest = periods.at(-1);
  if (!latest) return [];
  const from = `${Number(latest.slice(0, 4)) - 1}-12-31`;
  return periods.filter(p => p >= from);
}

// Next window to read, or null when every needed figure is in hand.
export function planHotFundPass(state, windows) {
  const needed = neededPeriods(windows);
  if (!needed.length) return null;
  const byPeriod = new Map(windows.map(w => [w.period, w]));
  const periods = state?.periods || {};
  const prices = state?.priceTables || {};
  const latest = needed.at(-1);
  if (!periods[latest]?.ownPass || periods[latest].window !== byPeriod.get(latest).url || periods[latest].parserVersion !== HOT_FUND_PARSER_VERSION) {
    return { period: latest, window: byPeriod.get(latest), nextPeriod: null };
  }
  for (let i = needed.length - 2; i >= 0; i--) {
    const p = needed[i], next = needed[i + 1];
    if (next !== nextQuarterEnd(p)) continue;
    if (periods[next]?.returnsFrom === p && periods[next]?.returnsVersion === HOT_FUND_PARSER_VERSION) continue;
    if (!prices[next]) return { period: next, window: byPeriod.get(next), nextPeriod: null, reason: 'rebuild-prices' };
    return { period: p, window: byPeriod.get(p), nextPeriod: next };
  }
  return null;
}
export function nextQuarterEnd(period) {
  const d = new Date(period + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 4, 0)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Zip and TSV streaming (no dependency; zip64 aware)

export async function readZipDirectory(path) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557 + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Zip directory not found');
    let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('Zip64 locator missing');
      const z = Buffer.alloc(56);
      await fh.read(z, 0, 56, Number(tail.readBigUInt64LE(loc + 8)));
      if (z.readUInt32LE(0) !== 0x06064b50) throw new Error('Zip64 directory missing');
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOffset = Number(z.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory entry');
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20), size2 = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen;) {
        const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
        if (id === 1) {
          let q = e + 4;
          if (size2 === 0xffffffff) { size2 = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + len;
      }
      const local = Buffer.alloc(30);
      await fh.read(local, 0, 30, offset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Bad zip local header');
      entries.push({ name, method, compressedSize, size: size2, dataStart: offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally { await fh.close(); }
}

export function zipEntryStream(path, entry) {
  if (!entry.compressedSize) return Readable.from([]);
  const raw = createReadStream(path, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 });
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`Unsupported zip method ${entry.method}`);
  const inflate = createInflateRaw();
  raw.on('error', e => inflate.destroy(e));
  return raw.pipe(inflate);
}

// Rows of a tab-separated file as objects keyed by upper-case header names.
export async function* tsvRows(stream) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', header = null;
  const emit = function* (line) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) return;
    const cells = line.split('\t');
    if (!header) { header = cells.map(c => c.trim().toUpperCase()); return; }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    yield row;
  };
  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); yield* emit(line); }
  }
  buffer += decoder.end();
  if (buffer) yield* emit(buffer);
}

export function parseSecDmy(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// One window pass

// Pick the accessions that make up each manager's book for the quarter: the
// original report or the latest restatement, plus any "new holdings"
// amendments filed after it. Notice-only filers have no table.
export function selectBooks(submissions, covers, summaries, period) {
  const byCik = new Map();
  for (const s of submissions) {
    if (!/^13F-HR(?:\/A)?$/i.test(s.type) || s.period !== period) continue;
    const c = covers.get(s.accession) || {};
    if (/NOTICE/i.test(c.reportType || '')) continue;
    const list = byCik.get(s.cik) || [];
    list.push({ ...s, ...c, ...(summaries.get(s.accession) || {}) });
    byCik.set(s.cik, list);
  }
  const books = new Map();
  for (const [cik, list] of byCik) {
    list.sort((a, b) => String(a.filingDate).localeCompare(String(b.filingDate)) || a.accession.localeCompare(b.accession));
    const restatements = list.filter(r => r.isAmendment && /RESTATE/i.test(r.amendmentType || ''));
    const originals = list.filter(r => !r.isAmendment);
    const base = restatements.at(-1) || originals.at(-1);
    if (!base) continue;
    const additions = list.filter(r => r.isAmendment && /NEW HOLDING/i.test(r.amendmentType || '') && String(r.filingDate) >= String(base.filingDate));
    const parts = [base, ...additions];
    books.set(cik, { cik, name: base.name || '', filingDate: base.filingDate, accession: base.accession, accessions: parts.map(p => p.accession),
      value: parts.reduce((t, p) => t + (p.tableValue || 0), 0), entries: parts.reduce((t, p) => t + (p.entries || 0), 0) });
  }
  return books;
}

function median(values) { const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// tables: {submission, coverpage, summarypage, infotable} async iterables of
// row objects. universe: [{symbol, keys:Set<string>, close}] where close is
// our own close on the quarter-end date (or the session before).
export async function process13FWindow({ tables, period, nextPrices = null, universe = [], knownUniverseCusips = {}, policy = HOT_FUND_POLICY, deadline = Infinity }) {
  const submissions = [], covers = new Map(), summaries = new Map();
  for await (const r of tables.submission) submissions.push({ accession: r.ACCESSION_NUMBER, cik: String(Number(r.CIK)), type: String(r.SUBMISSIONTYPE || '').trim(), filingDate: parseSecDmy(r.FILING_DATE), period: parseSecDmy(r.PERIODOFREPORT) });
  for await (const r of tables.coverpage) covers.set(r.ACCESSION_NUMBER, { name: String(r.FILINGMANAGER_NAME || '').trim(), isAmendment: /^Y/i.test(r.ISAMENDMENT || ''), amendmentType: r.AMENDMENTTYPE || '', reportType: r.REPORTTYPE || '' });
  for await (const r of tables.summarypage) summaries.set(r.ACCESSION_NUMBER, { tableValue: Number(r.TABLEVALUETOTAL) || 0, entries: Number(r.TABLEENTRYTOTAL) || 0 });
  const books = selectBooks(submissions, covers, summaries, period);
  const accessionCik = new Map();
  for (const book of books.values()) for (const a of book.accessions) accessionCik.set(a, book.cik);
  const large = new Set([...books.values()].filter(b => b.value >= policy.minBookValue).map(b => b.cik));
  const candidates = new Set([...large].filter(cik => books.get(cik).entries <= policy.maxEntries));
  const samples = new Map(), names = new Map(), candidateRows = new Map();
  const bench = { start: 0, priced: 0, end: 0 };
  let rows = 0;
  for await (const r of tables.infotable) {
    if ((++rows & 0xffff) === 0 && Date.now() > deadline) throw new Error('13F window pass exceeded its time budget');
    const cik = accessionCik.get(r.ACCESSION_NUMBER);
    if (!cik) continue;
    if (String(r.SSHPRNAMTTYPE || 'SH').trim().toUpperCase() !== 'SH') continue;
    const cusip = String(r.CUSIP || '').trim().toUpperCase(), value = Number(r.VALUE), shares = Number(r.SSHPRNAMT), putCall = normalizePutCall(r.PUTCALL);
    if (!/^[0-9A-Z]{9}$/.test(cusip) || !positive(value)) continue;
    if (!putCall && positive(shares)) {
      const px = value / shares;
      if (px > 0 && px < 1e6) { const list = samples.get(cusip) || []; if (list.length < 15) { list.push(px); samples.set(cusip, list); } }
      if (!names.has(cusip)) names.set(cusip, String(r.NAMEOFISSUER || ''));
      if (large.has(cik) && nextPrices) {
        bench.start += value;
        const end = nextPrices[cusip];
        if (positive(end)) { bench.priced += value; bench.end += shares * end; }
      }
    }
    if (candidates.has(cik)) {
      const list = candidateRows.get(cik) || [];
      list.push({ cusip, name: String(r.NAMEOFISSUER || '').trim(), cls: String(r.TITLEOFCLASS || '').trim(), value, shares: positive(shares) ? shares : null, putCall });
      candidateRows.set(cik, list);
    }
  }
  const prices = {};
  for (const [cusip, list] of samples) prices[cusip] = Number(median(list).toPrecision(7));
  // Tie a CUSIP to one of our stocks only when the cleaned issuer name
  // matches and the 13F quarter-end price is within 12% of our own close.
  const universeCusips = { ...knownUniverseCusips };
  const byKey = new Map(), byFirst = new Map();
  for (const u of universe) for (const k of u.keys || []) {
    if (!k) continue;
    byKey.set(k, u);
    const first = k.split(' ')[0];
    if (first.length >= 5) byFirst.set(first, byFirst.has(first) && byFirst.get(first) !== u ? null : u);
  }
  for (const [cusip, name] of names) {
    if (universeCusips[cusip]) continue;
    const key = issuerNameKey(name);
    const u = byKey.get(key) || byFirst.get(key.split(' ')[0]);
    if (u && positive(u.close) && positive(prices[cusip]) && Math.abs(prices[cusip] / u.close - 1) <= 0.12) universeCusips[cusip] = u.symbol;
  }
  const funds = {}, details = {}, returns = {};
  for (const cik of candidates) {
    const book = books.get(cik), collapsed = collapseBookRows(candidateRows.get(cik) || []);
    if (!collapsed.length) continue;
    const stats = bookStats(collapsed);
    funds[cik] = { name: book.name, filingDate: book.filingDate, accession: book.accession, reportedValue: Math.round(book.value), entries: book.entries, stats };
    details[cik] = { top: topBookRows(collapsed, policy.topHoldings),
      universe: collapsed.filter(r => universeCusips[r.cusip]).map(r => ({ symbol: universeCusips[r.cusip], cusip: r.cusip, putCall: r.putCall, shares: r.shares, value: Math.round(r.value) })) };
    if (nextPrices) returns[cik] = impliedQuarterReturn(collapsed, nextPrices);
  }
  return { period, rows, filers: books.size, large: large.size, candidates: candidates.size, prices, funds, details, returns, universeCusips,
    benchmark: nextPrices && bench.priced > 0 ? { stockPct: Number(((bench.end / bench.priced - 1) * 100).toFixed(2)), coverage: Number((bench.priced / bench.start).toFixed(4)) } : null };
}

// Merge one pass into the persisted state.
export function applyHotFundPass(state, plan, result, now) {
  const next = { ...state, periods: { ...(state.periods || {}) }, priceTables: { ...(state.priceTables || {}) } };
  const own = { ...(next.periods[plan.period] || {}) };
  own.window = plan.window.url; own.ownPass = now; own.parserVersion = HOT_FUND_PARSER_VERSION;
  own.filers = result.filers; own.large = result.large; own.candidates = result.candidates; own.rows = result.rows;
  next.priceTables[plan.period] = result.prices;
  const needed = Object.keys(next.periods).concat(plan.period).sort();
  const latest = needed.at(-1);
  if (plan.period === latest) {
    own.funds = result.funds;
    next.latest = { period: plan.period, funds: result.details };
  } else delete own.funds;
  next.periods[plan.period] = own;
  if (plan.nextPeriod) {
    const into = { ...(next.periods[plan.nextPeriod] || {}) };
    into.returns = result.returns; into.returnsFrom = plan.period; into.returnsVersion = HOT_FUND_PARSER_VERSION; into.benchmark = result.benchmark;
    next.periods[plan.nextPeriod] = into;
  }
  next.universeCusips = result.universeCusips;
  return next;
}

// Drop quarters outside the window and price tables no pass still needs.
export function pruneHotFundState(state, windows) {
  const needed = new Set(neededPeriods(windows));
  const periods = Object.fromEntries(Object.entries(state.periods || {}).filter(([p]) => needed.has(p)));
  const keepPrices = {};
  const sorted = [...needed].sort();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i], prev = sorted[i - 1];
    const stillNeeded = prev && !(periods[p]?.returnsFrom === prev && periods[p]?.returnsVersion === HOT_FUND_PARSER_VERSION);
    if (stillNeeded && state.priceTables?.[p]) keepPrices[p] = state.priceTables[p];
  }
  const latest = sorted.at(-1);
  for (const [p, data] of Object.entries(periods)) if (p !== latest && data.funds) { const { funds, ...rest } = data; periods[p] = rest; }
  return { ...state, periods, priceTables: keepPrices, latest: state.latest && needed.has(state.latest.period) ? state.latest : null };
}

// ---------------------------------------------------------------------------
// Network collection

async function downloadTo(url, file, { fetchImpl, userAgent, deadline, maxBytes }) {
  const remaining = Math.max(1000, deadline - Date.now());
  const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/zip,application/octet-stream' }, signal: AbortSignal.timeout(remaining) });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  if (Number(response.headers?.get?.('content-length')) > maxBytes) throw new Error('13F data set exceeds the size limit');
  let bytes = 0;
  const cap = new Transform({ transform(chunk, _e, cb) { bytes += chunk.length; cb(bytes > maxBytes ? new Error('13F data set exceeds the size limit') : null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), cap, createWriteStream(file));
  return bytes;
}

export async function run13FWindowPass({ plan, state, universe, fetchImpl = fetch, userAgent, deadline, maxBytes = 400e6, policy = HOT_FUND_POLICY }) {
  const dir = await mkdtemp(join(tmpdir(), 'hot-funds-'));
  try {
    const file = join(dir, 'window.zip');
    const bytes = await downloadTo(plan.window.url, file, { fetchImpl, userAgent, deadline, maxBytes });
    const entries = await readZipDirectory(file);
    const find = name => entries.find(e => e.name.split('/').pop().toUpperCase().replace(/\.(TSV|TXT)$/, '') === name);
    const parts = Object.fromEntries(['SUBMISSION', 'COVERPAGE', 'SUMMARYPAGE', 'INFOTABLE'].map(n => [n, find(n)]));
    for (const [n, e] of Object.entries(parts)) if (!e) throw new Error(`13F data set is missing ${n}`);
    const tables = { submission: tsvRows(zipEntryStream(file, parts.SUBMISSION)), coverpage: tsvRows(zipEntryStream(file, parts.COVERPAGE)),
      summarypage: tsvRows(zipEntryStream(file, parts.SUMMARYPAGE)), infotable: tsvRows(zipEntryStream(file, parts.INFOTABLE)) };
    const result = await process13FWindow({ tables, period: plan.period, nextPrices: plan.nextPeriod ? state.priceTables?.[plan.nextPeriod] : null,
      universe, knownUniverseCusips: state.universeCusips || {}, policy, deadline });
    return { ...result, bytes };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const OWNERSHIP_FORMS = /^(?:SC 13[DG](?:\/A)?|SCHEDULE 13[DG](?:\/A)?|4|4\/A)$/;
// A flagged fund's own recent filings: a newer 13F than the bulk data (so its
// holdings refresh before the SEC publishes the next window) and any
// ownership schedules or Form 4s in the last 30 days.
export async function checkFundSubmissions({ funds, state, now, fetchImpl = fetch, userAgent, deadline, maxChecks = 20, delayMs = 150, universeCusips = {}, policy = HOT_FUND_POLICY }) {
  const early = { ...(state.early13F || {}) }, recent = { ...(state.recentFilings || {}) }, checked = { ...(state.submissionChecks || {}) }, errors = [];
  const today = now.slice(0, 10);
  const due = (funds || []).filter(f => String(checked[f.cik] || '').slice(0, 10) !== today)
    .sort((a, b) => String(checked[a.cik] || '').localeCompare(String(checked[b.cik] || '')) || a.cik.localeCompare(b.cik)).slice(0, maxChecks);
  let requests = 0;
  const get = async (url, json) => {
    if (Date.now() > deadline) throw new Error('Fund filing check budget reached');
    requests++;
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: json ? 'application/json' : 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(Math.max(1000, Math.min(15000, deadline - Date.now()))) });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    return json ? res.json() : res.text();
  };
  for (const fund of due) {
    try {
      const subs = await get(`https://data.sec.gov/submissions/CIK${String(fund.cik).padStart(10, '0')}.json`, true);
      const r = subs?.filings?.recent;
      if (!Array.isArray(r?.form)) throw new Error('Unrecognized SEC submissions response');
      checked[fund.cik] = now;
      const cutoff = new Date(Date.parse(now) - 30 * DAY).toISOString().slice(0, 10);
      recent[fund.cik] = r.form.map((form, i) => ({ form, filingDate: r.filingDate?.[i], accession: r.accessionNumber?.[i], doc: r.primaryDocument?.[i] }))
        .filter(f => OWNERSHIP_FORMS.test(f.form) && f.filingDate >= cutoff && /^\d{10}-\d{2}-\d{6}$/.test(f.accession || ''))
        .slice(0, 12).map(f => ({ form: f.form, filingDate: f.filingDate, url: `https://www.sec.gov/Archives/edgar/data/${Number(fund.cik)}/${f.accession.replace(/-/g, '')}/${f.accession}-index.htm` }));
      const newest = r.form.map((form, i) => ({ form, reportDate: r.reportDate?.[i], filingDate: r.filingDate?.[i], accession: r.accessionNumber?.[i] }))
        .filter(f => /^13F-HR(?:\/A)?$/.test(f.form) && f.reportDate > fund.period && /^\d{10}-\d{2}-\d{6}$/.test(f.accession || ''))
        .sort((a, b) => b.reportDate.localeCompare(a.reportDate) || b.filingDate.localeCompare(a.filingDate))[0];
      if (newest && early[fund.cik]?.accession !== newest.accession) {
        const base = `https://www.sec.gov/Archives/edgar/data/${Number(fund.cik)}/${newest.accession.replace(/-/g, '')}`;
        const index = await get(base + '/index.json', true);
        const items = (index?.directory?.item || []).map(i => String(i?.name || ''));
        const xmlName = items.find(n => /information.*table.*\.xml$/i.test(n)) || items.find(n => /infotable\.xml$/i.test(n)) || items.find(n => /\.xml$/i.test(n) && !/primary_doc/i.test(n));
        if (!xmlName) throw new Error('13F information table not found');
        const rows = collapseBookRows(parse13FInfoTableXml(await get(base + '/' + xmlName, false)));
        if (!rows.length) throw new Error('13F information table parsed zero rows');
        early[fund.cik] = { period: newest.reportDate, filingDate: newest.filingDate, accession: newest.accession, stats: bookStats(rows), top: topBookRows(rows, policy.topHoldings),
          universe: rows.filter(x => universeCusips[x.cusip]).map(x => ({ symbol: universeCusips[x.cusip], cusip: x.cusip, putCall: x.putCall, shares: x.shares, value: Math.round(x.value) })) };
      }
    } catch (e) { errors.push({ cik: fund.cik, message: e.message }); if (/budget/.test(e.message)) break; }
  }
  return { early13F: early, recentFilings: recent, submissionChecks: checked, requests, errors };
}
