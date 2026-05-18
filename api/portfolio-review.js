// Vercel serverless function: AI portfolio review.
//
// POST /api/portfolio-review
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { positions: [{ id, symbol, side, expiry, strike, quantity,
//                          entry_premium, created_at }] }
//
// Flow:
//   1. Verify the JWT via Supabase (using the service-role key server-side).
//   2. Hydrate each position with a live mid (Yahoo) + Greeks (Black-Scholes).
//   3. Hand the hydrated portfolio to Gemini and ask for sell/hold/roll
//      recommendations plus a portfolio-level summary.
//   4. Return JSON. Per-position errors degrade gracefully; one bad symbol
//      never blocks the whole review.

import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { fetchContract, fetchQuote, isValidSymbol } from "../lib/yahoo.mjs";
import { greeks, yearsToExpiry, bsPrice } from "../lib/greeks.mjs";

const MAX_POSITIONS = 50;
const RFR = 0.045;

function midOf(row) {
  if (row == null) return null;
  if (row.b != null && row.a != null && row.b > 0 && row.a > 0) {
    return (row.b + row.a) / 2;
  }
  return row.l ?? null;
}

function clean(s) {
  return String(s || "").slice(0, 60);
}

async function verifyUser(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "missing bearer token" };
  const token = m[1];

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: "supabase not configured" };

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "invalid token" };
  return { user: data.user };
}

async function hydratePosition(p) {
  if (!isValidSymbol(p.symbol)) {
    return { id: p.id, error: "invalid symbol" };
  }
  const T = yearsToExpiry(p.expiry);
  const expired = p.expiry * 1000 < Date.now();

  try {
    const row = await fetchContract(p.symbol, p.expiry, p.side, p.strike);
    const spot = row?.spot ?? (await fetchQuote(p.symbol)).spot;
    let mid = midOf(row);
    if (mid == null && row?.iv && spot != null && !expired) {
      mid = bsPrice(p.side, spot, p.strike, T, row.iv, RFR);
    }
    const g =
      row?.iv && spot != null && !expired
        ? greeks(p.side, spot, p.strike, T, row.iv, RFR)
        : null;

    const entry = Number(p.entry_premium);
    const pnlPerContract = mid != null ? mid - entry : null;
    const pnlPct = mid != null && entry > 0 ? ((mid - entry) / entry) * 100 : null;
    const totalPnl =
      pnlPerContract != null ? pnlPerContract * Number(p.quantity) * 100 : null;
    const breakeven =
      p.side === "call" ? Number(p.strike) + entry : Number(p.strike) - entry;
    const breakevenDistPct =
      spot != null ? ((breakeven - spot) / spot) * 100 * (p.side === "call" ? 1 : -1) : null;
    const moneynessPct =
      spot != null ? ((spot - Number(p.strike)) / Number(p.strike)) * 100 : null;

    return {
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      strike: Number(p.strike),
      expiry: Number(p.expiry),
      daysToExpiry: Math.max(0, Math.round((p.expiry * 1000 - Date.now()) / 86400000)),
      quantity: Number(p.quantity),
      entryPremium: entry,
      spot,
      currentMid: mid,
      iv: row?.iv ?? null,
      openInterest: row?.oi ?? null,
      volume: row?.v ?? null,
      pnlPerContract,
      pnlPct,
      totalPnl,
      breakeven,
      breakevenDistPct,
      moneynessPct,
      greeks: g,
      expired,
      marketState: row?.marketState ?? null,
    };
  } catch (err) {
    return { id: p.id, symbol: p.symbol, error: String(err?.message || err).slice(0, 160) };
  }
}

function buildPrompt(hydrated) {
  const positionsForAI = hydrated.map((h) => ({
    id: h.id,
    symbol: h.symbol,
    side: h.side,
    strike: h.strike,
    daysToExpiry: h.daysToExpiry,
    expired: !!h.expired,
    quantity: h.quantity,
    entryPremium: h.entryPremium,
    currentMid: h.currentMid,
    spot: h.spot,
    pnlPct: h.pnlPct != null ? Math.round(h.pnlPct * 10) / 10 : null,
    totalPnl: h.totalPnl != null ? Math.round(h.totalPnl) : null,
    breakevenDistPct:
      h.breakevenDistPct != null ? Math.round(h.breakevenDistPct * 10) / 10 : null,
    moneynessPct: h.moneynessPct != null ? Math.round(h.moneynessPct * 10) / 10 : null,
    iv: h.iv != null ? Math.round(h.iv * 1000) / 1000 : null,
    delta: h.greeks?.delta != null ? Math.round(h.greeks.delta * 100) / 100 : null,
    thetaDay: h.greeks?.thetaDay != null ? Math.round(h.greeks.thetaDay * 100) / 100 : null,
    gamma: h.greeks?.gamma != null ? Math.round(h.greeks.gamma * 1000) / 1000 : null,
    vega: h.greeks?.vega != null ? Math.round(h.greeks.vega * 100) / 100 : null,
    error: h.error || null,
  }));

  return `You are a disciplined options trader reviewing a retail user's portfolio.
For EACH position, recommend one action ("sell", "hold", or "roll") and a short reason.
Then write a portfolio-level summary: concentration risk, theta bleed, IV-crush exposure,
and any hedge ideas. Be specific and direct. Plain English. No disclaimers. No emojis.

Rules of thumb:
- Big winner (>50% up) with limited remaining upside → consider selling or rolling up.
- Theta-decaying near-the-money with <14 days → flag the bleed; recommend exit or roll out.
- Deep ITM with high delta → suggest taking profit or rolling to lock gains.
- Losing position with no catalyst before expiry → cut losses.
- Expired positions → mark "sell" with reason "expired, close to realize".
- Heavy concentration in one ticker/sector → call it out in the portfolio summary.

Positions:
${JSON.stringify(positionsForAI, null, 2)}`;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    perPosition: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["sell", "hold", "roll", "unknown"] },
          headline: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["id", "action", "headline", "reasoning"],
      },
    },
    portfolio: {
      type: "object",
      properties: {
        summary: { type: "string" },
        concentrationWarnings: { type: "array", items: { type: "string" } },
        hedgeSuggestions: { type: "string" },
      },
      required: ["summary"],
    },
  },
  required: ["perPosition", "portfolio"],
};

// Primary model: gemini-3-flash — newest reasoning-grade Flash on the free
// tier, best at structured JSON output. Capped at 20 RPD on free tier.
// Fallback: gemini-3.1-flash-lite — 500 RPD, slightly weaker reasoning,
// kicks in when the primary returns 429 / quota-exhausted so the feature
// never goes dark. Both overridable via env vars.
const PRIMARY_MODEL = process.env.PORTFOLIO_REVIEW_MODEL || "gemini-3-flash";
const FALLBACK_MODEL =
  process.env.PORTFOLIO_REVIEW_FALLBACK_MODEL || "gemini-3.1-flash-lite";

function isQuotaError(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    err?.status === 429 ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted")
  );
}

async function generateReview(ai, model, prompt) {
  const resp = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  });
  const text = resp?.text || resp?.response?.text?.() || "";
  return JSON.parse(text);
}

async function aiReview(hydrated) {
  if (!process.env.GEMINI_API_KEY) {
    return { error: "ai_unavailable", reason: "GEMINI_API_KEY not set" };
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = buildPrompt(hydrated);

  try {
    return { ai: await generateReview(ai, PRIMARY_MODEL, prompt), model: PRIMARY_MODEL };
  } catch (primaryErr) {
    // Only fall back on quota / rate-limit errors. Other failures (bad
    // prompt, schema mismatch) would just repeat on the fallback model.
    if (!isQuotaError(primaryErr) || PRIMARY_MODEL === FALLBACK_MODEL) {
      return {
        error: "ai_unavailable",
        reason: String(primaryErr?.message || primaryErr).slice(0, 200),
      };
    }
    try {
      return {
        ai: await generateReview(ai, FALLBACK_MODEL, prompt),
        model: FALLBACK_MODEL,
        usedFallback: true,
      };
    } catch (fallbackErr) {
      return {
        error: "ai_unavailable",
        reason: `primary (${PRIMARY_MODEL}) quota exhausted; fallback (${FALLBACK_MODEL}) failed: ${String(fallbackErr?.message || fallbackErr).slice(0, 160)}`,
      };
    }
  }
}

function totalPortfolioPnlPct(hydrated) {
  let cost = 0;
  let value = 0;
  for (const h of hydrated) {
    if (h.error || h.entryPremium == null || h.quantity == null) continue;
    cost += h.entryPremium * h.quantity * 100;
    if (h.currentMid != null) value += h.currentMid * h.quantity * 100;
    else value += h.entryPremium * h.quantity * 100; // unknown → treat as flat
  }
  if (cost <= 0) return null;
  return ((value - cost) / cost) * 100;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const auth = await verifyUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const positions = Array.isArray(body.positions) ? body.positions : null;
  if (!positions || positions.length === 0) {
    return res.status(400).json({ error: "no positions" });
  }
  if (positions.length > MAX_POSITIONS) {
    return res.status(400).json({ error: `too many positions (max ${MAX_POSITIONS})` });
  }

  // Normalize symbol + side to keep prompt + Yahoo calls predictable.
  const normalized = positions.map((p) => ({
    id: clean(p.id),
    symbol: String(p.symbol || "").toUpperCase().trim(),
    side: p.side === "put" ? "put" : "call",
    expiry: Number(p.expiry),
    strike: Number(p.strike),
    quantity: Math.max(1, Math.floor(Number(p.quantity) || 0)),
    entry_premium: Math.max(0, Number(p.entry_premium) || 0),
  }));

  const hydrated = await Promise.all(normalized.map(hydratePosition));
  const aiResult = await aiReview(hydrated);

  // Stitch AI text recs onto our deterministic numeric hydration. We don't
  // trust the AI to echo back numbers — those are computed server-side and
  // carried straight through to the client untouched.
  const aiById = new Map();
  if (aiResult.ai?.perPosition) {
    for (const r of aiResult.ai.perPosition) aiById.set(r.id, r);
  }

  const perPosition = hydrated.map((h) => {
    const rec = aiById.get(h.id);
    if (h.error) {
      return {
        ...h,
        action: "unknown",
        headline: "Couldn't price this contract",
        reasoning: h.error,
      };
    }
    if (!rec) {
      return {
        ...h,
        action: "unknown",
        headline: "AI review unavailable",
        reasoning: aiResult.reason || "no recommendation returned",
      };
    }
    return { ...h, action: rec.action, headline: rec.headline, reasoning: rec.reasoning };
  });

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({
    perPosition,
    portfolio: {
      totalPnlPct: totalPortfolioPnlPct(hydrated),
      summary: aiResult.ai?.portfolio?.summary || null,
      concentrationWarnings: aiResult.ai?.portfolio?.concentrationWarnings || [],
      hedgeSuggestions: aiResult.ai?.portfolio?.hedgeSuggestions || null,
      aiError: aiResult.error || null,
      aiModel: aiResult.model || null,
      usedFallback: !!aiResult.usedFallback,
    },
    generatedAt: new Date().toISOString(),
  });
}
