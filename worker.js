// Cloudflare Worker — personal CORS proxy for the Option Contract Rater.
//
// Why: public CORS proxies are flaky (rate-limited, blacklisted, or just down).
// A personal Worker on Cloudflare's free tier (100k requests/day) is reliable.
//
// Deploy in ~3 minutes:
//   1. Sign up at https://workers.cloudflare.com (free, no card required).
//   2. Click "Create" → "Worker", name it (e.g. "stonks-proxy"), then "Deploy".
//   3. Click "Edit code", paste this whole file in, click "Deploy".
//   4. Copy your Worker URL (e.g. https://stonks-proxy.<you>.workers.dev).
//   5. On the Rater page, click ⚙ and paste:  <your-worker-url>/?url=
//
// Or with wrangler:
//   npm i -g wrangler && wrangler deploy worker.js --name stonks-proxy
//
// Allowlist limits the proxy to upstream hosts the Rater actually uses,
// so it cannot be abused as an open proxy.

const ALLOWED_HOSTS = new Set([
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "cdn.cboe.com",
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const target = url.searchParams.get("url");
    if (!target) {
      return json({ error: "Missing ?url= parameter" }, 400);
    }

    let upstream;
    try { upstream = new URL(target); }
    catch { return json({ error: "Invalid url" }, 400); }

    if (!ALLOWED_HOSTS.has(upstream.hostname)) {
      return json({ error: "Host not allowed: " + upstream.hostname }, 403);
    }

    const upstreamRes = await fetch(upstream.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
      },
    });

    const headers = corsHeaders();
    const ct = upstreamRes.headers.get("content-type");
    if (ct) headers.set("Content-Type", ct);
    headers.set("Cache-Control", "public, max-age=30");

    return new Response(upstreamRes.body, { status: upstreamRes.status, headers });
  },
};

function corsHeaders() {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  return h;
}

function json(obj, status) {
  const h = corsHeaders();
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(obj), { status, headers: h });
}
