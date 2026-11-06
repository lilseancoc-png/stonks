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

import { SOURCE_KEYS } from "../research-lab/feature-sources.mjs";
import { siteCatalog } from "../research-lab/site-catalog.mjs";
import { researchUniverse } from "../research-lab/universe.mjs";
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
const FEATURE_KEYS = { ...SOURCE_KEYS };
// Extra saved files behind a page, read with get_feature `dataset`. The main
// file is always dataset "main". Values ending in "{SYMBOL}" are per-stock
// files and need `ticker`. Mirrors what each page actually loads
// (scripts/render/app-js.mjs dataUrl calls and export-js.mjs EXPORT_SOURCES).
const FEATURE_DATASETS = {
  "bonds-usd": { history: "macro-history.json" },
  "capital-raises": { "ipo-credit": "ipo-credit.json" },
  "fear-greed": { history: "fear-greed-history.json" },
  calls: { transcript: "transcript-{SYMBOL}.json" },
  earnings: { history: "earnings-history.json" },
  "earnings-week": { plan: "earnings-week-plan.json" },
  "forced-liquidation": { "leverage-distress": "leverage-distress.json" },
  market: { "regime-history": "regime-history.json" },
  narratives: { history: "trends-history.json" },
  overnight: { log: "overnight-log.json", preopen: "overnight-preopen.json" },
  "iv-trend": { "iv-history": "iv-history/{SYMBOL}.json" },
  "unified-signal-engine": { rotation: "sector-rotation.json" },
  rotation: { log: "sector-rotation-log.json" },
  levetf: { log: "leveraged-etfs-log.json" },
  flow: { history: "unusual-history.json", log: "unusual-log.json", explanations: "flow-explanations.json" },
  volume: { history: "volume-history.json" },
  oi: { history: "oi-history.json" },
  grade: { "fundamentals-history": "fundamentals-history/{SYMBOL}.json", research: "grade-research.json", daily: "grades-daily.json" },
  picks: { open: "picks-open.json", raw: "picks.json" },
  track: { changes: "picks-changes.json", roster: "picks-roster.json", "grades-history": "grades-history.json" },
};
function datasetKey(id, dataset, sym) {
  if (!dataset || dataset === "main") return FEATURE_KEYS[id] || null;
  const tpl = FEATURE_DATASETS[id]?.[dataset];
  if (!tpl) return null;
  if (tpl.includes("{SYMBOL}")) {
    if (!sym) fail("INVALID_INPUT", `Dataset "${dataset}" is per stock; pass \`ticker\``);
    return tpl.replace("{SYMBOL}", sym);
  }
  return tpl;
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

function reduceValue(value, opts, depth = 0, keepHeavy = false) {
  const { maxDepth, maxArray, maxString, maxKeys } = opts;
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length > maxString ? value.slice(0, maxString) + "…" : value;
  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `[array of ${value.length}]`;
    return `{object with ${Object.keys(value).length} keys}`;
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, maxArray).map((v) => reduceValue(v, opts, depth + 1, keepHeavy));
    if (value.length > maxArray) out.push(`…${value.length - maxArray} more items`);
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) continue;
      if (!keepHeavy && HEAVY_KEYS.has(k)) {
        out[k] = Array.isArray(v) ? `[omitted: ${v.length} items]` : "[omitted: large series]";
        continue;
      }
      if (++n > maxKeys) {
        out["…"] = `${Object.keys(value).length - maxKeys} more keys`;
        break;
      }
      out[k] = reduceValue(v, opts, depth + 1, keepHeavy);
    }
    return out;
  }
  return null;
}

const BUDGETS = [
  { maxDepth: 6, maxArray: 25, maxString: 1200, maxKeys: 60 },
  { maxDepth: 5, maxArray: 12, maxString: 600, maxKeys: 40 },
  { maxDepth: 4, maxArray: 6, maxString: 300, maxKeys: 30 },
  { maxDepth: 3, maxArray: 4, maxString: 160, maxKeys: 20 },
  { maxDepth: 2, maxArray: 3, maxString: 120, maxKeys: 15 },
];

export function boundedJson(value, { maxBytes = RESULT_MAX_BYTES, keepHeavy = false, maxItems } = {}) {
  for (let i = 0; i < BUDGETS.length; i++) {
    const budget = { ...BUDGETS[i], ...(maxItems && i === 0 ? { maxArray: maxItems } : {}) };
    const reduced = reduceValue(value, budget, 0, keepHeavy);
    const bytes = Buffer.byteLength(JSON.stringify(reduced));
    if (bytes <= maxBytes) return { value: reduced, reduced: i > 0 || JSON.stringify(reduced) !== JSON.stringify(value) };
  }
  return { value: "[result too large: narrow it with `path` or `ticker`]", reduced: true };
}

function getPath(value, path) {
  if (!path) return value;
  let cur = value;
  for (const part of String(path).split(".").filter(Boolean)) {
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
    if (!Array.isArray(value) && [value.symbol, value.sym, value.ticker].includes(symbol)) {
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
  const t = payload?.builtAtIso || payload?.generatedAtIso || payload?.generatedAt || payload?.asOf || payload?.updatedAt || payload?.current?.builtAtIso || null;
  return typeof t === "string" && Number.isFinite(Date.parse(t)) ? t : null;
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
    results,
  };
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
    .filter((s) => s.id !== "research-lab" && s.id !== "update-checker" && !SPORTS_PAGES.has(s.id))
    .map((s) => {
      const key = FEATURE_KEYS[s.id] || null;
      const access = featureAccess(s.id, key);
      return {
        id: s.id,
        label: s.label,
        category: s.category,
        description: s.description,
        access,
        read_with: DEDICATED[s.id] || (key ? "get_feature" : null),
        datasets: key && !DEDICATED[s.id] ? ["main", ...Object.keys(FEATURE_DATASETS[s.id] || {})] : undefined,
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
      "Read the saved data behind a Mingstreet page (for example brief, news, calendar, heatmap, flow, oi, iv-trend, earnings, calls, f13, ai-capex, commodities, overnight, market, risk, unified-signal-engine, historical-data, earnings-forecast, forced-liquidation, bottom-tracker, rotation, levetf, leaps, stocks, quant). Large payloads are trimmed; use `ticker` and `path` to narrow.",
    inputSchema: {
      type: "object",
      properties: {
        feature_id: { type: "string", description: "Feature id from list_features, e.g. 'brief' or 'earnings-forecast'.", maxLength: 40 },
        ticker: { type: "string", description: "Optional covered symbol: keep only this stock's records.", maxLength: 8 },
        path: { type: "string", description: "Optional dotted path into the payload, e.g. 'current' or 'events.0'.", maxLength: 200 },
        dataset: { type: "string", maxLength: 40, description: "Optional extra file behind the page, from list_features `datasets` (default 'main'). Per-stock datasets (calls 'transcript', iv-trend 'iv-history', grade 'fundamentals-history') need `ticker`." },
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
      const sym = args.ticker ? (dataset && FEATURE_DATASETS[id]?.[dataset]?.includes("{SYMBOL}") ? coveredSymbol(args.ticker) : normSymbol(args.ticker)) : null;
      const key = datasetKey(id, dataset, sym);
      if (!key) {
        if (dataset) fail("NOT_FOUND", `"${id}" has no dataset "${dataset}". Options: ${["main", ...Object.keys(FEATURE_DATASETS[id] || {})].join(", ")}`);
        fail("NO_DATA_PAYLOAD", `"${id}" is a reference page without a saved data payload.`);
      }
      const pageOwner = featureAccess(id, FEATURE_KEYS[id]) === OWNER;
      if ((pageOwner || isPremiumKey(key)) && !ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required for this feature");
      const { payload, owner } = await readKey(ctx, key);
      let data = getPath(payload, args.path);
      const warnings = [];
      const perStock = Boolean(dataset && FEATURE_DATASETS[id]?.[dataset]?.includes("{SYMBOL}"));
      if (sym && !perStock) {
        const matches = findTicker(data, sym);
        if (!matches.length) warnings.push(`NO_TICKER_MATCH: this feature has no records for ${sym}.`);
        data = { ticker: sym, matches };
      }
      const bounded = boundedJson(data, { maxItems: args.max_items });
      if (bounded.reduced) warnings.push("TRIMMED: long lists, long text and large series were shortened. Narrow with `path`, `ticker` or `max_items`.");
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
      const available = Object.entries(sizes).filter(([k]) => !SECRET_KEY_RE.test(k)).map(([k, bytes]) => ({ section: k, bytes }));
      let picked;
      const warnings = [];
      if (Array.isArray(args.sections) && args.sections.length) {
        picked = {};
        for (const s of args.sections) {
          if (SECRET_KEY_RE.test(s)) continue;
          if (!(s in payload)) warnings.push(`UNKNOWN_SECTION: ${s}`);
          else picked[s] = payload[s];
        }
      } else {
        picked = {};
        for (const [k, bytes] of Object.entries(sizes)) if (bytes <= 6000 && !HEAVY_KEYS.has(k) && !SECRET_KEY_RE.test(k)) picked[k] = payload[k];
        warnings.push("COMPACT_VIEW: larger sections are listed in available_sections; request them with `sections`. Price bars come from get_price_history.");
      }
      const bounded = boundedJson(picked);
      if (bounded.reduced) warnings.push("TRIMMED: long lists and long text were shortened.");
      return envelope(ctx, {
        tool: "get_stock",
        source: { key: `${sym}.json`, page: `/?tab=grade&s=${sym}` },
        payload,
        owner: true,
        warnings,
        results: { ticker: sym, available_sections: available, data: bounded.value },
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
    description: "The current Top Picks exactly as the Owner Top Picks tab shows them, including today's live market approval check. Owner only.",
    inputSchema: { type: "object", properties: { max_items: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
    async run(ctx, args) {
      // The site's approval step also saves its market holds (read by the
      // Webull mirror). Here it runs on a throwaway overlay, so an agent sees
      // the same answer but can never change what the site or mirror does.
      const { approvedTopPicks } = await import("../top-picks-approval.mjs");
      const fetchLive = ctx.topPicksLive || (await import("../../api/top-picks.js")).topPicksLiveQuotes;
      const approved = await approvedTopPicks({ store: dryRunStore(ctx.store), fetchLive, now: ctx.now });
      if (!approved) fail("DATA_UNAVAILABLE", "Top Picks are not available yet");
      const bounded = boundedJson(approved, { maxItems: args.max_items });
      return envelope(ctx, {
        tool: "get_top_picks",
        source: { key: "picks.json", page: "/?tab=picks", live_approval: true },
        payload: approved,
        owner: true,
        warnings: bounded.reduced ? ["TRIMMED: long lists and long text were shortened."] : [],
        limitations: [
          "Model output from Mingstreet's Top Picks engine. Paper research; contracts and marks come from the last Top Picks run.",
          "The live market check is a read-only preview: it is not saved and does not affect the site or the Webull paper mirror.",
        ],
        results: bounded.value,
      });
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

// Owner Sports (lib/mcp/sports-tools.mjs): read-only, own store handle.
TOOLS.push(...sportsTools({ fail, envelope, boundedJson, ToolError }));

function compactTrade(e, { pickTradeId, entryPrice, markPrice }) {
  if (!e || typeof e !== "object") return e;
  const c = e.contract || {};
  const r = (v, d = 2) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(Number(v).toFixed(d)) : undefined);
  return {
    id: pickTradeId(e),
    symbol: e.symbol,
    side: e.side,
    status: e.status || (e.exitDate ? "closed" : "open"),
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

export function toolDefinition(t) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.name === "get_live_quotes" },
  };
}

// Minimal JSON Schema check for the shapes the tools use: objects (unknown
// fields rejected, or a typed map with `additionalProperties`), strings,
// integers, numbers, booleans, enums, patterns and arrays of either strings or
// objects. Nesting is checked the same way.
export function validateArgs(schema, args, where = "") {
  if (args == null) args = {};
  if (typeof args !== "object" || Array.isArray(args)) fail("INVALID_INPUT", `${where || "Arguments"} must be an object`);
  const props = schema.properties || {};
  const at = (k) => (where ? `${where}.${k}` : k);
  for (const k of Object.keys(args)) if (!Object.hasOwn(props, k)) fail("INVALID_INPUT", `Unknown argument "${at(k)}"`);
  for (const r of schema.required || []) if (args[r] == null || args[r] === "") fail("INVALID_INPUT", `Missing argument "${at(r)}"`);
  for (const [k, p] of Object.entries(props)) if (args[k] != null) checkValue(p, args[k], at(k));
  return args;
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
    if (p.maxItems && v.length > p.maxItems) fail("INVALID_INPUT", `"${k}" has too many items`);
    if (p.minItems && v.length < p.minItems) fail("INVALID_INPUT", `"${k}" needs at least ${p.minItems} item(s)`);
    if (p.items?.type === "object") v.forEach((x, i) => validateArgs(p.items, x, `${k}.${i}`));
    else if (v.some((x) => typeof x !== "string" || (p.items?.maxLength && x.length > p.items.maxLength))) fail("INVALID_INPUT", `"${k}" must be a list of short strings`);
  } else if (p.type === "object") {
    if (p.properties) return validateArgs(p, v, k);
    if (!v || typeof v !== "object" || Array.isArray(v)) fail("INVALID_INPUT", `"${k}" must be an object`);
    const keys = Object.keys(v);
    if (p.maxProperties && keys.length > p.maxProperties) fail("INVALID_INPUT", `"${k}" has too many entries`);
    for (const key of keys) {
      if (p.propertyNames?.pattern && !new RegExp(p.propertyNames.pattern).test(key)) fail("INVALID_INPUT", `"${k}" has an unexpected key "${key.slice(0, 20)}"`);
      if (p.additionalProperties && typeof p.additionalProperties === "object") checkValue(p.additionalProperties, v[key], `${k}.${key}`);
    }
  }
}
