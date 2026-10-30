// Shared, deterministic query model for the SEC ownership explorer.
// Serialized into the browser by the renderer; keep this factory self-contained.
export function ownershipExplorerFactory() {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const text = s => String(s || '').trim().toUpperCase();
  function matches(query, values) {
    const terms = text(query).replace(/^\$/, '').split(/\s+/).filter(Boolean);
    const haystack = values.map(text).join(' ');
    return terms.every(t => haystack.includes(t));
  }
  function sorted(rows, key, direction = 'desc') {
    return [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      const missingX = x == null || (typeof x === 'number' && !finite(x));
      const missingY = y == null || (typeof y === 'number' && !finite(y));
      if (missingX !== missingY) return missingX ? 1 : -1;
      const delta = missingX ? 0 : typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (direction === 'asc' ? delta : -delta) || String(a.firm || a.name || a.cusip).localeCompare(String(b.firm || b.name || b.cusip));
    });
  }
  function funds(data) {
    const directory = new Map((data.topFirms || []).map(f => [f.firm, f]));
    for (const [key, f] of Object.entries(data.perFirm || {})) if (!directory.has(key)) directory.set(key, { firm: f?.firm || key });
    return [...directory].map(([key, meta]) => {
      const f = data.perFirm?.[key];
      const full = !!f && Array.isArray(f.holdings);
      // Legacy top-20 tables are not a complete ownership index.
      const holdings = full ? f.holdings : [];
      return { ...meta, ...f, firm: meta.firm || key, holdings, complete: full,
        collectionError: f?.collectionError || data.collectionIssues?.[key] || null,
        aum: finite(meta.aumBillions) ? meta.aumBillions * 1e9 : null,
        performancePct: full && finite(f.performance?.pct) ? f.performance.pct : null,
        reportedValue: f?.reportedValue ?? f?.totalValue ?? null,
        positionCount: full ? holdings.filter(r => !r.isExit).length : f?.totalPositions ?? null,
        concentrationPct: full ? f.concentrationPct : null,
        filingDate: f?.filingDate || null };
    });
  }
  function queryFunds(data, query, key, direction) {
    return sorted(funds(data).filter(f => matches(query, [f.firm, f.cik, f.kind])), key, direction);
  }
  function positions(data, { query = '', fund = '', type = 'all', status = 'held', sort = 'valueNow', direction = 'desc' } = {}) {
    const rows = [];
    const books = funds(data), exact = text(query).replace(/^\$/, '');
    const identifier = exact && books.some(f => f.holdings.some(r => text(r.ticker) === exact || text(r.cusip) === exact));
    for (const f of books) {
      if (fund && f.firm !== fund) continue;
      for (const r of f.holdings) {
        if (identifier ? text(r.ticker) !== exact && text(r.cusip) !== exact : !matches(query, [r.ticker, r.name, r.cusip])) continue;
        if (type !== 'all' && r.type !== type) continue;
        if (status === 'held' && r.isExit || status === 'exited' && !r.isExit) continue;
        rows.push({ ...r, firm: f.firm, cik: f.cik, reportDate: f.reportDate, filingDate: f.filingDate,
          filingUrl: f.filingUrl, performancePct: f.performancePct, aum: f.aum, reportedValue: f.reportedValue,
          reportingCik: f.reportingCik, reportingName: f.reportingName, reportingScope: f.reportingScope,
          sourceChain: f.sourceChain,
          collectionStatus: f.collectionStatus, collectedAtIso: f.collectedAtIso });
      }
    }
    return sorted(rows, sort, direction);
  }
  function insiders(data, query) {
    if (!text(query)) return [];
    const exact = text(query).replace(/^\$/, ''), rows = data.insiderTransactions?.transactions || [];
    const holdings = funds(data).flatMap(f => f.holdings);
    const identifier = holdings.some(r => text(r.ticker) === exact || text(r.cusip) === exact) || rows.some(r => text(r.ticker || r.symbol) === exact);
    const symbols = new Set(holdings.filter(r => identifier ? text(r.ticker) === exact || text(r.cusip) === exact : matches(query, [r.name, r.cusip])).map(r => text(r.ticker)).filter(Boolean));
    return rows.filter(r => identifier ? text(r.ticker || r.symbol) === exact || symbols.has(text(r.ticker || r.symbol))
      : symbols.has(text(r.ticker || r.symbol)) || matches(query, [r.ticker, r.symbol, r.issuerName, r.cusip]));
  }
  function valid(data) {
    return !!data && Array.isArray(data.topFirms) && !!data.perFirm && typeof data.perFirm === 'object' && !Array.isArray(data.perFirm) && !!(data.periodEndIso || data.periodEnd);
  }
  return { funds, queryFunds, positions, sorted, matches, finite, insiders, valid };
}
