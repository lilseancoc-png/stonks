// O1 — FINRA Reg SHO daily short sale volume (consolidated NMS file).
//
// One pipe-delimited file per session at
// https://cdn.finra.org/equity/regsho/daily/CNMSshvolYYYYMMDD.txt
// (Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market). Published
// after the close (usually 18:00-20:00 ET), so the morning bake reads the
// prior session. The short-volume share (short / total) says what portion of
// the day's off-exchange-and-exchange prints were sold short; it is NOT short
// interest. Free, no key.
//
// Each build fetches only the sessions still missing (newest first, at most
// MAX_FILES_PER_BUILD), keeps HISTORY_DAYS sessions per tracked name, and
// marks the block stale when nothing new could be read.

import { fetchText, finite, round, carried, errorText, isoDay, compactDay, recentWeekdays, mean, zScore, normalizeSymbol } from "./util.mjs";

export const SHORT_VOLUME_URL = (iso) => `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${compactDay(iso)}.txt`;
export const SHORT_VOLUME_HISTORY_DAYS = 60;
export const SHORT_VOLUME_BACKFILL_DAYS = 60;
export const SHORT_VOLUME_MAX_FILES_PER_BUILD = 6;

// Parses one FINRA daily file into { symbol: { short, exempt, total } }.
export function parseShortVolumeFile(text, symbols) {
  const want = symbols ? new Set(symbols.map(normalizeSymbol)) : null;
  const out = {};
  let date = null;
  let rows = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line || line.startsWith("Date|")) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const sym = normalizeSymbol(parts[1]);
    if (!sym) continue;
    rows++;
    if (!date) date = isoDay(parts[0]);
    if (want && !want.has(sym)) continue;
    const short = finite(parts[2]);
    const exempt = finite(parts[3]);
    const total = finite(parts[4]);
    if (!(total > 0)) continue;
    out[sym] = { short: Math.round(short || 0), exempt: Math.round(exempt || 0), total: Math.round(total) };
  }
  return { date, rows, bySymbol: out };
}

function sessionsToFetch(prior, sessionDates, todayEt) {
  const have = new Set(Array.isArray(prior?.sessions) ? prior.sessions : []);
  const missing = new Set(Array.isArray(prior?.missing) ? prior.missing : []);
  const candidates = (Array.isArray(sessionDates) && sessionDates.length
    ? sessionDates.filter((d) => d < todayEt).sort().reverse()
    : recentWeekdays(todayEt, SHORT_VOLUME_BACKFILL_DAYS + 5)).slice(0, SHORT_VOLUME_BACKFILL_DAYS + 5);
  return candidates.filter((d) => !have.has(d) && !missing.has(d)).slice(0, SHORT_VOLUME_MAX_FILES_PER_BUILD);
}

// Per-symbol derived reads over the stored history.
export function summarizeShortVolume(history) {
  const rows = (history || []).filter((r) => Array.isArray(r) && Number.isFinite(r[1]));
  if (!rows.length) return null;
  const pcts = rows.map((r) => r[1]);
  const latest = rows[rows.length - 1];
  const last20 = pcts.slice(-21, -1);
  return {
    date: latest[0],
    shortPct: latest[1],
    shortVol: latest[2] ?? null,
    totalVol: latest[3] ?? null,
    exemptPct: latest[4] ?? null,
    avg20Pct: round(mean(last20), 1),
    z20: zScore(latest[1], last20),
    sessions: rows.length,
  };
}

export async function fetchShortVolume({ prior, symbols, sessionDates, todayEt, nowIso = new Date().toISOString(), fetchImpl = fetchText } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const bySymbol = { ...(base.bySymbol || {}) };
  const sessions = new Set(Array.isArray(base.sessions) ? base.sessions : []);
  const missing = new Set(Array.isArray(base.missing) ? base.missing : []);
  const toFetch = sessionsToFetch(base, sessionDates, todayEt);
  const errors = [];
  let fetched = 0;
  for (const day of toFetch) {
    try {
      const text = await fetchImpl(SHORT_VOLUME_URL(day));
      const parsed = parseShortVolumeFile(text, symbols);
      if (!parsed.rows) {
        missing.add(day);
        continue;
      }
      for (const sym of symbols) {
        const row = parsed.bySymbol[sym];
        const hist = Array.isArray(bySymbol[sym]?.history) ? bySymbol[sym].history : [];
        const next = row
          ? [day, round((row.short / row.total) * 100, 1), row.short, row.total, round((row.exempt / row.total) * 100, 2)]
          : null;
        const list = hist.filter((r) => r[0] !== day);
        if (next) list.push(next);
        list.sort((a, b) => a[0].localeCompare(b[0]));
        bySymbol[sym] = { history: list.slice(-SHORT_VOLUME_HISTORY_DAYS) };
      }
      sessions.add(day);
      fetched++;
    } catch (err) {
      // A missing file (404) is a holiday or not-yet-published day: remember
      // past misses so they are not retried every build, keep retrying the
      // newest session until it lands.
      if (err?.status === 404 && day !== toFetch[0]) missing.add(day);
      errors.push(`${day}: ${errorText(err)}`);
    }
  }
  const sessionList = [...sessions].sort().slice(-SHORT_VOLUME_HISTORY_DAYS - 5);
  for (const sym of Object.keys(bySymbol)) {
    bySymbol[sym] = { ...bySymbol[sym], ...(summarizeShortVolume(bySymbol[sym].history) || {}) };
  }
  // Tracked-universe average share for the market line.
  const marketHist = [];
  for (const day of sessionList) {
    const vals = Object.values(bySymbol).map((s) => (s.history || []).find((r) => r[0] === day)?.[1]).filter((v) => Number.isFinite(v));
    if (vals.length >= Math.min(10, Math.ceil(symbols.length / 2))) marketHist.push([day, round(mean(vals), 1), vals.length]);
  }
  const asOf = sessionList[sessionList.length - 1] || null;
  const okNow = fetched > 0 || (toFetch.length === 0 && sessionList.length > 0);
  if (!okNow && !sessionList.length) return carried(base, errors[0] || "no sessions read", nowIso);
  return {
    ok: okNow,
    stale: !okNow,
    carriedForward: !okNow,
    error: okNow ? null : (errors[0] || null),
    fetchedAt: nowIso,
    asOf,
    sessions: sessionList,
    missing: [...missing].sort().slice(-40),
    fetchedThisBuild: fetched,
    errors: errors.slice(0, 5),
    bySymbol,
    market: { history: marketHist.slice(-SHORT_VOLUME_HISTORY_DAYS), latest: marketHist[marketHist.length - 1] || null },
    note: "Share of each session's off-exchange volume (prints reported to FINRA's TRFs and ADF) that was sold short, from the Reg SHO daily files. Exchange prints are not included. Not short interest.",
  };
}
