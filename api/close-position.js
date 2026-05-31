// Vercel serverless function: close (sell) part or all of a position.
//
// POST /api/close-position
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { position_id, quantity, price }
//
// Flow:
//   1. Verify the JWT via Supabase service role.
//   2. Call the public.close_position RPC via a JWT-scoped (anon-key) client
//      so RLS enforces ownership at the DB layer. The function takes a row
//      lock, validates, inserts the SELL trade, and updates the position in
//      a single transaction — so two concurrent closes cannot over-sell.
//   3. Return the updated position + realized P/L delta.

import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// JWT-scoped client: uses the public anon key so RLS policies apply, and
// passes the user's JWT in Authorization so auth.uid() resolves to them.
function userClient(token) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function verifyUser(token) {
  const svc = serviceClient();
  if (!svc) return { error: "supabase not configured" };
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) return { error: "invalid token" };
  return { user: data.user };
}

// Map Postgres SQLSTATE / message hints from close_position() to HTTP status.
function statusForPgError(err) {
  const code = err?.code || "";
  if (code === "P0002") return 404;       // position not found
  if (code === "P0001") return 409;       // already closed
  if (code === "22023") return 400;       // invalid argument (quantity/price)
  if (code === "42883") return 500;       // function missing — schema not migrated
  return 500;
}

function publicMessage(err, fallback) {
  // The RPC's RAISE EXCEPTION messages are user-safe (no DB internals); pass
  // them through. Anything else gets a generic message so we don't leak
  // schema details from raw driver errors.
  const code = err?.code || "";
  if (code === "P0001" || code === "P0002" || code === "22023") {
    return String(err?.message || fallback).slice(0, 200);
  }
  return fallback;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const auth = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!auth) return res.status(401).json({ error: "missing bearer token" });
  const token = auth[1].trim();

  const verified = await verifyUser(token);
  if (verified.error) return res.status(401).json({ error: verified.error });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const position_id = String(body.position_id || "").trim();
  const quantity = Math.floor(Number(body.quantity) || 0);
  const price = Number(body.price);
  if (!position_id) return res.status(400).json({ error: "position_id required" });
  // Upper bounds keep a fat-fingered or malicious value from poisoning realized
  // P&L and the equity snapshot. The RPC re-checks these so the DB stays
  // authoritative regardless of caller.
  if (!(quantity > 0) || quantity > 100000) return res.status(400).json({ error: "quantity out of range" });
  if (!Number.isFinite(price) || price < 0 || price > 1000000) return res.status(400).json({ error: "price out of range" });

  const supabase = userClient(token);
  if (!supabase) return res.status(500).json({ error: "supabase not configured" });

  const { data, error } = await supabase.rpc("close_position", {
    p_position_id: position_id,
    p_quantity: quantity,
    p_price: price,
  });

  if (error) {
    console.error("close_position rpc failed", { code: error.code, message: error.message });
    const status = statusForPgError(error);
    return res.status(status).json({ error: publicMessage(error, "could not close position") });
  }

  // RPC returns SETOF — Supabase JS gives an array. Take the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return res.status(500).json({ error: "could not close position" });

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({
    position: {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      expiry: row.expiry,
      strike: row.strike,
      quantity: row.quantity,
      entry_premium: row.entry_premium,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
    },
    closed_quantity: quantity,
    close_price: price,
    realized_pnl: Number(row.realized_pnl),
  });
}
