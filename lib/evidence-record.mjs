// Daily evidence record. One compact record per name per bake date.
//
// Each piece is the same shape: direction (up / down / neutral), strength
// 0–3, asOf (when the source was known), and firstSeen (the first bake date
// this direction was on the record). Level pieces fire only when today's
// value is at least 2 standard deviations from the name's own prior readings
// inside the loaded window — a raw level does not. Cross-section rank is the
// day's percentile of that value. Pieces are stored in firstSeen order so the
// record is the arrival timeline.
//
// Reads and writes go through a datastore-shaped { get, put }. The bake uses
// exact keys only (evidence-latest.json and the last 60 evidence/YYYY-MM-DD.json
// files). Older dates are never opened and never delete-staled.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isEvidenceRecordKey } from "./data-ownership.mjs";

export const EVIDENCE_LATEST_KEY = "evidence-latest.json";
export const EVIDENCE_LOOKBACK_DAYS = 60;
export const EVIDENCE_MIN_SAMPLE = 20;
export const EVIDENCE_OWN_SD = 2;
// firstSeen carries across a gap of at most this many trading days (weekdays
// strictly between the last record holding the piece and today) when the
// piece's direction is unchanged; a longer gap or a direction flip resets it.
export const EVIDENCE_FIRSTSEEN_MAX_GAP_TRADING_DAYS = 5;

// Sources the bake does not join cleanly onto a per-name daily series.
export const EVIDENCE_SKIPPED_SOURCES = Object.freeze([
  {
    source: "Google Trends themes",
    reason: "search-interest.json is a theme index with no per-ticker series",
  },
  {
    source: "RAM prices",
    reason: "weekly market series with no per-name mapping",
  },
  {
    source: "GPU cloud prices",
    reason: "weekly provider and model series with no per-name mapping",
  },
  {
    source: "AI capex",
    reason: "annual filing level, not a daily change versus a 60-day own normal",
  },
]);

const DIRS = new Set(["up", "down", "neutral"]);

export function evidenceDayKey(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    throw new Error(`evidence date is invalid: ${date}`);
  }
  return `evidence/${date}.json`;
}

export function addCalendarDays(iso, delta) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Inclusive window ending on bakeDate. The day before the window is not a key.
export function evidenceWindowKeys(bakeDate, days = EVIDENCE_LOOKBACK_DAYS) {
  const span = Math.max(1, Math.floor(days));
  const keys = [];
  for (let ago = span - 1; ago >= 0; ago--) {
    const day = addCalendarDays(bakeDate, -ago);
    if (day) keys.push(evidenceDayKey(day));
  }
  return keys;
}

export function etDay(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMetric(value) {
  const n = finite(value);
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n);
  if (abs >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

function clampStr(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, n));
}

function normalizeDir(value) {
  return DIRS.has(value) ? value : "neutral";
}

export function ownNormalZ(values, today) {
  const xs = (values || []).map(finite).filter((n) => n != null);
  const current = finite(today);
  if (xs.length < EVIDENCE_MIN_SAMPLE || current == null) return null;
  const mean = xs.reduce((sum, n) => sum + n, 0) / xs.length;
  const variance = xs.reduce((sum, n) => sum + (n - mean) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return current === mean ? 0 : (current > mean ? Infinity : -Infinity);
  return (current - mean) / sd;
}

export function signalFromZ(z) {
  if (z == null || Number.isNaN(z)) return { dir: "neutral", str: 0 };
  if (z === Infinity) return { dir: "up", str: 3 };
  if (z === -Infinity) return { dir: "down", str: 3 };
  const magnitude = Math.abs(z);
  if (magnitude < EVIDENCE_OWN_SD) return { dir: "neutral", str: 0 };
  const dir = z > 0 ? "up" : "down";
  const str = magnitude < 2.5 ? 1 : magnitude < 3.5 ? 2 : 3;
  return { dir, str };
}

function knownDay(raw, bakeDate, external) {
  const day = etDay(raw);
  if (!day) return external ? null : bakeDate;
  if (day > bakeDate) return external ? null : bakeDate;
  return day;
}

function obs(id, src, value, asOf, extra = {}) {
  return {
    id,
    src,
    v: value,
    asOf,
    ownNormal: extra.ownNormal !== false,
    fallback: extra.fallback || null,
    dir: extra.dir || null,
    str: extra.str ?? null,
  };
}

function indexRows(rows, field = "symbol") {
  const map = new Map();
  for (const row of rows || []) {
    const key = row?.[field];
    if (key) map.set(key, row);
  }
  return map;
}

function flowNet(row) {
  if (!row) return 0;
  let net = 0;
  for (const contract of row.contracts || []) {
    if (!contract || contract.flagged === false) continue;
    if (contract.tape && contract.tape !== "ask" && contract.tape !== "abv") continue;
    const premium = finite(contract.deltaPremium ?? contract.premium);
    const weight = premium != null && premium > 0 ? premium : 1;
    if (contract.side === "call") net += weight;
    else if (contract.side === "put") net -= weight;
  }
  return net;
}

function signedVolume(row) {
  if (!row) return 0;
  const hits = Array.isArray(row.bucketHits) ? row.bucketHits : [];
  for (let i = hits.length - 1; i >= 0; i--) {
    const ratio = finite(hits[i]?.volRatio);
    if (ratio == null) continue;
    const move = finite(hits[i]?.priceMovePct);
    const sign = move != null && move !== 0 ? Math.sign(move) : 1;
    return ratio * sign;
  }
  const eodRatio = finite(row.eod?.volRatio ?? row.eod?.ratio);
  if (eodRatio == null) return 0;
  const move = finite(row.eod?.priceMovePct ?? row.eod?.changePct);
  const sign = move != null && move !== 0 ? Math.sign(move) : 1;
  return eodRatio * sign;
}

function ivSignal(row) {
  const z = finite(row?.z);
  const change = finite(row?.chg5dPct);
  if (z == null && change == null) return null;
  const rising = change != null ? change : z;
  let dir = "neutral";
  if (rising >= 0.5 || (z != null && z >= 0.75)) dir = "up";
  else if (rising <= -0.5 || (z != null && z <= -0.75)) dir = "down";
  if (z != null && change != null && z * change < 0 && Math.abs(change) >= 0.5 && Math.abs(z) >= 0.5) {
    dir = "neutral";
  }
  const magnitude = Math.max(Math.abs(z ?? 0), Math.abs(change ?? 0) / 5);
  let str = 0;
  if (dir !== "neutral") str = magnitude >= 2.5 ? 3 : magnitude >= 1.5 ? 2 : 1;
  return { dir, str, v: z != null ? z : change };
}

function structurePiece(chain, bakeDate) {
  const technicals = chain?.technicals;
  const spot = finite(chain?.spot ?? technicals?.asOfClose);
  if (spot == null || !technicals) return null;
  const support = finite(technicals.sr?.s20);
  const resistance = finite(technicals.sr?.r20);
  let value = null;
  let fallback = null;
  if (support != null && resistance != null && resistance > support) {
    value = ((spot - support) / (resistance - support)) * 100;
    if (spot >= support && spot <= resistance) fallback = { dir: "neutral", str: 0 };
  } else {
    const sma20 = finite(technicals.sma?.sma20);
    if (sma20 != null && sma20 > 0) value = (spot / sma20 - 1) * 100;
  }
  if (value == null) return null;
  return obs("structure", "technicals", value, bakeDate, { fallback });
}

function newsPiece(chain, bakeDate) {
  const news = chain?.news;
  if (!news?.sentiment) return null;
  const sentiment = String(news.sentiment);
  const value = sentiment === "bullish" ? 1 : sentiment === "bearish" ? -1 : 0;
  let asOf = null;
  for (const headline of news.headlines || []) {
    const day = etDay(headline?.publishedAt);
    if (day && day <= bakeDate && (!asOf || day > asOf)) asOf = day;
  }
  if (!asOf) asOf = knownDay(news.builtAt, bakeDate, true);
  if (!asOf) return null;
  return obs("news", "news", value, asOf);
}

function attentionPiece(chain, bakeDate) {
  const stocktwits = chain?.social?.sources?.stocktwits;
  if (!stocktwits) return null;
  const bull = finite(stocktwits.bull) ?? 0;
  const bear = finite(stocktwits.bear) ?? 0;
  const directional = bull + bear;
  if (!(directional > 0)) return null;
  const asOf = knownDay(stocktwits.sampledAt || chain.social?.builtAt, bakeDate, true);
  if (!asOf) return null;
  return obs("attention", "stocktwits", (bull / directional) * 200 - 100, asOf);
}

function earningsPiece(chain, callEntry, bakeDate) {
  const next = chain?.earningsHx?.next;
  const daysUntil = finite(next?.daysUntil);
  const drift = finite(next?.pre10Pct);
  const nextDay = etDay(next?.date);
  if (drift != null && daysUntil != null && daysUntil >= 0 && daysUntil <= 21 && nextDay && nextDay >= bakeDate) {
    return obs("earnings", "earnings", drift, bakeDate);
  }
  const events = Array.isArray(chain?.earningsHx?.events) ? chain.earningsHx.events : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const day = etDay(event?.date);
    if (!day || day > bakeDate) continue;
    const age = Math.round((Date.parse(`${bakeDate}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
    if (age > 30) break;
    const surprise = finite(event.surprisePct);
    const runup = finite(event.pre15Pct);
    const value = surprise != null ? surprise : runup;
    if (value != null) return obs("earnings", "earnings", value, day);
  }
  if (!callEntry) return null;
  const callDay = knownDay(callEntry.callDate || callEntry.updatedAt, bakeDate, true);
  if (!callDay) return null;
  const tone = callEntry.mgmtTone;
  const value = tone === "confident" || tone === "optimistic" ? 1
    : tone === "cautious" || tone === "defensive" ? -1
      : 0;
  return obs("earnings", "earnings", value, callDay);
}

function narrativePiece(narratives, symbol, bakeDate) {
  let value = 0;
  let asOf = null;
  let hit = false;
  for (const narrative of narratives || []) {
    const long = Array.isArray(narrative?.longs) && narrative.longs.includes(symbol);
    const short = Array.isArray(narrative?.shorts) && narrative.shorts.includes(symbol);
    if (!long && !short) continue;
    hit = true;
    const strength = finite(narrative.strength);
    const unit = strength == null ? 0.5 : strength / 100;
    if (long) value += unit;
    if (short) value -= unit;
    for (const source of narrative.sources || []) {
      const day = etDay(source?.date);
      if (day && day <= bakeDate && (!asOf || day > asOf)) asOf = day;
    }
  }
  if (!hit) return null;
  return obs("narrative", "narratives", value, asOf || bakeDate);
}

function rotationPiece(payload, symbol, bakeDate) {
  const rows = [...(payload?.candidates || []), ...(payload?.nearMisses || [])];
  const row = rows.find((candidate) => candidate?.symbol === symbol);
  if (!row) return null;
  const value = row.phase === "confirmed" ? 2
    : row.phase === "first-thrust" ? 1
      : row.phase === "late" ? -1
        : 0;
  const asOf = knownDay(payload.dataAsOfDate || payload.builtAtIso, bakeDate, false);
  return obs("rotation", "sector-rotation", value, asOf);
}

function peerPiece(correlations, symbol, bakeDate) {
  const peers = correlations?.map?.[symbol]?.peers;
  if (!Array.isArray(peers) || !peers.length) return null;
  let sum = 0;
  let n = 0;
  for (const peer of peers) {
    const beta = finite(peer?.beta);
    const change = finite(peer?.chPct);
    if (beta == null || change == null) continue;
    sum += beta * change;
    n++;
  }
  if (!n) return null;
  const asOf = knownDay(correlations.builtAtIso, bakeDate, false);
  return obs("peers", "overnight", sum / n, asOf);
}

function inputPiece(items, symbol, bakeDate) {
  let best = null;
  for (const item of items || []) {
    if (!Array.isArray(item?.watch) || !item.watch.includes(symbol)) continue;
    const change = (item.changes || []).find((row) =>
      row && (row.label === "1d" || row.label === "m/m") && finite(row.pct) != null);
    if (!change) continue;
    const day = knownDay(item.asOf, bakeDate, true);
    if (!day) continue;
    const value = finite(change.pct);
    if (best == null || Math.abs(value) > Math.abs(best.v)) best = { v: value, asOf: day };
  }
  return best ? obs("inputs", "commodities", best.v, best.asOf) : null;
}

function filingAsOf(filings, bakeDate) {
  const dates = [];
  for (const firm of Object.values(filings?.perFirm || {})) {
    const day = etDay(firm?.filingDate);
    if (day && day <= bakeDate) dates.push(day);
  }
  const explicit = etDay(filings?.asOf);
  if (explicit && explicit <= bakeDate) dates.push(explicit);
  dates.sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function instPiece(filings, symbol, bakeDate) {
  const asOf = filingAsOf(filings, bakeDate);
  if (!asOf) return null;
  const bought = (filings.overallTopBought || []).find((row) => row?.ticker === symbol);
  const sold = (filings.overallTopSold || []).find((row) => row?.ticker === symbol);
  const row = bought || sold;
  const value = row ? finite(row.valueChange) : 0;
  if (value == null) return null;
  return obs("inst", "13f", value, asOf);
}

function insiderPiece(filings, symbol, bakeDate) {
  const feed = filings?.insiderTransactions;
  if (!feed || !Array.isArray(feed.transactions)) return null;
  let net = 0;
  for (const row of feed.transactions) {
    const ticker = row?.symbol || row?.ticker;
    if (ticker !== symbol) continue;
    const filed = etDay(row.filingDate);
    if (filed !== bakeDate) continue;
    if (row.openMarket === false) continue;
    if (row.code !== "P" && row.code !== "S") continue;
    const value = finite(row.value);
    if (value == null) continue;
    net += row.code === "P" ? value : -value;
  }
  return obs("insider", "form4", net, bakeDate);
}

function callEntryFor(earningsCalls, symbol) {
  if (!earningsCalls || typeof earningsCalls !== "object") return null;
  if (earningsCalls.calls && typeof earningsCalls.calls === "object") return earningsCalls.calls[symbol] || null;
  const direct = earningsCalls[symbol];
  return direct && typeof direct === "object" ? direct : null;
}

function universeSymbols(sources) {
  const set = new Set();
  for (const symbol of Object.keys(sources?.chains || {})) if (symbol) set.add(symbol);
  for (const symbol of Object.keys(sources?.marketStructure?.bySymbol || {})) if (symbol) set.add(symbol);
  return [...set].sort();
}

function buildContext(sources, bakeDate) {
  return {
    unusualBy: indexRows(sources?.unusual?.tickers),
    volumeBy: indexRows(sources?.volumeFlags?.tickers),
    oiBy: indexRows(sources?.oiTracker?.tickers),
    ivBy: indexRows(sources?.ivTrending?.tickers),
    unusualDay: sources?.unusual ? knownDay(sources.unusual.scannedAt, bakeDate, true) : null,
    volumeDay: sources?.volumeFlags ? knownDay(sources.volumeFlags.scannedAt, bakeDate, true) : null,
    structureBy: sources?.marketStructure?.bySymbol || {},
  };
}

function extractPieces(symbol, sources, ctx, bakeDate) {
  const chain = sources?.chains?.[symbol] || null;
  const pieces = [];
  const structure = chain ? structurePiece(chain, bakeDate) : null;
  if (structure) pieces.push(structure);

  if (ctx.unusualDay) pieces.push(obs("flow", "unusual", flowNet(ctx.unusualBy.get(symbol)), ctx.unusualDay));
  if (ctx.volumeDay) pieces.push(obs("volume", "volume", signedVolume(ctx.volumeBy.get(symbol)), ctx.volumeDay));

  const oi = ctx.oiBy.get(symbol);
  const cpRatio = finite(oi?.cpRatio);
  const oiAsOf = oi ? knownDay(oi.scannedAt || sources?.oiTracker?.scannedAt, bakeDate, true) : null;
  if (oi && cpRatio != null && oiAsOf) pieces.push(obs("gamma", "oi", cpRatio, oiAsOf));

  const iv = ivSignal(ctx.ivBy.get(symbol));
  if (iv) {
    const ivAsOf = knownDay(ctx.ivBy.get(symbol)?.asOf, bakeDate, true);
    if (ivAsOf) pieces.push(obs("iv", "iv-trend", iv.v, ivAsOf, { ownNormal: false, dir: iv.dir, str: iv.str }));
  }

  const positioning = ctx.structureBy[symbol];
  const short = positioning?.shortInterest;
  const shortChange = finite(short?.changePct);
  const settlement = etDay(short?.settlementDate);
  if (shortChange != null && !(settlement && settlement > bakeDate)) {
    pieces.push(obs("short", "finra-si", shortChange, bakeDate));
  }
  const darkPool = finite(positioning?.ats?.darkPoolPct);
  const published = etDay(positioning?.ats?.publishedDate);
  const week = etDay(positioning?.ats?.weekStartDate);
  if (darkPool != null && !(published && published > bakeDate) && !(week && week > bakeDate)) {
    const asOf = published && published <= bakeDate ? published : (published ? null : bakeDate);
    if (asOf) pieces.push(obs("ats", "finra-ats", darkPool, asOf));
  }

  const insider = insiderPiece(sources?.filings, symbol, bakeDate);
  if (insider) pieces.push(insider);
  const inst = instPiece(sources?.filings, symbol, bakeDate);
  if (inst) pieces.push(inst);

  const attention = chain ? attentionPiece(chain, bakeDate) : null;
  if (attention) pieces.push(attention);
  const news = chain ? newsPiece(chain, bakeDate) : null;
  if (news) pieces.push(news);
  const earnings = earningsPiece(chain, callEntryFor(sources?.earningsCalls, symbol), bakeDate);
  if (earnings) pieces.push(earnings);
  const narrative = narrativePiece(sources?.narratives, symbol, bakeDate);
  if (narrative) pieces.push(narrative);
  const rotation = rotationPiece(sources?.sectorRotation, symbol, bakeDate);
  if (rotation) pieces.push(rotation);
  const peers = peerPiece(sources?.correlations, symbol, bakeDate);
  if (peers) pieces.push(peers);
  const inputs = inputPiece(sources?.commodities?.items, symbol, bakeDate);
  if (inputs) pieces.push(inputs);

  const stress = finite(sources?.macro?.macroRegime?.stress);
  if (stress != null) {
    const asOf = knownDay(sources.macro.asOf || sources.macro.builtAtIso, bakeDate, false);
    pieces.push(obs("macro", "macro", stress, asOf));
  }
  return pieces;
}

function historyValues(records, bakeDate) {
  const oldest = addCalendarDays(bakeDate, -(EVIDENCE_LOOKBACK_DAYS - 1));
  const map = new Map();
  const rows = (records || [])
    .filter((record) => record?.date && record.date < bakeDate && (!oldest || record.date >= oldest))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const record of rows) {
    for (const [symbol, pieces] of Object.entries(record.names || {})) {
      if (!Array.isArray(pieces)) continue;
      if (!map.has(symbol)) map.set(symbol, new Map());
      const byId = map.get(symbol);
      for (const piece of pieces) {
        const value = finite(piece?.v);
        if (!piece?.id || value == null) continue;
        if (!byId.has(piece.id)) byId.set(piece.id, []);
        byId.get(piece.id).push(value);
      }
    }
  }
  return map;
}

// symbol -> piece id -> { date, piece } from the most recent prior record in
// the lookback window that holds that piece (not just the latest record).
function lastPiecesById(records, bakeDate) {
  const oldest = addCalendarDays(bakeDate, -(EVIDENCE_LOOKBACK_DAYS - 1));
  const sorted = (records || [])
    .filter((r) => r?.date && r.date <= bakeDate && (!oldest || r.date >= oldest))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const map = new Map();
  for (const record of sorted) {
    for (const [symbol, pieces] of Object.entries(record.names || {})) {
      if (!Array.isArray(pieces)) continue;
      if (!map.has(symbol)) map.set(symbol, new Map());
      const byId = map.get(symbol);
      for (const piece of pieces) {
        if (piece?.id && !byId.has(piece.id)) byId.set(piece.id, { date: record.date, piece });
      }
    }
  }
  return map;
}

// Weekdays strictly between two YYYY-MM-DD dates (no holiday calendar).
export function tradingDaysBetween(fromDate, toDate) {
  let count = 0;
  let cursor = addCalendarDays(fromDate, 1);
  while (cursor && cursor < toDate) {
    const dow = new Date(cursor + "T00:00:00Z").getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor = addCalendarDays(cursor, 1);
  }
  return count;
}

export function carriedFirstSeen(last, dir, bakeDate) {
  if (!last?.piece || last.piece.dir !== dir) return bakeDate;
  const fs = last.piece.firstSeen;
  if (typeof fs !== "string" || fs > bakeDate) return bakeDate;
  if (tradingDaysBetween(last.date, bakeDate) > EVIDENCE_FIRSTSEEN_MAX_GAP_TRADING_DAYS) return bakeDate;
  return fs;
}

function applySignal(piece, values) {
  if (piece.ownNormal === false) {
    return { dir: normalizeDir(piece.dir), str: clampStr(piece.str) };
  }
  const z = ownNormalZ(values, piece.v);
  if (z == null) {
    if (piece.fallback) return { dir: normalizeDir(piece.fallback.dir), str: clampStr(piece.fallback.str) };
    return { dir: "neutral", str: 0 };
  }
  return signalFromZ(z);
}

function assignRanks(names) {
  const buckets = new Map();
  for (const pieces of Object.values(names)) {
    for (const piece of pieces) {
      if (finite(piece.v) == null) continue;
      if (!buckets.has(piece.id)) buckets.set(piece.id, []);
      buckets.get(piece.id).push(piece);
    }
  }
  for (const rows of buckets.values()) {
    if (rows.length < 2) continue;
    const sorted = rows.slice().sort((a, b) => a.v - b.v || a.id.localeCompare(b.id));
    let index = 0;
    while (index < sorted.length) {
      let end = index;
      while (end + 1 < sorted.length && sorted[end + 1].v === sorted[index].v) end++;
      const rank = Math.round((((index + end) / 2) / (sorted.length - 1)) * 100);
      for (let cursor = index; cursor <= end; cursor++) sorted[cursor].rk = rank;
      index = end + 1;
    }
  }
}

export function buildEvidenceRecord(sources, { bakeDate, priorRecords = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bakeDate || "")) {
    throw new Error("evidence bakeDate must be YYYY-MM-DD");
  }
  const ctx = buildContext(sources || {}, bakeDate);
  const history = historyValues(priorRecords, bakeDate);
  const lastBySymbol = lastPiecesById(priorRecords, bakeDate);
  const names = {};
  for (const symbol of universeSymbols(sources || {})) {
    const finished = [];
    for (const piece of extractPieces(symbol, sources || {}, ctx, bakeDate)) {
      const asOf = piece.asOf;
      if (!asOf || asOf > bakeDate) continue;
      const signal = applySignal(piece, history.get(symbol)?.get(piece.id) || []);
      const dir = normalizeDir(signal.dir);
      const firstSeen = carriedFirstSeen(lastBySymbol.get(symbol)?.get(piece.id), dir, bakeDate);
      const out = {
        id: piece.id,
        src: piece.src,
        dir,
        str: clampStr(signal.str),
        asOf,
        firstSeen,
      };
      const value = roundMetric(piece.v);
      if (value != null) out.v = value;
      finished.push(out);
    }
    if (!finished.length) continue;
    finished.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.id.localeCompare(b.id));
    names[symbol] = finished;
  }
  assignRanks(names);
  for (const pieces of Object.values(names)) {
    pieces.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.id.localeCompare(b.id));
  }
  return { date: bakeDate, names };
}

function parseRecord(body) {
  if (body == null) return null;
  try {
    const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || "")) return null;
    if (!parsed.names || typeof parsed.names !== "object" || Array.isArray(parsed.names)) parsed.names = {};
    return parsed;
  } catch {
    return null;
  }
}

export function createFileEvidenceStore(dataDir) {
  return {
    async get(key) {
      if (!isEvidenceRecordKey(key)) return null;
      try {
        return await readFile(resolve(dataDir, key));
      } catch {
        return null;
      }
    },
    async put(key, body) {
      if (!isEvidenceRecordKey(key)) throw new Error(`refusing evidence write ${key}`);
      const path = resolve(dataDir, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
  };
}

// Exact gets only. Never lists the evidence prefix, so older keys stay unread.
export async function loadEvidenceWindow(store, bakeDate, days = EVIDENCE_LOOKBACK_DAYS) {
  if (!store || typeof store.get !== "function") throw new Error("evidence load requires store.get");
  const keys = [...evidenceWindowKeys(bakeDate, days), EVIDENCE_LATEST_KEY];
  const records = [];
  let latest = null;
  for (const key of keys) {
    const body = await store.get(key);
    if (key === EVIDENCE_LATEST_KEY) {
      if (body == null) continue;
      try {
        latest = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
      } catch {
        latest = null;
      }
      continue;
    }
    const record = parseRecord(body);
    if (record) records.push(record);
  }
  return { records, latest, keys };
}

async function readOptionalJson(dataDir, name) {
  try {
    return JSON.parse(await readFile(resolve(dataDir, name), "utf8"));
  } catch {
    return null;
  }
}

export async function runEvidenceRecord({
  dataDir = null,
  store = null,
  remote = null,
  bakeDate,
  priorRecords = null,
  sources = {},
} = {}) {
  const io = store || (dataDir ? createFileEvidenceStore(dataDir) : null);
  if (!io) throw new Error("evidence record requires a store or dataDir");
  let records = priorRecords;
  if (!Array.isArray(records)) {
    const loaded = await loadEvidenceWindow(io, bakeDate);
    records = loaded.records;
  }
  const filled = { ...sources };
  if (dataDir) {
    if (filled.earningsCalls == null) filled.earningsCalls = await readOptionalJson(dataDir, "earnings-calls.json");
    if (filled.sectorRotation == null) filled.sectorRotation = await readOptionalJson(dataDir, "sector-rotation.json");
    if (filled.correlations == null) filled.correlations = await readOptionalJson(dataDir, "correlations.json");
    if (filled.commodities == null) filled.commodities = await readOptionalJson(dataDir, "commodities.json");
  }
  const record = buildEvidenceRecord(filled, { bakeDate, priorRecords: records });
  const key = evidenceDayKey(record.date);
  const names = Object.keys(record.names).length;
  const pieces = Object.values(record.names).reduce((sum, rows) => sum + rows.length, 0);
  const dayBody = JSON.stringify(record);
  const latestBody = JSON.stringify({ date: record.date, key, names, pieces });
  await io.put(key, dayBody);
  await io.put(EVIDENCE_LATEST_KEY, latestBody);
  let remoteError = null;
  if (remote?.hasToken?.()) {
    try {
      const updates = new Map([[key, Buffer.from(dayBody)], [EVIDENCE_LATEST_KEY, Buffer.from(latestBody)]]);
      if (typeof remote.publishGeneration === "function") {
        await remote.publishGeneration({ owner: "bake", updates });
      } else {
        await remote.put(key, updates.get(key));
        await remote.put(EVIDENCE_LATEST_KEY, updates.get(EVIDENCE_LATEST_KEY));
      }
    } catch (err) {
      remoteError = err?.message || String(err);
    }
  }
  return { date: record.date, key, names, pieces, remoteError, record };
}
