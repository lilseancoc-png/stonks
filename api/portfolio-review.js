// Vercel serverless function: AI portfolio review.
//
// POST /api/portfolio-review
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    {}  (positions are loaded server-side from the DB — clients used
//               to send them in the body, which let a caller poison their
//               own equity snapshot by fabricating prices)
//
// Flow:
//   1. Verify the JWT via Supabase (using the service-role key server-side).
//   2. Load the caller's open positions from the DB (closed_at IS NULL).
//   3. Hydrate each position with a live mid (Yahoo) + Greeks (Black-Scholes).
//   4. Hand the hydrated portfolio to Gemini and ask for sell/hold/roll/
//      trim-to-cost recommendations plus a portfolio-level summary.
//   5. Upsert today's equity snapshot (used by the equity chart).
//   6. Return JSON. Per-position errors degrade gracefully; one bad symbol
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

// JWT-scoped client: uses the public anon key so RLS policies apply, and
// passes the user's JWT in Authorization so auth.uid() resolves to them.
// Matches the pattern in close-position.js / delete-trade.js — RLS, not
// application-layer filtering, is the security boundary.
function userClient(token) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function verifyUser(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "missing bearer token" };
  const token = m[1];

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) return { error: "supabase not configured" };

  // Service-role client verifies the JWT and is also retained for the
  // server-computed snapshot upsert — portfolio_snapshots has no
  // INSERT/UPDATE policy by design (equity is computed from positions,
  // not user-writable), so RLS would reject a JWT-scoped write there.
  // Every read of user data (positions, trades) goes through the
  // JWT-scoped client so RLS enforces ownership at the DB layer.
  const svc = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) return { error: "invalid token" };
  const supabase = userClient(token);
  if (!supabase) return { error: "supabase not configured" };
  return { user: data.user, supabase, svc };
}

// Walk every SELL trade for this user and tally two numbers:
//   - realizedPnl:      cumulative profit, (exit - entry) * qty * 100. What
//                       the UI displays as "realized P/L".
//   - realizedProceeds: cumulative gross cash from sales, exit * qty * 100.
//                       Used for the equity formula so the chart stays
//                       continuous through a close — selling at the current
//                       mark should leave equity flat, not drop it by the
//                       cost basis.
// Returns zeros if the trades table isn't migrated yet (older deployments).
async function fetchRealizedFromTrades(supabase, userId) {
  const { data, error } = await supabase
    .from("trades")
    .select("quantity, price, side, positions!inner(entry_premium)")
    .eq("user_id", userId)
    .eq("side", "SELL");
  if (error) return { realizedPnl: 0, realizedProceeds: 0 };
  let realizedPnl = 0;
  let realizedProceeds = 0;
  for (const t of data || []) {
    const entry = Number(t.positions?.entry_premium ?? 0);
    const qty = Number(t.quantity);
    const price = Number(t.price);
    realizedPnl += (price - entry) * qty * 100;
    realizedProceeds += price * qty * 100;
  }
  return { realizedPnl, realizedProceeds };
}

// Upsert today's equity snapshot. Idempotent on (user_id, date) — running
// the review twice in one day overwrites with the latest marks. Best-effort:
// snapshot failures don't block the review response.
async function writeSnapshot(supabase, userId, hydrated, realized) {
  const realizedPnl = Number(realized?.realizedPnl || 0);
  const realizedProceeds = Number(realized?.realizedProceeds || 0);
  let openValue = 0;
  let costBasis = 0;
  let openCount = 0;
  for (const h of hydrated) {
    if (h.error || h.entryPremium == null || h.quantity == null) continue;
    const qty = Number(h.quantity);
    const ep = Number(h.entryPremium);
    // Skip the row entirely if entry premium isn't a finite number — a
    // single NaN poisons openValue/costBasis and the chart ends up with a
    // gap. Defense in depth against malformed legacy rows.
    if (!Number.isFinite(qty) || !Number.isFinite(ep)) continue;
    openCount += 1;
    costBasis += ep * qty * 100;
    let mark = h.currentMid != null ? Number(h.currentMid) : ep;
    if (!Number.isFinite(mark)) mark = ep;
    openValue += mark * qty * 100;
  }
  const unrealizedPnl = openValue - costBasis;
  // Equity = mark-to-market value of open positions + gross cash from all
  // prior sales. Stays continuous when a position closes: its mark drops
  // out of openValue but its sale price re-enters as proceeds, so a sale
  // at the live mark leaves equity unchanged (only profit/loss vs cost
  // basis nudges it — which is the whole point of the chart).
  const equity = openValue + realizedProceeds;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  // Supabase JS returns { error } rather than throwing for query failures,
  // so the previous try/catch only ever caught network-layer errors and let
  // RLS denials, validation failures, etc. fall through silently with the
  // snapshot row never written. Check the response and log loudly; only
  // swallow the "schema not migrated yet" case (PostgREST PGRST205 / 42P01)
  // so older deployments without the snapshots table still review cleanly.
  try {
    const { error } = await supabase
      .from("portfolio_snapshots")
      .upsert({
        user_id: userId,
        date: today,
        equity: Math.round(equity * 100) / 100,
        realized_pnl: Math.round(realizedPnl * 100) / 100,
        unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
        open_positions: openCount,
      }, { onConflict: "user_id,date" });
    if (error) {
      const code = error.code || "";
      const missingTable = code === "42P01" || code === "PGRST205"
        || /does not exist|not found in schema cache/i.test(error.message || "");
      if (!missingTable) {
        console.error("portfolio snapshot upsert failed", { code, message: error.message });
      }
    }
  } catch (err) {
    console.error("portfolio snapshot upsert threw", { message: String(err?.message || err) });
  }
  return { equity, unrealizedPnl, realizedPnl, realizedProceeds, date: today };
}

function ageDaysFrom(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
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
    // Expired positions don't have a tradable mid — Yahoo drops the chain
    // and BS can't price T<=0. Without a fallback, writeSnapshot treats the
    // position at entryPremium and equity stays flat across expiration. The
    // honest mark is intrinsic value at the current spot (0 if OTM); the
    // user-driven close will overwrite this once they record the actual
    // settlement.
    if (mid == null && expired) {
      if (spot != null && spot > 0) {
        mid = p.side === "call"
          ? Math.max(0, spot - p.strike)
          : Math.max(0, p.strike - spot);
      } else {
        mid = 0;
      }
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
    // Spot/strike must both be strictly positive — a zero or null on either
    // side would otherwise emit Infinity / NaN into the review payload.
    const strikeNum = Number(p.strike);
    const breakevenDistPct =
      spot != null && spot > 0
        ? ((breakeven - spot) / spot) * 100 * (p.side === "call" ? 1 : -1)
        : null;
    const moneynessPct =
      spot != null && strikeNum > 0
        ? ((spot - strikeNum) / strikeNum) * 100
        : null;
    const openedAt = p.opened_at || p.created_at || null;
    const ageDays = ageDaysFrom(openedAt);
    // "Just opened" heuristic — useful for the AI to recognize that a small
    // gain or loss on a fresh position isn't worth acting on yet.
    const recentlyOpened =
      ageDays != null && ageDays <= 3 && pnlPct != null && Math.abs(pnlPct) < 10;
    // ITM check from moneynessPct adjusted for direction.
    const isItm =
      moneynessPct != null
        ? (p.side === "call" ? moneynessPct >= 0 : moneynessPct <= 0)
        : null;

    return {
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      strike: Number(p.strike),
      expiry: Number(p.expiry),
      daysToExpiry: Math.max(0, Math.round((p.expiry * 1000 - Date.now()) / 86400000)),
      quantity: Number(p.quantity),
      entryPremium: entry,
      openedAt,
      ageDays,
      recentlyOpened,
      isItm,
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
    openedAt: h.openedAt,
    ageDays: h.ageDays,
    recentlyOpened: !!h.recentlyOpened,
    isItm: h.isItm,
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

CRITICAL: emit exactly one perPosition entry for EACH of the ${positionsForAI.length} positions below — even when the same ticker appears multiple times at different strikes/expirations. Treat every position as independent. Echo back each id exactly as given (do not modify, normalize, or merge them).

For each position recommend exactly ONE action from this list:
- "hold"           — let it run; thesis intact and time is on your side.
- "sell"           — close the position entirely.
- "trim-to-cost"   — sell enough contracts to recover the original cost basis, free-ride the rest.
- "roll"           — close the current contract and open a later-dated and/or further-strike one.

Use this rule of thumb tree for the action:

1. Expired → "sell" with reason "expired, close to realize".
2. Big winner with theta risk: (isItm OR pnlPct >= 100) AND daysToExpiry <= 40.
   - If the user still has high conviction on the name → "trim-to-cost" (take initial cost off, let the rest free-ride) OR "roll" (extend expiration / move strike out) to free up capital while keeping upside.
   - If conviction is fading → "sell" outright.
3. Theta acceleration zone: daysToExpiry <= 30 AND not ITM.
   - Surface that theta accelerates inside 30 days. Tilt toward "sell" or "roll" out unless the position is up materially.
4. Near-the-money with <14d and underwater → "sell"; theta bleed dominates.
5. Recently opened (recentlyOpened === true): small swings on a fresh position aren't actionable yet → "hold".
6. Losing position with no catalyst before expiry → "sell" to redeploy capital.

When recommending "trim-to-cost" or "roll", say which contracts to sell or what to roll into in plain English (e.g. "sell 2 of 5 to take cost off; let 3 free-ride", or "roll to the same strike 30+ days further out").

Then write a portfolio-level summary: concentration risk, theta bleed across positions inside 30 DTE, IV-crush exposure, and hedge ideas. Be specific and direct. Plain English. No disclaimers. No emojis.

Each per-position "reasoning" should briefly tie together: (a) market narrative on the underlying, (b) technicals (RSI / MACD / volume conviction), (c) fundamentals (analyst consensus, earnings backdrop), (d) the contract mechanics (theta runway, moneyness), and (e) the rule-of-thumb branch that drove the action.

Positions (${positionsForAI.length} total):
${JSON.stringify(positionsForAI, null, 2)}`;
}

// Deterministic fallback rec for positions the AI omitted or returned with
// a mismatched id. Uses simple P/L + DTE thresholds so the user always sees
// SOMETHING actionable, even on AI failure modes.
function deterministicRec(h) {
  if (h.expired) {
    return { action: "sell", headline: "Expired — close to realize", reasoning: "Position past expiry; close out to book P/L." };
  }
  if (h.pnlPct == null) {
    return { action: "hold", headline: "Live mark unavailable", reasoning: "Couldn't get a current quote for this contract; check your broker." };
  }
  // Recently opened — don't trigger on a small swing.
  if (h.recentlyOpened) {
    return { action: "hold", headline: "Just opened — give it room", reasoning: `Position is ${h.ageDays} day${h.ageDays === 1 ? "" : "s"} old with ${h.pnlPct >= 0 ? "+" : ""}${h.pnlPct.toFixed(1)}% move so far. Too early to act on this either way.` };
  }
  // Rule-of-thumb branch: ITM or +100% with ≤40 days — free-ride or roll.
  const itmOrDouble = h.isItm === true || h.pnlPct >= 100;
  if (itmOrDouble && h.daysToExpiry != null && h.daysToExpiry <= 40) {
    return {
      action: "trim-to-cost",
      headline: `${h.isItm ? "ITM" : `Up ${Math.round(h.pnlPct)}%`} with ${h.daysToExpiry}d left — take cost off, free-ride the rest`,
      reasoning: "Theta accelerates inside the last 30 days; with the position already in the money or doubled, selling enough contracts to recover your original cost locks the win and lets the remainder ride risk-free. If conviction is high and you want to keep full exposure, roll to a longer-dated strike instead.",
    };
  }
  if (h.pnlPct >= 50) {
    return { action: "roll", headline: `Up ${Math.round(h.pnlPct)}% — consider rolling up or trimming`, reasoning: "Big winner. Either roll to a higher strike (and/or later date) to lock some gains while keeping upside, or sell partial size." };
  }
  if (h.daysToExpiry != null && h.daysToExpiry <= 14 && h.pnlPct <= 0) {
    return { action: "sell", headline: `Underwater with ${h.daysToExpiry}d to expiry — theta bleed dominant`, reasoning: "Negative P/L this close to expiry rarely recovers; theta decay accelerates fast in the final two weeks." };
  }
  if (h.daysToExpiry != null && h.daysToExpiry <= 30 && h.pnlPct < 25) {
    return { action: "roll", headline: `${h.daysToExpiry}d left and no real lead — consider rolling out`, reasoning: "Inside 30 DTE theta accelerates; without a clear lead, rolling to a further-dated strike buys time without doubling exposure." };
  }
  if (h.pnlPct <= -50) {
    return { action: "sell", headline: `Down ${Math.round(-h.pnlPct)}% — likely no recovery before expiry`, reasoning: "Cut losses; capital is better redeployed than hoping for a sharp move." };
  }
  return { action: "hold", headline: `${h.pnlPct >= 0 ? "Up" : "Down"} ${Math.abs(Math.round(h.pnlPct))}% — nothing forcing the hand yet`, reasoning: `${h.daysToExpiry || "?"} days to expiry. Monitor for a clear directional move or a theta inflection point.` };
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
          symbol: { type: "string" },
          side: { type: "string" },
          strike: { type: "number" },
          expiry: { type: "number" },
          action: { type: "string", enum: ["sell", "hold", "roll", "trim-to-cost", "unknown"] },
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

// Primary model: gemini-2.5-flash — best reasoning Flash available on
// the free tier (20 RPD). Fallback: gemma-4-26b-a4b-it (1.5K RPD on
// free tier, same Gemma the daily build uses, no billing required).
// Pro models exist on Tier 1+ but require funded billing — even free-
// tier-available models fail with "prepayment credits depleted" once
// the project is moved to Tier 1 without funded credits.
//
// Both overridable via env vars — upgrade to gemini-2.5-pro or
// gemini-3.1-pro after adding billing in AI Studio without a code change.
const PRIMARY_MODEL = process.env.PORTFOLIO_REVIEW_MODEL || "gemini-2.5-flash";
const FALLBACK_MODEL =
  process.env.PORTFOLIO_REVIEW_FALLBACK_MODEL || "gemma-4-26b-a4b-it";

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

function isModelMissingError(err) {
  const msg = String(err?.message || err).toLowerCase();
  return (
    err?.status === 404 ||
    msg.includes("404") ||
    msg.includes("not found for api version") ||
    msg.includes("is not supported for")
  );
}

// Gemma respects responseMimeType: "application/json" but doesn't strictly
// honor responseSchema the way Gemini does, so it can emit JSON wrapped in
// a ```json ... ``` block or with leading prose. Extract the first
// balanced JSON object as a fallback when JSON.parse fails on the raw text.
function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch (_) {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  return null;
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
  const parsed = extractJson(text);
  if (!parsed) throw new Error("model returned non-JSON output");
  return parsed;
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
    // Fall back on quota errors AND model-missing errors (the latter
    // covers a stale env var pointing at a renamed/retired model — the
    // fallback is more likely to still exist).
    const transient = isQuotaError(primaryErr) || isModelMissingError(primaryErr);
    if (!transient || PRIMARY_MODEL === FALLBACK_MODEL) {
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
    const qty = Number(h.quantity);
    const ep = Number(h.entryPremium);
    if (!Number.isFinite(qty) || !Number.isFinite(ep)) continue;
    cost += ep * qty * 100;
    const cm = h.currentMid != null ? Number(h.currentMid) : ep;
    value += (Number.isFinite(cm) ? cm : ep) * qty * 100;
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

  // Load the caller's open positions from the DB. Trusting client-supplied
  // positions let a caller poison their own equity snapshot by submitting
  // fabricated prices/quantities.
  const { data: dbPositions, error: posErr } = await auth.supabase
    .from("positions")
    .select("id, symbol, side, expiry, strike, quantity, entry_premium, opened_at, created_at")
    .eq("user_id", auth.user.id)
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(MAX_POSITIONS + 1);
  if (posErr) {
    console.error("portfolio-review load failed", { code: posErr.code, message: posErr.message });
    return res.status(500).json({ error: "could not load positions" });
  }
  if (!dbPositions || dbPositions.length === 0) {
    return res.status(400).json({ error: "no positions" });
  }
  if (dbPositions.length > MAX_POSITIONS) {
    return res.status(400).json({ error: `too many positions (max ${MAX_POSITIONS})` });
  }

  // Normalize symbol + side to keep prompt + Yahoo calls predictable.
  const normalized = dbPositions.map((p) => ({
    id: clean(p.id),
    symbol: String(p.symbol || "").toUpperCase().trim(),
    side: p.side === "put" ? "put" : "call",
    expiry: Number(p.expiry),
    strike: Number(p.strike),
    quantity: Math.max(1, Math.floor(Number(p.quantity) || 0)),
    entry_premium: Math.max(0, Number(p.entry_premium) || 0),
    opened_at: p.opened_at || null,
    created_at: p.created_at || null,
  }));

  const hydrated = await Promise.all(normalized.map(hydratePosition));
  const aiResult = await aiReview(hydrated);

  // Realized P/L from prior SELL trades + today's equity snapshot. Both are
  // best-effort: if the new tables aren't migrated yet, the review still
  // returns a clean response without snapshot data.
  // Trades read goes through the JWT-scoped client so RLS enforces
  // ownership; snapshot write uses the service-role client because
  // portfolio_snapshots has no INSERT/UPDATE RLS policy (equity is
  // server-computed and intentionally not user-writable).
  let snapshot = null;
  try {
    const realized = await fetchRealizedFromTrades(auth.supabase, auth.user.id);
    snapshot = await writeSnapshot(auth.svc, auth.user.id, hydrated, realized);
  } catch (_) {
    snapshot = null;
  }

  // Stitch AI text recs onto our deterministic numeric hydration. We don't
  // trust the AI to echo back numbers — those are computed server-side and
  // carried straight through to the client untouched.
  //
  // Matching: try exact id first; if that misses (Gemma sometimes truncates
  // or normalizes UUIDs), fall back to a position-feature key — same symbol,
  // side, strike, and expiry uniquely identifies the position. If both miss,
  // use a deterministic P/L-based rec so the user never sees a blank row.
  const aiById = new Map();
  const aiByFeatures = new Map();
  const featureKey = (p) => `${p.symbol}|${p.side}|${p.strike}|${p.expiry}`;
  if (aiResult.ai?.perPosition) {
    for (const r of aiResult.ai.perPosition) {
      if (r.id) aiById.set(r.id, r);
      // The AI sometimes also echoes back the position context — match on
      // that too as a defensive fallback.
      if (r.symbol && r.strike != null && r.expiry != null) {
        aiByFeatures.set(featureKey({
          symbol: String(r.symbol).toUpperCase(),
          side: r.side === "put" ? "put" : "call",
          strike: Number(r.strike),
          expiry: Number(r.expiry),
        }), r);
      }
    }
  }

  const perPosition = hydrated.map((h) => {
    if (h.error) {
      return {
        ...h,
        action: "unknown",
        headline: "Couldn't price this contract",
        reasoning: h.error,
      };
    }
    const rec = aiById.get(h.id) || aiByFeatures.get(featureKey(h));
    if (rec && rec.action && rec.headline) {
      return { ...h, action: rec.action, headline: rec.headline, reasoning: rec.reasoning };
    }
    // AI didn't return a usable rec for this position — fall back to
    // deterministic P/L-based heuristics so the user always sees something.
    const det = deterministicRec(h);
    return { ...h, ...det };
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
      snapshot,
    },
    generatedAt: new Date().toISOString(),
  });
}
