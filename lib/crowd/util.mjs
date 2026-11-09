// Shared helpers for the crowd / positioning fetchers (lib/crowd/, 2026-11-09).
//
// Every fetcher here is free, keyless and fail-soft: a failed read returns
// the prior block marked `stale` with the error text, never throws into the
// bake, and never spends an AI call. Histories are compact arrays of
// [isoDate, ...numbers] capped per source so the public payload stays small.

export const CROWD_USER_AGENT = "stonks-app market-data pipeline (https://mingstreet.app)";
export const CROWD_TIMEOUT_MS = 30000;

export function finite(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[,%$\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round(v, digits = 2) {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

export function isoDay(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function compactDay(iso) {
  return String(iso || "").replace(/-/g, "");
}

export function etDateKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function addDays(iso, days) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

export function isWeekend(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

// Weekdays walking back from `fromIso` (exclusive when `exclusive`), newest first.
export function recentWeekdays(fromIso, count, exclusive = true) {
  const out = [];
  let d = exclusive ? addDays(fromIso, -1) : fromIso;
  while (out.length < count) {
    if (!isWeekend(d)) out.push(d);
    d = addDays(d, -1);
  }
  return out;
}

export async function fetchText(url, { headers = {}, method = "GET", body, timeoutMs = CROWD_TIMEOUT_MS, accept = "text/plain,application/json,text/html,*/*" } = {}) {
  const res = await fetch(url, {
    method,
    headers: { accept, "user-agent": CROWD_USER_AGENT, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { accept: "application/json", ...opts });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("non-JSON response");
  }
}

export function errorText(err) {
  return String(err?.message || err || "unknown error").split("\n")[0].slice(0, 160);
}

// Marks a prior block as carried forward after a failed fetch.
export function carried(prior, error, nowIso) {
  if (!prior || typeof prior !== "object") return { ok: false, stale: true, error, fetchedAt: nowIso, carriedForward: false };
  const { ok: _ok, error: _e, ...rest } = prior;
  return { ...rest, ok: false, stale: true, carriedForward: true, error, lastAttemptAt: nowIso };
}

// Upserts [isoDate, ...values] into a dated history, keeps the newest `keep`.
export function upsertDated(history, row, keep) {
  const list = Array.isArray(history) ? history.filter((r) => Array.isArray(r) && typeof r[0] === "string") : [];
  const idx = list.findIndex((r) => r[0] === row[0]);
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  list.sort((a, b) => a[0].localeCompare(b[0]));
  return list.slice(-keep);
}

export function mean(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 3) return null;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function zScore(value, values) {
  const m = mean(values);
  const s = stdev(values);
  if (!Number.isFinite(value) || m == null || !(s > 0)) return null;
  return round((value - m) / s, 2);
}

// Percentile rank (0..100) of `value` within `values`, midrank convention.
export function percentileRank(value, values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!Number.isFinite(value) || xs.length < 5) return null;
  let below = 0;
  let equal = 0;
  for (const x of xs) {
    if (x < value) below++;
    else if (x === value) equal++;
  }
  return round(((below + equal / 2) / xs.length) * 100, 0);
}

export function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|div|li|h\d|table|thead|tbody)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\|[ \t]*/g, " | ")
    .replace(/\n\s*\n+/g, "\n");
}

export function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/\//g, ".");
}

// Once-per-ET-day guard: true when the prior block already holds today's fetch.
export function fetchedToday(prior, etDate) {
  return !!prior && prior.ok !== false && prior.fetchedDate === etDate;
}
