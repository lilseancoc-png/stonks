// Public GPU / accelerator rental-price tracker.
//
// The collectors deliberately use only provider-published public surfaces:
// - Vast.ai's marketplace search endpoint (live verified rentable offers)
// - CoreWeave's public pricing table (on-demand + spot instance rates)
// - Runpod's public pricing-page JSON-LD (Community + Secure Cloud)
// - Lambda's public on-demand instance table
//
// All prices are normalized to USD per GPU-hour. Provider pages can publish
// either per-GPU or whole-instance rates, so every quote retains gpuCount and
// instancePrice alongside the normalized price. The payload builder carries
// last-good provider rows on a source failure, but never appends stale values
// as fresh history.

const FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SOURCE_TIMEOUT_MS = 20_000;
const HISTORY_MAX_POINTS = 400;

export const ACCELERATOR_SOURCES = Object.freeze({
  vast: {
    id: "vast",
    name: "Vast.ai",
    url: "https://cloud.vast.ai/",
    sourceUrl: "https://console.vast.ai/api/v0/bundles/",
  },
  coreweave: {
    id: "coreweave",
    name: "CoreWeave",
    url: "https://coreweave.com/pricing",
    sourceUrl: "https://coreweave.com/pricing",
  },
  runpod: {
    id: "runpod",
    name: "Runpod",
    url: "https://www.runpod.io/pricing",
    sourceUrl: "https://www.runpod.io/pricing",
  },
  lambda: {
    id: "lambda",
    name: "Lambda",
    url: "https://lambda.ai/instances",
    sourceUrl: "https://lambda.ai/instances",
  },
});

const MODEL_META = Object.freeze({
  b300: { label: "NVIDIA B300", vramGb: 288, rank: 1 },
  gb300: { label: "NVIDIA GB300", vramGb: 279, rank: 2 },
  b200: { label: "NVIDIA B200", vramGb: 180, rank: 3 },
  gb200: { label: "NVIDIA GB200", vramGb: 186, rank: 4 },
  h200: { label: "NVIDIA H200", vramGb: 141, rank: 5 },
  gh200: { label: "NVIDIA GH200", vramGb: 96, rank: 6 },
  h100: { label: "NVIDIA H100", vramGb: 80, rank: 7 },
  a100: { label: "NVIDIA A100 80GB", vramGb: 80, rank: 8 },
  "rtx-pro-6000": { label: "NVIDIA RTX Pro 6000", vramGb: 96, rank: 9 },
  "rtx-6000-ada": { label: "NVIDIA RTX 6000 Ada", vramGb: 48, rank: 10 },
  l40s: { label: "NVIDIA L40S", vramGb: 48, rank: 11 },
  l40: { label: "NVIDIA L40", vramGb: 48, rank: 12 },
  "rtx-5090": { label: "NVIDIA RTX 5090", vramGb: 32, rank: 13 },
  "rtx-4090": { label: "NVIDIA RTX 4090", vramGb: 24, rank: 14 },
  "rtx-3090": { label: "NVIDIA RTX 3090", vramGb: 24, rank: 15 },
  v100: { label: "NVIDIA V100", vramGb: 32, rank: 16 },
});

function finite(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
  const n = finite(value);
  if (n == null) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function median(values) {
  const xs = values.map(finite).filter((v) => v != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&times;|&#215;/g, "×")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function priceNumber(value) {
  const clean = decodeHtml(value).replace(/[$,\s]/g, "");
  if (!clean || /^(?:n\/a|contact|custom|—|-)$/i.test(clean)) return null;
  const match = clean.match(/\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
}

export function canonicalAcceleratorModel(rawName) {
  const raw = decodeHtml(rawName);
  const s = raw.toUpperCase().replace(/[™®]/g, "").replace(/\s+/g, " ");
  let id = null;
  if (/\bGB300\b/.test(s)) id = "gb300";
  else if (/\bB300\b/.test(s)) id = "b300";
  else if (/\bGB200\b/.test(s)) id = "gb200";
  else if (/\bB200\b/.test(s)) id = "b200";
  else if (/\bGH200\b/.test(s)) id = "gh200";
  else if (/\bH200\b/.test(s)) id = "h200";
  else if (/\bH100\b/.test(s)) id = "h100";
  else if (/\bA100\b/.test(s)) id = "a100";
  else if (/RTX\s*(?:PRO\s*)?6000.*(?:BLACKWELL|SERVER|PRO)/.test(s)) id = "rtx-pro-6000";
  else if (/RTX\s*6000.*ADA|6000ADA/.test(s)) id = "rtx-6000-ada";
  else if (/\bL40S\b/.test(s)) id = "l40s";
  else if (/\bL40\b/.test(s)) id = "l40";
  else if (/RTX\s*5090/.test(s)) id = "rtx-5090";
  else if (/RTX\s*4090/.test(s)) id = "rtx-4090";
  else if (/RTX\s*3090/.test(s)) id = "rtx-3090";
  else if (/\bV100\b/.test(s)) id = "v100";
  if (!id) return null;
  return { id, ...MODEL_META[id], rawName: raw };
}

function normalizedQuote({
  providerId,
  provider,
  providerUrl,
  sourceUrl,
  model,
  rawModel,
  market,
  price,
  instancePrice = null,
  gpuCount = 1,
  vramGb = null,
  offerCount = null,
  low = null,
  high = null,
  note = "",
}) {
  const p = finite(price);
  const count = Math.max(1, Math.round(finite(gpuCount) || 1));
  if (!model || p == null || p <= 0 || p >= 1_000) return null;
  return {
    key: `${providerId}|${model.id}|${market}`,
    providerId,
    provider,
    providerUrl,
    sourceUrl,
    modelId: model.id,
    model: model.label,
    rawModel: decodeHtml(rawModel || model.rawName || model.label),
    market,
    price: round(p),
    instancePrice: round(instancePrice == null ? p * count : instancePrice),
    gpuCount: count,
    vramGb: round(vramGb ?? model.vramGb, 1),
    offerCount: offerCount == null ? null : Math.max(0, Math.round(offerCount)),
    low: round(low == null ? p : low),
    high: round(high == null ? p : high),
    note,
  };
}

export function parseCoreweavePricing(html) {
  if (!html) return [];
  const quotes = [];
  const seen = new Set();
  const headerRe = /<h3\s+data-product="([^"]+)"[^>]*class="table-model-name"[^>]*>([\s\S]*?)<\/h3>/gi;
  for (const match of html.matchAll(headerRe)) {
    const productId = match[1];
    if (seen.has(productId)) continue;
    seen.add(productId);
    const rawModel = decodeHtml(match[2]);
    const model = canonicalAcceleratorModel(rawModel);
    if (!model) continue;
    // Each row repeats the heading in its mobile card. Work from the first
    // heading and cap the scan to this row so a missing value cannot bleed
    // into the next accelerator's prices.
    const row = html.slice(match.index, match.index + 5_000);
    const cells = [...row.matchAll(/<div class="table-v2-cell(?: [^"]*)?">\s*<div>([\s\S]*?)<\/div>/gi)]
      .map((cell) => decodeHtml(cell[1]));
    const gpuCount = Math.max(1, Math.round(finite(cells[0]?.match(/\d+/)?.[0]) || 1));
    const vramGb = finite(cells[1]?.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
    const onDemandInstance = priceNumber(
      (row.match(/On-Demand Price:\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1],
    );
    const spotInstance = priceNumber(
      (row.match(/Spot Price:\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1],
    );
    if (onDemandInstance != null) {
      const quote = normalizedQuote({
        providerId: "coreweave",
        provider: "CoreWeave",
        providerUrl: ACCELERATOR_SOURCES.coreweave.url,
        sourceUrl: ACCELERATOR_SOURCES.coreweave.sourceUrl,
        model,
        rawModel,
        market: "on-demand",
        price: onDemandInstance / gpuCount,
        instancePrice: onDemandInstance,
        gpuCount,
        vramGb,
        note: "Published whole-instance rate, normalized per GPU.",
      });
      if (quote) quotes.push(quote);
    }
    if (spotInstance != null) {
      const quote = normalizedQuote({
        providerId: "coreweave",
        provider: "CoreWeave",
        providerUrl: ACCELERATOR_SOURCES.coreweave.url,
        sourceUrl: ACCELERATOR_SOURCES.coreweave.sourceUrl,
        model,
        rawModel,
        market: "spot",
        price: spotInstance / gpuCount,
        instancePrice: spotInstance,
        gpuCount,
        vramGb,
        note: "Published spot instance rate, normalized per GPU; capacity can be interrupted.",
      });
      if (quote) quotes.push(quote);
    }
  }
  return quotes;
}

function walkJson(value, visit) {
  if (!value || typeof value !== "object") return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
  } else {
    for (const item of Object.values(value)) walkJson(item, visit);
  }
}

export function parseRunpodPricing(html) {
  if (!html) return [];
  const products = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      walkJson(parsed, (node) => {
        if (node?.["@type"] === "Product" && /GPU on Runpod/i.test(String(node.name || ""))) products.push(node);
      });
    } catch {
      // One malformed analytics blob must not discard the provider.
    }
  }
  const quotes = [];
  const seen = new Set();
  for (const product of products) {
    const rawModel = String(product.name || "").replace(/\s+GPU on Runpod.*$/i, "");
    const model = canonicalAcceleratorModel(rawModel);
    if (!model) continue;
    const offers = Array.isArray(product.offers?.offers)
      ? product.offers.offers
      : product.offers
        ? [product.offers]
        : [];
    for (const offer of offers) {
      const price = priceNumber(offer?.price);
      if (price == null) continue;
      const lane = /secure/i.test(String(offer?.name || "")) ? "secure" : "community";
      const providerId = `runpod-${lane}`;
      const key = `${providerId}|${model.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quote = normalizedQuote({
        providerId,
        provider: `Runpod ${lane === "secure" ? "Secure" : "Community"}`,
        providerUrl: ACCELERATOR_SOURCES.runpod.url,
        sourceUrl: ACCELERATOR_SOURCES.runpod.sourceUrl,
        model,
        rawModel,
        market: "on-demand",
        price,
        instancePrice: price,
        gpuCount: 1,
        note: `Published ${lane} cloud per-GPU rental rate.`,
      });
      if (quote) quotes.push(quote);
    }
  }
  return quotes;
}

export function parseLambdaPricing(html) {
  if (!html) return [];
  const byModel = new Map();
  const rowRe = /<tr[^>]*data-plan="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(rowRe)) {
    const rawModel = decodeHtml(match[1]);
    const model = canonicalAcceleratorModel(rawModel);
    if (!model) continue;
    const row = match[2];
    const vram = finite((row.match(/data-label="VRAM\/GPU"[^>]*>\s*([\d.]+)/i) || [])[1]);
    const price = priceNumber((row.match(/data-label="PRICE\/GPU\/HR\*"[^>]*>([\s\S]*?)<\/td>/i) || [])[1]);
    if (price == null) continue;
    const current = byModel.get(model.id);
    // Lambda renders several instance-size tabs. The published unit is already
    // per GPU, so retain one representative row per model (the lowest rate).
    if (!current || price < current.price) byModel.set(model.id, { model, rawModel, vram, price });
  }
  return [...byModel.values()].map((row) =>
    normalizedQuote({
      providerId: "lambda",
      provider: "Lambda",
      providerUrl: ACCELERATOR_SOURCES.lambda.url,
      sourceUrl: ACCELERATOR_SOURCES.lambda.sourceUrl,
      model: row.model,
      rawModel: row.rawModel,
      market: "on-demand",
      price: row.price,
      instancePrice: row.price,
      gpuCount: 1,
      vramGb: row.vram,
      note: "Published on-demand price per GPU; capacity is first-come.",
    }),
  ).filter(Boolean);
}

function vastOfferPricePerGpu(offer) {
  const count = Math.max(1, Math.round(finite(offer?.num_gpus) || 1));
  const total = finite(offer?.dph_total);
  if (total == null || total <= 0) return null;
  return total / count;
}

export function parseVastOffers(payload, market) {
  const offers = Array.isArray(payload?.offers) ? payload.offers : [];
  const groups = new Map();
  for (const offer of offers) {
    if (offer?.rentable === false) continue;
    const reliability = finite(offer?.reliability);
    if (reliability != null && reliability < 0.98) continue;
    const model = canonicalAcceleratorModel(offer?.gpu_name);
    const price = vastOfferPricePerGpu(offer);
    if (!model || price == null || price >= 100) continue;
    if (!groups.has(model.id)) groups.set(model.id, { model, offers: [] });
    groups.get(model.id).offers.push({
      price,
      gpuCount: Math.max(1, Math.round(finite(offer?.num_gpus) || 1)),
      vramGb: finite(offer?.gpu_ram) != null ? finite(offer.gpu_ram) / 1024 : model.vramGb,
    });
  }
  const quotes = [];
  for (const { model, offers: rows } of groups.values()) {
    const prices = rows.map((row) => row.price).sort((a, b) => a - b);
    if (!prices.length) continue;
    const middle = median(prices);
    const representative = [...rows].sort((a, b) => Math.abs(a.price - middle))[0];
    const quote = normalizedQuote({
      providerId: "vast",
      provider: "Vast.ai",
      providerUrl: ACCELERATOR_SOURCES.vast.url,
      sourceUrl: ACCELERATOR_SOURCES.vast.sourceUrl,
      model,
      rawModel: model.rawName,
      market,
      price: middle,
      instancePrice: middle * representative.gpuCount,
      gpuCount: representative.gpuCount,
      vramGb: median(rows.map((row) => row.vramGb)),
      offerCount: rows.length,
      low: prices[0],
      high: prices[prices.length - 1],
      note:
        market === "spot"
          ? "Median verified rentable interruptible offer; range is the live marketplace."
          : "Median verified rentable on-demand offer; range is the live marketplace.",
    });
    if (quote) quotes.push(quote);
  }
  return quotes;
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "user-agent": FETCH_UA,
      accept: "text/html,application/xhtml+xml,application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchVastMarket(market) {
  const body = {
    limit: 500,
    type: market === "spot" ? "bid" : "ondemand",
    rentable: { eq: true },
    verified: { eq: true },
    reliability: { gte: 0.98 },
  };
  const text = await fetchText(ACCELERATOR_SOURCES.vast.sourceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseVastOffers(JSON.parse(text), market);
}

async function collectSource(meta, collector) {
  try {
    const quotes = (await collector()).filter(Boolean);
    if (!quotes.length) throw new Error("no supported accelerator prices parsed");
    return { ...meta, ok: true, quotes, error: null };
  } catch (error) {
    return { ...meta, ok: false, quotes: [], error: String(error?.message || error) };
  }
}

export async function fetchAcceleratorMarketplaces() {
  return await Promise.all([
    collectSource(ACCELERATOR_SOURCES.vast, async () => {
      const [spot, onDemand] = await Promise.all([fetchVastMarket("spot"), fetchVastMarket("on-demand")]);
      return [...spot, ...onDemand];
    }),
    collectSource(ACCELERATOR_SOURCES.coreweave, async () =>
      parseCoreweavePricing(await fetchText(ACCELERATOR_SOURCES.coreweave.sourceUrl))),
    collectSource(ACCELERATOR_SOURCES.runpod, async () =>
      parseRunpodPricing(await fetchText(ACCELERATOR_SOURCES.runpod.sourceUrl))),
    collectSource(ACCELERATOR_SOURCES.lambda, async () =>
      parseLambdaPricing(await fetchText(ACCELERATOR_SOURCES.lambda.sourceUrl))),
  ]);
}

function etDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function pctBack(history, days) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const last = history[history.length - 1];
  const lastMs = Date.parse(last.d);
  if (!Number.isFinite(lastMs) || !(last.p > 0)) return null;
  let base = null;
  for (let i = history.length - 2; i >= 0; i--) {
    const row = history[i];
    const ms = Date.parse(row?.d);
    if (!Number.isFinite(ms) || !(row?.p > 0)) continue;
    const age = (lastMs - ms) / 86_400_000;
    if (age >= days) {
      base = { age, p: row.p };
      break;
    }
    base = { age, p: row.p };
  }
  if (!base || base.age < days * 0.6 || base.age > days * 2.5) return null;
  return round((last.p / base.p - 1) * 100, 1);
}

function carryProviderQuotes(source, priorQuotes) {
  const ids =
    source.id === "runpod"
      ? new Set(["runpod-community", "runpod-secure"])
      : new Set([source.id]);
  return priorQuotes
    .filter((quote) => ids.has(quote?.providerId))
    .map((quote) => ({ ...quote, stale: true }));
}

function modelSort(a, b) {
  const ar = MODEL_META[a.modelId]?.rank ?? 999;
  const br = MODEL_META[b.modelId]?.rank ?? 999;
  return ar - br || String(a.model).localeCompare(String(b.model));
}

export function buildAcceleratorPricesPayload({ sources, prior = null, builtAtIso }) {
  const date = etDate(builtAtIso);
  const priorQuotes = Array.isArray(prior?.quotes) ? prior.quotes : [];
  const priorHistory = prior?.history && typeof prior.history === "object" ? prior.history : {};
  const sourceRows = [];
  const quotes = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    const freshQuotes = Array.isArray(source?.quotes)
      ? source.quotes.map((quote) => ({ ...quote, stale: false }))
      : [];
    const carried = source?.ok ? [] : carryProviderQuotes(source, priorQuotes);
    quotes.push(...freshQuotes, ...carried);
    sourceRows.push({
      id: source.id,
      name: source.name,
      url: source.url,
      sourceUrl: source.sourceUrl,
      ok: !!source.ok,
      stale: !source.ok,
      quoteCount: source.ok ? freshQuotes.length : carried.length,
      error: source.ok ? null : source.error || "source unavailable",
    });
  }

  // If a future caller omitted a source entirely, retain its last-good rows and
  // surface that source as stale rather than silently dropping coverage.
  for (const meta of Object.values(ACCELERATOR_SOURCES)) {
    if (sourceRows.some((source) => source.id === meta.id)) continue;
    const carried = carryProviderQuotes(meta, priorQuotes);
    quotes.push(...carried);
    sourceRows.push({
      ...meta,
      ok: false,
      stale: true,
      quoteCount: carried.length,
      error: "source not attempted",
    });
  }

  const deduped = [...new Map(quotes.map((quote) => [quote.key, quote])).values()]
    .filter((quote) => quote?.modelId && quote?.price > 0)
    .sort((a, b) => modelSort(a, b) || a.market.localeCompare(b.market) || a.price - b.price);

  const history = {};
  for (const [key, rows] of Object.entries(priorHistory)) {
    if (Array.isArray(rows)) history[key] = rows.slice(-HISTORY_MAX_POINTS);
  }
  for (const quote of deduped) {
    const priorRows = Array.isArray(history[quote.key])
      ? history[quote.key].filter((row) => row?.d && row.d !== date)
      : [];
    if (!quote.stale) {
      priorRows.push({
        d: date,
        p: quote.price,
        lo: quote.low,
        hi: quote.high,
        n: quote.offerCount,
      });
    }
    history[quote.key] = priorRows.slice(-HISTORY_MAX_POINTS);
  }

  const groups = new Map();
  for (const quote of deduped) {
    if (!groups.has(quote.modelId)) {
      groups.set(quote.modelId, {
        modelId: quote.modelId,
        model: quote.model,
        // A marketplace can use several packaging labels for one canonical
        // accelerator (for example H100 PCIe/SXM/NVL). Keep the comparison
        // label stable instead of letting source order change the displayed
        // VRAM from one build to the next.
        vramGb: MODEL_META[quote.modelId]?.vramGb ?? quote.vramGb ?? null,
        quotes: [],
      });
    }
    groups.get(quote.modelId).quotes.push(quote);
  }
  const benchmarks = [...groups.values()].map((group) => {
    const spot = group.quotes.filter((quote) => quote.market === "spot");
    const onDemand = group.quotes.filter((quote) => quote.market === "on-demand");
    const modelHistory = {};
    for (const quote of group.quotes) modelHistory[quote.key] = history[quote.key] || [];
    const currentMedian = median(group.quotes.map((quote) => quote.price));
    const compositeHistory = [];
    const dates = new Set();
    for (const rows of Object.values(modelHistory)) for (const row of rows) if (row?.d) dates.add(row.d);
    for (const d of [...dates].sort()) {
      const values = [];
      for (const rows of Object.values(modelHistory)) {
        const row = rows.find((item) => item.d === d);
        if (row?.p > 0) values.push(row.p);
      }
      if (values.length) compositeHistory.push({ d, p: round(median(values)) });
    }
    return {
      modelId: group.modelId,
      model: group.model,
      vramGb: group.vramGb,
      quotes: group.quotes,
      spot: {
        count: spot.length,
        low: spot.length ? round(Math.min(...spot.map((quote) => quote.low ?? quote.price))) : null,
        median: round(median(spot.map((quote) => quote.price))),
      },
      onDemand: {
        count: onDemand.length,
        low: onDemand.length ? round(Math.min(...onDemand.map((quote) => quote.low ?? quote.price))) : null,
        median: round(median(onDemand.map((quote) => quote.price))),
      },
      currentMedian: round(currentMedian),
      change7dPct: pctBack(compositeHistory, 7),
      change30dPct: pctBack(compositeHistory, 30),
      history: modelHistory,
      compositeHistory,
    };
  }).sort(modelSort);

  const focus =
    benchmarks.find((row) => row.modelId === "h100") ||
    benchmarks.find((row) => row.modelId === "h200") ||
    benchmarks[0] ||
    null;
  const pairedDiscounts = [];
  for (const benchmark of benchmarks) {
    const byProvider = new Map();
    for (const quote of benchmark.quotes) {
      if (!byProvider.has(quote.providerId)) byProvider.set(quote.providerId, {});
      byProvider.get(quote.providerId)[quote.market] = quote.price;
    }
    for (const pair of byProvider.values()) {
      if (pair.spot > 0 && pair["on-demand"] > 0) {
        pairedDiscounts.push((1 - pair.spot / pair["on-demand"]) * 100);
      }
    }
  }
  const freshSources = sourceRows.filter((source) => source.ok).length;
  const staleSources = sourceRows.filter((source) => !source.ok).map((source) => source.name);
  const summary = {
    freshSources,
    sourceCount: sourceRows.length,
    staleSources,
    quoteCount: deduped.length,
    modelCount: benchmarks.length,
    spotQuoteCount: deduped.filter((quote) => quote.market === "spot").length,
    onDemandQuoteCount: deduped.filter((quote) => quote.market === "on-demand").length,
    medianSpotDiscountPct: round(median(pairedDiscounts), 1),
    focus: focus
      ? {
          modelId: focus.modelId,
          model: focus.model,
          spotMedian: focus.spot.median,
          spotLow: focus.spot.low,
          onDemandMedian: focus.onDemand.median,
          onDemandLow: focus.onDemand.low,
          change7dPct: focus.change7dPct,
          change30dPct: focus.change30dPct,
        }
      : null,
  };

  return {
    version: 1,
    builtAtIso,
    unit: "USD per GPU-hour",
    methodology:
      "Provider-published rates normalized per GPU-hour. Vast.ai uses the median and range of verified rentable offers with reliability at least 98%; other providers use their public pricing tables. Taxes, storage, network, commitments, negotiated discounts, and actual capacity can differ.",
    sources: sourceRows,
    summary,
    quotes: deduped,
    benchmarks,
    history,
    stale: freshSources === 0,
  };
}
