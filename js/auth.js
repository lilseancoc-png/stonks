// Supabase auth bootstrap. Loaded as <script type="module"> so we can pull
// the SDK from the jsdelivr ESM CDN without a bundler.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Config can arrive two ways:
//   1. Inlined at build time as window.STONKS_SUPABASE (requires the env
//      vars to be present where build.mjs runs — i.e. GitHub Actions).
//   2. Fetched at runtime from /api/config (reads Vercel env vars). This
//      is the path that "just works" when the user only configures
//      Supabase in the Vercel dashboard, which is the common case.
// We try (1) first; if it's empty, we fall back to (2). Top-level await
// is fine — modern browsers support it in ES modules.
let cfg = window.STONKS_SUPABASE || {};
if (!cfg.url || !cfg.anonKey) {
  try {
    const r = await fetch("/api/config");
    if (r.ok) {
      const remote = await r.json();
      if (remote && remote.url && remote.anonKey) cfg = remote;
    }
  } catch (_) {
    // Network error or 404 — leave cfg empty, the portfolio tab will
    // show "sign-in not configured" instead of crashing.
  }
}
const configured = !!(cfg.url && cfg.anonKey);

export const supabase = configured
  ? createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function isConfigured() {
  return configured;
}

const listeners = new Set();

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(session) {
  for (const fn of listeners) {
    try { fn(session); } catch (err) { console.error(err); }
  }
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

export async function signInWithEmail(email) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const redirectTo = window.location.origin + window.location.pathname + "?pt=portfolio";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function signInWithOAuth(provider) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const redirectTo = window.location.origin + window.location.pathname + "?pt=portfolio";
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => emit(session));
  // Strip Supabase's #access_token hash from the URL after detectSessionInUrl
  // has consumed it, so refresh doesn't re-trigger anything.
  if (window.location.hash.includes("access_token")) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
