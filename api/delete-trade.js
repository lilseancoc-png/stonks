// Vercel serverless function: delete a SELL trade and reverse its
// position-side effect.
//
// POST /api/delete-trade
// Headers: Authorization: Bearer <supabase-jwt>
// Body:    { trade_id }
//
// Calls the public.delete_trade RPC, which atomically re-opens or restores
// quantity on the parent position and then deletes the trade row. Mirrors
// api/close-position.js -- same JWT verification + JWT-scoped client so RLS
// enforces ownership at the DB layer.

import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

function statusForPgError(err) {
  const code = err?.code || "";
  if (code === "P0002") return 404;       // trade or position not found
  if (code === "22023") return 400;       // invalid argument (non-SELL trade)
  if (code === "42883") return 500;       // function missing -- schema not migrated
  return 500;
}

function publicMessage(err, fallback) {
  const code = err?.code || "";
  if (code === "P0002" || code === "22023") {
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
  const trade_id = String(body.trade_id || "").trim();
  if (!trade_id) return res.status(400).json({ error: "trade_id required" });

  const supabase = userClient(token);
  if (!supabase) return res.status(500).json({ error: "supabase not configured" });

  const { data, error } = await supabase.rpc("delete_trade", {
    p_trade_id: trade_id,
  });

  if (error) {
    console.error("delete_trade rpc failed", { code: error.code, message: error.message });
    const status = statusForPgError(error);
    return res.status(status).json({ error: publicMessage(error, "could not delete trade") });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return res.status(500).json({ error: "could not delete trade" });

  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({
    position_id: row.position_id,
    position_quantity: row.position_quantity,
    position_closed_at: row.position_closed_at,
    reopened: !!row.reopened,
  });
}
