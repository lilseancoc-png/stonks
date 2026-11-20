// Federal Register rules and orders tagged to covered stocks (2026-11-19,
// owner request).
//
// The Federal Register API (https://www.federalregister.gov/developers/
// documentation/api/v1) is free with no key. Two reads, once a day:
//
//   documents          everything published in the last few days (rules,
//                      proposed rules, notices, presidential documents),
//                      1,000 a page, at most FR_MAX_PAGES pages
//   public inspection  documents filed today for tomorrow's issue, the early
//                      look (an executive order or a final rule often shows
//                      here the evening before it is published)
//
// Each document is tagged to stocks by rules only: the issuing agency (CMS
// rules reach UnitedHealth, BIS export rules reach the chip makers), topic
// words in the title or abstract (tariffs, drug pricing, bank capital), and
// company names. A notice (the bulk of the Register, mostly routine) is kept
// only when a topic word or a company name matches; a rule, proposed rule or
// presidential document from a mapped agency is kept on the agency alone.
// Presidential documents are kept even when no stock matches (marked market
// wide), for the shock detector that will read this file.
//
// Pure parsers and the tagger are exported for the offline smoke test;
// fetches take a fetchImpl so the test never touches the network.

export const FR_DOCS_URL = "https://www.federalregister.gov/api/v1/documents.json";
export const FR_PI_URL = "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json";
export const FR_LOOKBACK_DAYS = 3;
export const FR_PER_PAGE = 1000;
export const FR_MAX_PAGES = 3;
export const FR_TIMEOUT_MS = 20000;

const FR_FIELDS = ["document_number", "title", "type", "abstract", "publication_date", "html_url", "agencies", "significant", "action"];

// Covered groups, used by the agency and topic rules below.
const SEMIS = ["NVDA", "AMD", "AVGO", "TSM", "ASML", "AMAT", "MU", "INTC", "QCOM", "MRVL", "TXN", "ARM", "SNDK", "WDC"];
const PHARMA = ["LLY", "MRK", "NVO", "MRNA"];
const BANKS = ["JPM", "BAC", "C", "GS", "MS", "SCHW"];
const CARDS = ["V", "MA", "AXP"];
const BROKERS = ["HOOD", "SCHW", "GS", "MS"];
const IMPORTERS = ["AAPL", "NKE", "WMT", "TGT", "COST", "HD", "SBUX", "AMZN", "TSLA", "DELL"];
const POWER = ["VST", "BE", "VRT"];
const SPACE = ["SPCX"];
const HEALTH = ["UNH"];

// Agency slug (or a word in its name) -> stocks. `kinds` is the document
// types kept on the agency alone; a notice needs a topic or name match.
export const AGENCY_RULES = Object.freeze([
  { id: "cms", match: ["centers-for-medicare-medicaid-services", "medicare & medicaid"], tickers: [...HEALTH, ...PHARMA] },
  { id: "fda", match: ["food-and-drug-administration", "food and drug administration"], tickers: PHARMA },
  { id: "bis", match: ["industry-and-security-bureau", "bureau of industry and security", "industry and security bureau"], tickers: SEMIS },
  { id: "ustr", match: ["trade-representative-office-of-united-states", "trade representative"], tickers: IMPORTERS },
  { id: "itc", match: ["international-trade-commission", "international trade commission"], tickers: [] },
  { id: "ftc", match: ["federal-trade-commission", "federal trade commission"], tickers: [] },
  { id: "doj-antitrust", match: ["antitrust-division", "antitrust division"], tickers: [] },
  { id: "sec", match: ["securities-and-exchange-commission", "securities and exchange commission"], tickers: BROKERS },
  { id: "cfpb", match: ["consumer-financial-protection-bureau", "consumer financial protection bureau"], tickers: [...CARDS, "JPM", "BAC", "C"] },
  { id: "fed", match: ["federal-reserve-system", "federal reserve system"], tickers: BANKS },
  { id: "occ", match: ["comptroller-of-the-currency", "comptroller of the currency"], tickers: BANKS },
  { id: "fdic", match: ["federal-deposit-insurance-corporation", "federal deposit insurance corporation"], tickers: BANKS },
  { id: "faa", match: ["federal-aviation-administration", "federal aviation administration"], tickers: SPACE },
  { id: "ferc", match: ["federal-energy-regulatory-commission", "federal energy regulatory commission"], tickers: POWER },
  { id: "doe", match: ["energy-department", "department of energy"], tickers: POWER },
]);
const RULE_KINDS = new Set(["Rule", "Proposed Rule", "Presidential Document"]);

// Topic words (title + abstract, case-insensitive) -> stocks.
export const TOPIC_RULES = Object.freeze([
  { id: "chips-export", re: /\b(semiconductors?|export controls?|entity list|advanced computing|integrated circuits?|foreign direct product)\b/i, tickers: SEMIS },
  { id: "tariffs", re: /\b(tariffs?|section 301|section 232|reciprocal trade|duties on imports|harmonized tariff)\b/i, tickers: IMPORTERS },
  { id: "drug-pricing", re: /\b(drug pric\w*|prescription drug|medicare part d|most favored nation|drug price negotiation|340b)\b/i, tickers: PHARMA },
  { id: "glp1", re: /\b(glp-1|semaglutide|tirzepatide|obesity drug|anti-obesity)\b/i, tickers: ["LLY", "NVO"] },
  { id: "vaccines", re: /\b(vaccines?|immunization|mrna)\b/i, tickers: ["MRNA", "MRK"] },
  { id: "medicare-advantage", re: /\b(medicare advantage|part c|risk adjustment)\b/i, tickers: HEALTH },
  { id: "bank-capital", re: /\b(capital requirements?|basel|stress (test|capital)|supplementary leverage|g-sib|liquidity coverage)\b/i, tickers: BANKS },
  { id: "cards", re: /\b(interchange|credit card|debit card|swipe fees?|overdraft|late fees?)\b/i, tickers: CARDS },
  { id: "crypto", re: /\b(crypto\w*|digital assets?|stablecoins?)\b/i, tickers: ["HOOD", "SCHW"] },
  { id: "brokers", re: /\b(payment for order flow|best execution|broker-dealers?|market structure|order competition)\b/i, tickers: BROKERS },
  { id: "space", re: /\b(commercial space|launch (and|or) reentry|launch licen\w*|spaceport|satellite spectrum)\b/i, tickers: SPACE },
  { id: "gig-work", re: /\b(independent contractors?|gig (work|workers?|economy)|transportation network compan\w*|ride-?hail\w*|rideshare)\b/i, tickers: ["UBER"] },
  { id: "frontier-ai", re: /\b(frontier (ai )?models?|(dual-use )?foundation models?|large language models?|model weights)\b/i, tickers: ["ANT"] },
  { id: "grid", re: /\b(interconnection|transmission planning|large loads?|data centers?|electric reliability|capacity market)\b/i, tickers: POWER },
]);

// Company names as they appear in Federal Register text: case-sensitive,
// legal-name style so "apple" in a farm notice never matches Apple.
export const FR_NAMES = Object.freeze({
  AAPL: /\bApple Inc\b/, MSFT: /\bMicrosoft\b/, AMZN: /\bAmazon(\.com)?,? Inc\b|\bAmazon Web Services\b/, META: /\bMeta Platforms\b|\bFacebook, Inc\b/,
  GOOGL: /\bAlphabet Inc\b|\bGoogle LLC\b/, TSLA: /\bTesla,? Inc\b/, NVDA: /\bNVIDIA\b|\bNvidia Corp/, TSM: /\bTaiwan Semiconductor Manufacturing\b/,
  AVGO: /\bBroadcom\b/, ORCL: /\bOracle (Corporation|America)\b/, NFLX: /\bNetflix\b/, JPM: /\bJPMorgan Chase\b/, V: /\bVisa (Inc|U\.S\.A)\b/,
  MA: /\bMastercard\b/, LLY: /\bEli Lilly\b/, MRNA: /\bModernaTX\b|\bModerna\b/, MRK: /\bMerck Sharp|\bMerck & Co\b/, WMT: /\bWalmart\b|\bWal-Mart\b/,
  COST: /\bCostco\b/, CRWD: /\bCrowdStrike\b/, ADBE: /\bAdobe Inc\b/, SHOP: /\bShopify\b/, BAC: /\bBank of America\b/, SCHW: /\bCharles Schwab\b/,
  BABA: /\bAlibaba\b/, MS: /\bMorgan Stanley\b/, GS: /\bGoldman Sachs\b/, HOOD: /\bRobinhood\b/, AXP: /\bAmerican Express\b/, AMD: /\bAdvanced Micro Devices\b/,
  C: /\bCitigroup\b|\bCitibank\b/, UNH: /\bUnitedHealth\b|\bOptum\b/, DELL: /\bDell Technologies\b|\bDell Inc\b/, ASML: /\bASML\b/, VST: /\bVistra\b/,
  NOW: /\bServiceNow\b/, MDB: /\bMongoDB\b/, ACN: /\bAccenture\b/, OKTA: /\bOkta,? Inc\b/, SNOW: /\bSnowflake Inc\b/, RKLB: /\bRocket Lab\b/,
  CRM: /\bSalesforce\b/, FTNT: /\bFortinet\b/, INTU: /\bIntuit Inc\b/, TEAM: /\bAtlassian\b/, NKE: /\bNike,? Inc\b/, PANW: /\bPalo Alto Networks\b/,
  IBM: /\bInternational Business Machines\b/, QCOM: /\bQualcomm\b|\bQUALCOMM\b/, HD: /\bHome Depot\b/, PLTR: /\bPalantir\b/, DDOG: /\bDatadog\b/,
  SBUX: /\bStarbucks\b/, ANET: /\bArista Networks\b/, TXN: /\bTexas Instruments\b/, INTC: /\bIntel Corporation\b/, NVO: /\bNovo Nordisk\b/,
  CRWV: /\bCoreWeave\b/, MRVL: /\bMarvell\b/, AMAT: /\bApplied Materials\b/, MU: /\bMicron Technology\b/, BE: /\bBloom Energy\b/,
  SNDK: /\bSanDisk\b|\bSandisk\b/, WDC: /\bWestern Digital\b/, ARM: /\bArm Holdings\b|\bArm Limited\b/, VRT: /\bVertiv\b/, TGT: /\bTarget Corporation\b/,
  SPCX: /\bSpace Exploration Technologies\b|\bSpaceX\b/,
  UBER: /\bUber Technologies\b/, ANT: /\bAnthropic\b/,
});

const str = (v) => (v == null ? "" : String(v));
const agencyText = (a) => `${str(a?.slug)} ${str(a?.name)} ${str(a?.raw_name)}`.toLowerCase();

// Normalize one API row (documents or public inspection) to our shape.
export function normalizeDoc(r, { pending = false } = {}) {
  if (!r || typeof r !== "object") return null;
  const id = str(r.document_number).trim();
  if (!id) return null;
  const agencies = Array.isArray(r.agencies) ? r.agencies.filter((a) => a && typeof a === "object") : [];
  const names = agencies.map((a) => str(a.name || a.raw_name).trim()).filter(Boolean);
  if (!names.length && Array.isArray(r.agency_names)) names.push(...r.agency_names.map(str).filter(Boolean));
  const abstract = str(r.abstract || r.excerpts || [r.subject_1, r.subject_2, r.subject_3].filter(Boolean).join(" "));
  return {
    id,
    date: str(r.publication_date).slice(0, 10) || null,
    type: str(r.type) || "Unknown",
    title: str(r.title).replace(/\s+/g, " ").trim().slice(0, 240),
    abstract: abstract.replace(/\s+/g, " ").trim().slice(0, 600),
    agencies: names.slice(0, 4),
    agencyText: (agencies.length ? agencies.map(agencyText) : names.map((n) => n.toLowerCase())).join(" | "),
    url: str(r.html_url) || null,
    significant: r.significant === true,
    pending,
  };
}

// Tag one normalized document. Returns { tickers, why, market } or null when
// the document is not kept.
export function tagDoc(doc, covered = null) {
  if (!doc) return null;
  const ok = (s) => !covered || covered.has(s);
  const hit = new Map();
  const add = (sym, why) => { if (!ok(sym)) return; if (!hit.has(sym)) hit.set(sym, new Set()); hit.get(sym).add(why); };
  const text = `${doc.title} ${doc.abstract}`;
  let topicOrName = false;
  for (const rule of TOPIC_RULES) {
    if (rule.re.test(text)) { topicOrName = true; for (const s of rule.tickers) add(s, `topic:${rule.id}`); }
  }
  for (const [sym, re] of Object.entries(FR_NAMES)) {
    if (re.test(text)) { topicOrName = true; add(sym, "name"); }
  }
  const ruleKind = RULE_KINDS.has(doc.type);
  const agencies = AGENCY_RULES.filter((a) => a.match.some((m) => doc.agencyText.includes(m)));
  if (ruleKind || topicOrName) {
    for (const a of agencies) for (const s of a.tickers) {
      // A notice from a mapped agency adds that agency's stocks only when a
      // topic or name already made it worth keeping.
      add(s, `agency:${a.id}`);
    }
  }
  const presidential = doc.type === "Presidential Document";
  if (!hit.size && !presidential) return null;
  const tickers = [...hit.keys()].sort();
  const why = {};
  for (const s of tickers) why[s] = [...hit.get(s)].sort();
  return { tickers, why, market: presidential };
}

// Parse one documents.json page: { results, nextUrl }.
export function parseDocsPage(body) {
  let j = body;
  if (typeof body === "string") { try { j = JSON.parse(body); } catch { return null; } }
  if (!j || typeof j !== "object" || !Array.isArray(j.results)) {
    return j && typeof j === "object" && Number(j.count) === 0 ? { results: [], nextUrl: null, total: 0 } : null;
  }
  return { results: j.results, nextUrl: typeof j.next_page_url === "string" && j.next_page_url ? j.next_page_url : null, total: Number(j.count) || j.results.length };
}

export function docsUrl(sinceIso, page = 1) {
  const p = new URLSearchParams();
  p.set("per_page", String(FR_PER_PAGE));
  p.set("page", String(page));
  p.set("order", "newest");
  p.set("conditions[publication_date][gte]", sinceIso);
  for (const f of FR_FIELDS) p.append("fields[]", f);
  return `${FR_DOCS_URL}?${p.toString()}`;
}

async function getJson(url, { fetchImpl, timeoutMs }) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "stonks-app market-data pipeline (https://mingstreet.app)", accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return text;
}

// Read the last `lookbackDays` of documents and today's public inspection
// list. Returns { docs: [tagged doc], calls, scanned, errors, ok }. `ok` is
// false only when the documents read failed outright (the inspection list is
// a bonus; its failure is an error line, not a failed read).
export async function readFederalRegister({ todayIso, covered = null, fetchImpl = globalThis.fetch, lookbackDays = FR_LOOKBACK_DAYS, timeoutMs = FR_TIMEOUT_MS, maxPages = FR_MAX_PAGES, log = () => {} } = {}) {
  const since = new Date(Date.parse(`${todayIso}T00:00:00Z`) - lookbackDays * 86400000).toISOString().slice(0, 10);
  const errors = [];
  let calls = 0, scanned = 0, ok = true;
  const byId = new Map();
  const keep = (raw, pending) => {
    const d = normalizeDoc(raw, { pending });
    if (!d) return;
    scanned += 1;
    const tag = tagDoc(d, covered);
    if (!tag) return;
    const { agencyText: _drop, ...rest } = d;
    // A published copy replaces the same document seen in public inspection.
    if (byId.has(d.id) && !byId.get(d.id).pending && pending) return;
    byId.set(d.id, { ...rest, ...tag });
  };
  try {
    let url = docsUrl(since, 1);
    for (let page = 1; url && page <= maxPages; page += 1) {
      calls += 1;
      const parsed = parseDocsPage(await getJson(url, { fetchImpl, timeoutMs }));
      if (!parsed) throw new Error("not a documents page");
      for (const r of parsed.results) keep(r, false);
      url = parsed.nextUrl;
    }
  } catch (err) {
    ok = false;
    errors.push(`documents: ${String(err?.message || err).split("\n")[0]}`);
  }
  try {
    calls += 1;
    const parsed = parseDocsPage(await getJson(FR_PI_URL, { fetchImpl, timeoutMs }));
    if (!parsed) throw new Error("not an inspection list");
    for (const r of parsed.results) keep(r, true);
  } catch (err) {
    errors.push(`public inspection: ${String(err?.message || err).split("\n")[0]}`);
  }
  const docs = [...byId.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.id.localeCompare(b.id));
  log(`  · Federal Register: ${scanned} documents scanned, ${docs.length} kept, ${calls} calls${errors.length ? `, ${errors.length} error(s)` : ""}`);
  return { docs, calls, scanned, errors, ok };
}
