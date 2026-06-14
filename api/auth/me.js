// Vercel serverless function: report the current session (for the app's
// "signed in as … · log out" chip). Always 200 with { authed } — never leaks
// why. See docs/private-data-migration.md §4.5.

import { getSession } from "../../lib/session.mjs";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!process.env.SESSION_SECRET) {
    return res.status(200).json({ authed: false });
  }
  const session = await getSession(req).catch(() => null);
  if (!session) return res.status(200).json({ authed: false });
  return res.status(200).json({
    authed: true,
    name: session.name || null,
    sub: session.sub || null,
  });
}
