// Compact, deterministic stock-news aggregation for data/news-feed.json.
//
// This module deliberately keeps two concepts separate:
//   - impact: how likely the event class is to matter to the stock
//   - direction: what the headline wording implies (if anything)
//
// The score is only a ranking device. The browser exposes the broad tier and
// the reasons, never a fake probability. No article bodies or premium Brief
// prose are shipped in the feed.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_MAX_ITEMS = 500;

const CATEGORY_RULES = [
  {
    id: "earnings",
    label: "Earnings",
    base: 54,
    why: "Earnings and guidance can reset near-term estimates.",
    re: /\b(earnings|quarterly results?|eps\b|revenue (?:beat|miss)|profit (?:beat|miss|warning)|guidance|outlook|forecast|preannounc|same-store sales)\b/i,
  },
  {
    id: "ma",
    label: "M&A",
    base: 54,
    why: "A takeover or asset sale can reprice the company quickly.",
    re: /\b(acquir(?:e|es|ed|ing|er)|acquisition|merger|takeover|buyout|strategic alternatives|sale process|agrees? to buy|bid for|go-private)\b/i,
  },
  {
    id: "regulatory",
    label: "Regulatory",
    base: 50,
    why: "Regulatory and court decisions can change the earnings path.",
    re: /\b(fda\b|sec\b|doj\b|ftc\b|antitrust|regulator|regulatory|approval|approved|reject(?:s|ed|ion)|investigation|probe|subpoena|ban(?:s|ned)?|sanction|court|lawsuit|settlement|patent ruling)\b/i,
  },
  {
    id: "capital",
    label: "Capital",
    base: 47,
    why: "Financing and capital returns change dilution, leverage, or per-share value.",
    re: /\b(share offering|stock offering|secondary offering|public offering|convertible notes?|debt offering|bond offering|capital raise|buyback|repurchase|dividend (?:hike|increase|cut|suspend)|stock split)\b/i,
  },
  {
    id: "legal-risk",
    label: "Company risk",
    base: 48,
    why: "A recall, breach, default, or accounting issue can create abrupt downside risk.",
    re: /\b(recall|data breach|cyberattack|hack(?:ed)?|bankrupt(?:cy)?|default|restatement|accounting irregularit|fraud|whistleblower|delist(?:ing)?)\b/i,
  },
  {
    id: "contract",
    label: "Contract",
    base: 43,
    why: "A material order or customer win can change expected revenue.",
    re: /\b(wins? (?:an? )?(?:[\w$%-]+ ){0,5}(?:contract|order)|awarded? (?:an? )?(?:[\w$%-]+ ){0,5}(?:contract|deal)|contract (?:win|award)|order worth|supply agreement|customer agreement|strategic partnership|lands? (?:an? )?(?:[\w$%-]+ ){0,5}(?:deal|contract))\b/i,
  },
  {
    id: "clinical",
    label: "Clinical",
    base: 50,
    why: "Trial and drug decisions are binary catalysts for healthcare names.",
    re: /\b(clinical trial|phase (?:1|2|3|i|ii|iii)\b|trial results?|primary endpoint|drug approval|therapy approval)\b/i,
  },
  {
    id: "leadership",
    label: "Leadership",
    base: 42,
    why: "An abrupt senior-leadership change can shift strategy and confidence.",
    re: /\b(ceo|cfo|chief executive|chief financial officer|chair(?:man|woman)?|founder)\b.*\b(resign|retir|steps? down|depart|appoint|named|oust)/i,
  },
  {
    id: "product",
    label: "Product",
    base: 36,
    why: "A meaningful launch or product issue can change demand expectations.",
    re: /\b(launch(?:es|ed|ing)?|unveil(?:s|ed)?|release(?:s|d)?|new product|product delay|production delay|shipment|deliveries)\b/i,
  },
  {
    id: "analyst",
    label: "Analyst",
    base: 29,
    why: "A rating or target change can move positioning, but usually matters less than hard results.",
    re: /\b(upgrade[sd]?|downgrade[sd]?|price target|initiates? (?:coverage|at)|rating (?:raised|cut)|outperform|underperform|overweight|underweight)\b/i,
  },
  {
    id: "workforce",
    label: "Restructuring",
    base: 35,
    why: "Layoffs or restructuring can change costs and signal demand stress.",
    re: /\b(layoffs?|job cuts?|restructur(?:e|es|ed|ing)|workforce reduction|plant clos(?:e|es|ed|ure))\b/i,
  },
  {
    id: "market",
    label: "Market",
    base: 34,
    why: "Macro news can move the whole tape and the stock's sector with it.",
    re: /\b(fed\b|fomc|interest rates?|rate cut|rate hike|inflation|cpi\b|ppi\b|payrolls?|jobs report|tariffs?|trade war|oil prices?|treasury yields?|recession|geopolit|war\b)\b/i,
  },
];

const POSITIVE_RE = /\b(beat(?:s|ing)?|tops? estimates?|raises? guidance|boosts? (?:guidance|outlook)|approv(?:al|e[sd]?)|clear(?:s|ed)?|wins?|won|awarded|buyback|repurchase|upgrade[sd]?|outperform|record (?:revenue|sales|profit)|surges?|jumps?|rallies|stronger|accelerat(?:es|ing)|expands?|dismiss(?:ed|es)|settles? in favor)\b/gi;
const NEGATIVE_RE = /\b(miss(?:es|ed)?|cuts? guidance|lowers? (?:guidance|outlook)|profit warning|downgrade[sd]?|underperform|investigat(?:es|ion)|probe|lawsuit|sued|recall|reject(?:s|ed|ion)|den(?:y|ies|ied)|bankrupt(?:cy)?|default|breach|hack(?:ed)?|layoffs?|job cuts?|resign(?:s|ed)?|steps? down|offering|dilut(?:es|ion)|falls?|drops?|slumps?|plunges?|weaker|loss widens?|halts?|delist(?:ing)?|antitrust)\b/gi;
const RUMOR_RE = /\b(rumou?r|reportedly|explores?|weighs?|may (?:buy|sell|acquire)|could (?:buy|sell|acquire)|in talks?|considering)\b/i;
const CLICKBAIT_RE = /\b(top \d+|\d+ stocks? to|should you buy|is .* a buy|why .* stock (?:is|was) (?:up|down)|prediction|forecast for \d{4}|could make you rich|millionaire-maker)\b/i;
const MATERIAL_NUMBER_RE = /(?:\$\s?\d|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:million|billion|trillion|m|b)\b)/i;
const TOP_SOURCE_RE = /\b(reuters|associated press|ap news|sec\b|fda\b|business wire|globe newswire)\b/i;
const MAJOR_SOURCE_RE = /\b(bloomberg|wall street journal|wsj|financial times|cnbc|marketwatch|barron|fortune|forbes)\b/i;

function safeHttpUrl(value) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function cleanText(value, max = 240) {
  const out = String(value || "").replace(/\s+/g, " ").trim();
  return out.length > max ? out.slice(0, max - 1).trim() + "…" : out;
}

export function normalizeNewsTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+-\s+(?:reuters|bloomberg|cnbc|marketwatch|yahoo finance|associated press|wsj|barron's?)\s*$/i, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFor(text, scope) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return rule;
  }
  if (scope === "market") return CATEGORY_RULES.find((r) => r.id === "market");
  return {
    id: "company",
    label: "Company",
    base: 18,
    why: "Company-specific coverage is useful context until a harder catalyst appears.",
  };
}

function directionFor(text) {
  let positive = (text.match(POSITIVE_RE) || []).length;
  let negative = (text.match(NEGATIVE_RE) || []).length;
  // Common guidance wording inserts a metric/timeframe between the verb and
  // "guidance" ("raises quarterly revenue guidance"). Catch that without
  // treating every generic use of "raises" as favorable.
  if (/\b(?:raise[sd]?|boost(?:s|ed)?)\b[^.;:]{0,60}\b(?:guidance|outlook|forecast|target)\b/i.test(text)) positive += 2;
  if (/\b(?:cut[sd]?|lower(?:s|ed)?)\b[^.;:]{0,60}\b(?:guidance|outlook|forecast|target)\b/i.test(text)) negative += 2;
  if (positive && negative) return "mixed";
  if (positive) return "positive";
  if (negative) return "negative";
  return "unclear";
}

function strongestReaction(symbols, chains) {
  let best = null;
  for (const symbol of symbols) {
    const volume = chains?.[symbol]?.technicals?.volume || {};
    const movePct = Number(volume.priceMove1dPct);
    const rvol = Number(volume.rvol);
    if (!Number.isFinite(movePct) && !Number.isFinite(rvol)) continue;
    const strength = (Number.isFinite(movePct) ? Math.abs(movePct) : 0)
      + (Number.isFinite(rvol) ? Math.max(0, rvol - 1) * 2 : 0);
    if (!best || strength > best._strength) {
      best = {
        symbol,
        movePct: Number.isFinite(movePct) ? Math.round(movePct * 100) / 100 : null,
        rvol: Number.isFinite(rvol) ? Math.round(rvol * 100) / 100 : null,
        _strength: strength,
      };
    }
  }
  if (!best) return null;
  const active = Math.abs(best.movePct || 0) >= 2 || (best.rvol || 0) >= 1.5;
  const { _strength, ...out } = best;
  return { ...out, active };
}

function sourceBoost(sources) {
  const joined = sources.join(" ");
  if (TOP_SOURCE_RE.test(joined)) return 10;
  if (MAJOR_SOURCE_RE.test(joined)) return 7;
  return 3;
}

export function classifyNewsHeadline(input, now = new Date()) {
  const title = cleanText(input?.title, 260);
  const scope = input?.scope === "market" ? "market" : "company";
  const category = categoryFor(title, scope);
  const publishedMs = Date.parse(input?.publishedAt || "");
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const ageHours = Number.isFinite(publishedMs) && Number.isFinite(nowMs)
    ? Math.max(0, (nowMs - publishedMs) / 3600000)
    : null;
  const sources = Array.isArray(input?.sources) ? input.sources.filter(Boolean) : [];
  const reaction = input?.reaction || null;
  const unconfirmed = RUMOR_RE.test(title);

  let score = category.base;
  if (ageHours == null) score -= 15;
  else if (ageHours <= 6) score += 20;
  else if (ageHours <= 24) score += 16;
  else if (ageHours <= 72) score += 10;
  else score += 4;
  score += sourceBoost(sources);
  if (sources.length > 1) score += Math.min(8, (sources.length - 1) * 4);
  if (MATERIAL_NUMBER_RE.test(title)) score += 5;
  if (unconfirmed) score -= 8;
  if (CLICKBAIT_RE.test(title) && category.id === "company") score -= 20;
  if (reaction && ageHours != null && ageHours <= 24) {
    const move = Math.abs(Number(reaction.movePct) || 0);
    const rvol = Number(reaction.rvol) || 0;
    if (move >= 3 && rvol >= 1.5) score += 8;
    else if (move >= 3 || rvol >= 1.5) score += 4;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Undated items cannot claim the highest attention tier, however material
  // their wording looks; freshness is part of what makes news actionable.
  let impact = score >= 70 ? "high" : score >= 45 ? "notable" : "context";
  if (ageHours == null && impact === "high") impact = "notable";
  return {
    category: category.id,
    categoryLabel: category.label,
    impact,
    impactScore: score,
    impactReason: category.why,
    direction: directionFor(title),
    unconfirmed,
    ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
  };
}

function addRawStory(map, row, nowMs, windowMs) {
  const title = cleanText(row?.title, 260);
  if (!title) return;
  const key = normalizeNewsTitle(title);
  if (!key || key.length < 12) return;
  const publishedMs = Date.parse(row?.publishedAt || "");
  // Reject wildly future-dated feed errors and expire old stories. Undated
  // items are allowed but rank as context/notable at most.
  if (Number.isFinite(publishedMs)) {
    if (publishedMs - nowMs > 6 * 3600000) return;
    if (nowMs - publishedMs > windowMs) return;
  }
  const symbol = cleanText(row?.symbol, 12).toUpperCase();
  const source = cleanText(row?.publisher || row?.source, 80);
  const link = safeHttpUrl(row?.link);
  let story = map.get(key);
  if (!story) {
    story = {
      key,
      title,
      publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
      publishedMs: Number.isFinite(publishedMs) ? publishedMs : 0,
      link,
      symbols: new Set(),
      sources: new Set(),
      scope: symbol ? "company" : "market",
      fromBriefSlate: !!row?.fromBriefSlate,
      carried: !!row?.carried,
    };
    map.set(key, story);
  }
  if (symbol) story.symbols.add(symbol);
  if (source) story.sources.add(source);
  if (!story.link && link) story.link = link;
  if (Number.isFinite(publishedMs) && publishedMs > story.publishedMs) {
    story.publishedMs = publishedMs;
    story.publishedAt = new Date(publishedMs).toISOString();
  }
  if (symbol) story.scope = "company";
  story.fromBriefSlate = story.fromBriefSlate || !!row?.fromBriefSlate;
  // A fresh copy of the same story clears the carry-forward marker.
  story.carried = story.carried && !!row?.carried;
}

function priorRows(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.title) continue;
    const symbols = item.scope === "company" && Array.isArray(item.symbols) && item.symbols.length
      ? item.symbols
      : [null];
    for (const symbol of symbols) {
      out.push({
        symbol,
        title: item.title,
        publisher: item.publisher || (Array.isArray(item.sources) ? item.sources[0] : null),
        publishedAt: item.publishedAt || null,
        link: item.link || null,
        carried: true,
        fromBriefSlate: !!item.fromBriefSlate,
      });
    }
  }
  return out;
}

export function buildNewsFeedPayload({
  tickerHeadlines = [],
  marketHeadlines = [],
  chains = {},
  sectors = {},
  priorItems = [],
  builtAtIso = null,
  now = new Date(),
  windowDays = DEFAULT_WINDOW_DAYS,
  maxItems = DEFAULT_MAX_ITEMS,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const safeWindowDays = Math.max(1, Math.min(14, Number(windowDays) || DEFAULT_WINDOW_DAYS));
  const windowMs = safeWindowDays * DAY_MS;
  const stories = new Map();

  // Fresh rows win links/source metadata; recent prior rows are only a
  // graceful carry-forward for a transient ticker or market-feed outage.
  for (const row of tickerHeadlines) addRawStory(stories, row, safeNowMs, windowMs);
  for (const row of priorRows(priorItems)) addRawStory(stories, row, safeNowMs, windowMs);
  for (const h of marketHeadlines) {
    addRawStory(stories, {
      title: h?.title,
      publisher: h?.publisher || h?.source,
      publishedAt: h?.publishedAt || h?.at,
      link: h?.link,
      fromBriefSlate: true,
    }, safeNowMs, windowMs);
  }

  const items = [];
  for (const story of stories.values()) {
    const symbols = Array.from(story.symbols).sort();
    // Broad-market headlines use SPY/QQQ only for the optional active-tape
    // readout; they stay market-scoped and do not become ticker stories.
    const reaction = strongestReaction(symbols.length ? symbols : ["SPY", "QQQ"], chains);
    const sources = Array.from(story.sources).slice(0, 4);
    const classification = classifyNewsHeadline({
      title: story.title,
      scope: story.scope,
      sources,
      publishedAt: story.publishedAt,
      reaction,
    }, new Date(safeNowMs));
    const sectorList = Array.from(new Set(symbols.map((s) => sectors[s]).filter(Boolean))).sort();
    items.push({
      id: story.key.slice(0, 96),
      title: story.title,
      link: story.link,
      publisher: sources[0] || null,
      sources,
      publishedAt: story.publishedAt,
      scope: story.scope,
      symbols,
      sectors: sectorList,
      fromBriefSlate: story.fromBriefSlate,
      carried: story.carried,
      reaction,
      ...classification,
    });
  }

  items.sort((a, b) =>
    (b.impactScore - a.impactScore)
    || (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0)
    || a.title.localeCompare(b.title));
  const capped = items.slice(0, Math.max(1, Number(maxItems) || DEFAULT_MAX_ITEMS));
  const counts = {
    total: capped.length,
    high: capped.filter((i) => i.impact === "high").length,
    notable: capped.filter((i) => i.impact === "notable").length,
    company: capped.filter((i) => i.scope === "company").length,
    market: capped.filter((i) => i.scope === "market").length,
    activeTape: capped.filter((i) => i.reaction?.active && i.impact !== "context").length,
  };
  return {
    version: 1,
    builtAtIso: builtAtIso || nowDate.toISOString(),
    generatedAtIso: nowDate.toISOString(),
    windowDays: safeWindowDays,
    counts,
    items: capped,
  };
}
