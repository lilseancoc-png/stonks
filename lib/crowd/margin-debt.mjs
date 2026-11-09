// S3 — FINRA margin statistics (customer debit balances and free credit).
//
// https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics
// shows a table of months with debit balances in margin accounts, free credit
// in cash accounts and free credit in margin accounts, in $ millions, posted
// around the third week of the following month. Months accumulate across
// builds (the page shows the recent window only); once per ET day. Free.

import { fetchText, finite, round, carried, errorText, stripTags, fetchedToday } from "./util.mjs";

export const MARGIN_DEBT_URL = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics";
export const MARGIN_DEBT_KEEP_MONTHS = 60;
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

export function monthKey(label) {
  const m = String(label || "").trim().match(/^([A-Z][a-z]{2})[-\s'’]?(\d{2}|\d{4})$/);
  if (!m || !MONTHS[m[1]]) return null;
  const year = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${year}-${MONTHS[m[1]]}`;
}

// Rows of { month: "YYYY-MM", debit, creditCash, creditMargin } in $ millions.
export function parseMarginPage(html) {
  const out = [];
  const seen = new Set();
  for (const line of stripTags(html).split("\n")) {
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
    if (cells.length < 4) continue;
    const month = monthKey(cells[0]);
    if (!month || seen.has(month)) continue;
    const debit = finite(cells[1]);
    const creditCash = finite(cells[2]);
    const creditMargin = finite(cells[3]);
    if (!(debit > 1000)) continue;
    seen.add(month);
    out.push({ month, debit: Math.round(debit), creditCash: creditCash == null ? null : Math.round(creditCash), creditMargin: creditMargin == null ? null : Math.round(creditMargin) });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

export function summarizeMargin(rows) {
  const list = (rows || []).slice().sort((a, b) => a.month.localeCompare(b.month));
  const latest = list[list.length - 1];
  if (!latest) return null;
  const find = (n) => list[list.length - 1 - n] || null;
  const byMonth = (key) => list.find((r) => r.month === key) || null;
  const [y, m] = latest.month.split("-").map(Number);
  const yearAgo = byMonth(`${y - 1}-${String(m).padStart(2, "0")}`);
  const prev = find(1);
  const freeCredit = (latest.creditCash || 0) + (latest.creditMargin || 0);
  const peak = list.reduce((a, r) => (r.debit > (a?.debit || 0) ? r : a), null);
  return {
    month: latest.month,
    debitUsdM: latest.debit,
    freeCreditUsdM: freeCredit || null,
    netUsdM: freeCredit ? latest.debit - freeCredit : null,
    momPct: prev ? round((latest.debit / prev.debit - 1) * 100, 1) : null,
    yoyPct: yearAgo ? round((latest.debit / yearAgo.debit - 1) * 100, 1) : null,
    peak: peak ? { month: peak.month, debitUsdM: peak.debit, fromPeakPct: round((latest.debit / peak.debit - 1) * 100, 1) } : null,
    months: list.length,
  };
}

export async function fetchMarginDebt({ prior, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchText } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  try {
    const html = await fetchImpl(MARGIN_DEBT_URL, { accept: "text/html" });
    const parsed = parseMarginPage(html);
    if (!parsed.length) throw new Error("no month rows parsed");
    const byMonth = new Map((Array.isArray(base.rows) ? base.rows : []).map((r) => [r.month, r]));
    for (const r of parsed) byMonth.set(r.month, r);
    const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-MARGIN_DEBT_KEEP_MONTHS);
    return {
      ok: true, stale: false, carriedForward: false, error: null,
      fetchedAt: nowIso, fetchedDate: todayEt, asOf: rows[rows.length - 1].month,
      summary: summarizeMargin(rows),
      rows,
      note: "FINRA member firms' customer debit balances in margin accounts (margin debt) and free credit balances, $ millions, published monthly about three weeks after month end.",
    };
  } catch (err) {
    return carried(base, errorText(err), nowIso);
  }
}
