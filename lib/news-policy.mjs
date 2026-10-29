// Shared source identity, content and evidence rules. No network or AI.
const normalize = (v) => String(v || "").normalize("NFKC").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const EDITORIAL = ["Reuters", "Bloomberg", "Wall Street Journal", "WSJ", "Financial Times", "FT", "Associated Press", "AP", "AP News", "MarketWatch", "CNBC", "Barron's", "The Economist", "New York Times", "The New York Times", "Washington Post", "Business Insider", "Insider", "Investor's Business Daily", "Investopedia", "Morningstar", "Dow Jones", "S&P Global", "Moody's", "Fitch", "FactSet", "Refinitiv", "Politico", "CNN", "CNN Business"];
const ANALYSIS = ["Motley Fool", "The Motley Fool", "Fool.com", "Zacks", "Benzinga", "InvestorPlace", "Investor's Place", "TheStreet", "Seeking Alpha", "24/7 Wall St", "24/7 Wall St.", "GuruFocus", "Simply Wall St", "PYMNTS", "Forbes", "Investing.com"];
const RELEASE = ["GlobeNewswire", "Globe Newswire", "PR Newswire", "Business Wire"];
const OFFICIAL = ["Federal Reserve", "BLS Employment Situation", "BLS CPI", "BLS PPI", "SEC Press", "FDA", "EIA", "Bureau of Labor Statistics", "Bureau of Economic Analysis", "U.S. Energy Information Administration"];
const kinds = new Map([...EDITORIAL.map(v => [normalize(v), "reporting"]), ...ANALYSIS.map(v => [normalize(v), "analysis"]), ...RELEASE.map(v => [normalize(v), "distributed-release"]), ...OFFICIAL.map(v => [normalize(v), "official"]), ["yahoo finance", "aggregator"], ["google finance", "aggregator"]]);
export function publisherKind(publisher) { return kinds.get(normalize(publisher)) || "unknown"; }
export function acceptedPublisher(publisher) { return publisherKind(publisher) !== "unknown"; }

export function newsDateIsCurrent(value, now = Date.now(), days = 7) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) && t <= now + 15 * 60000 && t >= now - days * 86400000;
}

export function usefulNewsSummary(title, text) {
  const words = normalize(title).split(" ").filter(Boolean);
  const extra = normalize(text).split(" ").filter(w => w.length > 2 && !words.includes(w));
  return String(text || "").length >= 80 && new Set(extra).size >= 8;
}

export function mergeTickerNewsRows(rows, now = Date.now(), limit = 20) {
  const byTitle = new Map();
  for (const row of rows) {
    if (!row?.title || !newsDateIsCurrent(row.publishedAt, now)) continue;
    const key = normalize(row.title);
    const prior = byTitle.get(key);
    const kind = publisherKind(row.publisher);
    const body = usefulNewsSummary(row.title, row.description || row.body) ? String(row.description || row.body) : "";
    const item = { ...row, body, bodyPublisher: body ? (row.bodyPublisher || row.publisher) : null, bodyLink: body ? (row.bodyLink || row.link) : null, contentKind: body ? (row.contentKind === "article-excerpt" ? "article-excerpt" : "rss-summary") : "headline", sourceKind: kind };
    if (!prior) byTitle.set(key, item);
    else {
      // Prefer real origin attribution, but retain the richer summary together
      // with its own origin. An aggregator copy is not independent reporting.
      const origin = prior.sourceKind === "aggregator" && kind !== "aggregator" ? item : prior;
      const rich = body.length > prior.body.length ? item : prior;
      byTitle.set(key, { ...origin, body: rich.body, contentKind: rich.contentKind, bodyPublisher: rich.body ? (rich.bodyPublisher || rich.publisher) : null, bodyLink: rich.body ? (rich.bodyLink || rich.link) : null });
    }
  }
  return [...byTitle.values()].sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0,limit);
}

const expandNegation = text => String(text || "").replace(/n['’]t\b/gi, " not");
const CONTRACT = /\b(?:contract|award(?:ed)?|deal|agreement|order|mandate|bookrunner|underwriter)\b/i;
const GUIDANCE = /\b(?:guidance|outlook|forecast|guided|guides)\b/i;
const TENTATIVE = /\b(?:rumou?r|reportedly|could|denies?|denied|no longer|not awarded)\b|\bmay\s+(?:\w+\s+){0,2}(?:win|lose|sign|receive|secure|raise|lower|cut|renew|acquire|get|announce|be)\b/i;
const GUIDE_UP = /\b(?:raises?|raised|boosts?|boosted|increases?|increased)\b[^.;:]{0,60}\b(?:guidance|outlook|forecast)\b/i;
const GUIDE_DOWN = /\b(?:cuts?|lowers?|lowered|reduces?|reduced|withdraws?|withdrew)\b[^.;:]{0,60}\b(?:guidance|outlook|forecast)\b/i;
const GUIDE_INLINE = /\b(?:reaffirms?|reaffirmed|maintains?|maintained|reiterates?|reiterated|unchanged)\b[^.;:]{0,60}\b(?:guidance|outlook|forecast)\b/i;
const CONTRACT_WON = /\b(?:wins?|won|awarded|secures?|secured|signs?|signed|renews?|renewed|selected|named)\b[^.;:]{0,70}\b(?:contract|deal|order|agreement|mandate|bookrunner|underwriter)\b/i;
const CONTRACT_LOST = /\b(?:loses?|lost|cancel(?:s|led|ed)|terminat(?:es|ed))\b[^.;:]{0,70}\b(?:contract|deal|order|agreement|mandate)\b/i;
const NEGATED_ACTION = /\b(?:no|not|never|without|fails? to|failed to)\b[^.;:]{0,30}\b(?:win|won|award|sign|secure|raise|raised|boost|increase|reaffirm|cut|lower|reduce)\b|\b(?:wins?|signs?|secures?)\s+no\b/i;
export function matchingSignalHeadline(signal, headlines, kind, now = Date.now()) {
  const pattern = kind === "contract" ? CONTRACT : GUIDANCE;
  const evidence = normalize(signal?.evidence);
  if (!evidence) return null;
  const tokens = evidence.split(" ").filter(w => w.length > 3);
  if (new Set(tokens).size < 3) return null;
  return (headlines || []).find(h => {
    const statement = expandNegation(h?.title);
    if (!newsDateIsCurrent(h?.publishedAt, now, kind === "contract" ? 30 : 14) || !pattern.test(statement) || TENTATIVE.test(statement) || NEGATED_ACTION.test(statement)) return false;
    // Matching words establish a citation, not the model's claimed outcome.
    // Require an explicit result and reject conflicting metric directions.
    if (kind === "contract") {
      if (signal.status === "won" && (!CONTRACT_WON.test(statement) || CONTRACT_LOST.test(statement))) return false;
      if (signal.status === "lost" && (!CONTRACT_LOST.test(statement) || CONTRACT_WON.test(statement))) return false;
    } else {
      if (signal.direction === "raised" && (!GUIDE_UP.test(statement) || GUIDE_DOWN.test(statement) || GUIDE_INLINE.test(statement))) return false;
      if (["lowered", "soft"].includes(signal.direction) && (!GUIDE_DOWN.test(statement) || GUIDE_UP.test(statement))) return false;
      if (signal.direction === "inline" && (!GUIDE_INLINE.test(statement) || GUIDE_UP.test(statement) || GUIDE_DOWN.test(statement))) return false;
    }
    if (signal.sourceId && h.sourceId && signal.sourceId !== h.sourceId) return false;
    const title = normalize(h.title);
    return title.includes(evidence) || evidence.includes(title) || (tokens.length >= 3 && tokens.every(t => title.split(" ").includes(t)));
  }) || null;
}

export function currentNewsSentiment(news, now = Date.now()) {
  if (!news || news.fallback || news.stale || !["bullish", "bearish", "neutral"].includes(news.sentiment)) return null;
  if (!newsDateIsCurrent(news.builtAt, now, 2)) return null;
  return (news.headlines || []).some(h => newsDateIsCurrent(h.publishedAt, now)) ? news.sentiment : null;
}

export function validNewsFeedPayload(data) {
  const strings = value => Array.isArray(value) && value.every(v => typeof v === "string");
  if (!data || !Array.isArray(data.items) || !data.items.every(item => item && typeof item.title === "string" && item.title.trim() && ["symbols","sectors","sources"].every(key => item[key] == null || strings(item[key])))) return false;
  if (data.sourceHealth != null && (!Array.isArray(data.sourceHealth) || !data.sourceHealth.every(s => s && typeof s.status === "string"))) return false;
  if (data.sourceCoverage != null && (typeof data.sourceCoverage !== "object" || Array.isArray(data.sourceCoverage) || !["issuerSymbols","fdaSymbols"].every(key => data.sourceCoverage[key] == null || strings(data.sourceCoverage[key])))) return false;
  return true;
}

// Enforce support before publishing claims, including cached extractions.
// An unsupported direction is missing, rather than an invented "none" read.
export function supportedNewsSignals(signals, headlines, now = Date.now()) {
  const out = {};
  for (const [key,kind,field,values] of [["majorContract","contract","status",["won","lost","none"]],["guidance","guidance","direction",["raised","inline","soft","lowered","none"]]]) {
    const signal = signals?.[key];
    if (!values.includes(signal?.[field])) continue;
    if (signal[field] === "none") { out[key] = {...signal}; continue; }
    const source = matchingSignalHeadline(signal, headlines, kind, now);
    if (source) out[key] = {...signal,sourceTitle:source.title,sourcePublishedAt:source.publishedAt,sourceUrl:source.link || null};
  }
  return Object.keys(out).length ? out : null;
}

export function headlineDirection(value) {
  // These are wording labels, not predictions. Separate independent clauses
  // so a favorable court outcome cannot erase an adverse product recall.
  const clauses = expandNegation(value).replace(/[’]/g, "'").split(/\s*(?:;|\bbut\b|\bwhile\b)\s*/i);
  let positive = false, negative = false;
  for (let text of clauses) {
    text = text.replace(/\brecalls?\b.{0,25}\b(?:early history|memories|achievements|anniversary)\b/gi, "");
    text = text.replace(/\b(?:denies?|denied)\b.{0,55}\b(?:rumou?r|acquisition|takeover|merger)\b/gi, "");
    // Negated adverse actions do not imply that an adverse action occurred.
    text = text.replace(/\b(?:no|not|without)\b[^.;:]{0,30}\b(?:recall|layoffs?|investigation|probe)\b/gi, "");
    text = text.replace(/\b(?:product )?recall\b.{0,15}\b(?:not required|not needed|ruled out)\b/gi, "");
    text = text.replace(/\b(?:did|does|has|have|is|was)\s+not\s+(?:raise[sd]?|boost(?:s|ed)?|increase[sd]?)\b[^.;:]{0,40}\b(?:guidance|outlook|forecast)\b/gi, "");
    const failedApproval = /\b(?:no|not|without)\s+(?:\w+\s+){0,3}(?:approval|approve[sd]?)\b|\bfail(?:s|ed)? to (?:gain|win|secure|receive)\b.{0,25}\bapproval\b/i.test(text);
    const failedEndpoint = /\bfail(?:s|ed)? to (?:meet|achieve)\b.{0,25}\bendpoint\b/i.test(text);
    if (failedApproval || failedEndpoint) { negative = true; continue; }
    const notDismissed = /\b(?:not|never)\s+(?:been\s+)?(?:dismissed|dropped|cleared)\b/i.test(text);
    const dismissed = !notDismissed && /\b(?:lawsuit|case|charges?|probe)\b.{0,45}\b(?:dismissed|dropped|cleared)\b|\b(?:wins?|secures?)\b.{0,30}\bdismissal\b/i.test(text);
    if (dismissed) {
      positive = true;
      text = text.replace(/\b(?:lawsuit|case|charges?|probe)\b/gi, "");
    }
    // "after FDA approval" is background to a realized recall, not a new
    // independent approval event. Independent clauses still yield Mixed.
    if (/\brecall(?:s|ed)?\b/i.test(text)) text = text.replace(/\bafter\b.{0,30}\b(?:approval|approved)\b/gi, "");
    if (GUIDE_UP.test(text) || CONTRACT_WON.test(text) || /\b(?:meets?|met|achieved)\b.{0,25}\bprimary endpoint\b/i.test(text) || /\b(?:beats?|tops? estimates?|approv(?:al|e[sd]?)|wins?|awarded|buyback|repurchase|upgrades?|upgraded|record (?:revenue|sales|profit)|surges?|jumps?|rallies)\b/i.test(text)) positive = true;
    if (GUIDE_DOWN.test(text) || CONTRACT_LOST.test(text) || /\b(?:miss(?:es|ed)?|profit warning|downgrades?|downgraded|investigation|probe|lawsuit|sued|recalls?|recalled|reject(?:s|ed|ion)|bankrupt(?:cy)?|default|breach|layoffs?|job cuts?|resigns?|steps? down|offering|dilution|falls?|drops?|slumps?|plunges?|antitrust)\b/i.test(text)) negative = true;
  }
  return positive && negative ? "mixed" : positive ? "positive" : negative ? "negative" : "unclear";
}

export function supportedCatalyst(catalyst, headlines, now = Date.now()) {
  const date = String(catalyst?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(date + "T00:00:00Z"), today = new Date(now).toISOString().slice(0,10);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== date || date < today || d.getUTCFullYear() !== new Date(now).getUTCFullYear()) return null;
  const h = (headlines || []).find(h => h.title === catalyst.sourceTitle && newsDateIsCurrent(h.publishedAt, now) && /^https?:\/\//.test(h.link || ""));
  if (!h) return null;
  const text = `${h.title}. ${h.body || ""}`;
  const month = d.toLocaleString("en-US", {month:"long",timeZone:"UTC"});
  const named = `\\b(?:${month}|${month.slice(0,3)}\\.?)\\s+${d.getUTCDate()}(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`;
  const datePattern = new RegExp(`\\b${date}\\b|${named}`, "gi");
  for (const match of text.matchAll(datePattern)) {
    if (match[1] && Number(match[1]) !== d.getUTCFullYear()) continue;
    const start = Math.max(text.lastIndexOf('. ', match.index), text.lastIndexOf(';', match.index));
    const next = text.indexOf('. ', match.index + match[0].length);
    const clause = expandNegation(text.slice(start < 0 ? 0 : start + 1, next < 0 ? text.length : next)).trim();
    const eventWords = normalize(catalyst.title).split(" ").filter(w => w.length > 2 && !["the", "for", "and", "with", "expected", "scheduled", "upcoming", "decision", "date", "event"].includes(w));
    const clauseWords = normalize(clause).split(" ");
    if (eventWords.length && !eventWords.every(w => clauseWords.includes(w))) continue;
    // A date mention in a historical or cancelled event is not a schedule.
    if (/\b(?:cancel(?:led|ed|s)?|cancell?ation|postpon(?:ed|es)|postponement|last year|previously held|was held|not (?:be )?held|not scheduled|no longer scheduled)\b/i.test(clause)) continue;
    if (!/\b(?:will|scheduled|set for|takes? place|to be held|on|hosts?)\b/i.test(clause)) continue;
    return { evidenceVersion: 2, dateEvidence: clause.slice(0,350), sourceTitle: h.title, sourceUrl: h.link, sourcePublishedAt: h.publishedAt };
  }
  return null;
}

// Old cache entries predate citation validation. Only carry entries produced
// by the validated path, retaining their original source publication date.
export function currentCachedCatalysts(catalysts, now = Date.now(), today = new Date(now).toISOString().slice(0, 10)) {
  return (Array.isArray(catalysts) ? catalysts : []).filter(c => {
    if (c?.evidenceVersion !== 2 || !c.dateEvidence || !c.sourceTitle || !/^https?:\/\//.test(c.sourceUrl || "") || !newsDateIsCurrent(c.sourcePublishedAt, now)) return false;
    const date = String(c.date || "");
    const parsed = Date.parse(date + "T00:00:00Z");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === date && date >= today;
  });
}
