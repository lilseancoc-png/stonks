// "What changed since yesterday" (2026-11-07): one public file that compares
// the latest build with the last build of the previous trading day.
//
// Each build saves a compact snapshot of what the site showed (per-stock
// moving-average side, options walls, up/down streak, IV band; the unusual
// trades, 13F filings and insider trades listed) and keeps the newest one per
// ET date for the last few dates. The page lists what differs between today's
// snapshot and the previous date's: new options walls, new unusual trades,
// 50 / 200-day crosses, streaks started or broken, IV turning rich or cheap,
// new 13F filings and new insider buys or sells.
//
// Owner grade moves are NOT here: the browser reads them from the Owner-only
// grades-history.json after sign-in. Pure; no network, no AI.

export const SITE_CHANGES_VERSION = 1;
export const SITE_CHANGES_FILE = "site-changes.json";
const KEEP_DATES = 3;
const MAX_ITEMS = 400;
const STREAK_MIN = 3;

const fin = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const etDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

function closesOf(data) {
  const bars = Array.isArray(data?._bars) && data._bars.length ? data._bars : null;
  if (bars) return bars.map((b) => fin(b?.c)).filter((c) => c > 0);
  const ps = data?.priceSeries;
  return Array.isArray(ps?.c) ? ps.c.map(fin).filter((c) => c > 0) : [];
}

function streakOf(closes) {
  let n = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    const d = Math.sign(closes[i] - closes[i - 1]);
    if (d === 0) break;
    if (n === 0) n = d;
    else if (Math.sign(n) === d) n += d;
    else break;
  }
  return n;
}

function avg(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

// The compact snapshot one build leaves behind.
export function buildSiteSnapshot({ chains, oi, unusual, f13, ivBand, builtAtIso }) {
  const stocks = {};
  for (const [sym, data] of Object.entries(chains || {})) {
    const c = closesOf(data);
    if (c.length < 2) continue;
    const last = c[c.length - 1];
    const s50 = fin(data?.technicals?.sma?.sma50) ?? avg(c, 50);
    const s200 = fin(data?.technicals?.sma?.sma200) ?? avg(c, 200);
    const iv = data?.ivRank || {};
    const band = ivBand ? ivBand({ pctile: fin(iv.pctile), iv: fin(iv.iv), rv30: fin(data?.technicals?.volRegime?.rv30) }) : null;
    stocks[sym] = {
      px: Math.round(last * 100) / 100,
      a50: s50 > 0 ? last > s50 : null,
      a200: s200 > 0 ? last > s200 : null,
      st: streakOf(c),
      ivb: band ? band.band : null,
    };
  }
  for (const row of Array.isArray(oi?.tickers) ? oi.tickers : []) {
    const st = row && stocks[row.symbol];
    if (!st) continue;
    if (fin(row.callWall?.strike) != null) st.cw = fin(row.callWall.strike);
    if (fin(row.putWall?.strike) != null) st.pw = fin(row.putWall.strike);
  }
  const flow = [];
  for (const t of Array.isArray(unusual?.tickers) ? unusual.tickers : []) {
    for (const c of Array.isArray(t?.contracts) ? t.contracts.slice(0, 6) : []) {
      if (!t.symbol || !c) continue;
      flow.push({ k: `${t.symbol}|${c.side === "put" ? "P" : "C"}|${c.strike}|${c.expSec}`, s: t.symbol, side: c.side === "put" ? "put" : "call", strike: fin(c.strike), exp: fin(c.expSec), prem: fin(c.premium), vol: fin(c.vol) });
    }
  }
  const filings = {};
  for (const [firm, f] of Object.entries(f13?.perFirm || {})) {
    if (f?.filingDate) filings[firm] = { date: String(f.filingDate).slice(0, 10), period: f.period || f13?.period || null };
  }
  const insiders = [];
  for (const t of Array.isArray(f13?.insiderTransactions?.transactions) ? f13.insiderTransactions.transactions : []) {
    if (!t?.openMarket || !t.symbol || !t.transactionDate) continue;
    insiders.push({ k: `${t.symbol}|${t.transactionDate}|${t.ownerName || ""}|${t.direction}|${t.shares || ""}`, s: t.symbol, date: t.transactionDate, who: String(t.ownerName || "").slice(0, 60), title: String(t.officerTitle || "").slice(0, 40), dir: t.direction === "buy" ? "buy" : "sell", value: fin(t.value) });
  }
  return { at: builtAtIso, date: etDate(builtAtIso), stocks, flow: flow.slice(0, 200), filings, insiders: insiders.slice(0, 200) };
}

const money = (v) => (v == null ? "" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const expLabel = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

// Items that differ between two snapshots.
export function diffSiteSnapshots(prev, cur) {
  if (!prev || !cur) return [];
  const items = [];
  const push = (kind, sym, text, tone = null, extra = {}) => items.push({ kind, s: sym || null, text, tone, ...extra });
  for (const [sym, now] of Object.entries(cur.stocks || {})) {
    const was = prev.stocks?.[sym];
    if (!was) continue;
    if (was.a200 != null && now.a200 != null && was.a200 !== now.a200) push("ma", sym, now.a200 ? "Closed back above its 200-day average" : "Closed below its 200-day average", now.a200 ? "up" : "down", { ma: 200 });
    else if (was.a50 != null && now.a50 != null && was.a50 !== now.a50) push("ma", sym, now.a50 ? "Closed back above its 50-day average" : "Closed below its 50-day average", now.a50 ? "up" : "down", { ma: 50 });
    const nowN = now.st || 0, wasN = was.st || 0;
    if (Math.abs(nowN) >= STREAK_MIN && (Math.sign(nowN) !== Math.sign(wasN) || Math.abs(wasN) < STREAK_MIN)) {
      push("streak", sym, `${Math.abs(now.st)} ${now.st > 0 ? "up" : "down"} days in a row`, now.st > 0 ? "up" : "down", { streak: now.st });
    } else if (Math.abs(wasN) >= STREAK_MIN && Math.sign(nowN) !== Math.sign(wasN)) {
      push("streak", sym, `Ended a ${Math.abs(was.st)}-day ${was.st > 0 ? "up" : "down"} streak`, now.st > 0 ? "up" : "down", { streak: now.st, ended: was.st });
    }
    if (now.cw != null && was.cw != null && now.cw !== was.cw) push("wall", sym, `Call wall moved from $${was.cw} to $${now.cw}`, now.cw > was.cw ? "up" : "down", { side: "call", from: was.cw, to: now.cw });
    if (now.pw != null && was.pw != null && now.pw !== was.pw) push("wall", sym, `Put wall moved from $${was.pw} to $${now.pw}`, now.pw > was.pw ? "up" : "down", { side: "put", from: was.pw, to: now.pw });
    if (now.ivb && was.ivb && now.ivb !== was.ivb && (now.ivb === "cheap" || now.ivb === "rich" || now.ivb === "very-rich" || was.ivb === "rich" || was.ivb === "very-rich" || was.ivb === "cheap")) {
      const label = { cheap: "cheap", normal: "normal", rich: "rich", "very-rich": "very rich", unknown: "unranked" };
      push("iv", sym, `Options went from ${label[was.ivb] || was.ivb} to ${label[now.ivb] || now.ivb}`, null, { from: was.ivb, to: now.ivb });
    }
  }
  const seenFlow = new Set((prev.flow || []).map((f) => f.k));
  for (const f of cur.flow || []) {
    if (seenFlow.has(f.k)) continue;
    push("flow", f.s, `Unusual ${f.side} trade: $${f.strike} strike, ${expLabel(f.exp)}${f.prem ? `, ${money(f.prem)} premium` : ""}`, f.side === "put" ? "down" : "up", { side: f.side, prem: f.prem });
  }
  for (const [firm, fl] of Object.entries(cur.filings || {})) {
    const was = prev.filings?.[firm];
    if (was && was.date === fl.date) continue;
    if (!was && Object.keys(prev.filings || {}).length === 0) continue;
    push("13f", null, `${firm} filed a new 13F${fl.period ? ` for ${fl.period}` : ""}`, null, { firm, date: fl.date });
  }
  const seenIns = new Set((prev.insiders || []).map((t) => t.k));
  for (const t of cur.insiders || []) {
    if (seenIns.has(t.k)) continue;
    push("insider", t.s, `${t.who || "An insider"}${t.title ? ` (${t.title})` : ""} ${t.dir === "buy" ? "bought" : "sold"}${t.value ? ` ${money(t.value)}` : ""} on ${t.date}`, t.dir === "buy" ? "up" : "down", { dir: t.dir, value: t.value });
  }
  return items.slice(0, MAX_ITEMS);
}

// Fold this build's snapshot into the prior payload and diff it against the
// newest snapshot from an earlier ET date.
export function nextSiteChanges(prior, snapshot) {
  const snaps = { ...(prior?.snapshots && typeof prior.snapshots === "object" ? prior.snapshots : {}) };
  snaps[snapshot.date] = snapshot;
  const dates = Object.keys(snaps).sort().slice(-KEEP_DATES);
  const kept = Object.fromEntries(dates.map((d) => [d, snaps[d]]));
  const earlier = dates.filter((d) => d < snapshot.date);
  const base = earlier.length ? kept[earlier[earlier.length - 1]] : null;
  const items = diffSiteSnapshots(base, snapshot);
  const counts = {};
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
  return {
    version: SITE_CHANGES_VERSION,
    builtAtIso: snapshot.at,
    date: snapshot.date,
    since: base ? base.date : null,
    sinceAt: base ? base.at : null,
    counts,
    items,
    snapshots: kept,
  };
}
