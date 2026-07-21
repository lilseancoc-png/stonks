// Vercel serverless function: tiered read of a private data/ artifact.
//
// The policy and store response live in lib/data-response.mjs so this catch-all
// and api/auth/me's compatibility data mode cannot drift. This route remains a
// supported direct entry point; current browser bundles use the auth function
// because production has intermittently dropped its cookie at this function
// boundary. See docs/private-data-migration.md §4.4.

import { serveDataKey } from "../../lib/data-response.mjs";

export default async function handler(req, res) {
  // Derive the store key from the request URL path only. Never trust
  // req.query.path: a client-supplied query could otherwise override the file.
  let key = "";
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    key = decodeURIComponent(pathname.replace(/^\/api\/data\//, "")).replace(/^\/+/, "");
  } catch (_) {
    key = "";
  }
  return serveDataKey(req, res, key);
}
