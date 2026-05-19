// Vercel serverless function: close (sell) part or all of a position.
//
// POST /api/close-position
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { position_id, quantity, price }
//
// Flow:
//   1. Verify the JWT via Supabase service role.
//   2. Load the caller's position (RLS enforces user_id match).
//   3. Validate: quantity > 0, quantity <= remaining, position not closed.
//   4. Insert a SELL trade row + decrement positions.quantity. When the
//      remaining quantity hits zero, mark closed_at instead of deleting so
//      the trade log keeps its FK and the equity history stays intact.
//   5. Return updated row + the realized P/L delta for this close.

import { createClient } from "@supabase/supabase-js";

function userClient(token) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function verifyUser(token) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: "supabase not configured" };
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "invalid token" };
  return { user: data.user, supabase };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const auth = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!auth) return res.status(401).json({ error: "missing bearer token" });
  const token = auth[1];

  const verified = await verifyUser(token);
  if (verified.error) return res.status(401).json({ error: verified.error });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const position_id = String(body.position_id || "").trim();
  const quantity = Math.floor(Number(body.quantity) || 0);
  const price = Number(body.price);
  if (!position_id) return res.status(400).json({ error: "position_id required" });
  if (!(quantity > 0)) return res.status(400).json({ error: "quantity must be a positive integer" });
  if (!(price >= 0)) return res.status(400).json({ error: "price must be a non-negative number" });

  const supabase = verified.supabase;
  const userId = verified.user.id;

  // Load the position. The service-role client bypasses RLS, so we filter
  // on user_id explicitly to ensure callers can only close their own rows.
  const { data: pos, error: loadErr } = await supabase
    .from("positions")
    .select("*")
    .eq("id", position_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!pos) return res.status(404).json({ error: "position not found" });
  if (pos.closed_at) return res.status(409).json({ error: "position already closed" });
  if (quantity > pos.quantity) {
    return res.status(400).json({ error: `quantity exceeds remaining (${pos.quantity})` });
  }

  // Insert the SELL trade. Done before the position update so that if the
  // update later fails, we don't have a stale position with no audit row.
  const { error: tradeErr } = await supabase.from("trades").insert({
    user_id: userId,
    position_id,
    side: "SELL",
    quantity,
    price,
  });
  if (tradeErr) return res.status(500).json({ error: tradeErr.message });

  const remaining = pos.quantity - quantity;
  const update = remaining > 0
    ? { quantity: remaining }
    : { quantity: 0, closed_at: new Date().toISOString() };

  const { data: updated, error: updErr } = await supabase
    .from("positions")
    .update(update)
    .eq("id", position_id)
    .eq("user_id", userId)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Realized P/L for this close. Option contracts are 100 shares each.
  const entry = Number(pos.entry_premium);
  const realizedPnl = (price - entry) * quantity * 100;

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({
    position: updated,
    closed_quantity: quantity,
    close_price: price,
    realized_pnl: realizedPnl,
  });
}
