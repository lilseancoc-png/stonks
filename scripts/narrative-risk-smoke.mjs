import assert from "node:assert/strict";
import { applyNarrativeRiskOverlays } from "./build.mjs";

const NOW = Date.parse("2026-08-14T16:00:00Z");
const baseNarrative = (extra = {}) => ({
  name: "AI Infrastructure Buildout",
  industry: "Semiconductors",
  sector: "Technology",
  thesis: "Hyperscaler AI capex supports accelerator and networking demand.",
  sentiment: "bullish",
  confidence: "high",
  strength: 82,
  status: "active",
  timeframe: "medium-term",
  lifecycleStage: "validation",
  lifecycleOutlook: null,
  bullCase: "Demand accelerates.",
  baseCase: "Demand remains firm.",
  bearCase: "Capex payback disappoints.",
  hype: { score: 30, label: "fundamentals", rationale: "Earnings support demand." },
  watchFor: ["Hyperscaler capex cuts"],
  conflictsWith: [],
  longs: ["NVDA", "AVGO", "TSM", "MU", "AMD"],
  shorts: [],
  sources: [],
  ...extra,
});
const overviews = { Technology: { stance: "bullish", strength: 72, score: 72, lifecycleStage: "validation", hype: { score: 28, label: "fundamentals", rationale: "Reported demand." }, industryGrades: [] } };
const apply = (n, ctx = {}) => applyNarrativeRiskOverlays([n], overviews, { chains: {}, previousHistory: [], nowMs: NOW, ...ctx });
const event = (symbol, surprisePct, guidance = "lowered", guidanceSrc = "call") => ({
  [symbol]: {
    earningsHx: { events: [{ date: "2026-08-10", surprisePct, guidance, guidanceSrc }] },
    fundamentals: {},
    technicals: { volume: { priceMove1dPct: -2 } },
  },
});

{
  const out = apply(baseNarrative(), { macroHeadlines: [{ publisher: "CNBC Top News", title: "Citadel Securities says higher for longer rates threaten growth stocks", publishedAt: "2026-08-14T13:00:00Z" }] });
  assert.equal(out.narratives[0].riskState, "watch", "high-influence hawkish language must stop a clean validated read");
  assert.equal(out.narratives[0].conflictFlags[0].category, "rate-hike-risk");
  assert.equal(out.sectorOverviews.Technology.score, 72, "risk overlay must not change deterministic sector score");
}

{
  const out = apply(baseNarrative(), { macroHeadlines: [{ publisher: "MarketWatch Top Stories", title: "Goldman Sachs warns AI capex spending slowdown could expose weak ROI", publishedAt: "2026-08-14T13:00:00Z" }] });
  assert.equal(out.narratives[0].riskState, "risk-rising", "high-influence AI-capex friction must accelerate the AI theme");
  assert.equal(out.narratives[0].lifecycleStage, "challenges");
  assert.ok(out.narratives[0].hype.score > 30);
  const reset = applyNarrativeRiskOverlays(out.narratives, out.sectorOverviews, { chains: {}, previousHistory: [], nowMs: NOW });
  assert.equal(reset.narratives[0].riskState, "none", "exact-cache reuse must recompute, not compound, an old overlay");
  assert.equal(reset.narratives[0].lifecycleStage, "validation");
  assert.equal(reset.sectorOverviews.Technology.lifecycleStage, "validation");
}

{
  const out = apply(baseNarrative(), { macroHeadlines: [{ publisher: "Unknown blog", title: "Higher for longer rates threaten stocks", publishedAt: "2026-08-14T13:00:00Z" }] });
  assert.equal(out.narratives[0].riskState, "none", "non-whitelisted influence must not force a macro conflict");
}

{
  const unusual = { scannedAt: "2026-08-14T15:00:00Z", tickers: [{ symbol: "NVDA", contracts: [{ side: "put", tape: "ask", flagged: true, deltaPremium: 2_000_000 }] }] };
  const out = apply(baseNarrative(), { unusual });
  assert.equal(out.narratives[0].riskState, "risk-rising", "current core-name aggressive flow must be decisive");
  assert.equal(out.narratives[0].lifecycleStage, "challenges");
}

{
  const chains = { NVDA: { earningsHx: { next: { date: "2026-08-18", daysUntil: 4 } }, fundamentals: {}, technicals: { volume: {} } } };
  const out = apply(baseNarrative(), { chains });
  assert.equal(out.narratives[0].riskState, "watch", "imminent keystone earnings must force Watch");
  assert.equal(out.narratives[0].earningsCheckpoint.rows[0].phase, "pre");
}

{
  const chains = event("AMD", -12);
  const out = apply(baseNarrative(), { chains });
  assert.equal(out.narratives[0].riskState, "none", "one peripheral hard miss must not kill a broad narrative");
}

{
  const chains = event("NVDA", -12);
  const out = apply(baseNarrative(), { chains });
  assert.equal(out.narratives[0].riskState, "risk-rising", "keystone hard miss plus official cut must escalate immediately");
  assert.equal(out.narratives[0].earningsCheckpoint.state, "risk-rising");
}

{
  const chains = { ...event("NVDA", -12), ...event("AVGO", -8), ...event("TSM", -7) };
  const out = apply(baseNarrative(), { chains });
  assert.equal(out.narratives[0].riskState, "invalidated", "critical-mass linked failures must invalidate the current story");
  assert.equal(out.narratives[0].lifecycleStage, "collapse");
}

{
  const chains = {
    ...event("NVDA", 9, "raised"),
    ...event("AVGO", 5, "inline"),
    ...event("TSM", 4, "raised"),
  };
  const out = apply(baseNarrative({ lifecycleStage: "amplification", status: "building" }), { chains });
  assert.equal(out.narratives[0].earningsCheckpoint.state, "confirmed");
  assert.equal(out.narratives[0].lifecycleStage, "validation", "majority confirmation should progress an early story toward validation");
  assert.ok(out.narratives[0].hype.score < 30, "confirmatory prints must strengthen the fundamentals side");
}

{
  const chains = event("NVDA", -12, "lowered", "news");
  const out = apply(baseNarrative(), { chains });
  assert.notEqual(out.narratives[0].riskState, "risk-rising", "news-derived guidance must not act like official guidance");
}

{
  const chains = {
    NVDA: {
      fundamentals: {},
      earningsHx: { events: [] },
      technicals: { volume: { priceMove1dPct: -8 } },
      news: { headlines: [{ publisher: "Reuters", title: "Fund forced liquidation hits crowded AI positions", publishedAt: "2026-08-14T14:00:00Z" }] },
    },
  };
  const first = apply(baseNarrative(), { chains });
  assert.equal(first.narratives[0].riskState, "fading");
  assert.ok(first.narratives[0].hype.score >= 50, "validated forced liquidation must rapidly degrade fundamentals-vs-hype");
  const prior = [{ date: "2026-08-14", narratives: [{ name: first.narratives[0].name, riskState: first.narratives[0].riskState, conflictFlags: first.narratives[0].conflictFlags }] }];
  const carried = applyNarrativeRiskOverlays([baseNarrative()], overviews, { chains: {}, previousHistory: prior, nowMs: Date.parse("2026-08-15T16:00:00Z") });
  assert.equal(carried.narratives[0].riskState, "fading", "sticky reversal conflict must stay locked through the headline window");
  assert.equal(carried.narratives[0].riskDays, 2, "consecutive risk days must annotate the 90-day trail");
}

console.log("narrative risk smoke: all checks passed");
