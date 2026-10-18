// Deterministic name / theme / input graph.
//
// The bake already knows these joins in separate registries. This module only
// copies them into one map. It does not fetch, score, or call a model.
//
// asOf is the calendar date that source was known. Static registries are known
// on the bake date. A carried-forward narrative keeps its own earlier date.
// Nothing is stamped after bakeDate.
//
// Propagation is one hop: a piece on a node is copied onto the ticker nodes
// directly connected to it.

export const LINK_MAP_SKIPPED_SOURCES = Object.freeze([
  Object.freeze({
    source: "search-interest",
    reason: "SEARCH_INTEREST_TERMS is a theme list with ids and labels. The bake has no ticker membership for those themes, so theme-to-name edges are not invented.",
  }),
  Object.freeze({
    source: "central-bank-gold",
    reason: "The central-bank gold tab lists countries and estimated demand. It has no equity ticker list. Gold-linked names stay on the commodity gold watch list.",
  }),
]);

// Tickers the RAM and GPU price tabs already render. Kept here so the map can
// join them without parsing the page template. scripts/link-map-smoke.mjs
// checks these symbols still match those tab lists.
export const LINK_MAP_ALT_INPUTS = Object.freeze([
  Object.freeze({
    id: "gpu-rent",
    label: "GPU rent",
    src: "accelerator-prices",
    tickers: Object.freeze(["CRWV", "NVDA", "AMD"]),
  }),
  Object.freeze({
    id: "ram",
    label: "RAM prices",
    src: "ram-prices",
    // Supplier lens MU/SNDK and buyer lens DELL/SMCI/ANET.
    tickers: Object.freeze(["MU", "SNDK", "DELL", "SMCI", "ANET"]),
  }),
]);

const DATE_RE = /^(\d{4}-\d{2}-\d{2})/;

export function linkMapSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function dateOnly(value) {
  const text = String(value || "").trim();
  const match = DATE_RE.exec(text);
  if (match) return match[1];
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function cleanSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol || symbol.length > 24) return null;
  if (!/^[A-Z0-9.^=_-]+$/.test(symbol)) return null;
  return symbol;
}

function symbolsOf(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const symbol = cleanSymbol(raw);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function addNode(nodes, id, node) {
  if (!id) return;
  const prev = nodes.get(id);
  if (!prev) {
    nodes.set(id, node);
    return;
  }
  if (prev.type === "ticker" && prev.label === prev.symbol && node.label && node.label !== prev.symbol) {
    prev.label = node.label;
  }
}

function addTicker(nodes, symbol, label) {
  const display = label && label !== symbol ? String(label) : symbol;
  addNode(nodes, `ticker:${symbol}`, { type: "ticker", symbol, label: display });
  return `ticker:${symbol}`;
}

function addEdge(edges, edge) {
  if (!edge.from || !edge.to || edge.from === edge.to || !edge.kind || !edge.src || !edge.asOf) return;
  const key = `${edge.from}\0${edge.to}\0${edge.kind}\0${edge.src}`;
  const prev = edges.get(key);
  if (!prev) {
    const row = {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      src: edge.src,
      asOf: edge.asOf,
    };
    if (Number.isFinite(edge.w)) row.w = edge.w;
    edges.set(key, row);
    return;
  }
  if (edge.asOf < prev.asOf) prev.asOf = edge.asOf;
  if (Number.isFinite(edge.w)) prev.w = prev.w == null ? edge.w : Math.max(prev.w, edge.w);
}

function cmp(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareEdges(a, b) {
  return cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind) || cmp(a.src, b.src);
}

function typedId(type, raw) {
  const slug = linkMapSlug(raw);
  return slug ? `${type}:${slug}` : null;
}

function groupId(prefix, raw) {
  const slug = linkMapSlug(raw);
  return slug ? `group:${prefix}:${slug}` : null;
}

export function buildLinkMap(inputs = {}, options = {}) {
  const bakeDate = dateOnly(options.bakeDate ?? inputs.bakeDate);
  if (!bakeDate) throw new TypeError("buildLinkMap requires bakeDate (YYYY-MM-DD)");
  const clamp = (value) => {
    const date = dateOnly(value) || bakeDate;
    return date > bakeDate ? bakeDate : date;
  };
  const nodes = new Map();
  const edges = new Map();

  const linkTickers = (from, kind, src, tickers, asOf, weightFor) => {
    for (const symbol of symbolsOf(tickers)) {
      const to = addTicker(nodes, symbol);
      const w = weightFor ? weightFor(symbol) : undefined;
      addEdge(edges, { from, to, kind, src, asOf, w });
    }
  };

  const sectors = inputs.sectors && typeof inputs.sectors === "object" ? inputs.sectors : null;
  if (sectors) {
    const asOf = clamp(inputs.sectorAsOf);
    for (const raw of Object.keys(sectors).sort()) {
      const symbol = cleanSymbol(raw);
      const label = sectors[raw];
      const from = typedId("sector", label);
      if (!symbol || !from) continue;
      addNode(nodes, from, { type: "sector", label: String(label) });
      const to = addTicker(nodes, symbol);
      addEdge(edges, { from, to, kind: "sector", src: "sectors", asOf });
    }
  }

  const industries = inputs.industries && typeof inputs.industries === "object" ? inputs.industries : null;
  if (industries) {
    const asOf = clamp(inputs.industryAsOf);
    for (const raw of Object.keys(industries).sort()) {
      const symbol = cleanSymbol(raw);
      const label = industries[raw];
      const from = typedId("industry", label);
      if (!symbol || !from) continue;
      addNode(nodes, from, { type: "industry", label: String(label) });
      const to = addTicker(nodes, symbol);
      addEdge(edges, { from, to, kind: "industry", src: "industry-of-ticker", asOf });
    }
  }

  const parents = inputs.industriesBySector && typeof inputs.industriesBySector === "object"
    ? inputs.industriesBySector
    : null;
  if (parents) {
    const asOf = clamp(inputs.industryAsOf);
    for (const sectorLabel of Object.keys(parents).sort()) {
      const sectorId = typedId("sector", sectorLabel);
      if (!sectorId) continue;
      for (const industryLabel of parents[sectorLabel] || []) {
        const industryId = typedId("industry", industryLabel);
        if (!industryId || !nodes.has(industryId)) continue;
        addNode(nodes, sectorId, { type: "sector", label: String(sectorLabel) });
        addEdge(edges, {
          from: industryId,
          to: sectorId,
          kind: "taxonomy",
          src: "industries-by-sector",
          asOf,
        });
      }
    }
  }

  if (Array.isArray(inputs.spilloverGroups)) {
    const asOf = clamp(inputs.spilloverAsOf);
    for (const group of inputs.spilloverGroups) {
      const from = groupId("spillover", group?.key);
      if (!from) continue;
      const members = symbolsOf(group.members);
      if (!members.length) continue;
      addNode(nodes, from, { type: "group", label: String(group.label || group.key) });
      linkTickers(from, "spillover-group", "spillover-groups", members, asOf);
    }
  }

  const overnight = inputs.overnight && typeof inputs.overnight === "object" ? inputs.overnight : null;
  if (overnight) {
    const asOf = clamp(overnight.asOf);
    const markets = overnight.markets && typeof overnight.markets === "object" ? overnight.markets : {};
    const peerGroups = overnight.peerGroups && typeof overnight.peerGroups === "object" ? overnight.peerGroups : {};
    const peerOf = overnight.peerOfTicker && typeof overnight.peerOfTicker === "object" ? overnight.peerOfTicker : {};
    const labelFor = (symbol) => markets[symbol]?.name || null;
    for (const groupKey of Object.keys(peerGroups).sort()) {
      const from = groupId("overnight", groupKey);
      const peers = symbolsOf(peerGroups[groupKey]);
      if (!from || !peers.length) continue;
      addNode(nodes, from, { type: "group", label: String(groupKey) });
      peers.forEach((symbol, index) => {
        const to = addTicker(nodes, symbol, labelFor(symbol));
        addEdge(edges, {
          from,
          to,
          kind: "overnight-lead",
          src: "global-peer-groups",
          asOf,
          w: peers.length - index,
        });
      });
    }
    for (const raw of Object.keys(peerOf).sort()) {
      const symbol = cleanSymbol(raw);
      const groupKey = peerOf[raw];
      const from = groupId("overnight", groupKey);
      const peers = symbolsOf(peerGroups[groupKey]);
      if (!symbol || !from || !peers.length) continue;
      addNode(nodes, from, { type: "group", label: String(groupKey) });
      const member = addTicker(nodes, symbol);
      addEdge(edges, { from, to: member, kind: "overnight-member", src: "global-peer-of-ticker", asOf });
      peers.forEach((peer, index) => {
        const to = addTicker(nodes, peer, labelFor(peer));
        addEdge(edges, {
          from: member,
          to,
          kind: "overnight-peer",
          src: "global-peer-groups",
          asOf,
          w: peers.length - index,
        });
      });
    }
    const broad = symbolsOf(overnight.broad);
    if (broad.length) {
      const from = groupId("overnight", "broad");
      addNode(nodes, from, { type: "group", label: "broad" });
      for (const symbol of broad) {
        const to = addTicker(nodes, symbol, labelFor(symbol));
        addEdge(edges, { from, to, kind: "overnight-lead", src: "global-broad-signals", asOf });
      }
    }
  }

  if (Array.isArray(inputs.inputs)) {
    for (const row of inputs.inputs) {
      const from = typedId("input", row?.id || row?.label);
      const tickers = symbolsOf(row?.tickers);
      if (!from || !tickers.length) continue;
      addNode(nodes, from, { type: "input", label: String(row.label || row.id) });
      linkTickers(from, "input", String(row.src || "inputs"), tickers, clamp(row?.asOf));
    }
  }

  if (Array.isArray(inputs.themes)) {
    for (const row of inputs.themes) {
      const from = typedId("theme", row?.id || row?.label);
      const tickers = symbolsOf(row?.tickers);
      if (!from || !tickers.length) continue;
      addNode(nodes, from, { type: "theme", label: String(row.label || row.id) });
      linkTickers(from, "theme", String(row.src || "themes"), tickers, clamp(row?.asOf));
    }
  }

  if (Array.isArray(inputs.narratives)) {
    for (const row of inputs.narratives) {
      const from = typedId("narrative", row?.id || row?.name);
      if (!from) continue;
      const asOf = clamp(row?.asOf);
      const src = row?.autogenerated ? "narrative-watchlist" : "narratives";
      const longs = symbolsOf(row?.longs);
      const shorts = symbolsOf(row?.shorts);
      if (!longs.length && !shorts.length) continue;
      addNode(nodes, from, { type: "narrative", label: String(row.name || row.id) });
      linkTickers(from, "narrative-long", src, longs, asOf, () => 2);
      linkTickers(from, "narrative-short", src, shorts, asOf, () => 1);
    }
  }

  const nodeIds = [...nodes.keys()].sort(cmp);
  const outNodes = {};
  for (const id of nodeIds) outNodes[id] = nodes.get(id);
  const edgeList = [...edges.values()].sort(compareEdges);
  return {
    asOf: bakeDate,
    bakeDate,
    nodes: outNodes,
    edges: edgeList,
    sources: [...new Set(edgeList.map((edge) => edge.src))].sort(),
    skipped: LINK_MAP_SKIPPED_SOURCES,
  };
}

export function assembleBakeLinkMap(ctx = {}) {
  const bakeDate = ctx.bakeDate;
  const narrativeAsOf = ctx.narrativeAsOf || bakeDate;
  const narratives = (Array.isArray(ctx.narratives) ? ctx.narratives : []).map((row) => ({
    name: row?.name,
    id: row?.id,
    longs: row?.longs,
    shorts: row?.shorts,
    autogenerated: row?.autogenerated === true,
    asOf: row?.autogenerated === true ? bakeDate : (row?.asOf || narrativeAsOf),
  }));
  const commodityInputs = (Array.isArray(ctx.commodityTrackers) ? ctx.commodityTrackers : []).map((row) => ({
    id: row?.key,
    label: row?.label || row?.key,
    src: "commodities",
    tickers: row?.watch || [],
  }));
  return buildLinkMap({
    sectors: ctx.sectors,
    industries: ctx.industries,
    industriesBySector: ctx.industriesBySector,
    spilloverGroups: ctx.spilloverGroups,
    overnight: {
      peerOfTicker: ctx.peerOfTicker,
      peerGroups: ctx.peerGroups,
      markets: ctx.markets,
      broad: ctx.broadSignals,
    },
    inputs: [
      ...LINK_MAP_ALT_INPUTS.map((row) => ({
        id: row.id,
        label: row.label,
        src: row.src,
        tickers: [...row.tickers],
      })),
      ...commodityInputs,
      {
        id: "ai-capex",
        label: "AI CapEx",
        src: "ai-capex",
        tickers: ctx.aiCapexTickers || [],
      },
    ],
    narratives,
  }, { bakeDate });
}

export function neighbors(map, nodeId, opts = {}) {
  if (!map || nodeId == null || nodeId === "") return [];
  const kinds = Array.isArray(opts.kinds) ? new Set(opts.kinds) : null;
  const found = new Set();
  for (const edge of map.edges || []) {
    if (kinds && !kinds.has(edge.kind)) continue;
    if (edge.from === nodeId) found.add(edge.to);
    else if (edge.to === nodeId) found.add(edge.from);
  }
  return [...found].sort(cmp);
}

export function namesForNode(map, nodeId) {
  const names = [];
  for (const id of neighbors(map, nodeId)) {
    const node = map?.nodes?.[id];
    if (node?.type === "ticker" && node.symbol) names.push(node.symbol);
  }
  return [...new Set(names)].sort(cmp);
}

function pieceFrom(value) {
  if (typeof value === "string") {
    const text = value.trim();
    return { kind: linkMapSlug(text) || "piece", text: text || null, asOf: null };
  }
  if (!value || typeof value !== "object") return { kind: "piece", text: null, asOf: null };
  const text = value.text || value.label || null;
  return {
    kind: String(value.kind || value.type || (text ? linkMapSlug(text) : "") || "piece"),
    text: text ? String(text) : null,
    asOf: value.asOf || null,
  };
}

export function propagate(map, nodeId, piece) {
  const bakeDate = dateOnly(map?.bakeDate) || dateOnly(map?.asOf);
  const parsed = pieceFrom(piece);
  let asOf = dateOnly(parsed.asOf) || dateOnly(map?.asOf) || bakeDate;
  if (bakeDate && asOf && asOf > bakeDate) asOf = bakeDate;
  const rows = [];
  for (const ticker of namesForNode(map, nodeId)) {
    const row = { ticker, kind: parsed.kind, src: String(nodeId), asOf };
    if (parsed.text) row.text = parsed.text;
    rows.push(row);
  }
  rows.sort((a, b) => cmp(a.ticker, b.ticker) || cmp(a.kind, b.kind));
  return rows;
}
