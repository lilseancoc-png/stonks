import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serveDataKey } from "../lib/data-response.mjs";
import { store } from "../lib/datastore.mjs";
import {
  BAKE_LINK_MAP_KEY,
  SCANNER_OWNERS,
  isBakeOwnedKey,
  keysForScannerOwner,
} from "../lib/data-ownership.mjs";
import {
  LINK_MAP_OWNER_ONLY,
  OWNER_ROLE_CLAIMS,
  isPremiumKey,
  isRoleRestrictedKey,
  roleClaimForKey,
} from "../lib/premium-keys.mjs";
import { SESSION_COOKIE, signSession } from "../lib/session.mjs";
import {
  LINK_MAP_ALT_INPUTS,
  LINK_MAP_SKIPPED_SOURCES,
  assembleBakeLinkMap,
  buildLinkMap,
  namesForNode,
  neighbors,
  propagate,
} from "../lib/link-map.mjs";
import {
  AI_CAPEX_TICKERS,
  COMMODITY_TRACKERS,
  GLOBAL_BROAD_SIGNALS,
  GLOBAL_MARKETS,
  GLOBAL_PEER_GROUPS,
  GLOBAL_PEER_OF_TICKER,
  INDUSTRIES_BY_SECTOR,
  INDUSTRY_OF_TICKER,
  SECTORS,
  SPILLOVER_GROUPS,
} from "./build.mjs";

const BAKE_DATE = "2026-10-13";

function edgeKey(edge) {
  return [edge.from, edge.to, edge.kind, edge.src].join("|");
}

function assertDated(map, bakeDate) {
  assert.equal(map.asOf, bakeDate);
  assert.equal(map.bakeDate, bakeDate);
  assert.ok(map.asOf <= bakeDate);
  for (const edge of map.edges) {
    assert.ok(edge.asOf <= bakeDate, `${edge.from} ${edge.kind} asOf ${edge.asOf} is after ${bakeDate}`);
    assert.equal(typeof edge.src, "string");
    assert.ok(edge.src.length > 0);
  }
  const sorted = [...map.edges].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.src !== b.src) return a.src < b.src ? -1 : 1;
    return 0;
  });
  assert.deepEqual(map.edges, sorted);
  assert.equal(new Set(map.edges.map(edgeKey)).size, map.edges.length);
}

const fixture = {
  sectors: { NVDA: "Semis", MU: "Semis" },
  industries: { NVDA: "Semiconductors" },
  spilloverGroups: [{ key: "semis", label: "Semis & memory", members: ["NVDA", "MU"] }],
  inputs: [
    { id: "gpu-rent", label: "GPU rent", src: "accelerator-prices", tickers: ["NVDA", "AMD", "NVDA"], asOf: "2026-11-01" },
    { id: "gpu-rent", label: "GPU rent", src: "accelerator-prices", tickers: ["AMD", "CRWV"], asOf: "2026-10-01" },
  ],
  themes: [
    { id: "ai-chips", label: "AI chips", src: "themes", tickers: ["NVDA", "AMD", "NVDA"], asOf: "2026-10-13" },
  ],
};
const first = buildLinkMap(fixture, { bakeDate: BAKE_DATE });
const second = buildLinkMap(fixture, { bakeDate: BAKE_DATE });
assert.equal(JSON.stringify(first), JSON.stringify(second), "same inputs must build the same map");
assertDated(first, BAKE_DATE);

const reversed = buildLinkMap({
  ...fixture,
  inputs: [
    { ...fixture.inputs[0], tickers: ["AMD", "NVDA"] },
    { ...fixture.inputs[1], tickers: ["CRWV", "AMD"] },
  ],
}, { bakeDate: BAKE_DATE });
assert.equal(JSON.stringify(first), JSON.stringify(reversed), "ticker order must not change unweighted edges");

assert.ok(first.edges.some((edge) => edge.kind === "sector" && edge.from === "sector:semis" && edge.to === "ticker:NVDA" && edge.src === "sectors"));
assert.ok(first.edges.some((edge) => edge.kind === "industry" && edge.from === "industry:semiconductors" && edge.to === "ticker:NVDA" && edge.src === "industry-of-ticker"));
assert.ok(first.edges.some((edge) => edge.kind === "spillover-group" && edge.from === "group:spillover:semis" && edge.to === "ticker:NVDA" && edge.src === "spillover-groups"));

const gpuEdges = first.edges.filter((edge) => edge.from === "input:gpu-rent" && edge.kind === "input");
assert.deepEqual(gpuEdges.map((edge) => edge.to), ["ticker:AMD", "ticker:CRWV", "ticker:NVDA"]);
assert.equal(gpuEdges.find((edge) => edge.to === "ticker:AMD").asOf, "2026-10-01");
assert.equal(gpuEdges.find((edge) => edge.to === "ticker:NVDA").asOf, BAKE_DATE, "a future source date clamps to the bake date");
assert.equal(namesForNode(first, "input:gpu-rent").join(","), "AMD,CRWV,NVDA");

const costPieces = propagate(first, "input:gpu-rent", {
  kind: "input-costs-rising",
  text: "input costs rising",
  asOf: "2026-12-01",
});
assert.deepEqual(costPieces.map((piece) => piece.ticker), ["AMD", "CRWV", "NVDA"]);
for (const piece of costPieces) {
  assert.equal(piece.kind, "input-costs-rising");
  assert.equal(piece.text, "input costs rising");
  assert.equal(piece.src, "input:gpu-rent");
  assert.equal(piece.asOf, BAKE_DATE);
}
const stringPieces = propagate(first, "input:gpu-rent", "input costs rising");
assert.equal(stringPieces[0].kind, "input-costs-rising");
assert.equal(stringPieces[0].asOf, BAKE_DATE);

const attention = propagate(first, "theme:ai-chips", {
  kind: "attention",
  text: "search interest climbing",
  asOf: "2026-10-01",
});
assert.deepEqual(attention.map((piece) => piece.ticker), ["AMD", "NVDA"]);
assert.equal(new Set(attention.map((piece) => piece.ticker)).size, attention.length);
for (const piece of attention) {
  assert.equal(piece.kind, "attention");
  assert.equal(piece.src, "theme:ai-chips");
  assert.equal(piece.asOf, "2026-10-01");
}
assert.deepEqual(propagate(first, "theme:missing", { kind: "attention" }), []);

assert.throws(() => buildLinkMap(fixture, {}), /bakeDate/);

const real = assembleBakeLinkMap({
  bakeDate: BAKE_DATE,
  sectors: SECTORS,
  industries: INDUSTRY_OF_TICKER,
  industriesBySector: INDUSTRIES_BY_SECTOR,
  spilloverGroups: SPILLOVER_GROUPS,
  peerOfTicker: GLOBAL_PEER_OF_TICKER,
  peerGroups: GLOBAL_PEER_GROUPS,
  markets: GLOBAL_MARKETS,
  broadSignals: GLOBAL_BROAD_SIGNALS,
  commodityTrackers: COMMODITY_TRACKERS,
  aiCapexTickers: AI_CAPEX_TICKERS,
  narrativeAsOf: "2026-10-02",
  narratives: [
    { name: "Old chip story", longs: ["NVDA"], shorts: ["INTC"], asOf: "2026-09-01" },
    { name: "Future story", longs: ["AMD"], asOf: "2026-12-01" },
    { name: "Undated story", longs: ["MU"] },
    { name: "Semiconductors Watchlist", longs: ["INTC"], autogenerated: true, asOf: "2026-01-01" },
  ],
});
const realAgain = assembleBakeLinkMap({
  bakeDate: BAKE_DATE,
  sectors: SECTORS,
  industries: INDUSTRY_OF_TICKER,
  industriesBySector: INDUSTRIES_BY_SECTOR,
  spilloverGroups: SPILLOVER_GROUPS,
  peerOfTicker: GLOBAL_PEER_OF_TICKER,
  peerGroups: GLOBAL_PEER_GROUPS,
  markets: GLOBAL_MARKETS,
  broadSignals: GLOBAL_BROAD_SIGNALS,
  commodityTrackers: COMMODITY_TRACKERS,
  aiCapexTickers: AI_CAPEX_TICKERS,
  narrativeAsOf: "2026-10-02",
  narratives: [
    { name: "Old chip story", longs: ["NVDA"], shorts: ["INTC"], asOf: "2026-09-01" },
    { name: "Future story", longs: ["AMD"], asOf: "2026-12-01" },
    { name: "Undated story", longs: ["MU"] },
    { name: "Semiconductors Watchlist", longs: ["INTC"], autogenerated: true, asOf: "2026-01-01" },
  ],
});
assert.equal(JSON.stringify(real), JSON.stringify(realAgain));
assertDated(real, BAKE_DATE);
assert.equal(real.nodes["ticker:NVDA"].type, "ticker");
assert.equal(real.nodes["sector:mega-cap-tech"].label, "Mega-cap tech");
assert.ok(real.edges.some((edge) => edge.kind === "sector" && edge.from === "sector:mega-cap-tech" && edge.to === "ticker:NVDA"));
assert.ok(real.edges.some((edge) => edge.kind === "industry" && edge.from === "industry:semiconductors" && edge.to === "ticker:NVDA"));
assert.ok(real.edges.some((edge) => edge.kind === "taxonomy" && edge.from === "industry:semiconductors" && edge.to === "sector:technology"));
const nvdaGroup = SPILLOVER_GROUPS.find((group) => group.members.includes("NVDA"));
assert.equal(nvdaGroup.key, "semis");
assert.ok(real.edges.some((edge) => edge.kind === "spillover-group" && edge.from === "group:spillover:semis" && edge.to === "ticker:NVDA" && edge.src === "spillover-groups"));
assert.deepEqual(neighbors(real, "ticker:NVDA", { kinds: ["sector"] }), ["sector:mega-cap-tech"]);
assert.deepEqual(neighbors(real, "ticker:NVDA", { kinds: ["industry"] }), ["industry:semiconductors"]);
assert.deepEqual(neighbors(real, "ticker:NVDA", { kinds: ["spillover-group"] }), ["group:spillover:semis"]);

assert.deepEqual(namesForNode(real, "input:gpu-rent"), ["AMD", "CRWV", "NVDA"]);
assert.ok(namesForNode(real, "input:ram").includes("MU"));
assert.ok(namesForNode(real, "input:ram").includes("DELL"));
assert.ok(namesForNode(real, "input:ai-capex").includes("NVDA"));
assert.ok(namesForNode(real, "input:gold").includes("GLD"));
assert.ok(namesForNode(real, "ticker:MU").includes("000660.KS"));
assert.equal(real.edges.find((edge) => edge.from === "ticker:MU" && edge.to === "ticker:000660.KS" && edge.kind === "overnight-peer").w, 4);
assert.ok(namesForNode(real, "group:overnight:broad").includes("ES=F"));

const oldLong = real.edges.find((edge) => edge.from === "narrative:old-chip-story" && edge.to === "ticker:NVDA");
assert.equal(oldLong.kind, "narrative-long");
assert.equal(oldLong.w, 2);
assert.equal(oldLong.asOf, "2026-09-01");
const oldShort = real.edges.find((edge) => edge.from === "narrative:old-chip-story" && edge.to === "ticker:INTC");
assert.equal(oldShort.kind, "narrative-short");
assert.equal(oldShort.w, 1);
assert.equal(real.edges.find((edge) => edge.from === "narrative:future-story").asOf, BAKE_DATE);
assert.equal(real.edges.find((edge) => edge.from === "narrative:undated-story").asOf, "2026-10-02");
const watchlist = real.edges.find((edge) => edge.from === "narrative:semiconductors-watchlist");
assert.equal(watchlist.src, "narrative-watchlist");
assert.equal(watchlist.asOf, BAKE_DATE);

assert.deepEqual(real.skipped, LINK_MAP_SKIPPED_SOURCES);
assert.ok(LINK_MAP_SKIPPED_SOURCES.some((row) => row.source === "search-interest" && row.reason));
assert.ok(LINK_MAP_SKIPPED_SOURCES.some((row) => row.source === "central-bank-gold" && row.reason));
assert.equal(real.sources.includes("search-interest"), false);
assert.equal(real.sources.includes("central-bank-gold"), false);
for (const src of ["sectors", "industry-of-ticker", "spillover-groups", "global-peer-groups", "global-peer-of-ticker", "commodities", "accelerator-prices", "ram-prices", "ai-capex", "narratives"]) {
  assert.ok(real.sources.includes(src), `missing linked source ${src}`);
}

const livePieces = propagate(real, "input:gpu-rent", {
  kind: "input-costs-rising",
  text: "input costs rising",
  asOf: "2026-10-20",
});
assert.deepEqual(livePieces.map((piece) => piece.ticker), ["AMD", "CRWV", "NVDA"]);
assert.ok(livePieces.every((piece) => piece.src === "input:gpu-rent" && piece.asOf === BAKE_DATE));

const render = await readFile(resolve("scripts/render/app-js.mjs"), "utf8");
const ramListed = [...render.matchAll(/rpEquityLinks\(\[([^\]]+)\]\)/g)].flatMap((match) =>
  [...match[1].matchAll(/'([A-Z]+)'/g)].map((item) => item[1]));
const gpuListed = [...render.matchAll(/data-ap-grade="([A-Z]+)"/g)].map((match) => match[1]);
const ramInput = LINK_MAP_ALT_INPUTS.find((row) => row.id === "ram");
const gpuInput = LINK_MAP_ALT_INPUTS.find((row) => row.id === "gpu-rent");
assert.deepEqual([...ramInput.tickers].sort(), [...new Set(ramListed)].sort());
assert.deepEqual([...gpuInput.tickers].sort(), [...new Set(gpuListed)].sort());

assert.equal(BAKE_LINK_MAP_KEY, "link-map.json");
assert.equal(isBakeOwnedKey(BAKE_LINK_MAP_KEY), true);
for (const owner of SCANNER_OWNERS) {
  assert.equal(keysForScannerOwner(owner).includes(BAKE_LINK_MAP_KEY), false, owner);
}
assert.equal(LINK_MAP_OWNER_ONLY, true);
assert.equal(isPremiumKey("link-map.json"), true);
assert.equal(isRoleRestrictedKey("link-map.json"), true);
assert.equal(roleClaimForKey("link-map.json"), OWNER_ROLE_CLAIMS);
assert.deepEqual(OWNER_ROLE_CLAIMS, ["tr", "tp"]);

const ownership = await readFile(resolve("lib/data-ownership.mjs"), "utf8");
const premium = await readFile(resolve("lib/premium-keys.mjs"), "utf8");
const freshness = await readFile(resolve("scripts/verify-data-freshness.mjs"), "utf8");
assert.match(ownership, /BAKE_LINK_MAP_KEY = "link-map\.json"/);
assert.match(premium, /export const LINK_MAP_OWNER_ONLY = true;/);
// Owner role comes from the generic PREMIUM_KEYS -> ROLE_RESTRICTED_KEYS rule.
assert.match(premium, /\.\.\.\(LINK_MAP_OWNER_ONLY \? \["link-map\.json"\] : \[\]\)/);
assert.doesNotMatch(premium, /isLinkMapKey/);
const published = premium.replace(
  "export const LINK_MAP_OWNER_ONLY = true;",
  "export const LINK_MAP_OWNER_ONLY = false;",
);
assert.notEqual(published, premium);
const publishedModule = await import(`data:text/javascript,${encodeURIComponent(published)}`);
assert.equal(publishedModule.LINK_MAP_OWNER_ONLY, false);
assert.equal(publishedModule.isPremiumKey("link-map.json"), false);
assert.equal(publishedModule.isRoleRestrictedKey("link-map.json"), false);
assert.equal(publishedModule.roleClaimForKey("link-map.json"), null);
assert.equal(publishedModule.isPremiumKey("picks.json"), true);
assert.equal(publishedModule.isRoleRestrictedKey("picks.json"), true);
assert.equal(publishedModule.roleClaimForKey("picks.json"), publishedModule.OWNER_ROLE_CLAIMS);

function mockDataResponse() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    end(value) { this.body = value; return value; },
  };
}
const priorFlag = process.env.PRIVATE_DATA_ENABLED;
const priorSecret = process.env.SESSION_SECRET;
const priorGet = store.get;
let linkMapReads = 0;
try {
  process.env.PRIVATE_DATA_ENABLED = "1";
  process.env.SESSION_SECRET = "offline-link-map-smoke-secret";
  store.get = async (key) => {
    linkMapReads += 1;
    assert.equal(key, "link-map.json");
    return Buffer.from(JSON.stringify({ nodes: {}, edges: [] }));
  };
  const anon = mockDataResponse();
  await serveDataKey({ headers: {} }, anon, "link-map.json");
  assert.equal(anon.statusCode, 401);
  assert.deepEqual(anon.body, { error: "auth required" });
  assert.equal(anon.headers["cache-control"], "private, no-store");
  assert.equal(linkMapReads, 0, "anonymous Owner read must stop before storage");
  const partial = await signSession({ sub: "partial", tr: true });
  const partialRes = mockDataResponse();
  await serveDataKey({ headers: { cookie: `${SESSION_COOKIE}=${partial}` } }, partialRes, "link-map.json");
  assert.equal(partialRes.statusCode, 401);
  assert.deepEqual(partialRes.body, { error: "role required" });
  assert.equal(linkMapReads, 0, "a partial Owner session must stop before storage");
  const owner = await signSession({ sub: "owner", tr: true, tp: true });
  const ownerRes = mockDataResponse();
  await serveDataKey({ headers: { cookie: `${SESSION_COOKIE}=${owner}` } }, ownerRes, "link-map.json");
  assert.equal(ownerRes.statusCode, 200);
  assert.equal(ownerRes.headers["cache-control"], "private, no-store");
  assert.deepEqual(JSON.parse(String(ownerRes.body)), { nodes: {}, edges: [] });
  assert.equal(linkMapReads, 1);
} finally {
  store.get = priorGet;
  if (priorFlag == null) delete process.env.PRIVATE_DATA_ENABLED;
  else process.env.PRIVATE_DATA_ENABLED = priorFlag;
  if (priorSecret == null) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
}
const stamped = freshness.match(/const BAKE_STAMPED_FILES = \[([\s\S]*?)\];/)?.[1] || "";
const required = freshness.match(/const BAKE_REQUIRED_REWRITTEN_FILES = \[([\s\S]*?)\];/)?.[1] || "";
assert.match(required, /"link-map\.json"/);
assert.doesNotMatch(stamped, /link-map/);

console.log(`link-map smoke passed (${real.edges.length} edges, ${Object.keys(real.nodes).length} nodes, sources ${real.sources.join(", ")})`);
