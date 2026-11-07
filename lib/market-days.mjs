// Past days (the "time machine", 2026-11-07): one public file that lets the
// Past days page show the heatmap and the Brief as they were on an earlier
// trading day.
//
//   dates   the last ~252 trading sessions (SPY's bars).
//   moves   each tracked name's daily close-to-close move on those dates, in
//           basis points (small ints keep the file compact). The page draws
//           the heatmap with today's names, sectors and sizes.
//   index   SPY, QQQ and IWM closes on those dates.
//
// The Brief's written headline and summary are NOT here. The public response
// boundary already strips that prose from briefs.json (lib/public-data-
// policy.mjs), so the per-day copies go to a separate Owner-only file,
// market-days-briefs.json (premium-keys.mjs), collected build by build from
// briefs.json (up to four per day, ~4 months) and only for briefs minted
// under the current BRIEF_ACCESS_POLICY_VERSION. Top Picks are not here
// either: the Owner layer reads the Owner-only daily run archive
// (picks-run-YYYY-MM-DD.json) and the track record after sign-in.
// Pure; no network, no AI.

export const MARKET_DAYS_VERSION = 1;
export const MARKET_DAYS_FILE = "market-days.json";
export const MARKET_DAYS_BRIEFS_FILE = "market-days-briefs.json";
export const MARKET_DAYS_SESSIONS = 252;
const BRIEF_DAYS = 120;
const BRIEFS_PER_DAY = 4;
const INDEX_SYMS = ["SPY", "QQQ", "IWM"];

const fin = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

function closeMap(data) {
  const bars = Array.isArray(data?._bars) && data._bars.length ? data._bars : null;
  const m = new Map();
  if (bars) {
    for (const b of bars) if (b?.t && fin(b.c) > 0) m.set(String(b.t).slice(0, 10), Number(b.c));
    return m;
  }
  const ps = data?.priceSeries;
  if (ps && Array.isArray(ps.t)) ps.t.forEach((t, i) => { if (t && fin(ps.c?.[i]) > 0) m.set(String(t).slice(0, 10), Number(ps.c[i])); });
  return m;
}

function clip(text, n) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// One brief as stored: headline + short summary + when. Only a brief minted
// under the current access policy is kept.
export function briefEntry(brief, policyVersion = null) {
  if (!brief || typeof brief !== "object") return null;
  if (policyVersion != null && brief.accessPolicyVersion !== policyVersion) return null;
  const headline = clip(brief.headline || brief.title, 200);
  if (!headline) return null;
  const at = brief.generatedAtIso || brief.generatedAt || brief.builtAtIso || brief.at || null;
  const date = brief.date || (at ? new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  return { date, at, kind: brief.kind || brief.slot || null, v: brief.accessPolicyVersion ?? null, headline, summary: clip(brief.summary || brief.lede, 600) };
}

export function mergeBriefs(prior, entry, policyVersion = null) {
  const list = Array.isArray(prior) ? prior.filter((b) => b && b.date && b.headline && (policyVersion == null || b.v === policyVersion)) : [];
  if (entry && !list.some((b) => b.date === entry.date && b.headline === entry.headline)) list.push(entry);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.at || "").localeCompare(String(b.at || ""))));
  const byDate = new Map();
  for (const b of list) {
    const day = byDate.get(b.date) || [];
    day.push(b);
    byDate.set(b.date, day.slice(-BRIEFS_PER_DAY));
  }
  const dates = [...byDate.keys()].sort().slice(-BRIEF_DAYS);
  return dates.flatMap((d) => byDate.get(d));
}

export function buildMarketDays({ chains, symbols, prior = null, builtAtIso }) {
  const syms = (symbols || Object.keys(chains || {})).filter((s) => chains?.[s]);
  const spy = closeMap(chains?.SPY);
  const dates = [...spy.keys()].sort().slice(-MARKET_DAYS_SESSIONS);
  if (dates.length < 2) return prior ? { ...prior, stale: true } : null;
  const moves = {};
  for (const s of syms) {
    const m = closeMap(chains[s]);
    if (m.size < 2) continue;
    const row = [];
    let prev = null;
    // The close the session before the first date, for the first move.
    const before = [...m.keys()].filter((d) => d < dates[0]).sort().pop();
    if (before) prev = m.get(before);
    for (const d of dates) {
      const c = m.get(d);
      row.push(c > 0 && prev > 0 ? Math.round((c / prev - 1) * 10000) : null);
      if (c > 0) prev = c;
    }
    moves[s] = row;
  }
  const index = {};
  for (const s of INDEX_SYMS) {
    const m = closeMap(chains?.[s]);
    if (m.size) index[s] = dates.map((d) => (m.has(d) ? r2(m.get(d)) : null));
  }
  return {
    version: MARKET_DAYS_VERSION,
    builtAtIso,
    dates,
    moves,
    index,
    note: "Daily close-to-close moves in basis points (100 = 1%).",
  };
}

// The Owner-only companion: the Brief's headline and summary per date.
export function buildMarketDayBriefs({ prior = null, brief = null, policyVersion, builtAtIso }) {
  return {
    version: MARKET_DAYS_VERSION,
    builtAtIso,
    policyVersion,
    briefs: mergeBriefs(prior?.briefs, briefEntry(brief, policyVersion), policyVersion),
  };
}
