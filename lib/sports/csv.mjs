// Small RFC 4180 CSV reader for provider files (nflverse releases, owner CSV
// imports). Quoted fields may hold commas, quotes ("") and newlines. Returns
// an array of objects keyed by the header row. No dependency.
export function parseCsv(text, { maxRows = 500000 } = {}) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') rows.push(row);
    if (rows.length > maxRows + 1) throw Object.assign(new Error('CSV has too many rows'), { code: 'RESOURCE_LIMIT' });
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) endRow();
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    for (let c = 0; c < header.length; c++) o[header[c]] = r[c] ?? '';
    return o;
  });
}
