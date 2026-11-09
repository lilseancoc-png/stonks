// P1 — Hyperliquid HIP-3 stock perpetuals: 24/7 price, funding, open interest.
//
// POST https://api.hyperliquid.xyz/info with { type: "perpDexs" } lists the
// builder-deployed perp exchanges (HIP-3); { type: "metaAndAssetCtxs", dex }
// returns each one's universe (asset names such as "xyz:TSLA") and the live
// contexts (markPx, oraclePx, funding per hour, openInterest in contracts,
// dayNtlVlm, prevDayPx, premium). Equity perps trade around the clock, so
// their mark against the last US close is a 24/7 read of where the crowd has
// the stock between sessions. Public endpoint, no key, no account. One
// perpDexs call plus one call per dex (capped) a build; 60 points of
// [time, mark, fundingHourly, oiUsd] per tracked name.
//
// UNTESTED FROM THE BUILD SANDBOX (POST was unreachable here); the first live
// build shows what the dexes list. A failure only carries forward.

import { fetchJson, finite, round, carried, errorText, normalizeSymbol } from "./util.mjs";

export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
export const PERPS_HISTORY_KEEP = 60;
export const PERPS_MAX_DEXES = 12;
// Index-style perps some dexes list; kept under these display symbols.
export const PERPS_INDEX_ALIASES = Object.freeze({ SPX: "SPX", SP500: "SPX", SPY: "SPX", US500: "SPX", NDX: "NDX", NASDAQ100: "NDX", QQQ: "NDX", US100: "NDX", DJI: "DJI", US30: "DJI", RUT: "RUT", US2000: "RUT" });

async function infoPost(body, fetchImpl) {
  return fetchImpl(HYPERLIQUID_INFO_URL, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

export function baseSymbol(name) {
  const s = String(name || "");
  const i = s.indexOf(":");
  return normalizeSymbol(i >= 0 ? s.slice(i + 1) : s);
}

// Joins a dex's universe with its asset contexts into flat rows.
export function perpRows(dexName, meta, ctxs) {
  const universe = Array.isArray(meta?.universe) ? meta.universe : [];
  const list = Array.isArray(ctxs) ? ctxs : [];
  const out = [];
  for (let i = 0; i < universe.length && i < list.length; i++) {
    const u = universe[i];
    const c = list[i];
    if (!u?.name || u.isDelisted) continue;
    const mark = finite(c?.markPx);
    if (!(mark > 0)) continue;
    const oi = finite(c?.openInterest);
    const funding = finite(c?.funding);
    out.push({
      dex: dexName,
      name: u.name,
      base: baseSymbol(u.name),
      markPx: mark,
      oraclePx: finite(c?.oraclePx),
      midPx: finite(c?.midPx),
      prevDayPx: finite(c?.prevDayPx),
      fundingHourly: funding,
      fundingAnnualPct: funding != null ? round(funding * 24 * 365 * 100, 2) : null,
      premiumPct: finite(c?.premium) != null ? round(finite(c.premium) * 100, 3) : (mark && finite(c?.oraclePx) ? round((mark / finite(c.oraclePx) - 1) * 100, 3) : null),
      openInterest: oi,
      oiUsd: oi != null ? Math.round(oi * mark) : null,
      dayVolumeUsd: finite(c?.dayNtlVlm) != null ? Math.round(finite(c.dayNtlVlm)) : null,
      maxLeverage: finite(u?.maxLeverage),
      dayChangePct: finite(c?.prevDayPx) > 0 ? round((mark / finite(c.prevDayPx) - 1) * 100, 2) : null,
    });
  }
  return out;
}

export async function fetchPerps({ prior, symbols, refCloses = {}, nowIso = new Date().toISOString(), fetchImpl = fetchJson } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  const tracked = new Set(symbols.map(normalizeSymbol));
  try {
    const dexes = await infoPost({ type: "perpDexs" }, fetchImpl);
    const names = (Array.isArray(dexes) ? dexes : []).map((d) => d?.name).filter((n) => typeof n === "string" && n).slice(0, PERPS_MAX_DEXES);
    if (!names.length) throw new Error("no HIP-3 dexes listed");
    const rows = [];
    const errors = [];
    const dexInfo = [];
    for (const dex of names) {
      try {
        const res = await infoPost({ type: "metaAndAssetCtxs", dex }, fetchImpl);
        const list = perpRows(dex, res?.[0], res?.[1]);
        dexInfo.push({ dex, assets: list.length });
        rows.push(...list);
      } catch (err) {
        errors.push(`${dex}: ${errorText(err)}`);
      }
    }
    // Tracked names and index perps only; the deepest market wins when two dexes list the same stock.
    const bySymbol = {};
    for (const r of rows) {
      const sym = tracked.has(r.base) ? r.base : (PERPS_INDEX_ALIASES[r.base] || null);
      if (!sym) continue;
      const cur = bySymbol[sym];
      if (!cur || (r.oiUsd || 0) > (cur.oiUsd || 0)) bySymbol[sym] = { ...r, symbol: sym, isIndex: !tracked.has(r.base) };
    }
    if (!Object.keys(bySymbol).length) throw new Error(`no tracked stock perps across ${names.length} dex(es)`);
    for (const [sym, r] of Object.entries(bySymbol)) {
      const ref = refCloses[sym];
      const refClose = finite(ref?.close);
      const hist = Array.isArray(base.bySymbol?.[sym]?.history) ? base.bySymbol[sym].history : [];
      const row = [nowIso, r.markPx, r.fundingHourly, r.oiUsd];
      const history = [...hist.filter((h) => h[0] !== nowIso), row].slice(-PERPS_HISTORY_KEEP);
      bySymbol[sym] = {
        ...r,
        refClose,
        refDate: ref?.date || null,
        vsRefClosePct: refClose > 0 ? round((r.markPx / refClose - 1) * 100, 2) : null,
        history,
      };
    }
    const covered = Object.values(bySymbol).filter((r) => !r.isIndex).length;
    const totalOi = Object.values(bySymbol).reduce((a, r) => a + (r.oiUsd || 0), 0);
    return {
      ok: true, stale: false, carriedForward: false, untested: true,
      error: errors.length ? `${errors.length} dex read(s) failed: ${errors[0]}` : null,
      fetchedAt: nowIso, asOf: nowIso,
      dexes: dexInfo, covered, totalOiUsd: Math.round(totalOi),
      bySymbol,
      note: "Perpetual futures on Hyperliquid's builder-deployed (HIP-3) exchanges trade 24/7 against an oracle of the stock price. Mark vs the last US close shows the overnight / weekend move the crowd is pricing; funding is paid hourly by the crowded side (positive = longs pay shorts).",
    };
  } catch (err) {
    return { ...carried(base, errorText(err), nowIso), untested: true };
  }
}
