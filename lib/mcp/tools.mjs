// lib/mcp/tools.mjs — the Mingstreet MCP tool catalog.
//
// Every tool is READ-ONLY and makes ZERO AI calls. Tools read the same baked
// payloads the website reads (the private R2 store via lib/datastore.mjs) and,
// for live quotes and Top Picks approval, the same Yahoo helpers the site's
// /api endpoints use. Authorization reuses the site's single sources:
// lib/premium-keys.mjs (which stored payloads are Owner-only) and
// lib/owner-access-policy.mjs (which pages are Owner-only on screen).
//
// Never reachable from here: broker / Webull records, uploaded fills, the
// shared watchlist, AI caches and accounting, Research Lab internals, retired
// Day Trading keys, and any secret. Only keys named in FEATURE_KEYS, per-ticker
// `<SYMBOL>.json` for covered symbols, and the Track Record view are read.

import { SOURCE_KEYS } from "../site-catalog/feature-sources.mjs";
import { siteCatalog } from "../site-catalog/site-catalog.mjs";
import { researchUniverse } from "../site-catalog/universe.mjs";
import { isPremiumKey, isRetiredKey } from "../premium-keys.mjs";
import { OWNER_PAGE_IDS, SPORTS_PAGE_IDS } from "../owner-access-policy.mjs";
import { dryRunStore } from "./read-only-store.mjs";
import { sportsTools } from "./sports-tools.mjs";

export const RESULT_MAX_BYTES = 48_000;
const LIVE_QUOTE_MAX = 10;
const UNIVERSE = new Set(researchUniverse);
const OWNER_PAGES = new Set(OWNER_PAGE_IDS);
const SPORTS_PAGES = new Set(SPORTS_PAGE_IDS);

// Features whose canonical MCP read is a dedicated tool.
const DEDICATED = {
  picks: "get_top_picks",
  track: "get_track_record",
  "open-picks": "get_track_record",
  grade: "get_stock",
  tickers: "get_stock_grades",
};
export const FEATURE_KEYS = { ...SOURCE_KEYS };
// Extra saved files behind a page, read with get_feature `dataset`. The main
// file is always dataset "main". Values with "{SYMBOL}" are per-stock files
// and need `ticker`; values with "{DATE}" are per-day files and take `date`
// (default: the newest day found in the last week). Mirrors what each page
// actually loads (scripts/render/*.mjs dataUrl / vnJson / quantFetchJson calls
// and export-js.mjs EXPORT_SOURCES). scripts/mcp-smoke.mjs fails when a page
// loads a data file that is neither listed here nor deliberately left out.
export const FEATURE_DATASETS = {
  "bonds-usd": { history: "macro-history.json", auctions: "treasury-auctions.json" },
  "capital-raises": { "ipo-credit": "ipo-credit.json" },
  "fear-greed": { history: "fear-greed-history.json" },
  calls: { transcript: "transcript-{SYMBOL}.json" },
  crowd: { owner: "crowd-owner.json" },
  "history-rhymes": { owner: "history-rhymes-owner.json" },
  earnings: { history: "earnings-history.json" },
  "earnings-week": { plan: "earnings-week-plan.json" },
  "past-day": { briefs: "market-days-briefs.json", "picks-run": "picks-run-{DATE}.json" },
  "forced-liquidation": { "leverage-distress": "leverage-distress.json" },
  market: { "regime-history": "regime-history.json" },
  narratives: { history: "trends-history.json" },
  overnight: { log: "overnight-log.json", preopen: "overnight-preopen.json" },
  "iv-trend": { "iv-history": "iv-history/{SYMBOL}.json" },
  "unified-signal-engine": { rotation: "sector-rotation.json", "link-map": "link-map.json" },
  rotation: { log: "sector-rotation-log.json" },
  levetf: { log: "leveraged-etfs-log.json" },
  leaps: { paper: "leaps-paper.json" },
  flow: { history: "unusual-history.json", log: "unusual-log.json", explanations: "flow-explanations.json" },
  volume: { history: "volume-history.json" },
  oi: { history: "oi-history.json" },
  quant: {
    evidence: "evidence-board.json", outcomes: "picks-outcomes.json", "regime-lab": "regime-lab.json",
    loop: "picks-loop.json", history: "quant-history.json", "source-health": "source-health.json",
  },
  grade: {
    "fundamentals-history": "fundamentals-history/{SYMBOL}.json", research: "grade-research.json", daily: "grades-daily.json",
    "auto-picks": "auto-picks.json",
  },
  picks: { open: "picks-open.json", raw: "picks.json", runs: "picks-run-{DATE}.json", mode: "top-picks-mode.json" },
  track: { changes: "picks-changes.json", roster: "picks-roster.json", "grades-history": "grades-history.json" },
};
// One line per non-obvious dataset, shown by list_features.
const DATASET_NOTES = {
  "bonds-usd.auctions": "Treasury auction results, last two years.",
  "crowd.owner": "Owner join of the crowd facts to open Top Picks trades, with attention and short-pressure ranks.",
  "history-rhymes.owner": "Per-stock buildout role, model (Merton) five-year default chance and spread, leverage flags and reported CDS quotes.",
  "past-day.picks-run": "Every Top Picks decision run that day (pass `date`).",
  "unified-signal-engine.link-map": "Company relationships (suppliers, customers, peers).",
  "leaps.paper": "LEAPS paper book.",
  "quant.evidence": "Owner Lab Evidence: open questions, tests and gates, shadow signals.",
  "quant.outcomes": "What every scored name did 1/5/10/20 days later, plus the random control book.",
  "quant.regime-lab": "Regime Lab: market labels, playbook shadow books, headline oracle, tests.",
  "quant.loop": "Self-improving loop: stated odds per pick vs what happened, honesty score, which inputs and rules pay.",
  "quant.history": "Owner Lab history.",
  "quant.source-health": "Which outside data feeds are fresh, stale or failing.",
  "grade.auto-picks": "The best call and put Top Picks would buy for each stock.",
  "picks.runs": "Run archive: the whole scored universe at each 11:00/15:30 ET run that day (pass `date`).",
  "picks.mode": "The Owner market mode (which sides may open new trades).",
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Data files pages load that the MCP deliberately does not serve.
export const NOT_SERVED_KEYS = new Set(["manifest.json", "manifest-free.json", "ai-cost-history.json"]);

function etDate(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function datasetKey(id, dataset, sym, date) {
  if (!dataset || dataset === "main") return FEATURE_KEYS[id] || null;
  const tpl = FEATURE_DATASETS[id]?.[dataset];
  if (!tpl) return null;
  if (tpl.includes("{SYMBOL}")) {
    if (!sym) fail("INVALID_INPUT", `Dataset "${dataset}" is per stock; pass \`ticker\``);
    return tpl.replace("{SYMBOL}", sym);
  }
  if (tpl.includes("{DATE}")) return date ? tpl.replace("{DATE}", date) : tpl;
  return tpl;
}

// Owner-saved files that do not exist until first saved: the site reads them
// as these defaults, so the MCP does too.
const DEFAULT_PAYLOADS = {
  "top-picks-mode.json": async () => ({ ...(await import("../top-picks-mode.mjs")).readTopPicksModeDoc(null), note: "Never changed: the site runs on the default (Auto)." }),
};

// A concrete key for access checks on templated keys.
const sampleKey = (key) => key.replace("{DATE}", "2026-01-02").replace("{SYMBOL}", "SPY");

// A per-day file: the given date, or the newest one in the last 8 days (ET).
async function readDatedKey(ctx, tpl, date) {
  if (date) return { ...(await readKey(ctx, tpl.replace("{DATE}", date))), key: tpl.replace("{DATE}", date) };
  for (let i = 0; i < 8; i++) {
    const day = etDate(ctx.now() - i * 86_400_000);
    const key = tpl.replace("{DATE}", day);
    try {
      return { ...(await readKey(ctx, key)), key };
    } catch (err) {
      if (!(err instanceof ToolError) || err.code !== "DATA_UNAVAILABLE") throw err;
    }
  }
  fail("DATA_UNAVAILABLE", "No saved file for the last 8 days; pass `date` (YYYY-MM-DD).");
}
// Never readable through the MCP, even by the Owner.
const DENIED_KEYS = new Set([
  "picks-fills.json", "webull-paper-ledger.json", "picks-watchlist.json", "owner-watchlist.json", "ai-usage.json",
  "chart-pattern-cache.json", "pick-thesis-cache.json", "ticker-judgment-cache.json",
  "news-source-evidence.json", "track-record-reset.json", "webull-track-record-reset.json",
]);
// Keys dropped anywhere in a reduced payload. Deliberately specific: market
// data uses words like `session` (earnings AM/PM, trading sessions) and
// `tokens`, which must survive.
const SECRET_KEY_RE = /secret|password|passwd|credential|api[_-]?key|webhook|cookie|authorization|bearer|(access|refresh|auth|id|session|csrf)[_-]?token|^token$|private[_-]?key/i;
// Internal state saved beside the research: forced-liquidation's one entry per
// SEC document read, 13F's CUSIP lookup attempts and storage part keys.
// Readable with `path`, never by default.
const BOOKKEEPING_KEYS = new Set(["inspected", "mappingAttempts", "holdingsParts", "ownershipRetainedParts"]);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ENCODED_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const HEAVY_KEYS = new Set(["priceSeries", "intradaySeries", "_bars", "_intraday", "chains", "chain", "options", "expirations", "rawHistory", "history"]);

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => { throw new ToolError(code, message); };

// ---------------------------------------------------------------------------
// bounded JSON reduction

// Long float tails (0.49999999999998934, -22.191887675507026) are noise for a
// reader: 2 decimals from 1,000 up (index levels, revenue), 4 decimals from 1,
// 5 significant digits below 1.
function tidyNumber(n) {
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n)) return n;
  if (Math.abs(n) >= 1000) return Math.round(n * 100) / 100;
  if (Math.abs(n) >= 1) return Math.round(n * 1e4) / 1e4;
  return Number(n.toPrecision(5));
}
// Epoch numbers under time-named keys (`expSec`, `closeMs`, `exp`) become ISO
// dates. The two ranges (2000-2100 in seconds, then in milliseconds) do not
// overlap, and a duration under such a key never reaches them.
const EPOCH_KEY_RE = /(?:Sec|Ms|Epoch)$|^(?:exp|expiry|expiration)$/;
function epochText(key, n) {
  if (typeof n !== "number" || !EPOCH_KEY_RE.test(key)) return undefined;
  const ms = n >= 946_684_800 && n < 4_102_444_800 ? n * 1000 : n >= 946_684_800_000 && n < 4_102_444_800_000 ? n : null;
  if (ms == null) return undefined;
  const iso = new Date(ms).toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}
// `path` is the dotted path of `value` inside what the caller can read with
// get_feature `path` (null when the caller has no `path` argument), so every
// placeholder says where to read the part that was cut.
const childPath = (path, key) => (path == null || String(key).includes(".") ? null : path ? `${path}.${key}` : String(key));
const readHint = (path) => (path == null ? "" : `; read with path "${path}"`);
const spanHint = (path, from, to) => (path == null ? "" : ` (paths "${childPath(path, from)}" to "${childPath(path, to)}", or raise max_items)`);
function reduceValue(value, opts, depth = 0, keepHeavy = false, path = null) {
  const { maxDepth, maxArray, maxString, maxKeys, state } = opts;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return tidyNumber(value);
  if (typeof value === "string") {
    // Compressed or base64 blobs (unified-signal `trading.inputs.data`) are
    // unreadable text; say what was there instead of printing 1,200 characters of it.
    if (value.length > 256 && ENCODED_RE.test(value) && /\d/.test(value) && /[A-Z]/.test(value) && /[a-z]/.test(value)) {
      state.cut = true;
      return `[encoded data omitted: ${value.length} characters]`;
    }
    if (value.length <= maxString) return value;
    state.cut = true;
    return value.slice(0, maxString) + "…";
  }
  if (depth >= maxDepth) {
    state.cut = true;
    if (Array.isArray(value)) return `[array of ${value.length}${readHint(path)}]`;
    const n = Object.keys(value).length;
    return `{object with ${n} key${n === 1 ? "" : "s"}${readHint(path)}}`;
  }
  if (Array.isArray(value)) {
    if (value.length > maxArray) state.cut = true;
    // Logs and histories are stored oldest first; keep their newest rows.
    if (value.length > maxArray && ascendingByDate(value)) {
      const skip = value.length - maxArray;
      const out = value.slice(-maxArray).map((v, i) => reduceValue(v, opts, depth + 1, keepHeavy, childPath(path, skip + i)));
      out.unshift(`…${plural(skip, "earlier item")}${spanHint(path, 0, skip - 1)}`);
      return out;
    }
    const out = value.slice(0, maxArray).map((v, i) => reduceValue(v, opts, depth + 1, keepHeavy, childPath(path, i)));
    if (value.length > maxArray) out.push(`…${plural(value.length - maxArray, "more item")}${spanHint(path, maxArray, value.length - 1)}`);
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value).filter((k) => !SECRET_KEY_RE.test(k));
    let n = 0;
    for (const k of keys) {
      const v = value[k];
      if (!keepHeavy && (HEAVY_KEYS.has(k) || BOOKKEEPING_KEYS.has(k)) && v && typeof v === "object") {
        state.cut = true;
        const n = Array.isArray(v) ? v.length : Object.keys(v).length;
        const what = BOOKKEEPING_KEYS.has(k) ? `internal bookkeeping, ${plural(n, "entry", "entries")}` : Array.isArray(v) ? plural(n, "item") : "large series";
        out[k] = `[omitted: ${what}${readHint(childPath(path, k))}]`;
        continue;
      }
      if (++n > maxKeys) {
        state.cut = true;
        const rest = keys.slice(keys.indexOf(k));
        const names = rest.slice(0, 15).join(", ") + (rest.length > 15 ? ", …" : "");
        out["…"] = `${plural(rest.length, "more key")}: ${names}${path == null ? "" : `; read one with path "${childPath(path, rest[0])}"`}`;
        break;
      }
      out[k] = epochText(k, v) ?? reduceValue(v, opts, depth + 1, keepHeavy, childPath(path, k));
    }
    return out;
  }
  return null;
}

// Each step cuts lists, text and key counts before it cuts depth, so a large
// payload keeps its shape and loses rows first.
const BUDGETS = [
  { maxDepth: 7, maxArray: 25, maxString: 1200, maxKeys: 60 },
  { maxDepth: 6, maxArray: 12, maxString: 600, maxKeys: 40 },
  { maxDepth: 6, maxArray: 8, maxString: 400, maxKeys: 30 },
  { maxDepth: 5, maxArray: 5, maxString: 240, maxKeys: 24 },
  { maxDepth: 4, maxArray: 4, maxString: 160, maxKeys: 20 },
  { maxDepth: 3, maxArray: 3, maxString: 120, maxKeys: 15 },
  { maxDepth: 2, maxArray: 3, maxString: 100, maxKeys: 12 },
];

const ROW_TIME_FIELDS = ["date", "d", "etDate", "day", "t", "asOf", "builtAtIso", "builtAt", "generatedAt", "at", "ts", "time", "issued_utc", "entryDate", "session"];
function rowTime(v) {
  if (typeof v === "string") return DATE_LIKE.test(v) ? Date.parse(v) : NaN;
  if (typeof v === "number") return NaN;
  // Packed rows (picks-outcomes `rows`) lead with their date.
  if (Array.isArray(v)) return typeof v[0] === "string" && DATE_LIKE.test(v[0]) ? Date.parse(v[0]) : NaN;
  if (!v || typeof v !== "object") return NaN;
  for (const f of ROW_TIME_FIELDS) {
    const x = v[f];
    if (typeof x === "string" && DATE_LIKE.test(x)) return Date.parse(x);
  }
  return NaN;
}
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/;
function ascendingByDate(arr) {
  if (arr.length < 2) return false;
  const a = rowTime(arr[0]), b = rowTime(arr[arr.length - 1]);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

// `pathBase` (the caller's get_feature `path`, "" for the whole payload) turns
// on read-with-path hints in placeholders; leave it out where `path` is not an
// argument.
export function boundedJson(value, { maxBytes = RESULT_MAX_BYTES, keepHeavy = false, maxItems, pathBase = null } = {}) {
  for (let i = 0; i < BUDGETS.length; i++) {
    // An explicit max_items is a ceiling at every budget, not only the first.
    const state = { cut: false };
    const budget = { ...BUDGETS[i], state, ...(maxItems ? { maxArray: i === 0 ? maxItems : Math.min(maxItems, BUDGETS[i].maxArray) } : {}) };
    const reduced = reduceValue(value, budget, 0, keepHeavy, pathBase);
    const bytes = Buffer.byteLength(JSON.stringify(reduced));
    if (bytes <= maxBytes) return { value: reduced, reduced: state.cut };
  }
  return { value: "[result too large: narrow it with `path` or `ticker`]", reduced: true };
}

function getPath(value, path) {
  if (!path) return value;
  let cur = value;
  for (let part of String(path).split(".").filter(Boolean)) {
    // Negative indexes count from the end: "entries.-1" is the newest row of a log.
    if (Array.isArray(cur) && /^-\d+$/.test(part)) part = String(cur.length + Number(part));
    if (cur == null || typeof cur !== "object" || !Object.hasOwn(cur, part)) fail("NOT_FOUND", `Path "${path}" does not exist in this payload`);
    cur = cur[part];
  }
  if (cur === undefined) fail("NOT_FOUND", `Path "${path}" does not exist in this payload`);
  return cur;
}

function findTicker(payload, symbol, limit = 25) {
  const matches = [];
  let scanned = 0;
  (function walk(value, path, depth) {
    if (matches.length >= limit || ++scanned > 80_000 || depth > 12 || !value || typeof value !== "object") return;
    if (!Array.isArray(value) && ([value.symbol, value.sym, value.ticker, value.s].includes(symbol) || [value.from, value.to].includes(`ticker:${symbol}`))) {
      matches.push({ path, value });
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) continue;
      if (k === symbol && v && typeof v === "object") { matches.push({ path: path ? `${path}.${k}` : k, value: v }); continue; }
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  })(payload, "", 0);
  return matches;
}

function sourceTime(payload) {
  // The hourly and OI scanners stamp scannedAt (unusual, volume-flags, oi-tracker).
  // Per-stock files carry their Yahoo fetch times instead of a build stamp.
  const t = payload?.builtAtIso || payload?.builtAt || payload?.generatedAtIso || payload?.generatedAt || payload?.asOf || payload?.updatedAt || payload?.scannedAt || payload?.current?.builtAtIso ||
    payload?.updated_utc || payload?.priceHistoryProvenance?.fetchedAt || payload?.quoteProvenance?.fetchedAt || payload?.quoteAsOf || null;
  if (typeof t === "string" && Number.isFinite(Date.parse(t))) return t;
  return latestRowTime(payload);
}

// Logs and histories have no build stamp: date them by their newest row
// (a top-level array, an array one level down, or date-keyed objects).
function latestRowTime(payload) {
  if (!payload || typeof payload !== "object") return null;
  let best = NaN;
  // Rows dated in the future (scheduled events) say nothing about freshness.
  const ceiling = Date.now() + 36 * 3_600_000;
  const consider = (ms) => { if (Number.isFinite(ms) && ms <= ceiling && !(ms <= best)) best = ms; };
  const scanArray = (arr) => { if (arr.length) { consider(rowTime(arr[0])); consider(rowTime(arr[arr.length - 1])); } };
  const scanObject = (obj, depth) => {
    let n = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (++n > 400) break;
      if (DATE_LIKE.test(k)) consider(Date.parse(k.slice(0, 10)));
      if (Array.isArray(v)) scanArray(v);
      else if (depth < 1 && v && typeof v === "object") scanObject(v, depth + 1);
    }
  };
  if (Array.isArray(payload)) scanArray(payload);
  else scanObject(payload, 0);
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

function freshness(payload, now) {
  const asOf = sourceTime(payload);
  const warnings = [];
  if (!asOf) warnings.push("UNDATED_SOURCE: the saved payload has no usable timestamp.");
  else {
    const ageH = (now - Date.parse(asOf)) / 3_600_000;
    if (ageH > 96) warnings.push(`STALE_SOURCE: saved ${Math.round(ageH)} hours ago.`);
  }
  if (payload?.stale || payload?.carriedForward) warnings.push("CARRIED_FORWARD: the source marks this payload as stale or carried forward.");
  const until = Date.parse(payload?.validUntil || "");
  if (Number.isFinite(until) && until < now) warnings.push(`EXPIRED: the source says this data was valid until ${payload.validUntil}; treat decisions in it as out of date.`);
  return { as_of: asOf, warnings };
}

function normSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(s)) fail("INVALID_INPUT", "Give a ticker symbol such as NVDA");
  return s;
}

function coveredSymbol(raw) {
  const s = normSymbol(raw);
  if (!UNIVERSE.has(s)) fail("NOT_COVERED", `${s} is not in Mingstreet's coverage list. Call list_features for the covered universe.`);
  return s;
}

// ---------------------------------------------------------------------------
// store access, gated exactly like lib/data-response.mjs

async function readKey(ctx, key) {
  if (DENIED_KEYS.has(key) || isRetiredKey(key) || key.startsWith("_stonks/")) fail("FORBIDDEN", "This record is not available through the MCP");
  const owner = isPremiumKey(key);
  if (owner && !ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required for this data");
  const buf = await ctx.store.get(key);
  if (buf == null) fail("DATA_UNAVAILABLE", "No saved data yet for this feature. It appears after the next site build.");
  if (buf.length > 12 * 1024 * 1024) fail("RESOURCE_LIMIT", "Saved payload is too large to read");
  let text = buf.toString("utf8");
  if (!owner && !ctx.principal.owner) {
    const { sanitizePublicJsonText } = await import("../public-data-policy.mjs");
    const sanitized = sanitizePublicJsonText(key, text);
    if (sanitized != null) text = typeof sanitized === "string" ? sanitized : sanitized.toString("utf8");
  }
  try {
    return { payload: JSON.parse(text), owner, bytes: buf.length };
  } catch {
    fail("DATA_UNAVAILABLE", "Saved payload is unreadable");
  }
}

function envelope(ctx, { tool, source, payload, results, owner, warnings = [], limitations = [] }) {
  const f = payload ? freshness(payload, ctx.now()) : { as_of: null, warnings: [] };
  return {
    schema_version: "1.0",
    tool,
    source: source || null,
    access: owner ? "owner" : "public",
    as_of: f.as_of,
    generated_at: new Date(ctx.now()).toISOString(),
    ai_calls: 0,
    warnings: [...f.warnings, ...warnings],
    limitations: [
      "Saved site research from the last scheduled build, not a live feed, unless the tool says it is live.",
      "Research and education only; not investment advice. No orders can be placed.",
      ...limitations,
    ],
    results: tidyResults(results),
  };
}

// Google News RSS links are opaque redirects (often 300+ characters) that an
// AI client cannot use; the headline keeps its title, publisher and date.
const OPAQUE_LINK_RE = /^https:\/\/news\.google\.com\/rss\/articles\//;
const LINK_KEYS = new Set(["link", "bodyLink", "url"]);

// Headline rows carry the same link and publisher twice plus an internal
// source hash; keep one of each.
function slimRow(out) {
  if (out.bodyLink != null && out.bodyLink === out.link) delete out.bodyLink;
  if (out.bodyPublisher != null && out.bodyPublisher === out.publisher) delete out.bodyPublisher;
  if (typeof out.title === "string" && "publisher" in out) delete out.sourceId;
  for (const k of LINK_KEYS) if (typeof out[k] === "string" && OPAQUE_LINK_RE.test(out[k])) delete out[k];
  return out;
}

// The same long note repeated in every split (the Sports prop record repeats
// its closing-line note per stat, basis and rank) is sent once; later copies
// point back to it.
const REPEAT_MIN_CHARS = 160;
export const REPEATED_TEXT = "(same text as earlier in this result)";
// What every tool result goes through (rounding, dates, slim headline rows,
// repeated notes). Exported for the smoke test.
export const tidyResults = (v) => dedupeLongText(tidyDeep(v));
function dedupeLongText(v) {
  const seen = new Set();
  const walk = (x, depth) => {
    if (typeof x === "string") {
      if (x.length < REPEAT_MIN_CHARS) return x;
      if (seen.has(x)) return REPEATED_TEXT;
      seen.add(x);
      return x;
    }
    if (!x || typeof x !== "object" || depth > 40) return x;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    const out = {};
    for (const [k, y] of Object.entries(x)) out[k] = walk(y, depth + 1);
    return out;
  };
  return walk(v, 0);
}
// Every tool's results get the same rounding as trimmed feature payloads.
function tidyDeep(v, depth = 0) {
  if (typeof v === "number") return tidyNumber(v);
  if (!v || typeof v !== "object" || depth > 40) return v;
  if (Array.isArray(v)) return v.map((x) => tidyDeep(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = epochText(k, x) ?? tidyDeep(x, depth + 1);
  return slimRow(out);
}

// ---------------------------------------------------------------------------
// tools

const OWNER = "owner";
const ANY = "any";

function featureAccess(id, key) {
  if (OWNER_PAGES.has(id)) return OWNER;
  if (key && isPremiumKey(key)) return OWNER;
  return "public";
}

function featureList(principal) {
  return siteCatalog
    // Sports is a separate private section with its own sports_* tools.
    .filter((s) => s.id !== "update-checker" && !SPORTS_PAGES.has(s.id))
    .map((s) => {
      const key = FEATURE_KEYS[s.id] || null;
      const access = featureAccess(s.id, key);
      // Extra files this caller may read (an Owner-only file on a public page
      // is listed only for the Owner).
      const extra = Object.entries(FEATURE_DATASETS[s.id] || {})
        .filter(([, tpl]) => principal.owner || !isPremiumKey(sampleKey(tpl)))
        .map(([name]) => name);
      const notes = Object.fromEntries(extra.filter((n) => DATASET_NOTES[`${s.id}.${n}`]).map((n) => [n, DATASET_NOTES[`${s.id}.${n}`]]));
      return {
        id: s.id,
        label: s.label,
        category: s.category,
        description: s.description,
        access,
        read_with: DEDICATED[s.id] || (key ? "get_feature" : null),
        datasets: key && !DEDICATED[s.id] ? ["main", ...extra] : extra.length ? extra : undefined,
        dataset_notes: Object.keys(notes).length ? notes : undefined,
        page: `/?tab=${s.id}`,
      };
    })
    .filter((f) => principal.owner || f.access === "public");
}

export const TOOLS = [
  {
    name: "list_features",
    title: "List Mingstreet features",
    audience: ANY,
    description:
      "List every Mingstreet research feature you can read, the tool that reads it, and the covered stock universe. Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(ctx) {
      const features = featureList(ctx.principal);
      return envelope(ctx, {
        tool: "list_features",
        owner: ctx.principal.owner,
        results: {
          features,
          covered_symbols: researchUniverse,
          tips: [
            "get_feature reads any feature with read_with = get_feature; pass `ticker` to keep only that stock's records and `path` to drill into a section.",
            "get_stock gives one stock in depth; get_price_history its daily bars; get_live_quotes current prices.",
            "Pages with read_with = null are reference or UI pages without a saved data payload.",
            "Dedicated tools (get_top_picks, get_track_record, get_stock) also list `datasets`: read those extra files with get_feature and `dataset`.",
            "get_option_chain reads a stock's saved option chain; search finds pages and stocks by keyword; fetch reads one search result.",
          ],
        },
      });
    },
  },
  {
    name: "get_feature",
    title: "Read a Mingstreet feature",
    audience: ANY,
    description:
      "Read the saved data behind a Mingstreet page (for example brief, whats-changed, news, calendar, heatmap, market-map, crowd, history-rhymes, flow, oi, iv-trend, earnings, earnings-week, calls, f13, ai-capex, commodities, overnight, past-day, market, risk, unified-signal-engine, owner-market-brief, historical-data, earnings-forecast, forced-liquidation, bottom-tracker, party-tracker, rotation, levetf, leaps, stocks, quant). Large payloads are trimmed (histories keep their newest rows); use `ticker`, `path` and `max_items` to narrow.",
    inputSchema: {
      type: "object",
      properties: {
        feature_id: { type: "string", description: "Feature id from list_features, e.g. 'brief' or 'earnings-forecast'.", maxLength: 40 },
        ticker: { type: "string", description: "Optional covered symbol: keep only this stock's records.", maxLength: 8 },
        path: { type: "string", description: "Optional dotted path into the payload, e.g. 'current', 'events.0' or 'entries.-1' (last item).", maxLength: 200 },
        dataset: { type: "string", maxLength: 40, description: "Optional extra file behind the page, from list_features `datasets` (default 'main'). Per-stock datasets (calls 'transcript', iv-trend 'iv-history', grade 'fundamentals-history') need `ticker`; per-day datasets (picks 'runs', past-day 'picks-run') take `date`." },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10, description: "Optional YYYY-MM-DD for per-day datasets (default: the newest saved day)." },
        max_items: { type: "integer", minimum: 1, maximum: 100, description: "Max array items per list (default 25)." },
      },
      required: ["feature_id"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const id = String(args.feature_id || "").trim();
      const dataset = args.dataset && args.dataset !== "main" ? String(args.dataset) : null;
      const known = siteCatalog.some((s) => s.id === id);
      if (!known) fail("NOT_FOUND", `Unknown feature "${id}". Call list_features.`);
      if (DEDICATED[id] && !dataset) fail("USE_TOOL", `Read "${id}" with ${DEDICATED[id]}.`);
      const tpl = dataset ? FEATURE_DATASETS[id]?.[dataset] || "" : "";
      const sym = args.ticker ? (tpl.includes("{SYMBOL}") ? coveredSymbol(args.ticker) : normSymbol(args.ticker)) : null;
      if (args.date != null && !tpl.includes("{DATE}")) fail("INVALID_INPUT", "`date` only applies to per-day datasets (picks 'runs', past-day 'picks-run')");
      if (args.date != null && (!DATE_RE.test(args.date) || !Number.isFinite(Date.parse(args.date)))) fail("INVALID_INPUT", "Give `date` as YYYY-MM-DD");
      let key = datasetKey(id, dataset, sym, args.date);
      if (!key) {
        if (dataset) fail("NOT_FOUND", `"${id}" has no dataset "${dataset}". Options: ${["main", ...Object.keys(FEATURE_DATASETS[id] || {})].join(", ")}`);
        fail("NO_DATA_PAYLOAD", `"${id}" is a reference page without a saved data payload.`);
      }
      const pageOwner = featureAccess(id, FEATURE_KEYS[id]) === OWNER;
      if ((pageOwner || isPremiumKey(sampleKey(key))) && !ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required for this feature");
      let read;
      if (key.includes("{DATE}")) { read = await readDatedKey(ctx, key, null); key = read.key; }
      else if (DEFAULT_PAYLOADS[key]) {
        try { read = await readKey(ctx, key); }
        catch (err) {
          if (!(err instanceof ToolError) || err.code !== "DATA_UNAVAILABLE") throw err;
          read = { payload: await DEFAULT_PAYLOADS[key](), owner: true };
        }
      } else read = await readKey(ctx, key);
      const { payload, owner } = read;
      let data = getPath(payload, args.path);
      const warnings = [];
      const perStock = Boolean(dataset && FEATURE_DATASETS[id]?.[dataset]?.includes("{SYMBOL}"));
      if (sym && !perStock) {
        const matches = findTicker(data, sym);
        if (!matches.length) warnings.push(`NO_TICKER_MATCH: this feature has no records for ${sym}.`);
        data = { ticker: sym, matches };
      }
      const bounded = boundedJson(data, { maxItems: args.max_items, pathBase: sym && !perStock ? null : String(args.path || "").split(".").filter(Boolean).join(".") });
      if (bounded.reduced) warnings.push("TRIMMED: long lists, long text and large series were shortened; each cut says where to read the rest. Narrow with `path`, `ticker` or `max_items`.");
      return envelope(ctx, { tool: "get_feature", source: { feature_id: id, dataset: dataset || "main", key, page: `/?tab=${id}` }, payload, owner: owner || pageOwner, warnings, results: bounded.value });
    },
  },
  {
    name: "get_stock",
    title: "Research one stock",
    audience: OWNER,
    description:
      "One covered stock in depth from its saved research file: technicals, IV regime, fundamentals, earnings history, catalysts, news take and more. Without `sections` it returns the compact sections and lists the larger ones you can request.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", maxLength: 8, description: "Covered symbol, e.g. NVDA." },
        sections: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 12, description: "Optional top-level sections to return in full (names come from available_sections)." },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const sym = coveredSymbol(args.ticker);
      const { payload, owner } = await readKey(ctx, `${sym}.json`);
      const sizes = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v) || "")]));
      // Series and chains are too large to send here; their own tools page them.
      const elsewhere = (k) => (/^(chains?|options|expirations)$/.test(k) ? "get_option_chain" : HEAVY_KEYS.has(k) ? "get_price_history" : null);
      const available = Object.entries(sizes).filter(([k]) => !SECRET_KEY_RE.test(k)).map(([k, bytes]) => ({ section: k, bytes, ...(elsewhere(k) ? { read_with: elsewhere(k) } : {}) }));
      let picked;
      const warnings = [];
      if (Array.isArray(args.sections) && args.sections.length) {
        picked = {};
        for (const s of args.sections) {
          if (SECRET_KEY_RE.test(s)) continue;
          if (!(s in payload)) warnings.push(`UNKNOWN_SECTION: ${s}`);
          else if (elsewhere(s)) warnings.push(`USE_TOOL: read "${s}" with ${elsewhere(s)}.`);
          else picked[s] = payload[s];
        }
      } else {
        picked = {};
        for (const [k, bytes] of Object.entries(sizes)) if (bytes <= 6000 && !HEAVY_KEYS.has(k) && !SECRET_KEY_RE.test(k)) picked[k] = payload[k];
        warnings.push("COMPACT_VIEW: larger sections are listed in available_sections; request them with `sections`. Price bars come from get_price_history and option chains from get_option_chain.");
      }
      const bounded = boundedJson(picked);
      if (bounded.reduced) warnings.push("TRIMMED: long lists and long text were shortened.");
      // Booms & busts credit read for this stock (Owner file, optional): its
      // buildout role, model five-year default chance and reported CDS quotes.
      let credit = null;
      try {
        const hr = (await readKey(ctx, "history-rhymes-owner.json")).payload;
        const row = [...(Array.isArray(hr?.buildout) ? hr.buildout : []), ...(Array.isArray(hr?.others) ? hr.others : [])].find((r) => r?.symbol === sym);
        if (row) credit = { as_of: hr.asOf ?? null, built_at: hr.builtAtIso ?? null, market_stage: hr.stage?.label ?? null, ...row, page: "/?tab=history-rhymes&view=stocks", note: "Equity-implied (Merton) model, not a market CDS quote. Research only." };
      } catch { credit = null; }
      return envelope(ctx, {
        tool: "get_stock",
        source: { key: `${sym}.json`, page: `/?tab=grade&s=${sym}` },
        payload,
        owner: true,
        warnings,
        results: { ticker: sym, available_sections: available, data: bounded.value, ...(credit ? { credit_read: credit } : {}) },
      });
    },
  },
  {
    name: "get_price_history",
    title: "Daily or intraday price bars",
    audience: ANY,
    description: "Recent OHLCV bars for a covered symbol from the saved series: daily (up to 252 sessions) or 30-minute intraday (up to ~22 sessions).",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", maxLength: 8 },
        interval: { type: "string", enum: ["daily", "30m"], description: "Default daily." },
        bars: { type: "integer", minimum: 1, maximum: 320, description: "How many most-recent bars (default 60)." },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const sym = coveredSymbol(args.ticker);
      const { payload } = await readKey(ctx, `${sym}.json`);
      const series = args.interval === "30m" ? payload.intradaySeries : payload.priceSeries;
      if (!series || !Array.isArray(series.c)) fail("DATA_UNAVAILABLE", "No saved price series for this symbol yet");
      const n = Math.min(Number(args.bars) || 60, series.c.length, 320);
      const start = series.c.length - n;
      const rows = [];
      for (let i = start; i < series.c.length; i++) rows.push({ t: series.t?.[i] ?? null, o: series.o?.[i] ?? null, h: series.h?.[i] ?? null, l: series.l?.[i] ?? null, c: series.c[i], v: series.v?.[i] ?? null });
      return envelope(ctx, {
        tool: "get_price_history",
        source: { key: `${sym}.json`, field: args.interval === "30m" ? "intradaySeries" : "priceSeries" },
        payload,
        owner: false,
        limitations: ["Yahoo-derived bars rounded to cents; adjustment for splits and dividends follows Yahoo and is not independently verified."],
        results: { ticker: sym, interval: args.interval === "30m" ? "30m" : "daily", currency: "USD", bars: rows },
      });
    },
  },
  {
    name: "get_option_chain",
    title: "Option chain for a stock",
    audience: ANY,
    description:
      "A covered stock's saved option chain from the last site build (Yahoo, strikes within the site's band around spot): bid, ask, mid, last, implied volatility, open interest and volume for calls and puts at one expiration, nearest strikes to spot first. Lists every saved expiration. Not live: use get_live_quotes for the current stock price.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", maxLength: 8 },
        expiry: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10, description: "YYYY-MM-DD from `expirations` (default: the first one at least 7 days out)." },
        side: { type: "string", enum: ["call", "put", "both"], description: "Default both." },
        strikes: { type: "integer", minimum: 1, maximum: 60, description: "Strikes nearest to spot per side (default 12)." },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const sym = coveredSymbol(args.ticker);
      const { payload } = await readKey(ctx, `${sym}.json`);
      const chains = payload.chains && typeof payload.chains === "object" ? payload.chains : null;
      const spot = Number(payload.spot);
      const exps = Object.keys(chains || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      if (!chains || !exps.length) fail("DATA_UNAVAILABLE", `No saved option chain for ${sym} yet`);
      const day = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
      const dte = (sec) => Math.round((sec * 1000 - ctx.now()) / 86_400_000);
      let exp;
      if (args.expiry) {
        exp = exps.find((x) => day(x) === args.expiry);
        if (exp == null) fail("NOT_FOUND", `No saved ${sym} expiration on ${args.expiry}. Saved: ${exps.map(day).join(", ")}`);
      } else exp = exps.find((x) => dte(x) >= 7) ?? exps[exps.length - 1];
      const n = Math.min(args.strikes ?? 12, 60);
      const r = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(d)));
      const rows = (list) => (Array.isArray(list) ? list : [])
        .filter((c) => Number.isFinite(Number(c?.s)))
        .sort((a, b) => Math.abs(a.s - spot) - Math.abs(b.s - spot))
        .slice(0, n)
        .sort((a, b) => a.s - b.s)
        .map((c) => ({
          strike: c.s, bid: r(c.b), ask: r(c.a), mid: c.b != null && c.a != null && c.a > 0 ? r((c.b + c.a) / 2) : null, last: r(c.l),
          iv: r(c.iv, 4), oi: c.oi ?? null, volume: c.v ?? null, moneyness_pct: Number.isFinite(spot) && spot > 0 ? r((c.s / spot - 1) * 100, 1) : null,
        }));
      const side = args.side || "both";
      const chain = chains[exp] || {};
      return envelope(ctx, {
        tool: "get_option_chain",
        source: { key: `${sym}.json`, field: "chains", page: `/?tab=stock&s=${sym}` },
        payload,
        owner: false,
        limitations: ["Saved at the last site build, not live. Yahoo bids and asks can be stale or zero outside market hours; check your broker before trading."],
        results: {
          ticker: sym,
          spot: Number.isFinite(spot) ? spot : null,
          spot_as_of: payload.quoteAsOf ?? null,
          expirations: exps.map((x) => ({ date: day(x), dte: dte(x) })),
          expiry: day(exp),
          dte: dte(exp),
          calls: side === "put" ? undefined : rows(chain.c),
          puts: side === "call" ? undefined : rows(chain.p),
        },
      });
    },
  },
  {
    name: "get_stock_grades",
    title: "Grades for every covered stock",
    audience: OWNER,
    description: "Mingstreet's 4-pillar grade for every covered stock (total score, side, conviction, tier, pillars, RSI, IV percentile, sector, news sentiment), sorted. Use it to screen.",
    inputSchema: {
      type: "object",
      properties: {
        sort_by: { type: "string", enum: ["conviction", "total", "ivPctile", "rsi", "symbol"], description: "Default conviction (strongest first)." },
        side: { type: "string", enum: ["call", "put", "any"], description: "Keep only call-side or put-side names. Default any." },
        sector: { type: "string", maxLength: 60, description: "Optional sector filter (case-insensitive substring)." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 40." },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      const { payload } = await readKey(ctx, "grades.json");
      const flat = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([, v]) => v == null || typeof v !== "object")) : o ?? null);
      let rows = Object.values(payload.grades || {}).map((g) => ({
        symbol: g.symbol, side: g.side ?? null, total: g.total ?? null, conviction: g.conviction ?? null,
        tier: g.recommendation?.tier ?? null, recommendation: flat(g.recommendation),
        pillars: g.pillars && typeof g.pillars === "object" ? Object.fromEntries(Object.entries(g.pillars).map(([k, v]) => [k, v && typeof v === "object" ? (v.score ?? v.total ?? flat(v)) : v])) : null,
        spot: g.spot ?? null, sector: g.sector ?? null, rsi: g.rsi ?? null, ivPctile: g.ivPctile ?? null,
        sentiment: flat(g.sentiment), streak: g.streak ?? null,
      }));
      if (args.side && args.side !== "any") rows = rows.filter((r) => r.side === args.side);
      if (args.sector) rows = rows.filter((r) => String(r.sector || "").toLowerCase().includes(String(args.sector).toLowerCase()));
      const key = args.sort_by || "conviction";
      rows.sort((a, b) => (key === "symbol" ? String(a.symbol).localeCompare(String(b.symbol)) : (Number(b[key]) || -Infinity) - (Number(a[key]) || -Infinity)));
      const limit = Math.min(Number(args.limit) || 40, 100);
      const bounded = boundedJson(rows.slice(0, limit), { maxItems: 100 });
      return envelope(ctx, {
        tool: "get_stock_grades",
        source: { key: "grades.json", page: "/?tab=tickers" },
        payload,
        owner: true,
        warnings: bounded.reduced ? ["TRIMMED: some fields were shortened."] : [],
        limitations: ["The 4-pillar score leans bullish by design. Call/Put thresholds are ±4 / ±7."],
        results: {
          grade_model_version: payload.gradeModelVersion ?? null,
          regime_band: payload.regimeBand ?? null,
          min_conviction: payload.minConviction ?? null,
          count: rows.length,
          rows: bounded.value,
        },
      });
    },
  },
  {
    name: "get_live_quotes",
    title: "Live quotes",
    audience: ANY,
    description: "Live (or latest extended-hours) Yahoo quotes for up to 10 covered symbols: price, previous close, change, volume, market state.",
    inputSchema: {
      type: "object",
      properties: { tickers: { type: "array", items: { type: "string", maxLength: 8 }, minItems: 1, maxItems: LIVE_QUOTE_MAX } },
      required: ["tickers"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const list = Array.isArray(args.tickers) ? [...new Set(args.tickers.map(coveredSymbol))] : [];
      if (!list.length || list.length > LIVE_QUOTE_MAX) fail("INVALID_INPUT", `Give 1-${LIVE_QUOTE_MAX} covered symbols`);
      const fetchQuote = ctx.fetchQuote || (await import("../yahoo.mjs")).fetchQuote;
      const quotes = await Promise.all(
        list.map(async (s) => {
          try {
            return { symbol: s, ...(await fetchQuote(s)) };
          } catch {
            return { symbol: s, error: "quote unavailable" };
          }
        }),
      );
      return envelope(ctx, {
        tool: "get_live_quotes",
        source: { provider: "Yahoo Finance via the site's quote helper", live: true },
        payload: { builtAtIso: new Date(ctx.now()).toISOString() },
        owner: false,
        limitations: ["Yahoo quotes can be delayed and are for research only; check your broker before trading."],
        results: { quotes },
      });
    },
  },
  {
    name: "get_top_picks",
    title: "Current Top Picks",
    audience: OWNER,
    description:
      "The current Top Picks as the Owner Top Picks tab shows them, including today's live market approval check: one compact row per pick (side, score, group, AI grade, strategy, contract, entry plan, market approval) plus the run's gates. Pass `symbol` for one pick in full detail. Owner only.",
    inputSchema: {
      type: "object",
      properties: {
        max_items: { type: "integer", minimum: 1, maximum: 50, description: "How many picks (default 10)." },
        symbol: { type: "string", maxLength: 8, description: "Optional: return this one pick in full (thesis card, pillars, drivers, contract, entry checks)." },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      // The site's approval step also saves its market holds (read by the
      // Webull mirror). Here it runs on a throwaway overlay, so an agent sees
      // the same answer but can never change what the site or mirror does.
      const { approvedTopPicks } = await import("../top-picks-approval.mjs");
      const fetchLive = ctx.topPicksLive || (await import("../../api/top-picks.js")).topPicksLiveQuotes;
      const approved = await approvedTopPicks({ store: dryRunStore(ctx.store), fetchLive, now: ctx.now });
      if (!approved) fail("DATA_UNAVAILABLE", "Top Picks are not available yet");
      const picks = Array.isArray(approved.picks) ? approved.picks : [];
      const warnings = [];
      const limitations = [
        "Model output from Mingstreet's Top Picks engine. Paper research; contracts and marks come from the last Top Picks run.",
        "The live market check is a read-only preview: it is not saved and does not affect the site or the Webull paper mirror.",
      ];
      const source = { key: "picks.json", page: "/?tab=picks", live_approval: true };
      if (args.symbol) {
        const sym = normSymbol(args.symbol);
        const matches = picks.filter((p) => p.symbol === sym);
        if (!matches.length) fail("NOT_FOUND", `${sym} is not on the current Top Picks list. get_near_misses shows what stopped other names.`);
        const bounded = boundedJson(matches.length === 1 ? matches[0] : matches);
        if (bounded.reduced) warnings.push("TRIMMED: long lists and long text were shortened.");
        return envelope(ctx, { tool: "get_top_picks", source, payload: approved, owner: true, warnings, limitations, results: { built_at: approved.builtAtIso ?? null, market_checked_at: approved.marketCheckedAt ?? null, pick: bounded.value } });
      }
      const n = Math.min(args.max_items ?? 10, 50);
      const rows = picks.slice(0, n).map(compactPick);
      const meta = approved.rosterMeta || {};
      const gates = {};
      for (const [k, v] of Object.entries(meta)) if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" || (x && typeof x === "object" && typeof (x.sym || x.symbol) === "string"))) gates[k] = v.map((x) => (typeof x === "string" ? x : x.sym || x.symbol));
      const regime = meta.macroRegime || {};
      const shared = approved.sharedResearch?.picks;
      const bounded = boundedJson({
        built_at: approved.builtAtIso ?? null,
        market_checked_at: approved.marketCheckedAt ?? null,
        market_confirmation_pending: approved.marketConfirmationPending === true || undefined,
        model: { model_epoch: meta.modelEpoch ?? null, grade_model: meta.gradeModelVersion ?? null, entry_policy: meta.entryPolicyVersion ?? approved.entryPolicyVersion ?? null, structure_policy: meta.structurePolicy ?? null },
        thresholds: { min_conviction: meta.minConviction ?? approved.minConviction ?? null, trade_cut: meta.tradeCut ?? null, strong_cut: meta.strongCut ?? null, actionable_bar: meta.actionableBar ?? null },
        market: { regime_band: meta.regimeBand ?? null, state: regime.state ?? null, summary: regime.summary ?? null, stress: regime.stress ?? null, drivers: regime.drivers ?? [] },
        total_picks: picks.length,
        actionable: picks.filter((p) => p.group === "actionable").length,
        picks: rows,
        gated_names: gates,
        without_market_check: Array.isArray(shared) ? shared.map((p) => ({ symbol: p.symbol, side: p.side, total: p.total ?? null, group: p.group ?? null, classification: p.classification ?? null })) : undefined,
      }, { maxBytes: RESULT_MAX_BYTES });
      if (bounded.reduced) warnings.push("TRIMMED: long lists and long text were shortened. Pass `symbol` for one pick in full.");
      if (picks.length > n) warnings.push(`MORE_PICKS: ${picks.length - n} more picks; raise max_items to see them.`);
      return envelope(ctx, { tool: "get_top_picks", source, payload: approved, owner: true, warnings, limitations, results: bounded.value });
    },
  },
  {
    name: "get_near_misses",
    title: "Why no picks today",
    audience: OWNER,
    description: "The names that came closest to a Top Pick in the last run and the rule that stopped each (the Top Picks tab's \"Why no picks today\" card), plus how many names each rule stopped. Owner only.",
    inputSchema: { type: "object", properties: { max_items: { type: "integer", minimum: 1, maximum: 20, description: "How many near misses (default 5)." } }, additionalProperties: false },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      const [{ noPicksFactory }, { pickDisplayDecision }, { approvedTopPicks }] = await Promise.all([
        import("../no-picks.mjs"), import("../research-display.mjs"), import("../top-picks-approval.mjs"),
      ]);
      // Same roster as the tab (the live market approval on a throwaway
      // overlay, as in get_top_picks); the saved run if that is unavailable.
      let picks = null;
      try {
        const fetchLive = ctx.topPicksLive || (await import("../../api/top-picks.js")).topPicksLiveQuotes;
        picks = await approvedTopPicks({ store: dryRunStore(ctx.store), fetchLive, now: ctx.now });
      } catch { picks = null; }
      if (!picks) picks = (await readKey(ctx, "picks.json")).payload;
      let grades = null;
      try { grades = (await readKey(ctx, "grades.json")).payload; } catch { grades = null; }
      const nm = noPicksFactory().nearMisses(picks, grades, { n: args.max_items ?? 5, isReady: (p) => pickDisplayDecision(p).ready });
      return envelope(ctx, {
        tool: "get_near_misses",
        source: { key: "picks.json", page: "/?tab=picks" },
        payload: picks,
        owner: true,
        warnings: nm.traced ? [] : ["NO_TRACE: this run saved no rule trace; near misses come from the grades only."],
        limitations: [
          "Each name shows only the first rule that stopped it in that run; other rules might also have stopped it.",
          "Scores are the 4-pillar grade, which leans bullish by design.",
        ],
        results: {
          built_at: nm.builtAtIso,
          ready_to_buy: nm.readyCount,
          listed: nm.listed,
          score_bar: nm.bar,
          near_misses: nm.misses,
          stopped_by_rule: nm.gates,
        },
      });
    },
  },
  {
    name: "get_track_record",
    title: "Top Picks track record",
    audience: OWNER,
    description: "The Top Picks track record: summary stats, open trades (with IDs, entries and marks) and recent closes. Owner only; never public.",
    inputSchema: {
      type: "object",
      properties: { recent_closed: { type: "integer", minimum: 0, maximum: 50, description: "How many most recent closed trades to include (default 15)." } },
      additionalProperties: false,
    },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      const [{ readSiteRecord }, tradeText, { computePicksAccuracyStats }] = await Promise.all([
        import("../track-record-reset.mjs"), import("../pick-trade-text.mjs"), import("../track-record-stats.mjs"),
      ]);
      const { buildPicksFeedText } = tradeText;
      const acc = (await readSiteRecord(ctx.store, "picks-accuracy.json")) || {};
      const open = Array.isArray(acc.open) ? acc.open : [];
      const closed = Array.isArray(acc.closed) ? acc.closed : [];
      const stats = acc.stats || computePicksAccuracyStats(open, closed, acc.builtAtIso || null);
      const n = Math.min(args.recent_closed ?? 15, 50);
      const recent = [...closed].sort((a, b) => String(b.exitDate || "").localeCompare(String(a.exitDate || ""))).slice(0, n);
      // Compact rows: the full records carry mark histories and audit blocks
      // that would blow the result budget before the first few trades.
      const row = (e) => compactTrade(e, tradeText);
      const bounded = boundedJson({ stats, all_time_stats: acc.allTimeStats || undefined, open_trades: open.map(row), recent_closed: recent.map(row) }, { maxBytes: RESULT_MAX_BYTES - 12_000 });
      let text = "";
      try { text = buildPicksFeedText(acc, { nowMs: ctx.now() }); } catch { text = ""; }
      return envelope(ctx, {
        tool: "get_track_record",
        source: { key: "picks-accuracy.json", page: "/?tab=track" },
        payload: acc,
        owner: true,
        warnings: bounded.reduced ? ["TRIMMED: long lists were shortened."] : [],
        limitations: ["Private Owner record. Do not share outside your own research."],
        results: { open_count: open.length, closed_count: closed.length, ...bounded.value, trade_lines: text.slice(0, 10_000) },
      });
    },
  },
];

// ChatGPT deep research and connectors that only call `search` and `fetch`
// (OpenAI's MCP shape): plain results, no envelope. Both reuse the tools above.
TOOLS.push(
  {
    name: "search",
    title: "Search Mingstreet",
    audience: ANY,
    plain: true,
    description:
      "Search Mingstreet's research pages and covered stocks by keyword (a company, ticker, sector or topic such as 'earnings', 'options flow', 'rates'). Returns ids for `fetch`.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 200, description: "Words to look for." } },
      required: ["query"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const words = String(args.query || "").toLowerCase().split(/[^a-z0-9.&-]+/).filter((w) => w.length >= 2).slice(0, 12);
      if (!words.length) fail("INVALID_INPUT", "Give at least one word to search for");
      const names = await stockNames(ctx);
      const items = [
        ...featureList(ctx.principal).map((f) => ({ id: `feature:${f.id}`, title: `${f.label} (${f.category})`, url: `${ctx.origin}${f.page}`, hay: `${f.id} ${f.label} ${f.category} ${f.description}`.toLowerCase(), sym: null })),
        ...researchUniverse.map((sym) => {
          const n = names.get(sym) || {};
          return { id: `stock:${sym}`, title: n.name ? `${sym}: ${n.name}` : sym, url: `${ctx.origin}/?tab=stock&s=${sym}`, hay: `${sym} ${n.name || ""} ${n.sector || ""} ${n.industry || ""} stock`.toLowerCase(), sym: sym.toLowerCase() };
        }),
      ];
      const scored = items
        .map((it) => ({ it, score: words.reduce((a, w) => a + (it.sym === w ? 5 : it.hay.includes(w) ? 1 : 0), 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title))
        .slice(0, 12);
      return { results: scored.map(({ it }) => ({ id: it.id, title: it.title, url: it.url })) };
    },
  },
  {
    name: "fetch",
    title: "Fetch a Mingstreet search result",
    audience: ANY,
    plain: true,
    description: "Read one result from `search` by its id (feature:<id> or stock:<TICKER>): the page's saved data, or the stock's research, as JSON text.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", maxLength: 60, pattern: "^(feature:[a-z0-9-]{1,40}|stock:[A-Za-z][A-Za-z0-9.]{0,5})$", description: "An id from search." } },
      required: ["id"],
      additionalProperties: false,
    },
    async run(ctx, args) {
      const [kind, rest] = String(args.id).split(/:(.*)/s);
      const tool = (name) => TOOLS.find((t) => t.name === name);
      let env, title, url, f;
      if (kind === "feature") {
        f = featureList(ctx.principal).find((x) => x.id === rest);
        if (!f) fail("NOT_FOUND", `Unknown id ${args.id}`);
        title = f.label;
        url = `${ctx.origin}${f.page}`;
        if (f.read_with === "get_feature") env = await tool("get_feature").run(ctx, { feature_id: f.id, max_items: 15 });
        else if (f.read_with && toolsFor(ctx.principal, ctx.env).some((t) => t.name === f.read_with)) env = await tool(f.read_with).run(ctx, {});
        else env = { results: { description: f.description, note: "Reference page without saved data." } };
      } else {
        const sym = coveredSymbol(rest);
        const names = await stockNames(ctx);
        title = names.get(sym)?.name ? `${sym}: ${names.get(sym).name}` : sym;
        url = `${ctx.origin}/?tab=stock&s=${sym}`;
        env = ctx.principal.owner ? await tool("get_stock").run(ctx, { ticker: sym }) : await tool("get_price_history").run(ctx, { ticker: sym, bars: 30 });
      }
      const text = JSON.stringify(env.results ?? env);
      // fetch takes only an id, so point trimmed reads at the tool that can narrow them.
      const more = kind === "feature"
        ? (f.read_with === "get_feature" ? `get_feature with feature_id "${f.id}" and \`path\`, \`ticker\` or \`max_items\`` : f.read_with)
        : ctx.principal.owner ? `get_stock with \`sections\`` : "get_price_history";
      const warnings = (env.warnings ?? []).map((w) => (/^TRIMMED/.test(w) ? `TRIMMED: shortened for fetch. Read more with ${more}.` : w));
      return { id: args.id, title, text, url, metadata: { as_of: env.as_of ?? null, source: env.source ?? null, warnings } };
    },
  },
);

// Company names and sectors for search, from the public heatmap payload.
async function stockNames(ctx) {
  const out = new Map();
  try {
    const { payload } = await readKey(ctx, "heatmap.json");
    for (const row of Array.isArray(payload?.tickers) ? payload.tickers : []) {
      if (row?.t) out.set(String(row.t), { name: row.n || null, sector: row.s || null, industry: row.i || null });
    }
  } catch { /* names are optional */ }
  return out;
}

// Owner Sports (lib/mcp/sports-tools.mjs): read-only, own store handle.
TOOLS.push(...sportsTools({ fail, envelope, boundedJson, ToolError }));

// One Top Picks row with the fields a reader acts on; the full pick (thesis
// card, pillars, drivers, checks) comes back with get_top_picks `symbol`.
function compactPick(p) {
  if (!p || typeof p !== "object") return p;
  const c = p.contract || {};
  const e = p.entry || {};
  const pick = (o, keys) => (o && typeof o === "object" ? Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) : null);
  return {
    symbol: p.symbol, side: p.side, total: p.total ?? null, conviction: p.conviction ?? null, trade_score: p.tradeScore ?? null,
    group: p.group ?? null, classification: p.classification ?? null, tier: p.recommendation?.label ?? p.recommendation?.tier ?? null,
    sector: p.sector ?? null, spot: p.spot ?? null, first_seen: p.firstSeen ?? null,
    ai_grade: pick(p.finalGrade, ["tier", "score", "source", "confidence", "reason"]),
    analysis: p.analysis ?? null,
    strategy: pick(p.strategy, ["type", "label", "reason", "ivPctile", "ivTier"]),
    contract: pick(c, ["structure", "optionType", "strike", "longStrike", "shortStrike", "expiryLabel", "dte", "bid", "ask", "mid", "netDebit", "netCredit", "maxLoss", "maxProfit", "iv", "delta", "oi", "volume", "spreadPct", "breakeven", "breakevenMovePct", "expectedMovePct", "pop"]),
    entry: pick(e, ["now", "signal", "headline", "basis", "trigger", "zone", "invalidation", "target", "rr"]),
    market_approval: pick(p.marketApproval, ["held", "reason", "checkedAt"]),
    macro_fit: pick(p.macroFit, ["points", "kindLabel"]),
    event_play: p.eventPlay ?? null,
    invalidators: Array.isArray(p.thesisCard?.invalidators) ? p.thesisCard.invalidators.slice(0, 5) : undefined,
  };
}

function compactTrade(e, { pickTradeId, entryPrice, markPrice, CLOSE_REASON = {} }) {
  if (!e || typeof e !== "object") return e;
  const c = e.contract || {};
  const r = (v, d = 2) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(Number(v).toFixed(d)) : undefined);
  return {
    id: pickTradeId(e),
    symbol: e.symbol,
    side: e.side,
    status: e.status || (e.exitDate ? "closed" : "open"),
    close_reason: e.exitDate || e.status !== "open" ? CLOSE_REASON[e.status] : undefined,
    structure: c.structure || "long",
    expiry: Number.isFinite(c.expiry) ? new Date(c.expiry * 1000).toISOString().slice(0, 10) : undefined,
    strike: r(c.strike), long_strike: r(c.longStrike), short_strike: r(c.shortStrike),
    entry_price: r(entryPrice(e)), mark_price: r(markPrice(e)),
    option_pnl_pct: r(e.optionPnlPct, 1),
    entry_spot: r(e.entrySpot), last_spot: r(e.lastSpot),
    entry_date: e.entryDate, exit_date: e.exitDate || undefined,
    conviction: r(e.conviction, 1), grade_model: e.gradeModelVersion || undefined,
    counted: e.countsTowardStats === false || e.status === "left-coverage" ? false : undefined,
  };
}

export function toolsFor(principal, env = {}) {
  return TOOLS.filter((t) => (t.audience === ANY || (t.audience === OWNER && principal.owner)) && !(t.sports && env.SPORTS_ENABLED === "0"));
}

// The schema sent to clients keeps to the JSON Schema subset every major
// client accepts (OpenAI, Anthropic, Gemini's function declarations): map
// limits such as propertyNames / maxProperties stay server-side checks only.
const NON_PORTABLE_KEYWORDS = new Set(["propertyNames", "maxProperties", "minProperties", "$schema", "$id"]);
export function portableSchema(schema) {
  if (Array.isArray(schema)) return schema.map(portableSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (NON_PORTABLE_KEYWORDS.has(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v).map(([p, ps]) => [p, portableSchema(ps)])) : portableSchema(v);
  }
  return out;
}

export function toolDefinition(t) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: portableSchema(t.inputSchema),
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.name === "get_live_quotes" },
  };
}

// Minimal JSON Schema check for the shapes the tools use: objects (unknown
// fields rejected, or a typed map with `additionalProperties`), strings,
// integers, numbers, booleans, enums, patterns and arrays of either strings or
// objects. Nesting is checked the same way.
//
// Models and clients differ in how they send values, so obvious forms are
// accepted before the check: a JSON string for the whole arguments object,
// "5" for an integer, "true" for a boolean, "NVDA, AMD" or "NVDA" for a list
// of strings, one object for a list of objects, and null or "" for an
// optional argument left out. Errors name the allowed arguments so a model
// can correct itself.
export function validateArgs(schema, args, where = "") {
  if (args == null || args === "") args = {};
  if (typeof args === "string" && !where) {
    try { args = JSON.parse(args); } catch { fail("INVALID_INPUT", "Arguments must be a JSON object"); }
    if (args == null) args = {};
  }
  if (typeof args !== "object" || Array.isArray(args)) fail("INVALID_INPUT", `${where || "Arguments"} must be an object`);
  const props = schema.properties || {};
  const required = new Set(schema.required || []);
  const at = (k) => (where ? `${where}.${k}` : k);
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (!Object.hasOwn(props, k)) {
      const allowed = Object.keys(props);
      fail("INVALID_INPUT", `Unknown argument "${at(k)}"; ${allowed.length ? `allowed: ${allowed.join(", ")}` : "this tool takes no arguments"}`);
    }
    if (v == null || (v === "" && !required.has(k))) continue;
    out[k] = coerceValue(props[k], v);
  }
  for (const r of required) if (out[r] == null || out[r] === "") fail("INVALID_INPUT", `Missing argument "${at(r)}"`);
  for (const [k, p] of Object.entries(props)) if (out[k] != null) out[k] = checkValue(p, out[k], at(k)) ?? out[k];
  return out;
}

function coerceValue(p, v) {
  if (!p || typeof p !== "object") return v;
  if ((p.type === "integer" || p.type === "number") && typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  if (p.type === "boolean" && typeof v === "string" && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === "true";
  if (p.type === "string" && typeof v === "number" && Number.isFinite(v) && !p.enum) return String(v);
  if (p.type === "array") {
    if (typeof v === "string") {
      const t = v.trim();
      if (t.startsWith("[")) { try { const a = JSON.parse(t); if (Array.isArray(a)) return a; } catch { /* fall through */ } }
      if (p.items?.type !== "object") return t.split(",").map((x) => x.trim()).filter(Boolean);
    }
    if (v && typeof v === "object" && !Array.isArray(v) && p.items?.type === "object") return [v];
  }
  if (p.type === "object" && typeof v === "string" && v.trim().startsWith("{")) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function checkValue(p, v, k) {
  if (p.type === "string") {
    if (typeof v !== "string") fail("INVALID_INPUT", `"${k}" must be a string`);
    if (p.maxLength && v.length > p.maxLength) fail("INVALID_INPUT", `"${k}" is too long`);
    if (p.enum && !p.enum.includes(v)) fail("INVALID_INPUT", `"${k}" must be one of ${p.enum.join(", ")}`);
    if (p.pattern && !new RegExp(p.pattern).test(v)) fail("INVALID_INPUT", `"${k}" is not in the expected form`);
  } else if (p.type === "integer" || p.type === "number") {
    if (p.type === "integer" ? !Number.isInteger(v) : typeof v !== "number" || !Number.isFinite(v)) fail("INVALID_INPUT", `"${k}" must be ${p.type === "integer" ? "an integer" : "a number"}`);
    if (p.minimum != null && v < p.minimum) fail("INVALID_INPUT", `"${k}" must be at least ${p.minimum}`);
    if (p.maximum != null && v > p.maximum) fail("INVALID_INPUT", `"${k}" must be at most ${p.maximum}`);
  } else if (p.type === "boolean") {
    if (typeof v !== "boolean") fail("INVALID_INPUT", `"${k}" must be true or false`);
  } else if (p.type === "array") {
    if (!Array.isArray(v)) fail("INVALID_INPUT", `"${k}" must be an array`);
    if (p.maxItems && v.length > p.maxItems) fail("INVALID_INPUT", `"${k}" has too many items (at most ${p.maxItems})`);
    if (p.minItems && v.length < p.minItems) fail("INVALID_INPUT", `"${k}" needs at least ${p.minItems} item(s)`);
    if (p.items?.type === "object") return v.map((x, i) => validateArgs(p.items, x, `${k}.${i}`));
    else if (v.some((x) => typeof x !== "string" || (p.items?.maxLength && x.length > p.items.maxLength))) fail("INVALID_INPUT", `"${k}" must be a list of short strings`);
  } else if (p.type === "object") {
    if (p.properties) return validateArgs(p, v, k);
    if (p.additionalProperties && typeof p.additionalProperties === "object" && v && typeof v === "object" && !Array.isArray(v)) {
      v = Object.fromEntries(Object.entries(v).map(([key, x]) => [key, coerceValue(p.additionalProperties, x)]));
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) fail("INVALID_INPUT", `"${k}" must be an object`);
    const keys = Object.keys(v);
    if (p.maxProperties && keys.length > p.maxProperties) fail("INVALID_INPUT", `"${k}" has too many entries`);
    for (const key of keys) {
      if (p.propertyNames?.pattern && !new RegExp(p.propertyNames.pattern).test(key)) fail("INVALID_INPUT", `"${k}" has an unexpected key "${key.slice(0, 20)}"`);
      if (p.additionalProperties && typeof p.additionalProperties === "object") checkValue(p.additionalProperties, v[key], `${k}.${key}`);
    }
    return v;
  }
}
