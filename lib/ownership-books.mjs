import { createHash } from 'node:crypto';
import { ownershipPartReferences } from './data-ownership.mjs';

// Immutable part names prevent a refresh from mixing two filing generations.
// Summary parts power searches; heavier source rows are loaded only on demand.
export function packOwnershipBooks(input, maxBytes = 750_000) {
  const parts = new Map(), perFirm = {};
  function part(kind, rows) {
    const body = JSON.stringify({ version: 1, rows });
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 24);
    const key = `13f-books/${kind}-${hash}.json`;
    parts.set(key, body);
    return key;
  }
  function groups(rows) {
    const groups = []; let group = [], bytes = 32;
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (group.length && bytes + size > maxBytes) { groups.push(group); group = []; bytes = 32; }
      if (size > maxBytes) throw new Error('A single ownership position exceeds the disclosure part budget');
      group.push(row); bytes += size;
    }
    if (group.length) groups.push(group);
    return groups;
  }
  for (const [name, f] of Object.entries(input.perFirm || {})) {
    if (!Array.isArray(f?.holdings)) { perFirm[name] = f; continue; }
    if (Array.isArray(f.holdingsParts) && f.holdings.every(r => r.disclosurePart && !r.disclosures)) {
      const { holdings, ...meta } = f;
      perFirm[name] = meta;
      continue;
    }
    const summaries = [];
    for (const group of groups(f.holdings)) {
      const key = part('disclosures', group.map(r => ({ disclosures: r.disclosures, priorDisclosures: r.priorDisclosures })));
      group.forEach((r, index) => {
        const { disclosures, priorDisclosures, ...summary } = r;
        summaries.push({ ...summary, disclosurePart: key, disclosureIndex: index,
          disclosureCount: disclosures.length + priorDisclosures.length });
      });
    }
    const { holdings, ...meta } = f;
    perFirm[name] = { ...meta, holdingsCount: summaries.length, holdingsParts: groups(summaries).map(rows => part('summary', rows)) };
  }
  return { payload: { ...input, perFirm }, parts };
}

// Shared by collection cache hydration and the browser. Concurrent reads are
// bounded and failed parts never become empty, apparently complete portfolios.
export function ownershipBookClientFactory(readPart, { readTimeoutMs = 20000, hydrateTimeoutMs = 30000 } = {}) {
  const cache = new Map();
  async function read(key, deadline = Infinity) {
    if (!/^13f-books\/(?:summary|disclosures)-[a-f0-9]{24}\.json$/.test(key)) throw new Error('Invalid ownership part');
    const wait = Math.min(readTimeoutMs, deadline - Date.now());
    if (wait <= 0) throw new Error('Ownership book loading deadline exceeded');
    if (!cache.has(key)) {
      const controller = new AbortController(); let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Ownership book read timed out')); }, wait); });
      const promise = Promise.race([Promise.resolve().then(() => readPart(key, { signal: controller.signal })), timeout]).then(value => {
        if (value?.version !== 1 || !Array.isArray(value.rows)) throw new Error('Invalid ownership book');
        return value.rows;
      }).catch(error => { cache.delete(key); throw error; }).finally(() => clearTimeout(timer));
      cache.set(key, promise);
    }
    return cache.get(key);
  }
  async function batch(items, fn) {
    const output = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) { const i = next++; output[i] = await fn(items[i]); }
    }));
    return output;
  }
  async function hydrate(data) {
    const deadline = Date.now() + hydrateTimeoutMs;
    const entries = Object.entries(data.perFirm || {});
    const keys = [...new Set(entries.flatMap(([, f]) => Array.isArray(f?.holdings) ? [] : f?.holdingsParts || []))];
    const loaded = new Map(await batch(keys, async key => {
      try { return [key, await read(key, deadline)]; } catch { return [key, null]; }
    }));
    return { ...data, perFirm: Object.fromEntries(entries.map(([key, f]) => {
      if (!f || Array.isArray(f.holdings) || !Array.isArray(f.holdingsParts)) return [key, f];
      if (f.holdingsParts.some(part => !loaded.get(part))) return [key, { ...f, holdingsLoadFailed: true }];
      const holdings = f.holdingsParts.flatMap(part => loaded.get(part));
      if (holdings.length !== f.holdingsCount || holdings.some(r => !r || typeof r.cusip !== 'string' || typeof r.type !== 'string' || !Number.isFinite(r.valueNow) || !r.disclosurePart)) {
        for (const part of f.holdingsParts) cache.delete(part);
        return [key, { ...f, holdingsLoadFailed: true }];
      }
      return [key, { ...f, holdings }];
    })) };
  }
  async function details(row) {
    if (!row.disclosurePart) return row;
    const rows = await read(row.disclosurePart), detail = rows[row.disclosureIndex];
    if (!detail || !Array.isArray(detail.disclosures) || !Array.isArray(detail.priorDisclosures)) { cache.delete(row.disclosurePart); throw new Error('Disclosure rows unavailable'); }
    if (detail.disclosures.length + detail.priorDisclosures.length !== row.disclosureCount) { cache.delete(row.disclosurePart); throw new Error('Disclosure rows incomplete'); }
    return { ...row, ...detail };
  }
  return { hydrate, details, batch };
}

// Read before the build's data-directory wipe. Renew grace only for parts of
// the immediately previous root; previously retired parts keep their expiry.
export async function retainOwnershipBooks(payload, readText, now = new Date()) {
  const bodies = new Map();
  const read = async key => { if (!bodies.has(key)) bodies.set(key, await readText(key)); return bodies.get(key); };
  const hydrated = await ownershipBookClientFactory(async key => JSON.parse(await read(key))).hydrate(payload);
  const priorExpiry = new Map((payload.ownershipRetainedParts || []).filter(r => Date.parse(r.expiresAtIso) > now.getTime()).map(r => [r.key, r.expiresAtIso]));
  const current = ownershipPartReferences({ ...hydrated, ownershipRetainedParts: [] }, now);
  const expiry = new Date(now.getTime() + 24 * 3600000).toISOString();
  const parts = new Map();
  for (const key of ownershipPartReferences(hydrated, now)) {
    try { parts.set(key, { body: await read(key), expiresAtIso: current.includes(key) ? expiry : priorExpiry.get(key) }); } catch { /* invalid prior books cannot be retained */ }
  }
  for (const [name, f] of Object.entries(hydrated.perFirm || {})) {
    if (Array.isArray(f?.holdingsParts) && (!Array.isArray(f.holdings) || f.holdingsParts.some(k => !parts.has(k)) || f.holdings.some(r => !parts.has(r.disclosurePart)))) hydrated.perFirm[name] = null;
  }
  // Retained summaries are useful only with every referenced source part.
  for (const [key, value] of parts) if (key.includes('/summary-')) {
    try { if (JSON.parse(value.body).rows.some(r => !parts.has(r.disclosurePart))) parts.delete(key); } catch { parts.delete(key); }
  }
  return { payload: hydrated, parts };
}
