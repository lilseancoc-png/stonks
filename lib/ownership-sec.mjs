// SEC boundary helpers. All callers share one paced reader so submissions,
// covers, amendments and Form 4 reads cannot create a 14-manager burst.
export function createOwnershipSecReader({ fetchImpl = (...args) => fetch(...args), userAgent, spacingMs = 150 } = {}) {
  let nextStart = 0;
  return async function read(url, options = {}) {
    options.signal?.throwIfAborted();
    const start = Math.max(Date.now(), nextStart);
    nextStart = start + spacingMs;
    if (start > Date.now()) await new Promise(resolve => setTimeout(resolve, start - Date.now()));
    options.signal?.throwIfAborted();
    return fetchImpl(url, { ...options, headers: { 'user-agent': userAgent, ...options.headers }, signal: options.signal || AbortSignal.timeout(20000) });
  };
}

export function ownershipRequestSignal(signal, milliseconds) {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function priorOwnershipQuarter(period) {
  const d = new Date(period + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 0)).toISOString().slice(0, 10);
}

// Older SEC submissions files are bare column arrays. Read every archive
// whose filing-date span can contain the target quarter or its predecessor.
export async function expandOwnershipSubmissions(submissions, period, readJson) {
  const columns = ['form', 'filingDate', 'reportDate', 'accessionNumber', 'primaryDocument'];
  const recent = submissions?.filings?.recent;
  if (!recent) throw new Error('SEC submissions missing filing history');
  const merged = Object.fromEntries(columns.map(k => [k, [...(recent[k] || [])]]));
  const cutoff = priorOwnershipQuarter(period);
  const files = (submissions.filings.files || []).filter(f => !f.filingTo || f.filingTo >= cutoff);
  let historyComplete = true;
  if (files.length > 12) historyComplete = false;
  for (const f of files.slice(0, 12)) {
    if (!/^CIK\d{10}-submissions-\d+\.json$/.test(f.name)) { historyComplete = false; continue; }
    try {
      const page = await readJson('https://data.sec.gov/submissions/' + f.name);
      if (!Array.isArray(page.form) || !Array.isArray(page.accessionNumber)) throw new Error('Malformed SEC submissions archive');
      for (const k of columns) for (let i = 0; i < page.form.length; i++) merged[k].push(page[k]?.[i] ?? null);
    } catch { historyComplete = false; }
  }
  // Duplicate accessions across a page boundary must not duplicate amendments.
  const seen = new Set(), keep = [];
  for (let i = 0; i < merged.form.length; i++) {
    const key = merged.accessionNumber[i];
    if (!key || seen.has(key)) continue;
    seen.add(key); keep.push(i);
  }
  return { ...submissions, historyComplete, filings: { ...submissions.filings,
    recent: Object.fromEntries(columns.map(k => [k, keep.map(i => merged[k][i])])) } };
}

export function ownershipPrimaryUrl(cik, filing) {
  const accession = String(filing.accessionNumber || '').replace(/-/g, '');
  const doc = String(filing.primaryDocument || '').split('/').at(-1);
  if (!/^\d+$/.test(String(cik)) || !/^\d{18}$/.test(accession) || !/^[\w.-]+\.xml$/i.test(doc || '')) throw new Error('Invalid SEC filing identity');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${encodeURIComponent(doc)}`;
}

export function ownershipNotice(submissions, period) {
  const r = submissions?.filings?.recent;
  if (!r) return null;
  return r.form.map((form, i) => ({ form, filingDate: r.filingDate[i], reportDate: r.reportDate[i], accessionNumber: r.accessionNumber[i], primaryDocument: r.primaryDocument[i] }))
    .filter(f => /^13F-NT(?:\/A)?$/.test(f.form) && f.reportDate === period)
    .sort((a, b) => String(b.filingDate).localeCompare(String(a.filingDate)) || String(b.accessionNumber).localeCompare(String(a.accessionNumber)))[0] || null;
}
