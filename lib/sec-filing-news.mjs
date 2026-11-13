// SEC 8-K filings as official company news (2026-11-13, owner request).
//
// A company files an 8-K for a material event, usually within minutes of its
// press release (earnings, a major agreement, an officer change, a
// restatement). Each filing lists numbered items, so the event type comes from
// the filing itself, with no headline guessing and no AI. One EDGAR
// submissions read per covered company (data.sec.gov/submissions/CIK##.json,
// keyless; SEC asks for a declared User-Agent and at most 10 requests a
// second). Two readers, about 80 names, at most one read per name every 45
// minutes; the whole pass overlaps the AI news pass in the bake.
//
// Output joins news-source-evidence.json as one source, `sec-8k`. Like the
// issuer feeds it is context only: it shows on the News page with an
// "SEC filing" label and never adds grading points, re-reads or AI calls.
// Foreign issuers (TSM, ASML, NVO, BABA, ARM ...) file 6-K reports, which
// carry no item numbers; they are listed in coverage and skipped.

import { newsDateIsCurrent } from "./news-policy.mjs";

export const SEC_8K_SOURCE_ID = "sec-8k";
export const SEC_8K_LABEL = "SEC 8-K filings";
export const SEC_8K_TTL_MS = 45 * 60000;
export const SEC_8K_ERROR_RETRY_MS = 30 * 60000;
export const SEC_8K_WINDOW_DAYS = 7;
// Big bank filers list tens of thousands of note filings (JPM: 26,667 rows,
// 4.7 MB on 2026-11-13); other filers are about 160 KB.
export const SEC_8K_MAX_BYTES = 30_000_000;
// Below this share of names read, the source reports "partial" (the Update
// checker and News page then flag it). One or two slow names do not.
export const SEC_8K_MIN_READ_SHARE = 0.9;
// Foreign filers (6-K only) never produce a row, so they are re-checked once a
// day instead of every 45 minutes.
export const SEC_8K_FOREIGN_TTL_MS = 24 * 3600000;
// Pause after each read per reader: two readers stay under ~7 requests a
// second even on instant responses (SEC's limit is 10 a second, shared with
// the build's other EDGAR reads).
export const SEC_8K_GAP_MS = 300;
const SUBMISSIONS_HOST = "data.sec.gov";

// The 8-K item list (SEC Form 8-K General Instructions). `cls` groups items by
// what happened; `routine` items alone do not make a news row.
export const SEC_8K_ITEMS = Object.freeze({
  "1.01": { label: "Material agreement signed", cls: "agreement" },
  "1.02": { label: "Material agreement ended", cls: "agreement" },
  "1.03": { label: "Bankruptcy or receivership", cls: "bankruptcy" },
  "1.04": { label: "Mine safety notice", cls: "routine", routine: true },
  "1.05": { label: "Material cybersecurity incident", cls: "cybersecurity" },
  "2.01": { label: "Acquisition or sale completed", cls: "acquisition" },
  "2.02": { label: "Results of operations", cls: "earnings" },
  "2.03": { label: "New debt or financial obligation", cls: "financing" },
  "2.04": { label: "Debt repayment accelerated", cls: "financing" },
  "2.05": { label: "Exit or restructuring costs", cls: "restructuring" },
  "2.06": { label: "Material impairment", cls: "impairment" },
  "3.01": { label: "Listing rule notice or delisting", cls: "listing" },
  "3.02": { label: "Unregistered share sale", cls: "financing" },
  "3.03": { label: "Shareholder rights changed", cls: "shareholder-rights" },
  "4.01": { label: "Auditor change", cls: "auditor" },
  "4.02": { label: "Past financial statements no longer reliable", cls: "restatement" },
  "5.01": { label: "Change in control", cls: "control" },
  "5.02": { label: "Director or officer change, or executive pay", cls: "leadership" },
  "5.03": { label: "Charter or bylaw change", cls: "routine", routine: true },
  "5.04": { label: "Benefit plan trading blackout", cls: "routine", routine: true },
  "5.05": { label: "Code of ethics change", cls: "routine", routine: true },
  "5.06": { label: "Shell company status change", cls: "routine", routine: true },
  "5.07": { label: "Shareholder vote results", cls: "routine", routine: true },
  "5.08": { label: "Director nomination dates", cls: "routine", routine: true },
  "7.01": { label: "Regulation FD disclosure", cls: "disclosure" },
  "8.01": { label: "Other events", cls: "other" },
  "9.01": { label: "Exhibits", cls: "exhibits", routine: true },
});
// Most telling item first when a filing lists several.
const CLASS_ORDER = ["bankruptcy", "restatement", "control", "cybersecurity", "earnings", "acquisition", "agreement", "impairment", "restructuring", "financing", "leadership", "auditor", "listing", "shareholder-rights", "disclosure", "other"];

function padCik(cik) {
  const digits = String(cik ?? "").replace(/\D/g, "");
  return digits && digits.length <= 10 ? digits.padStart(10, "0") : null;
}

export function secSubmissionsUrl(cik) {
  const p = padCik(cik);
  return p ? `https://${SUBMISSIONS_HOST}/submissions/CIK${p}.json` : null;
}

// "2.02,9.01" / "Item 2.02, Item 9.01" -> ["2.02", "9.01"], known items only.
export function parseSecItems(raw) {
  const out = [];
  for (const m of String(raw || "").matchAll(/\b(\d)\.(\d{2})\b/g)) {
    const code = `${m[1]}.${m[2]}`;
    if (SEC_8K_ITEMS[code] && !out.includes(code)) out.push(code);
  }
  return out;
}

export function secEventClass(items) {
  const classes = items.map((c) => SEC_8K_ITEMS[c]).filter((d) => d && !d.routine).map((d) => d.cls);
  return CLASS_ORDER.find((c) => classes.includes(c)) || null;
}

// EDGAR's acceptanceDateTime is UTC ("2026-10-30T20:30:22.000Z"). A missing
// or malformed stamp falls back to the filing date as a date-only row.
function acceptedAt(acceptance, filingDate) {
  const a = String(acceptance || "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(a) && Number.isFinite(Date.parse(a))) return { publishedAt: new Date(Date.parse(a)).toISOString(), dateOnly: false };
  const d = String(filingDate || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + "T12:00:00Z"))) return { publishedAt: d + "T12:00:00Z", dateOnly: true };
  return null;
}

function shortName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
}

// EDGAR stores most names in capitals ("NVIDIA CORP"); a mixed-case name from
// the quote feed reads better in a headline and is preferred when given.
function displayName(preferred, edgarName) {
  const p = shortName(preferred);
  return p && /[a-z]/.test(p) ? p : shortName(edgarName);
}

// One company's submissions JSON -> 8-K news events from the last
// SEC_8K_WINDOW_DAYS days. Throws on a payload that is not this company's.
export function parseSecSubmissions(json, { symbol, cik, name = null }, now = Date.now()) {
  const want = padCik(cik);
  if (!json || typeof json !== "object" || padCik(json.cik) !== want) throw new Error("Submissions payload is for another filer");
  if (Array.isArray(json.tickers) && json.tickers.length && !json.tickers.map((t) => String(t).toUpperCase()).includes(symbol)) throw new Error("Ticker not listed on this filer");
  const r = json.filings?.recent;
  const cols = ["accessionNumber", "filingDate", "acceptanceDateTime", "form", "items", "primaryDocument"];
  if (!r || !cols.every((c) => Array.isArray(r[c])) || !cols.every((c) => r[c].length === r.form.length)) throw new Error("Unexpected submissions layout");
  const company = displayName(name, json.name) || symbol;
  const cikInt = String(Number(want));
  const events = [];
  let rejected = 0, eightK = 0, sixK = 0;
  for (let i = 0; i < r.form.length; i++) {
    const form = String(r.form[i] || "");
    if (form === "6-K" || form === "6-K/A") { sixK++; continue; }
    if (form !== "8-K" && form !== "8-K/A") continue;
    eightK++;
    const when = acceptedAt(r.acceptanceDateTime[i], r.filingDate[i]);
    if (!when || !newsDateIsCurrent(when.publishedAt, now, SEC_8K_WINDOW_DAYS)) continue;
    const acc = String(r.accessionNumber[i] || "");
    const doc = String(r.primaryDocument[i] || "");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(acc) || !/^[\w.\-]{1,120}$/.test(doc)) { rejected++; continue; }
    const items = parseSecItems(r.items[i]);
    const eventClass = secEventClass(items);
    if (!eventClass) { rejected++; continue; }
    const amended = form === "8-K/A";
    const labels = items.filter((c) => !SEC_8K_ITEMS[c].routine).map((c) => `${SEC_8K_ITEMS[c].label} (Item ${c})`);
    events.push({
      eventId: `sec8k:${acc}`,
      kind: "sec-filing",
      sourceKind: "official",
      symbols: [symbol],
      publisher: "SEC EDGAR · company filing",
      title: `${company} ${amended ? "amends an 8-K" : "files an 8-K"}: ${labels.join("; ")}`,
      publishedAt: when.publishedAt,
      dateOnly: when.dateOnly,
      link: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc.replace(/-/g, "")}/${doc}`,
      facts: { form, items, eventClass, accession: acc, filingDate: String(r.filingDate[i] || "") || null },
    });
  }
  return { events, rejected, foreignFiler: eightK === 0 && sixK > 0 };
}

async function boundedJson(res, maxBytes) {
  if (Number(res.headers.get("content-length")) > maxBytes) throw new Error("Response exceeds byte budget");
  if (!res.body?.getReader) { const t = await res.text(); if (t.length > maxBytes) throw new Error("Response exceeds byte budget"); return JSON.parse(t); }
  const reader = res.body.getReader(); let size = 0; const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Response exceeds byte budget"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
}

// Collect every covered filer into ONE source state (so the News page and the
// Update checker show one "SEC 8-K filings" row, not eighty). `filers` maps
// symbol -> CIK; a name missing from it keeps its CIK from the prior state.
// A name whose read fails keeps its earlier events.
export async function collectSecFilingNews({ filers = {}, names: companyNames = {}, prior = null, fetchImpl = fetch, now = new Date(), userAgent, concurrency = 2, ttlMs = SEC_8K_TTL_MS, gapMs = SEC_8K_GAP_MS } = {}) {
  const nowMs = now.getTime();
  const checkedAt = now.toISOString();
  const priorNames = prior && typeof prior.names === "object" && !Array.isArray(prior.names) ? prior.names : {};
  const priorEvents = Array.isArray(prior?.events) ? prior.events : [];
  const symbols = [...new Set([...Object.keys(filers), ...Object.keys(priorNames)])]
    .filter((s) => /^[A-Z][A-Z0-9.]{0,5}$/.test(s))
    .filter((s) => Object.keys(filers).length === 0 || Object.prototype.hasOwnProperty.call(filers, s))
    .sort();
  const names = {};
  const events = [];
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++];
      const old = priorNames[symbol] || null;
      const cik = padCik(filers[symbol]) || padCik(old?.cik);
      // Carried events still leave after SEC_8K_WINDOW_DAYS, even while a
      // name keeps failing.
      const carry = () => priorEvents.filter((e) => e?.symbols?.[0] === symbol && newsDateIsCurrent(e.publishedAt, nowMs, SEC_8K_WINDOW_DAYS));
      if (!cik) { names[symbol] = { cik: null, status: "error", checkedAt, error: "No CIK mapped" }; continue; }
      const lastAt = Date.parse(old?.checkedAt || "");
      const fresh = old && old.cik === cik && Number.isFinite(lastAt) && newsDateIsCurrent(old.checkedAt, nowMs, 1)
        && nowMs - lastAt < (old.status === "error" ? SEC_8K_ERROR_RETRY_MS : old.foreignFiler ? Math.max(ttlMs, SEC_8K_FOREIGN_TTL_MS) : ttlMs);
      if (fresh) { names[symbol] = { ...old, status: old.status === "error" ? "error" : "cached" }; events.push(...carry()); continue; }
      try {
        const res = await fetchImpl(secSubmissionsUrl(cik), { headers: { accept: "application/json", "user-agent": userAgent || "Mingstreet holdings research https://mingstreet.app" }, signal: AbortSignal.timeout(15000) });
        if (res.url && new URL(res.url).hostname !== SUBMISSIONS_HOST) throw new Error("Unexpected redirect host");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseSecSubmissions(await boundedJson(res, SEC_8K_MAX_BYTES), { symbol, cik, name: companyNames?.[symbol] }, nowMs);
        names[symbol] = { cik, status: "ok", checkedAt, lastSuccessAt: checkedAt, accepted: parsed.events.length, rejected: parsed.rejected, foreignFiler: parsed.foreignFiler, error: null };
        events.push(...parsed.events);
      } catch (err) {
        names[symbol] = { cik, status: "error", checkedAt, lastSuccessAt: old?.lastSuccessAt || null, foreignFiler: old?.foreignFiler === true, error: String(err?.message || err).replace(/https?:\/\/\S+/g, "[source]").slice(0, 180) };
        events.push(...carry());
      }
      if (gapMs > 0 && cursor < symbols.length) await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, symbols.length || 1)) }, worker));
  const total = symbols.length;
  const read = Object.values(names).filter((n) => n.status !== "error").length;
  const failed = Object.entries(names).filter(([, n]) => n.status === "error").map(([s]) => s).sort();
  const share = total ? read / total : 0;
  const status = !total || read === 0 ? "error" : share < SEC_8K_MIN_READ_SHARE ? "partial" : "ok";
  return {
    label: SEC_8K_LABEL,
    status,
    partial: status === "partial",
    checkedAt,
    // The newest real read (a cached name does not move it).
    lastSuccessAt: Object.values(names).map((n) => n.lastSuccessAt).filter(Boolean).sort().pop() || prior?.lastSuccessAt || null,
    error: status === "error" ? (total ? `No filer read (${failed.length} failed)` : "No filers mapped") : null,
    sourceUrl: `https://${SUBMISSIONS_HOST}/submissions/`,
    events: events.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))),
    rejected: Object.values(names).reduce((s, n) => s + (n.rejected || 0), 0),
    names,
    coverage: {
      filers: total,
      read,
      failed,
      foreignFilers: Object.entries(names).filter(([, n]) => n.foreignFiler).map(([s]) => s).sort(),
    },
  };
}
