// Folds parsed Section 16 filings into one record per insider at one company:
// current role, each holding line (direct, or through a trust, spouse, fund…)
// at its latest reported amount, and the newest transactions. Filings may be
// read in any order: a line only changes when a newer filing reports it.
import { shareClassOf, officerTitle } from './forms.mjs';

const TX_KEEP = 15;

function natureKey(s) {
  return String(s || '').toLowerCase().replace(/see footnote.*$/, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
}
export function lineKey(row) {
  return `${shareClassOf(row.title)}|${row.di === 'I' ? 'I' : 'D'}|${row.di === 'I' ? natureKey(row.nature || row.natureNote) : ''}`;
}

// meta: { acc, filed (YYYY-MM-DD), form, url }
export function foldFiling(company, parsed, meta) {
  if (!parsed || !Array.isArray(parsed.owners) || !parsed.owners.length) return [];
  company.owners ||= {};
  const touched = [];
  parsed.owners.forEach((o, idx) => {
    if (!o.cik) return;
    const rec = company.owners[o.cik] ||= { cik: o.cik, sec: o.name, lines: {}, tx: [], filings: 0 };
    rec.filings = (rec.filings || 0) + 1;
    if (o.name) rec.sec = rec.sec || o.name;
    // The role on the newest filing is the current one.
    if (!rec.rolesFiled || meta.filed >= rec.rolesFiled) {
      rec.roles = { director: !!o.director, officer: !!o.officer, title: officerTitle(o.title, parsed.remarks), tenPct: !!o.tenPct, other: !!o.other, otherText: o.otherText || null };
      rec.rolesFiled = meta.filed;
      if (o.name) rec.sec = o.name;
    }
    if (!rec.first || meta.filed < rec.first) rec.first = meta.filed;
    if (!rec.last || meta.filed > rec.last) { rec.last = meta.filed; rec.lastAcc = meta.acc; rec.lastUrl = meta.url || null; rec.lastForm = meta.form || parsed.form || null; }
    if (/^3/.test(String(meta.form || parsed.form || '')) && (!rec.form3 || meta.filed < rec.form3)) rec.form3 = meta.filed;
    if (parsed.owners.length > 1) rec.joint = parsed.owners.filter((x) => x.cik !== o.cik).map((x) => x.name).filter(Boolean).slice(0, 4);
    touched.push(o.cik);
    // Joint filings report one set of shares; it belongs to the first filer.
    if (idx !== 0) return;
    if (parsed.noSecurities && !parsed.rows.length) {
      for (const k of Object.keys(rec.lines)) if ((rec.lines[k].filed || '') < meta.filed) rec.lines[k] = { ...rec.lines[k], shares: 0, filed: meta.filed, acc: meta.acc };
    }
    const latestByKey = new Map();
    parsed.rows.forEach((row, order) => {
      if (row.post == null || !row.title) return;
      if (shareClassOf(row.title) === 'preferred') return;
      const k = lineKey(row);
      const date = row.date || parsed.period || meta.filed;
      const prev = latestByKey.get(k);
      if (!prev || date > prev.date || (date === prev.date && order > prev.order)) latestByKey.set(k, { row, date, order });
    });
    for (const [k, { row, date }] of latestByKey) {
      const cur = rec.lines[k];
      if (cur && (cur.filed > meta.filed || (cur.filed === meta.filed && cur.asOf > date))) continue;
      rec.lines[k] = {
        title: row.title, cls: shareClassOf(row.title), di: row.di === 'I' ? 'I' : 'D',
        nature: row.di === 'I' ? (row.nature || null) : null, note: row.di === 'I' ? (row.natureNote || null) : null,
        shares: Math.round(row.post), asOf: date, filed: meta.filed, acc: meta.acc,
      };
    }
    const seen = new Set(rec.tx.map((t) => t.acc + '#' + t.i));
    parsed.rows.forEach((row, i) => {
      if (row.kind !== 'tx' || !row.code || seen.has(meta.acc + '#' + i)) return;
      rec.tx.push({ acc: meta.acc, i, date: row.date || meta.filed, code: row.code, shares: row.shares, price: row.price, ad: row.ad, post: row.post, title: row.title, di: row.di });
    });
    rec.tx.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.i - a.i);
    rec.tx = rec.tx.slice(0, TX_KEEP);
  });
  return touched;
}

// Shares by class across every line, plus how much is direct vs indirect.
export function holdingTotals(rec) {
  const byClass = {};
  let direct = 0, indirect = 0, asOf = null;
  for (const line of Object.values(rec?.lines || {})) {
    if (!(line.shares > 0)) continue;
    byClass[line.cls] = (byClass[line.cls] || 0) + line.shares;
    if (line.di === 'I') indirect += line.shares; else direct += line.shares;
    if (!asOf || line.asOf > asOf) asOf = line.asOf;
  }
  return { byClass, direct, indirect, total: direct + indirect, asOf };
}
