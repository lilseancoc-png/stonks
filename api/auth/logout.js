// Vercel serverless function: clear the session cookie and return to the
// public welcome page. See docs/private-data-migration.md §4.5.

import { serializeCookie, SESSION_COOKIE } from "../../lib/session.mjs";

export default function handler(req, res) {
  const secure = String(req.headers["x-forwarded-proto"] || "https").includes("https");
  res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure }));
  res.statusCode = 302;
  res.setHeader("Location", "/welcome.html");
  res.end();
}
