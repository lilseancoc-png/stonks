// Crowd & positioning (2026-11-09): one public payload (crowd.json) of
// facts about how the market is positioned and where the crowd's attention
// sits, plus one Owner-only payload (crowd-owner.json) that joins the same
// facts to the Owner's open Top Picks trades and keeps a daily row per name
// for later testing. Nothing here changes a pick or a grade.
//
// Sources (all free, keyless, fail-soft, no AI):
//   P1 Hyperliquid HIP-3 stock perps   P2 Kalshi index ranges + macro odds
//   O1 FINRA daily short sale volume   O2 Cboe put/call ratios
//   O3 IBKR borrow fee / availability  O4 CFTC COT (financial futures)
//   R1 ApeWisdom Reddit mentions       R2 Wikipedia page views
//   R3 leveraged ETF share flows       R4 Stocktwits watchers + trending
//   S3 FINRA margin debt
// S1 (NAAIM exposure) was dropped: the public series lags three months and
// its terms allow tracking only, so a current reading is not free.
//
// Public payload: data, ranks and percentiles only, no recommendation and no
// field the public-data policy names (lib/public-data-policy.mjs). The
// Owner payload may rank and flag.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchShortVolume } from "./short-volume.mjs";
import { fetchPutCall } from "./put-call.mjs";
import { fetchBorrow } from "./borrow.mjs";
import { fetchCot } from "./cot.mjs";
import { fetchReddit } from "./reddit.mjs";
import { fetchWikipedia } from "./wikipedia.mjs";
import { fetchLevFlows, levFundList } from "./lev-flows.mjs";
import { fetchStocktwitsCrowd } from "./stocktwits.mjs";
import { fetchMarginDebt } from "./margin-debt.mjs";
import { fetchKalshi } from "./kalshi.mjs";
import { fetchPerps } from "./perps.mjs";
import { round, finite, isoDay, percentileRank, mean, errorText, etDateKey } from "./util.mjs";

export const CROWD_KEY = "crowd.json";
export const CROWD_OWNER_KEY = "crowd-owner.json";
export const CROWD_VERSION = 1;
export const CROWD_OWNER_DAILY_KEEP = 130;

export const CROWD_SOURCE_IDS = Object.freeze([
  "shortVolume", "putCall", "borrow", "cot", "reddit", "wikipedia", "levFlows", "stocktwits", "marginDebt", "kalshi", "perps",
]);
export const CROWD_SOURCE_LABELS = Object.freeze({
  shortVolume: "FINRA short sale volume", putCall: "Cboe put/call ratios", borrow: "IBKR borrow fee", cot: "CFTC COT (financial futures)",
  reddit: "Reddit mentions (ApeWisdom)", wikipedia: "Wikipedia page views", levFlows: "Leveraged ETF flows", stocktwits: "Stocktwits watchers",
  marginDebt: "FINRA margin debt", kalshi: "Kalshi odds", perps: "Hyperliquid stock perps",
});

export function sessionDatesFromChain(chain) {
  const bars = Array.isArray(chain?._bars) ? chain._bars.map((b) => b?.t) : (Array.isArray(chain?.priceSeries?.t) ? chain.priceSeries.t : []);
  return [...new Set(bars.map(isoDay).filter(Boolean))].sort();
}

// Last completed US session close per symbol for the perps "vs last close"
// read. While a session is trading, Yahoo's newest daily bar is that session
// in progress (its "close" is the live price), so the bar is dropped unless the
// quote says the session has ended (CLOSED / POST / POSTPOST) or the bar is
// dated before today in New York (the confirmedDailyBars rule in build.mjs).
// Before this (first live day, 2026-11-09) a mid-session build compared the
// perp with the live price and read about zero. `sessionOpen` marks a name
// whose regular session was trading when read: its perp gap then holds the
// day's own move, so the gap read falls back to the 09:00 ET snapshot.
export function refClosesFromChains(chains, symbols, now = new Date()) {
  const out = {};
  const today = etDateKey(now);
  for (const sym of symbols) {
    const c = chains?.[sym];
    if (!c) continue;
    let bars = [];
    if (Array.isArray(c._bars) && c._bars.length) bars = c._bars.map((b) => ({ c: finite(b?.c), t: b?.t ?? b?.date }));
    else if (Array.isArray(c.priceSeries?.c) && c.priceSeries.c.length) bars = c.priceSeries.c.map((v, i) => ({ c: finite(v), t: c.priceSeries.t?.[i] }));
    const state = String(c.marketState || "").toUpperCase();
    const ended = state === "CLOSED" || state === "POST" || state === "POSTPOST";
    let i = bars.length - 1;
    let droppedToday = false;
    if (i >= 0 && !ended) {
      const day = isoDay(bars[i].t);
      if (!day || day >= today) { i--; droppedToday = true; }
    }
    while (i >= 0 && bars[i].c == null) i--;
    const sessionOpen = state === "REGULAR" || (!state && droppedToday);
    if (i >= 0) out[sym] = { close: bars[i].c, date: isoDay(bars[i].t), sessionOpen };
    else if (!bars.length && finite(c.spot) != null && !sessionOpen) out[sym] = { close: finite(c.spot), date: null, sessionOpen };
  }
  return out;
}

function sourceSummary(block, id) {
  return {
    id,
    label: CROWD_SOURCE_LABELS[id],
    ok: !!block?.ok,
    stale: !!block?.stale,
    carriedForward: !!block?.carriedForward,
    untested: !!block?.untested,
    asOf: block?.asOf || null,
    fetchedAt: block?.fetchedAt || null,
    error: block?.error || null,
  };
}

// One row per tracked name: the facts the public table shows. Numbers and
// percentile ranks within the tracked universe only.
// Today's 09:00 ET pre-open perp read for one name (null without a snapshot
// dated today). A fixed time of day, so it is the shadow-log value.
function perpPreopenFor(sym, preopen, todayEt) {
  const pre = preopen?.bySymbol?.[sym];
  const preDay = preopen?.asOf ? etDateKey(new Date(preopen.asOf)) : null;
  return pre && pre.vsRefClosePct != null && (!todayEt || preDay === todayEt) ? pre.vsRefClosePct : null;
}

// The perp "gap" is the crowd's overnight read: the live mark against the last
// close when the read was taken outside the regular session (pre-market, after
// the close, weekends), else today's 09:00 ET pre-open snapshot. Flags and the
// Owner warnings read the gap, not the in-session move.
function perpGapFor(pp, preopenPct) {
  if (pp && pp.vsRefClosePct != null && pp.refSessionOpen === false) return { pct: pp.vsRefClosePct, from: "live" };
  if (preopenPct != null) return { pct: preopenPct, from: "pre-open" };
  return { pct: null, from: null };
}

export function buildSymbolRollup(symbols, blocks, { todayEt = null } = {}) {
  const rows = symbols.map((sym) => {
    const sv = blocks.shortVolume?.bySymbol?.[sym] || null;
    const bo = blocks.borrow?.bySymbol?.[sym] || null;
    const rd = blocks.reddit?.bySymbol?.[sym] || null;
    const wk = blocks.wikipedia?.bySymbol?.[sym] || null;
    const st = blocks.stocktwits?.bySymbol?.[sym] || null;
    const pp = blocks.perps?.bySymbol?.[sym] || null;
    const preopenPct = perpPreopenFor(sym, blocks.perps?.preopen, todayEt);
    const gap = perpGapFor(pp, preopenPct);
    return {
      symbol: sym,
      shortPct: sv?.shortPct ?? null,
      shortAvg20Pct: sv?.avg20Pct ?? null,
      shortZ20: sv?.z20 ?? null,
      borrowFeePct: bo?.feePct ?? null,
      borrowAvailable: bo?.available ?? null,
      redditRank: rd?.rank ?? null,
      redditMentions: rd?.mentions ?? null,
      redditVsAvg7: rd?.vsAvg7 ?? null,
      wikiViews: wk?.views ?? null,
      wikiRatio30: wk?.ratio30 ?? null,
      watchers: st?.watchers ?? null,
      watchersPct7d: st?.pct7d ?? null,
      perpMark: pp?.markPx ?? null,
      perpVsClosePct: pp?.vsRefClosePct ?? null,
      perpPreopenPct: preopenPct,
      perpGapPct: gap.pct,
      perpGapFrom: gap.from,
      perpFundingAnnualPct: pp?.fundingAnnualPct ?? null,
      perpOiUsd: pp?.oiUsd ?? null,
    };
  });
  const pct = (key) => {
    const vals = rows.map((r) => r[key]).filter((v) => Number.isFinite(v));
    for (const r of rows) r[`${key}Pctile`] = percentileRank(r[key], vals);
  };
  for (const key of ["shortPct", "shortZ20", "borrowFeePct", "redditMentions", "wikiRatio30", "watchersPct7d", "perpFundingAnnualPct"]) pct(key);
  return rows;
}

export async function buildCrowdPayload({
  prior, symbols, chains, todayEt = etDateKey(), nowIso = new Date().toISOString(),
  quoteFn, levSingles, levGroups, preopen = null, log = () => {},
  // Tests inject these; the bake leaves them undefined (live reads).
  fetchers = {},
} = {}) {
  const text = fetchers.text;
  const json = fetchers.json;
  const borrowRead = fetchers.borrow;
  const base = prior && typeof prior === "object" ? prior : {};
  const sessionDates = sessionDatesFromChain(chains?.SPY);
  const refCloses = refClosesFromChains(chains, symbols, new Date(nowIso));
  const funds = levFundList(levSingles, levGroups);
  const run = async (id, fn) => {
    try {
      const block = await fn();
      log(block?.disabled ? `  · crowd ${CROWD_SOURCE_LABELS[id]} off` : `  ${block?.ok ? "✓" : "⚠"} crowd ${CROWD_SOURCE_LABELS[id]}${block?.ok ? "" : ` — ${block?.error || "carried forward"}`}`);
      return block;
    } catch (err) {
      log(`  ⚠ crowd ${CROWD_SOURCE_LABELS[id]} threw: ${errorText(err)}`);
      const p = base[id];
      return p ? { ...p, ok: false, stale: true, carriedForward: true, error: errorText(err) } : { ok: false, stale: true, error: errorText(err), fetchedAt: nowIso };
    }
  };
  const [shortVolume, putCall, borrow, cot, reddit, wikipedia, levFlows, stocktwits, marginDebt, kalshi, perps] = await Promise.all([
    run("shortVolume", () => fetchShortVolume({ prior: base.shortVolume, symbols, sessionDates, todayEt, nowIso, ...(text ? { fetchImpl: text } : {}) })),
    run("putCall", () => fetchPutCall({ prior: base.putCall, todayEt, sessionDates, nowIso, ...(text ? { fetchImpl: text } : {}) })),
    run("borrow", () => fetchBorrow({ prior: base.borrow, symbols, todayEt, nowIso, ...(borrowRead ? { readImpl: borrowRead } : {}) })),
    run("cot", () => fetchCot({ prior: base.cot, todayEt, nowIso, ...(json ? { fetchImpl: json } : {}) })),
    run("reddit", () => fetchReddit({ prior: base.reddit, symbols, todayEt, nowIso, ...(json ? { fetchImpl: json } : {}) })),
    run("wikipedia", () => fetchWikipedia({ prior: base.wikipedia, symbols, todayEt, nowIso, ...(json ? { fetchImpl: json } : {}) })),
    run("levFlows", () => fetchLevFlows({ prior: base.levFlows, funds, todayEt, quoteFn, nowIso })),
    run("stocktwits", () => fetchStocktwitsCrowd({ prior: base.stocktwits, symbols, chains, todayEt, nowIso, ...(json ? { fetchImpl: json } : {}) })),
    run("marginDebt", () => fetchMarginDebt({ prior: base.marginDebt, todayEt, nowIso, ...(text ? { fetchImpl: text } : {}) })),
    run("kalshi", () => fetchKalshi({ prior: base.kalshi, todayEt, nowIso, ...(json ? { fetchImpl: json } : {}) })),
    run("perps", () => fetchPerps({ prior: base.perps, symbols, refCloses, nowIso, ...(json ? { fetchImpl: json } : {}) })),
  ]);
  // The 09:00 ET pre-open snapshot (overnight-preopen.json `perps`) rides along
  // so the page can show where the perps had each name before the bell.
  // An earlier build's copy only stands while it is still today's snapshot.
  const priorPre = base.perps?.preopen?.asOf && etDateKey(new Date(base.perps.preopen.asOf)) === todayEt ? base.perps.preopen : null;
  const perpsOut = perps && typeof perps === "object" ? { ...perps, preopen: preopen?.perps || priorPre } : perps;
  const blocks = { shortVolume, putCall, borrow, cot, reddit, wikipedia, levFlows, stocktwits, marginDebt, kalshi, perps: perpsOut };
  const sources = CROWD_SOURCE_IDS.map((id) => sourceSummary(blocks[id], id));
  return {
    version: CROWD_VERSION,
    builtAtIso: nowIso,
    etDate: todayEt,
    symbols: symbols.slice(),
    sources,
    okCount: sources.filter((s) => s.ok).length,
    rollup: buildSymbolRollup(symbols, blocks, { todayEt }),
    ...blocks,
    disclaimer: "Data and market-implied readings only. Nothing on this page is a recommendation to buy or sell anything.",
  };
}

// ---------- Owner payload ----------

function pctileOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

// Attention = how crowded the name is in retail attention right now, 0..100
// (average of the percentile ranks that exist). Short pressure = how heavy
// the shorting tape and borrow read, 0..100. Owner-only ranking.
export function crowdScoresForRow(row) {
  const attention = mean([
    pctileOrNull(row.redditMentionsPctile), pctileOrNull(row.wikiRatio30Pctile), pctileOrNull(row.watchersPct7dPctile),
  ].filter((v) => v != null));
  const shortPressure = mean([
    pctileOrNull(row.shortZ20Pctile), pctileOrNull(row.borrowFeePctPctile),
  ].filter((v) => v != null));
  const flags = [];
  if (row.redditRank != null && row.redditRank <= 10) flags.push("reddit-top10");
  // A spike needs real volume: 3x a 7-day average of two mentions is noise.
  if (row.redditVsAvg7 != null && row.redditVsAvg7 >= 3 && (row.redditMentions ?? 0) >= 10) flags.push("reddit-spike");
  if (row.wikiRatio30 != null && row.wikiRatio30 >= 2) flags.push("wiki-spike");
  if (row.watchersPct7d != null && row.watchersPct7d >= 2) flags.push("watchers-surge");
  if (row.shortZ20 != null && row.shortZ20 >= 1.5) flags.push("short-volume-high");
  if (row.shortZ20 != null && row.shortZ20 <= -1.5) flags.push("short-volume-low");
  if (row.borrowFeePct != null && row.borrowFeePct >= 5) flags.push("hard-to-borrow");
  if (row.perpFundingAnnualPct != null && row.perpFundingAnnualPct >= 30) flags.push("perp-longs-crowded");
  if (row.perpFundingAnnualPct != null && row.perpFundingAnnualPct <= -30) flags.push("perp-shorts-crowded");
  // Rows written before the gap read existed fall back to the vs-close figure.
  const gap = row.perpGapPct !== undefined ? row.perpGapPct : row.perpVsClosePct;
  if (gap != null && Math.abs(gap) >= 2) flags.push(gap > 0 ? "perp-gap-up" : "perp-gap-down");
  return { attention: attention == null ? null : round(attention, 0), shortPressure: shortPressure == null ? null : round(shortPressure, 0), flags };
}

export function marketGauges(crowd) {
  const pc = crowd?.putCall;
  const cot = crowd?.cot?.contracts || {};
  const md = crowd?.marginDebt?.summary || null;
  const lev = crowd?.levFlows?.totals || null;
  const inxSeries = crowd?.kalshi?.series?.KXINX || null;
  const inx = inxSeries?.headline || null;
  const sv = crowd?.shortVolume?.market?.latest || null;
  // The S&P range market's 80% band as % of its mean, and per square root of
  // the days left to settle, so a Monday and a Thursday read compare.
  const bandPct = Array.isArray(inx?.band80) && inx.impliedMean > 0 ? ((inx.band80[1] - inx.band80[0]) / inx.impliedMean) * 100 : null;
  const settleMs = Date.parse(inxSeries?.events?.[0]?.closeTime || "") - Date.parse(crowd?.builtAtIso || "");
  const settleDays = Number.isFinite(settleMs) ? Math.max(0.25, settleMs / 86400000) : null;
  const rec = crowd?.kalshi?.series?.KXRECSSNBER?.headline || null;
  return {
    putCallEquity: pc?.stats?.equity?.value ?? null,
    putCallEquityZ: pc?.stats?.equity?.z250 ?? null,
    putCallTotal: pc?.stats?.total?.value ?? null,
    putCallTotalZ: pc?.stats?.total?.z250 ?? null,
    cotEsLevNet: cot.ES?.groups?.levFund?.net ?? null,
    cotEsLevZ: cot.ES?.groups?.levFund?.z3y ?? null,
    cotEsAmZ: cot.ES?.groups?.assetMgr?.z3y ?? null,
    cotNqLevZ: cot.NQ?.groups?.levFund?.z3y ?? null,
    cotVxLevNet: cot.VX?.groups?.levFund?.net ?? null,
    cotVxLevZ: cot.VX?.groups?.levFund?.z3y ?? null,
    marginDebtYoyPct: md?.yoyPct ?? null,
    marginDebtMomPct: md?.momPct ?? null,
    marginDebtFromPeakPct: md?.peak?.fromPeakPct ?? null,
    levBullUsd5d: lev?.bullUsd5d ?? null,
    levBearUsd5d: lev?.bearUsd5d ?? null,
    kalshiSpxMean: inx?.impliedMean ?? null,
    kalshiSpxBand80: inx?.band80 ?? null,
    kalshiSpxBandPct: bandPct != null ? round(bandPct, 2) : null,
    kalshiSpxBandPerDayPct: bandPct != null && settleDays ? round(bandPct / Math.sqrt(settleDays), 2) : null,
    kalshiRecessionPct: Number.isFinite(rec?.prob) ? round(rec.prob * 100, 1) : null,
    shortVolumeMarketPct: sv ? sv[1] : null,
  };
}

export function buildCrowdOwner({ crowd, prior, openTrades = [], regime = null, nowIso = new Date().toISOString(), todayEt = crowd?.etDate || etDateKey() } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const rows = Array.isArray(crowd?.rollup) ? crowd.rollup : [];
  const scored = rows.map((r) => ({ symbol: r.symbol, ...crowdScoresForRow(r) }));
  const bySymbol = Object.fromEntries(scored.map((s) => [s.symbol, s]));
  const gauges = marketGauges(crowd);
  const open = (Array.isArray(openTrades) ? openTrades : []).map((t) => {
    const s = bySymbol[t.symbol] || null;
    const row = rows.find((r) => r.symbol === t.symbol) || null;
    const warn = [];
    if (s?.flags?.includes("perp-longs-crowded") && t.side === "call") warn.push("perp longs crowded on a call");
    if (s?.flags?.includes("perp-shorts-crowded") && t.side === "put") warn.push("perp shorts crowded on a put");
    if (s?.flags?.includes("hard-to-borrow") && t.side === "put") warn.push("hard to borrow: squeeze risk on a put");
    if (s?.flags?.includes("short-volume-high") && t.side === "put") warn.push("short volume already heavy on a put");
    if (s?.attention != null && s.attention >= 85) warn.push("crowded attention");
    if (s?.flags?.includes("perp-gap-down") && t.side === "call") warn.push("perps gapped down vs close");
    if (s?.flags?.includes("perp-gap-up") && t.side === "put") warn.push("perps gapped up vs close");
    return {
      id: t.id ?? t.tradeId ?? null,
      symbol: t.symbol,
      side: t.side,
      entryDate: t.entryDate ?? null,
      attention: s?.attention ?? null,
      shortPressure: s?.shortPressure ?? null,
      flags: s?.flags || [],
      warnings: warn,
      facts: row ? {
        shortPct: row.shortPct, borrowFeePct: row.borrowFeePct, redditRank: row.redditRank, wikiRatio30: row.wikiRatio30,
        watchersPct7d: row.watchersPct7d, perpVsClosePct: row.perpVsClosePct, perpGapPct: row.perpGapPct ?? null, perpFundingAnnualPct: row.perpFundingAnnualPct,
      } : null,
    };
  });
  // One row per ET day for later tests: market gauges + [attention, shortPressure] per name.
  const dayRow = {
    date: todayEt,
    at: nowIso,
    regime: regime ? { cell: regime.cell ?? null, label: regime.cellLabel ?? null, era: regime.era ?? null, character: regime.character ?? null } : null,
    gauges,
    scores: Object.fromEntries(scored.filter((s) => s.attention != null || s.shortPressure != null).map((s) => [s.symbol, [s.attention, s.shortPressure, s.flags.length ? s.flags : undefined]])),
  };
  const daily = (Array.isArray(base.daily) ? base.daily.filter((d) => d?.date && d.date !== todayEt) : []).concat([dayRow]).sort((a, b) => a.date.localeCompare(b.date)).slice(-CROWD_OWNER_DAILY_KEEP);
  const ranked = scored.filter((s) => s.attention != null).sort((a, b) => b.attention - a.attention);
  return {
    version: CROWD_VERSION,
    builtAtIso: nowIso,
    etDate: todayEt,
    regime: dayRow.regime,
    gauges,
    scores: bySymbol,
    mostCrowded: ranked.slice(0, 10).map((s) => ({ symbol: s.symbol, attention: s.attention, shortPressure: s.shortPressure, flags: s.flags })),
    leastCrowded: ranked.slice(-10).reverse().map((s) => ({ symbol: s.symbol, attention: s.attention, shortPressure: s.shortPressure, flags: s.flags })),
    openTrades: open,
    daily,
    days: daily.length,
    note: "Measurement only: nothing here feeds the Top Picks grade or any gate. The daily rows accumulate so the crowd reads can be tested against trade outcomes later.",
  };
}

export async function readCrowdPrior(dataDir, key = CROWD_KEY) {
  try {
    return JSON.parse(await readFile(resolve(dataDir, key), "utf8"));
  } catch {
    return null;
  }
}

export async function writeCrowdFiles(dataDir, crowd, owner) {
  if (crowd) await writeFile(resolve(dataDir, CROWD_KEY), JSON.stringify(crowd), "utf8");
  if (owner) await writeFile(resolve(dataDir, CROWD_OWNER_KEY), JSON.stringify(owner), "utf8");
}
