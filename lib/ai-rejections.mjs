// AI rejection log + later scorecard.
//
// The bake writes one day file, ai-rejections/YYYY-MM-DD.json, plus the small
// pointer ai-rejections-latest.json. It exact-gets today's file and a bounded
// prior window (for firstSeen only). It never lists the prefix and never
// opens the rest of the archive. Old dates stay in the store because the keys
// are bake-owned and not dynamic.
//
// Scoring is separate. The Top Picks backtest reads the local day files the
// pull already hydrated and the priceSeries that script already loads. It
// does not fetch prices and it does not run inside the hourly bake.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AI_REJECTION_SCORECARD_KEY, isAiRejectionKey } from "./data-ownership.mjs";

export const AI_REJECTIONS_LATEST_KEY = "ai-rejections-latest.json";
export { AI_REJECTION_SCORECARD_KEY };
export const AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS = 60;
export const REJECT_HORIZONS = Object.freeze([5, 10, 21]);
export const WAIT_BETTER_ENTRY_DAYS = 5;

const RECORD_KINDS = new Set(["reject", "wait", "wait-heldback"]);
const PASS_GRADES = new Set(["strong", "moderate", "weak"]);
const SYM_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function aiRejectionDayKey(date) {
  if (!isIsoDate(date)) throw new Error(`ai-rejection date is invalid: ${date}`);
  return `ai-rejections/${date}.json`;
}

export function addCalendarDays(iso, delta) {
  if (!isIsoDate(iso)) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Exact keys only: prior window, today's file, then the latest pointer.
// Callers must not list ai-rejections/.
export function aiRejectionReadKeys(bakeDate, days = AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS) {
  if (!isIsoDate(bakeDate)) return [];
  const span = Math.max(1, Math.floor(days));
  const keys = [];
  for (let ago = span; ago >= 1; ago--) {
    const day = addCalendarDays(bakeDate, -ago);
    if (day) keys.push(aiRejectionDayKey(day));
  }
  keys.push(aiRejectionDayKey(bakeDate));
  keys.push(AI_REJECTIONS_LATEST_KEY);
  return keys;
}

// Today's dated file and the latest pointer may sit in the post-bake tree.
// The backtest-local scorecard is not bake-owned, so freshness never sees it. Older dated keys are not rewritten locally; freshness
// accepts only today so a hydrated archive is not treated as this run's output.
export function isCurrentAiRejectionPublishKey(key, today) {
  if (key === AI_REJECTIONS_LATEST_KEY) return true;
  const match = /^ai-rejections\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key || "");
  return !!(match && match[1] === today);
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function normalizeSym(value) {
  const sym = String(value || "").trim().toUpperCase();
  return SYM_RE.test(sym) ? sym : null;
}

function normalizeSide(value) {
  return value === "call" || value === "put" ? value : null;
}

// Null when this candidate must not be logged: tactical, no thesis, or the
// grader did not run. The bake calls this at the reject and wait sites.
export function aiRejectionNote(input) {
  if (!input || input.tactical || input.graderActive === false) return null;
  const ai = input.aiThesis;
  if (!ai || typeof ai !== "object") return null;
  if (!RECORD_KINDS.has(input.kind)) return null;
  const sym = normalizeSym(input.sym);
  const side = normalizeSide(input.side);
  if (!sym || !side) return null;
  return {
    sym,
    side,
    kind: input.kind,
    asOf: typeof input.asOf === "string" ? input.asOf : null,
    spot: finiteOrNull(input.spot),
    grade: cleanText(ai.grade, 32),
    entryReason: cleanText(ai.entryReason, 400),
    total: finiteOrNull(input.total),
    regime: cleanText(input.regime, 64),
  };
}

// Names the grader did not reject. Kept beside the rejection rows so a later
// score can compare same-day, same-side passes and detect a later promotion.
export function aiRejectionPassNote(input) {
  if (!input || input.tactical || input.graderActive === false) return null;
  const ai = input.aiThesis;
  if (!ai || typeof ai !== "object") return null;
  const grade = cleanText(ai.grade, 32);
  if (!grade || !PASS_GRADES.has(grade)) return null;
  const sym = normalizeSym(input.sym);
  const side = normalizeSide(input.side);
  if (!sym || !side) return null;
  const verdict = input.entryVerdict === "buy-now" || input.entryVerdict === "wait"
    ? input.entryVerdict
    : (ai.entryVerdict === "buy-now" || ai.entryVerdict === "wait" ? ai.entryVerdict : null);
  return {
    sym,
    side,
    spot: finiteOrNull(input.spot),
    grade,
    entryVerdict: verdict,
    total: finiteOrNull(input.total),
    asOf: typeof input.asOf === "string" ? input.asOf : null,
  };
}

function carriedFirstSeen(priorRecords, sym, side, kind, date) {
  let found = null;
  for (const day of priorRecords || []) {
    if (!day || !isIsoDate(day.date) || day.date >= date) continue;
    for (const row of day.records || []) {
      if (!row || row.sym !== sym || row.side !== side || row.kind !== kind) continue;
      const first = isIsoDate(row.firstSeen) && row.firstSeen <= date ? row.firstSeen : day.date;
      if (!found || first < found) found = first;
    }
  }
  return found || date;
}

function normalizeRecord(row, date, priorRecords, { carry = false } = {}) {
  if (!row || typeof row !== "object") return null;
  const sym = normalizeSym(row.sym);
  const side = normalizeSide(row.side);
  const kind = RECORD_KINDS.has(row.kind) ? row.kind : null;
  if (!sym || !side || !kind) return null;
  let firstSeen = isIsoDate(row.firstSeen) && row.firstSeen <= date ? row.firstSeen : null;
  if (!firstSeen && carry) firstSeen = carriedFirstSeen(priorRecords, sym, side, kind, date);
  if (!firstSeen) firstSeen = date;
  return {
    sym,
    side,
    kind,
    firstSeen,
    asOf: typeof row.asOf === "string" ? row.asOf : null,
    spot: finiteOrNull(row.spot),
    grade: cleanText(row.grade, 32),
    entryReason: cleanText(row.entryReason, 400),
    total: finiteOrNull(row.total),
    regime: cleanText(row.regime, 64),
  };
}

function normalizePass(row) {
  if (!row || typeof row !== "object") return null;
  const sym = normalizeSym(row.sym);
  const side = normalizeSide(row.side);
  const grade = cleanText(row.grade, 32);
  if (!sym || !side || !grade || !PASS_GRADES.has(grade)) return null;
  const entryVerdict = row.entryVerdict === "buy-now" || row.entryVerdict === "wait" ? row.entryVerdict : null;
  return {
    sym,
    side,
    spot: finiteOrNull(row.spot),
    grade,
    entryVerdict,
    total: finiteOrNull(row.total),
    asOf: typeof row.asOf === "string" ? row.asOf : null,
  };
}

function takeFirst(rows, normalize) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const norm = normalize(row);
    if (!norm) continue;
    const key = `${norm.sym}:${norm.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  out.sort((a, b) => a.sym.localeCompare(b.sym) || a.side.localeCompare(b.side));
  return out;
}

// One row per name+side for this date. A second run the same day keeps the
// first spot, asOf, kind, and the rest of that row. firstSeen comes from the
// prior window the first time this name+side+kind is stored.
export function mergeAiRejectionDay({
  date,
  observations = [],
  passed = [],
  existing = null,
  priorRecords = [],
} = {}) {
  if (!isIsoDate(date)) throw new Error("ai-rejection bakeDate must be YYYY-MM-DD");
  const prior = (priorRecords || []).filter((day) => day && isIsoDate(day.date) && day.date < date);
  const records = takeFirst(existing?.date === date ? existing.records : [], (row) => normalizeRecord(row, date, prior));
  const seen = new Set(records.map((row) => `${row.sym}:${row.side}`));
  for (const obs of observations || []) {
    const row = normalizeRecord(obs, date, prior, { carry: true });
    if (!row) continue;
    const key = `${row.sym}:${row.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(row);
  }
  records.sort((a, b) => a.sym.localeCompare(b.sym) || a.side.localeCompare(b.side));
  const keptPasses = takeFirst(
    [...(existing?.date === date ? existing.passed || [] : []), ...(passed || [])],
    normalizePass,
  );
  return { date, records, passed: keptPasses };
}

function parseJson(body) {
  if (body == null) return null;
  try {
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseDay(body, expectedDate) {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!isIsoDate(parsed.date) || parsed.date !== expectedDate) return null;
  if (!Array.isArray(parsed.records)) parsed.records = [];
  if (!Array.isArray(parsed.passed)) parsed.passed = [];
  return parsed;
}

function parseLatest(body) {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (!isIsoDate(parsed.date)) return null;
  return {
    date: parsed.date,
    key: typeof parsed.key === "string" ? parsed.key : null,
    count: finiteOrNull(parsed.count),
    passed: finiteOrNull(parsed.passed),
  };
}

export function createFileAiRejectionStore(dataDir) {
  return {
    async get(key) {
      if (!isAiRejectionKey(key)) return null;
      try {
        return await readFile(resolve(dataDir, key));
      } catch {
        return null;
      }
    },
    async put(key, body) {
      if (!isAiRejectionKey(key)) throw new Error(`refusing ai-rejection write ${key}`);
      const path = resolve(dataDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
  };
}

export async function loadAiRejectionContextFromStore(store, bakeDate, days = AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS) {
  if (!store || typeof store.get !== "function") {
    return { today: null, prior: [], latest: null, error: "ai-rejection load requires store.get" };
  }
  if (!isIsoDate(bakeDate)) {
    return { today: null, prior: [], latest: null, error: "ai-rejection bakeDate must be YYYY-MM-DD" };
  }
  const keys = aiRejectionReadKeys(bakeDate, days);
  const prior = [];
  let today = null;
  let latest = null;
  for (const key of keys) {
    let body = null;
    try {
      body = await store.get(key);
    } catch {
      body = null;
    }
    if (key === AI_REJECTIONS_LATEST_KEY) {
      latest = parseLatest(body);
      continue;
    }
    const fileDate = key.slice("ai-rejections/".length, -".json".length);
    const record = parseDay(body, fileDate);
    if (!record) continue;
    if (fileDate === bakeDate) today = record;
    else prior.push(record);
  }
  prior.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { today, prior, latest, keys };
}

export async function loadAiRejectionContext(dataDir, bakeDate, days = AI_REJECTION_FIRSTSEEN_LOOKBACK_DAYS) {
  try {
    return await loadAiRejectionContextFromStore(createFileAiRejectionStore(dataDir), bakeDate, days);
  } catch (err) {
    return { today: null, prior: [], latest: null, error: err?.message || String(err) };
  }
}

export async function persistAiRejections({
  dataDir,
  bakeDate,
  capture = null,
  context = null,
} = {}) {
  try {
    if (!capture) return { skipped: "no-grader" };
    if (!isIsoDate(bakeDate)) return { error: "ai-rejection bakeDate must be YYYY-MM-DD" };
    // A failed pre-wipe read must not publish this run alone. That would
    // replace the morning file in the store and drop its spot/asOf/firstSeen.
    if (context?.error) return { skipped: "history-unavailable", error: String(context.error) };
    const existing = context?.today?.date === bakeDate ? context.today : null;
    const prior = Array.isArray(context?.prior) ? context.prior : [];
    const merged = mergeAiRejectionDay({
      date: bakeDate,
      observations: capture.notes || [],
      passed: capture.passed || [],
      existing,
      priorRecords: prior,
    });
    const key = aiRejectionDayKey(merged.date);
    const dayBody = JSON.stringify(merged);
    const latestBody = JSON.stringify({
      date: merged.date,
      key,
      count: merged.records.length,
      passed: merged.passed.length,
    });
    const store = createFileAiRejectionStore(dataDir);
    await store.put(key, dayBody);
    await store.put(AI_REJECTIONS_LATEST_KEY, latestBody);
    return { date: merged.date, key, count: merged.records.length, passed: merged.passed.length };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

// Scoring reader. The bake does not call this. The backtest does, over the
// day files already on disk after a read-only pull.
export async function readLocalAiRejectionDays(dataDir) {
  let names = [];
  try {
    names = await readdir(resolve(dataDir, "ai-rejections"));
  } catch {
    return [];
  }
  const days = [];
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const key = `ai-rejections/${name}`;
    if (!isAiRejectionKey(key)) continue;
    try {
      const record = parseDay(await readFile(resolve(dataDir, key), "utf8"), name.slice(0, 10));
      if (record) days.push(record);
    } catch {
      // One corrupt day does not blank the scorecard.
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

export async function writeAiRejectionScorecard(dataDir, scorecard) {
  const store = createFileAiRejectionStore(dataDir);
  await store.put(AI_REJECTION_SCORECARD_KEY, JSON.stringify(scorecard));
}

function seriesIndex(row, date) {
  if (!row) return null;
  const idx = row.dateIndex;
  const value = idx instanceof Map ? idx.get(date) : idx?.[date];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function closeAt(row, index) {
  if (!row || !Array.isArray(row.closes)) return null;
  if (index < 0 || index >= row.closes.length) return null;
  return finiteOrNull(row.closes[index]);
}

// Side-adjusted close-to-close percent. Same guards as diagnose-grade-ic
// (missing close is not zero) and the same sign as backtest-picks undRet:
// call/long up is positive, put/short down is positive.
export function directionalForwardPct(series, sym, date, horizon, side) {
  const h = Math.floor(horizon);
  if (!Number.isInteger(h) || h <= 0) return null;
  if (side !== "call" && side !== "put") return null;
  const row = series?.[sym];
  const i = seriesIndex(row, date);
  if (i == null) return null;
  const c0 = closeAt(row, i);
  const c1 = closeAt(row, i + h);
  if (!(c0 > 0) || !(c1 > 0)) return null;
  const raw = ((c1 - c0) / c0) * 100;
  return side === "put" ? -raw : raw;
}

// True when a later trading-day close is a better entry than the logged spot
// (lower for a long/call, higher for a short/put). Null when the window is
// not fully realized. The logged spot is the baseline; the series close is
// only the fallback when spot was not stored.
export function betterEntryWithin(series, record, days) {
  const n = Math.floor(days);
  if (!record || !Number.isInteger(n) || n <= 0) return null;
  if (record.side !== "call" && record.side !== "put") return null;
  const row = series?.[record.sym];
  const i = seriesIndex(row, record.asOfDate || record.date);
  if (i == null) return null;
  const c0 = closeAt(row, i);
  const spot = finiteOrNull(record.spot);
  const base = spot != null && spot > 0 ? spot : c0;
  if (!(base > 0)) return null;
  if (i + n >= (row.closes?.length || 0)) return null;
  const long = record.side !== "put";
  for (let step = 1; step <= n; step++) {
    const px = closeAt(row, i + step);
    if (!(px > 0)) return null;
    if (long ? px < base : px > base) return true;
  }
  return false;
}

function priceIsBetter(side, later, earlier) {
  if (!(later > 0) || !(earlier > 0)) return false;
  return side === "put" ? later > earlier : later < earlier;
}

function laterPromotion(days, series, record, waitDays) {
  const spot = finiteOrNull(record?.spot);
  const n = Math.floor(waitDays);
  const row = series?.[record?.sym];
  const start = seriesIndex(row, record?.asOfDate || record?.date);
  if (!(spot > 0) || !Number.isInteger(n) || n <= 0 || start == null) return false;
  for (const day of days || []) {
    if (!day || !isIsoDate(day.date) || day.date <= record.date) continue;
    // Use the same price-series sessions as the five-day price path. This
    // respects market holidays and never guesses a missing trading date.
    const index = seriesIndex(row, day.date);
    if (index == null || index <= start || index > start + n) continue;
    for (const pass of day.passed || []) {
      if (!pass || pass.sym !== record.sym || pass.side !== record.side) continue;
      if (pass.entryVerdict !== "buy-now") continue;
      const next = finiteOrNull(pass.spot);
      if (priceIsBetter(record.side, next, spot)) return true;
    }
  }
  return false;
}

function summarizeReturns(values) {
  if (!values.length) return { n: 0, mean: null, hitRate: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const hitRate = values.filter((value) => value > 0).length / values.length;
  return { n: values.length, mean, hitRate };
}

function emptyWaitBucket() {
  return { scored: 0, pending: 0, right: 0, pricePath: 0, promotionPath: 0, hitRate: null };
}

function scoreWaitKind(days, series, kind, waitDays) {
  const bucket = emptyWaitBucket();
  for (const day of days || []) {
    if (!day || !isIsoDate(day.date)) continue;
    for (const record of day.records || []) {
      if (!record || record.kind !== kind) continue;
      const stamped = { ...record, date: day.date };
      const price = betterEntryWithin(series, stamped, waitDays);
      const promoted = laterPromotion(days, series, stamped, waitDays);
      if (price == null && !promoted) {
        bucket.pending += 1;
        continue;
      }
      bucket.scored += 1;
      if (price === true) bucket.pricePath += 1;
      if (promoted) bucket.promotionPath += 1;
      if (price === true || promoted) bucket.right += 1;
    }
  }
  bucket.hitRate = bucket.scored ? bucket.right / bucket.scored : null;
  return bucket;
}

export function scoreAiRejections({
  days = [],
  series = {},
  horizons = REJECT_HORIZONS,
  waitDays = WAIT_BETTER_ENTRY_DAYS,
  asOf = null,
} = {}) {
  const horizonList = (Array.isArray(horizons) ? horizons : REJECT_HORIZONS)
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0);
  const ordered = (days || [])
    .filter((day) => day && isIsoDate(day.date))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rejects = {};
  for (const horizon of horizonList) {
    const rejectRets = [];
    const passRets = [];
    let pending = 0;
    for (const day of ordered) {
      for (const side of ["call", "put"]) {
        const rejected = (day.records || []).filter((row) => row && row.kind === "reject" && row.side === side);
        const passed = (day.passed || []).filter((row) => row && row.side === side);
        if (!rejected.length || !passed.length) {
          pending += rejected.length;
          continue;
        }
        const realizedRejects = [];
        for (const row of rejected) {
          const ret = directionalForwardPct(series, row.sym, day.date, horizon, side);
          if (ret == null) pending += 1;
          else realizedRejects.push(ret);
        }
        const realizedPasses = [];
        for (const row of passed) {
          const ret = directionalForwardPct(series, row.sym, day.date, horizon, side);
          if (ret != null) realizedPasses.push(ret);
        }
        // A realized reject with no realized same-day same-side pass is not a
        // comparison. Count it pending instead of putting it in the delta.
        if (!realizedRejects.length || !realizedPasses.length) {
          pending += realizedRejects.length;
          continue;
        }
        rejectRets.push(...realizedRejects);
        passRets.push(...realizedPasses);
      }
    }
    const reject = summarizeReturns(rejectRets);
    const passed = summarizeReturns(passRets);
    rejects[String(horizon)] = {
      reject,
      passed,
      meanDelta: reject.mean == null || passed.mean == null ? null : reject.mean - passed.mean,
      hitRateDelta: reject.hitRate == null || passed.hitRate == null ? null : reject.hitRate - passed.hitRate,
      pending,
    };
  }
  return {
    asOf: typeof asOf === "string" ? asOf : null,
    horizons: horizonList,
    waitBetterEntryDays: Math.floor(waitDays) || WAIT_BETTER_ENTRY_DAYS,
    rejects,
    waits: {
      wait: scoreWaitKind(ordered, series, "wait", waitDays),
      "wait-heldback": scoreWaitKind(ordered, series, "wait-heldback", waitDays),
    },
  };
}
