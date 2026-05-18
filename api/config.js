// Vercel serverless function: runtime Supabase config.
//
// Why this exists: the daily-build GitHub Action regenerates index.html
// but doesn't have access to Vercel's env vars, so the build-time
// STONKS_SUPABASE inject ends up empty for users who only configure
// secrets on Vercel. This endpoint reads the env vars at request time
// (on Vercel) and hands them to the browser.
//
// The values returned here are non-secret by design — the anon key is
// safe to ship publicly; Row Level Security in Postgres is what actually
// enforces per-user access. The service-role key is never returned here.

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  // 5-minute edge cache is fine — these values change roughly never, and
  // stale-while-revalidate lets a slightly stale config still serve while
  // we refresh.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=3600",
  );
  return res.status(200).json({
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  });
}
