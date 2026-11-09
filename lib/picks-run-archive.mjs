// Top Picks run archive (the "data clock").
//
// Every Top Picks decision run (11:00 and 15:30 ET) appends one record to an
// Owner-only file per ET trading day, picks-run-YYYY-MM-DD.json. A record
// holds the whole scored universe as the engine saw it at that moment: each
// name's total, side, pillar scores, every signal vote, entry timing, the
// AI final grader's verdict (for the names it graded), the single-option
// contract it would buy with bid and ask, and what the run did with the name
// (shipped, or the first rule that turned it away). Shipped picks carry their
// real structure and legs.
//
// Why: the backtest could rebuild only the price half of the grade. This file
// keeps the half it could not (news, fundamentals, flow, the AI verdict, real
// quotes), so a later rule change can be tested on what the engine actually
// saw. It never changes a pick. Pure and synchronous except the two file
// helpers at the bottom; no network, no AI.
//
// Storage: data-ownership.mjs isPicksRunArchiveKey (flat key, bake-owned,
// never delete-staled), premium-keys.mjs (always Owner-only), and
// data-hydration.mjs (the bake reopens only today's file). PICKS_RUN_ARCHIVE=0
// turns the writer off; the prior files stay in the store.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildEntrySnapshot } from "./trade-snapshot.mjs";
import { isPicksRunArchiveKey } from "./data-ownership.mjs";

export const PICKS_RUN_ARCHIVE_VERSION = 1;
// More than two decision runs a day only happens on a re-dispatch. Keep the
// newest eight so a retry storm cannot grow one day file without bound.
export const PICKS_RUN_MAX_PER_DAY = 8;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function picksRunDayKey(date) {
  if (!isIsoDate(date)) throw new Error(`picks-run date is invalid: ${date}`);
  return `picks-run-${date}.json`;
}

// Today's day file is the only archive key a bake may publish. An older day
// on disk is not this run's output.
export function isCurrentPicksRunPublishKey(key, today) {
  return isPicksRunArchiveKey(key) && key === `picks-run-${today}.json`;
}

export function picksRunArchiveEnabled(env = process.env) {
  return !/^(?:0|false|off)$/i.test(String(env?.PICKS_RUN_ARCHIVE ?? "1").trim());
}

function etClock(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
}

function clip(text, max) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t ? t.slice(0, max) : null;
}

// Primitive fields only, nulls dropped. Keeps a record small and free of
// nested prose when an engine object grows new fields.
function pickPrimitives(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, alias] of keys) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "number") { if (Number.isFinite(v)) out[alias] = v; }
    else if (typeof v === "boolean") out[alias] = v;
    else if (typeof v === "string") out[alias] = v.slice(0, 80);
  }
  return Object.keys(out).length ? out : null;
}

// One single-leg contract: what an option bought at this run would cost.
export function compactSingle(c) {
  if (!c || typeof c !== "object") return null;
  const out = pickPrimitives(c, [
    ["strike", "k"], ["expiry", "exp"], ["dte", "dte"], ["bid", "b"], ["ask", "a"], ["mid", "m"],
    ["iv", "iv"], ["delta", "d"], ["oi", "oi"], ["volume", "vol"], ["spreadPct", "sp"],
    ["earningsInWindow", "ew"],
  ]);
  return out && out.k != null ? out : null;
}

// A shipped contract with its real structure and every leg.
export function compactContract(c) {
  if (!c || typeof c !== "object") return null;
  const base = pickPrimitives(c, [
    ["structure", "st"], ["optionType", "ot"], ["strike", "k"], ["longStrike", "lk"], ["shortStrike", "sk"],
    ["expiry", "exp"], ["dte", "dte"], ["bid", "b"], ["ask", "a"], ["mid", "m"], ["netDebit", "debit"],
    ["netCredit", "credit"], ["maxLoss", "maxLoss"], ["maxProfit", "maxProfit"], ["width", "w"],
    ["iv", "iv"], ["delta", "d"], ["oi", "oi"], ["spreadPct", "sp"], ["earningsInWindow", "ew"],
  ]) || {};
  const legs = (Array.isArray(c.legs) ? c.legs : [])
    .map((l) => pickPrimitives(l, [["qty", "q"], ["type", "t"], ["strike", "k"], ["expiry", "exp"], ["bid", "b"], ["ask", "a"], ["mid", "m"], ["iv", "iv"], ["delta", "d"], ["oi", "oi"]]))
    .filter(Boolean);
  if (legs.length) base.legs = legs;
  return Object.keys(base).length ? base : null;
}

function compactAi(ai) {
  if (!ai || typeof ai !== "object") return null;
  const out = {};
  if (typeof ai.grade === "string") out.g = ai.grade;
  if (num(ai.score) != null) out.sc = num(ai.score);
  if (ai.entryVerdict === "buy-now" || ai.entryVerdict === "wait") out.ev = ai.entryVerdict;
  if (typeof ai.confidence === "string") out.cf = ai.confidence;
  if (typeof ai.macroSupport === "string") out.ms = ai.macroSupport;
  const er = clip(ai.entryReason, 220);
  if (er) out.er = er;
  const gr = clip(ai.gradeReason, 220);
  if (gr) out.gr = gr;
  // Grader audit fields (2026-11-08): the load-bearing drivers and the
  // invalidation it named, the model that answered, how many web sources the
  // research pass returned, and the call's token counts [input, output,
  // thinking, cached]. All already in the thesis payload; no extra call.
  const dr = (Array.isArray(ai.drivers) ? ai.drivers : []).map((d) => clip(d, 80)).filter(Boolean).slice(0, 4);
  if (dr.length) out.dr = dr;
  const inv = (Array.isArray(ai.invalidation) ? ai.invalidation : []).map((d) => clip(d, 120)).filter(Boolean).slice(0, 3);
  if (inv.length) out.inv = inv;
  if (typeof ai.model === "string" && ai.model) out.mdl = ai.model.slice(0, 40);
  if (Array.isArray(ai.webResearch?.sources)) out.web = ai.webResearch.sources.length;
  const u = ai.usage;
  if (u && typeof u === "object") {
    const tk = [num(u.in) ?? 0, num(u.out) ?? 0, num(u.th) ?? 0, num(u.cached) ?? 0];
    if (tk.some((v) => v > 0)) out.tk = tk;
  }
  return Object.keys(out).length ? out : null;
}

// Quote quality of the contract the engine would trade (2026-11-08): how old
// the chain was when the run stamped (minutes), whether either side of the
// quote was missing, and the bid-ask spread as % of the mid. Recorded on
// every scored row so quote staleness can be checked against outcomes later.
function quoteQuality(contract, data, builtAtIso) {
  const out = {};
  const fetched = Date.parse(data?._fetchedAt || "");
  const built = Date.parse(builtAtIso || "");
  if (Number.isFinite(fetched) && Number.isFinite(built)) out.age = Math.max(0, Math.round((built - fetched) / 60000));
  if (contract && typeof contract === "object") {
    const b = num(contract.bid), a = num(contract.ask);
    if (b != null && a != null) {
      out.zq = !(b > 0 && a > 0);
      const mid = (a + b) / 2;
      if (b > 0 && a > 0 && a >= b) out.sp = r2(((a - b) / mid) * 100);
    }
  }
  return Object.keys(out).length ? out : null;
}

function compactTiming(t) {
  if (!t || typeof t !== "object") return null;
  const out = pickPrimitives(t, [["state", "st"], ["score", "sc"], ["deferKind", "df"], ["hardVeto", "hv"], ["hardWait", "hw"]]) || {};
  const inv = num(t.structure?.invalidation);
  if (inv != null) out.inv = r2(inv);
  if (t.eventPlay?.ok && t.eventPlay.kind) out.ep = String(t.eventPlay.kind).slice(0, 40);
  return Object.keys(out).length ? out : null;
}

function compactRegime(mr) {
  if (!mr || typeof mr !== "object") return null;
  const out = pickPrimitives(mr, [["state", "st"], ["stress", "stress"], ["effRiskOffAxes", "off"], ["effRiskOnAxes", "on"], ["grossMult", "gross"], ["fragile", "fragile"]]) || {};
  const axes = {};
  for (const [k, a] of Object.entries(mr.axes || {})) if (num(a?.score) != null) axes[k] = num(a.score);
  if (Object.keys(axes).length) out.axes = axes;
  return Object.keys(out).length ? out : null;
}

// Which gate lists in rosterMeta hold this name. Only arrays of symbols are
// read, so a new list is picked up without a code change here.
function rosterLists(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (!Array.isArray(v) || !v.length || k === "turnedAway") continue;
    const syms = v.filter((s) => typeof s === "string" && SYM_RE.test(s));
    if (syms.length) out[k] = [...new Set(syms)].slice(0, 120);
  }
  return out;
}

function streakOf(r) {
  const cs = r?.streakRow?.current || null;
  return cs && cs.color ? { color: cs.color, days: cs.sameDays, cumulativePct: cs.cumulativePct, volumeTrend: cs.volumeTrend || null } : null;
}

// Inputs (all in memory at the end of writeTopPicksFile):
//   builtAtIso   the run stamp
//   scored       the scored universe the roster was cut from (rows of scoreTicker)
//   picks        buildTopPicks' result (array + rosterMeta)
//   aiMap        the final grader's map, keyed "SYM:side"
//   aiActive     whether the grader produced a grade this run
//   openPositions  the Track Record's open trades at run time
//   contractFor  (sym, side) => the single-leg contract the engine would buy
//   versions     rule versions to stamp on the record
export function buildPicksRunRecord({
  builtAtIso,
  scored = [],
  picks = [],
  aiMap = null,
  aiActive = false,
  aiSkipped = false,
  aiMode = null,
  openPositions = [],
  contractFor = null,
  versions = {},
  lab = null,
} = {}) {
  const meta = picks?.rosterMeta || {};
  const shipped = new Map();
  for (const p of Array.isArray(picks) ? picks : []) {
    if (p && p.symbol && (p.side === "call" || p.side === "put")) shipped.set(`${p.symbol}:${p.side}`, p);
  }
  const firstGate = new Map();
  for (const t of Array.isArray(meta.turnedAway) ? meta.turnedAway : []) {
    const key = `${t?.sym}:${t?.side}`;
    if (t?.sym && !firstGate.has(key)) firstGate.set(key, String(t.gate || "").slice(0, 40) || null);
  }
  const reentry = new Set(Array.isArray(meta.reentrySuppressed) ? meta.reentrySuppressed : []);
  const bar = num(meta.tradeCut) ?? num(meta.minConviction);

  const rows = [];
  for (const r of Array.isArray(scored) ? scored : []) {
    if (!r || !SYM_RE.test(String(r.sym || ""))) continue;
    const total = num(r.total);
    const side = r.side === "call" || r.side === "put" ? r.side : (total != null && total < 0 ? "put" : "call");
    const data = r.data || {};
    const key = `${r.sym}:${side}`;
    const pick = shipped.get(key) || null;
    let out = null;
    if (pick) out = `pick:${pick.group || "listed"}`;
    else if (firstGate.has(key)) out = `gate:${firstGate.get(key)}`;
    else if (reentry.has(r.sym)) out = "open";
    else if (bar != null && total != null && Math.abs(total) < bar) out = "below-bar";
    const snap = buildEntrySnapshot({ symbol: r.sym, pillars: r.pillars, streak: streakOf(r) }, data) || {};
    delete snap.v;
    const row = { s: r.sym, tot: r2(total), side, spot: r2(num(data.spot)), out, ...snap };
    const pre = num(r.preRegimeTotal);
    if (pre != null && pre !== total) row.pre = r2(pre);
    if (num(r.tradeScore) != null) row.ts = r2(num(r.tradeScore));
    const tm = compactTiming(r.timing);
    if (tm) row.tm = tm;
    const ivr = data.ivRank || null;
    const iv = {};
    if (num(ivr?.iv) != null) iv.atm = r4(num(ivr.iv));
    if (num(ivr?.pctile) != null) iv.pct = num(ivr.pctile);
    if (num(ivr?.z) != null) iv.z = r2(num(ivr.z));
    const rv30 = num(data.technicals?.volRegime?.rv30);
    if (rv30 != null) iv.rv30 = r4(rv30);
    if (Object.keys(iv).length) row.iv = iv;
    const ne = data.fundamentals?.nextEarningsDate;
    if (typeof ne === "string" && ne) row.ne = ne.slice(0, 10);
    const ai = compactAi(aiMap ? aiMap[key] : null);
    if (ai) row.ai = ai;
    if (typeof contractFor === "function") {
      let c = null, raw = null;
      try { raw = contractFor(r.sym, side); c = compactSingle(raw); } catch { c = null; raw = null; }
      if (c) row.c = c;
      const q = quoteQuality(raw, data, builtAtIso);
      if (q) row.q = q;
    } else {
      const q = quoteQuality(null, data, builtAtIso);
      if (q) row.q = q;
    }
    rows.push(row);
  }

  const shippedRows = [];
  for (const p of shipped.values()) {
    const row = { s: p.symbol, side: p.side, group: p.group || null, cls: p.classification || null, tot: r2(num(p.total)) };
    const fg = pickPrimitives(p.finalGrade, [["tier", "tier"], ["score", "sc"], ["source", "src"]]);
    if (fg) row.fg = fg;
    const st = pickPrimitives(p.strategy, [["type", "type"], ["ivTier", "ivTier"], ["adverseSkew", "skew"], ["fallback", "fallback"], ["requested", "req"]]);
    if (st) row.strategy = st;
    const reason = clip(p.strategy?.reason, 240);
    if (reason) row.strategyReason = reason;
    const c = compactContract(p.contract);
    if (c) row.c = c;
    const entry = pickPrimitives(p.entry, [["now", "now"], ["signal", "signal"], ["basis", "basis"], ["trigger", "trigger"], ["zone", "zone"]]);
    if (entry) row.entry = entry;
    if (p.eventPlay?.kind) row.ep = String(p.eventPlay.kind).slice(0, 40);
    if (p.tactical) row.tactical = true;
    const size = pickPrimitives(p.sizing, [["suggestedContracts", "n"], ["weight", "w"], ["riskToStopPct", "stopPct"]]);
    if (size) row.size = size;
    shippedRows.push(row);
  }

  const open = (Array.isArray(openPositions) ? openPositions : [])
    .map((o) => {
      const sym = o?.symbol || o?.sym;
      const side = o?.side;
      return sym && (side === "call" || side === "put") ? `${sym}:${side}` : null;
    })
    .filter(Boolean);

  const bars = pickPrimitives(meta, [["tradeCut", "tradeCut"], ["strongCut", "strongCut"], ["actionableBar", "actionableBar"], ["baseTradeCut", "baseTradeCut"], ["regimeBand", "regimeBand"]]);
  return {
    v: PICKS_RUN_ARCHIVE_VERSION,
    builtAtIso: typeof builtAtIso === "string" ? builtAtIso : null,
    et: etClock(builtAtIso),
    versions: pickPrimitives(versions, Object.keys(versions || {}).map((k) => [k, k])) || {},
    bars: bars || {},
    regime: compactRegime(meta.macroRegime),
    ai: { active: !!aiActive, skipped: !!aiSkipped, graded: aiMap ? Object.keys(aiMap).length : 0, ...(aiMode === "live" || aiMode === "off" || aiMode === "keyless" ? { mode: aiMode } : {}) },
    open: [...new Set(open)],
    lists: rosterLists(meta),
    picks: shippedRows,
    rows,
    // The Regime Lab's market label at this run (lib/regime-lab/payload.mjs
    // labStamp): cell, era, character, transition, asOf. Measurement only.
    ...(lab && typeof lab === "object" ? { lab: pickPrimitives(lab, Object.keys(lab).map((k) => [k, k])) || null } : {}),
  };
}

// One file per ET day. A later run the same day is appended; a re-run with
// the same stamp replaces its earlier copy.
export function mergePicksRunDay({ date, existing = null, run } = {}) {
  if (!isIsoDate(date)) throw new Error("picks-run date must be YYYY-MM-DD");
  const prior = existing && existing.date === date && Array.isArray(existing.runs) ? existing.runs : [];
  const runs = prior.filter((x) => x && typeof x === "object" && x.builtAtIso !== run?.builtAtIso);
  if (run) runs.push(run);
  runs.sort((a, b) => String(a.builtAtIso || "").localeCompare(String(b.builtAtIso || "")));
  return { v: PICKS_RUN_ARCHIVE_VERSION, date, runs: runs.slice(-PICKS_RUN_MAX_PER_DAY) };
}

export function parsePicksRunDay(body, expectedDate) {
  if (body == null) return null;
  let parsed;
  try { parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.date !== expectedDate || !Array.isArray(parsed.runs)) return null;
  return parsed;
}

// Read today's file BEFORE writeChainFiles wipes data/. A missing file is a
// fresh day. An unreadable one is reported; the writer then starts the day
// over rather than keep a file nothing can parse.
export async function loadPicksRunDay(dataDir, date) {
  if (!isIsoDate(date)) return { today: null, error: "picks-run date must be YYYY-MM-DD" };
  let body = null;
  try { body = await readFile(resolve(dataDir, picksRunDayKey(date)), "utf8"); } catch (err) {
    if (err?.code === "ENOENT") return { today: null };
    return { today: null, error: String(err?.message || err).split("\n")[0] };
  }
  const today = parsePicksRunDay(body, date);
  return today ? { today } : { today: null, error: "unreadable day file" };
}

export async function persistPicksRun({ dataDir, bakeDate, run, context = null, env = process.env } = {}) {
  try {
    if (!picksRunArchiveEnabled(env)) return { skipped: "disabled" };
    if (!run) return { skipped: "no-run" };
    if (!isIsoDate(bakeDate)) return { error: "picks-run bakeDate must be YYYY-MM-DD" };
    const merged = mergePicksRunDay({ date: bakeDate, existing: context?.today || null, run });
    const key = picksRunDayKey(bakeDate);
    const body = JSON.stringify(merged);
    await writeFile(resolve(dataDir, key), body, "utf8");
    return { key, runs: merged.runs.length, rows: run.rows?.length || 0, bytes: body.length, restarted: !!context?.error };
  } catch (err) {
    return { error: String(err?.message || err).split("\n")[0] };
  }
}
