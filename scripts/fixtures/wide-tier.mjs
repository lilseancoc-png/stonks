// Synthetic market for the wide-tier tests (scripts/wide-tier-smoke.mjs and
// scripts/wide-tier-browser.mjs). Every price, volume, market value and date
// here is MADE UP and seeded, so a run is repeatable; nothing contacts Yahoo,
// GitHub or the store. Only the member list is real (lib/wide-tier-members.json).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runWideTier, SECTOR_FUNDS, WIDE_EXTRAS } from "../../lib/wide-tier.mjs";
import { sessionForDate } from "../../lib/us-equity-calendar.mjs";

export const SEED = JSON.parse(readFileSync(fileURLToPath(new URL("../../lib/wide-tier-members.json", import.meta.url)), "utf8"));

// NYSE sessions (the site's own calendar, lib/us-equity-calendar.mjs), so the
// synthetic market closes on the same holidays the code skips. Years outside
// that calendar fall back to plain weekdays.
const isSession = (d) => { const s = sessionForDate(d); if (s) return s.open; const w = new Date(d + "T12:00:00Z").getUTCDay(); return w > 0 && w < 6; };
export function weekdays(fromIso, toIso) {
  const out = [];
  for (let t = Date.parse(fromIso + "T12:00:00Z"); t <= Date.parse(toIso + "T12:00:00Z"); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (isSession(d)) out.push(d);
  }
  return out;
}
// The k sessions after iso (or on or before it, for k = 0: the session itself or the one before).
export function sessionsAfter(iso, k) {
  const out = [];
  for (let t = Date.parse(iso + "T12:00:00Z") + 86400000; out.length < k; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (isSession(d)) out.push(d);
  }
  return out;
}
export function sessionOnOrBefore(iso) {
  for (let t = Date.parse(iso + "T12:00:00Z"); ; t -= 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (isSession(d)) return d;
  }
}

function rng(seedText) {
  let x = 7;
  for (const c of String(seedText)) x = (x * 31 + c.charCodeAt(0)) % 2147483647;
  return () => { x = (x * 48271) % 2147483647; return x / 2147483647; };
}

// opts.days: ascending YYYY-MM-DD list; opts.seed: string; opts.drift: daily drift.
export function syntheticMarket({ days, seed = "wide", drift = 0.0004, vol = 0.018 } = {}) {
  const cache = new Map();
  const calls = { chart: 0, quote: 0, profile: 0, text: 0 };
  const overrides = new Map(); // sym -> { prevCloseMult, noQuote, noChart }
  function path(sym) {
    if (cache.has(sym)) return cache.get(sym);
    const r = rng(seed + ":" + sym);
    let p = 20 + r() * 380;
    const out = days.map((t) => {
      p *= 1 + drift + (r() - 0.5) * 2 * vol;
      return { t, c: Math.round(p * 100) / 100, v: Math.round(5e5 + r() * 9e6) };
    });
    cache.set(sym, out);
    return out;
  }
  const lastDay = days[days.length - 1];
  const barsBefore = (sym, day) => path(sym).filter((b) => b.t < day);
  return {
    calls, overrides, path,
    chainBarsOf: (sym) => path(sym),
    chart: async (sym, { period1 } = {}) => {
      calls.chart++;
      if (overrides.get(sym)?.noChart) throw new Error("synthetic chart failure");
      const from = period1 ? new Date(period1).toISOString().slice(0, 10) : "";
      return { quotes: path(sym).filter((b) => b.t >= from).map((b) => ({ date: new Date(b.t + "T20:00:00Z"), close: b.c, volume: b.v })) };
    },
    quote: async (list, { marketState = "POST", day = lastDay } = {}) => {
      calls.quote++;
      return list.filter((s) => !overrides.get(s)?.noQuote).map((s) => {
        const p = path(s).filter((b) => b.t <= day);
        const L = p[p.length - 1], P = p[p.length - 2] || L;
        const o = overrides.get(s) || {};
        const r = rng("q:" + s);
        return {
          symbol: s,
          regularMarketPrice: L.c,
          regularMarketPreviousClose: Math.round(P.c * (o.prevCloseMult || 1) * 100) / 100,
          regularMarketChangePercent: (L.c / P.c - 1) * 100,
          regularMarketVolume: L.v,
          regularMarketTime: new Date(L.t + "T20:00:00Z"),
          marketState,
          marketCap: Math.round((2e9 + r() * 4e11)),
          longName: s + " Synthetic Co",
          earningsTimestampStart: new Date(Date.parse(day + "T12:00:00Z") + Math.floor(r() * 40) * 86400000),
          isEarningsDateEstimate: r() < 0.3,
        };
      });
    },
    profile: async (sym) => { calls.profile++; return { sector: "Technology", industry: "Software - Application", name: sym + " Synthetic Co" }; },
    barsBefore,
  };
}

// A built wide payload on a synthetic market: runs the bake until the
// backfill is done, then one post-close run on `asOf`.
export async function fixtureRun({ asOf = "2026-11-18", tracked = ["AAPL", "MSFT", "NVDA", "AMD", "AVGO", "JPM", "XOM", "LLY"], groupOf = () => "Synthetic group", groupOrder = ["Synthetic group"], unusual = null, seed = "wide", backfillPerRun = 600 } = {}) {
  const days = weekdays(new Date(Date.parse(asOf + "T12:00:00Z") - 900 * 86400000).toISOString().slice(0, 10), asOf);
  const mkt = syntheticMarket({ days, seed });
  const nowPost = Date.parse(asOf + "T21:20:00Z"); // 16:20 ET (EST) / 17:20 ET (EDT): after the close
  let out = null;
  for (let i = 0; i < 6; i++) {
    out = await runWideTier({
      nowMs: nowPost, builtAtIso: new Date(nowPost).toISOString(), priorState: out?.state || null, seedMembers: SEED,
      tracked, groupOf, groupOrder, unusual, chainBarsOf: mkt.chainBarsOf, quote: mkt.quote, chart: mkt.chart, profile: mkt.profile, backfillPerRun,
    });
    if (!out.backlog) break;
  }
  return { out, mkt, days };
}

export { SECTOR_FUNDS, WIDE_EXTRAS };
