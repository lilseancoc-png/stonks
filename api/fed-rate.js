// Vercel serverless function: live effective Federal Funds Rate.
//
// Surfaces the latest effective fed funds rate so the FOMC widget at the
// top of the Calendar tab stays fresh between daily builds. The rate is
// set once per business day (~16:00 ET), so cache 1 hour at the edge —
// anything tighter is wasted hits.
//
// Source order mirrors the build (scripts/build.mjs):
//   1. NY Fed EFFR — the source of record, a public JSON endpoint with no
//      auth and no Cloudflare WAF. It's literally the upstream of FRED's
//      DFF series, so it's both more authoritative and more reliable.
//   2. FRED:DFF CSV — fallback only, when NY Fed is unreachable.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Reject any value outside the plausible Fed-rate range — catches a
// mis-parsed field (which has bitten rate consumers before) so we never
// ship "rate: 10000" to the FOMC widget.
function plausibleRate(value) {
  return Number.isFinite(value) && value >= 0 && value <= 25;
}

// Primary: NY Fed EFFR. Returns { rate, asOf, source } or null.
async function fetchNyFedEffr() {
  try {
    const r = await fetch(
      "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json",
      {
        headers: { accept: "application/json", "user-agent": UA },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!r.ok) return null;
    const json = await r.json();
    const row = json?.refRates?.[0];
    const rate = Number(row?.percentRate);
    const asOf = row?.effectiveDate;
    if (!plausibleRate(rate) || !asOf) return null;
    return { rate, asOf, source: "NYFED:EFFR" };
  } catch {
    return null;
  }
}

// Fallback: FRED:DFF public CSV. Returns { rate, asOf, source } or null.
async function fetchFredDff() {
  try {
    const r = await fetch(
      "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF",
      {
        // FRED's Cloudflare WAF rejects bare user-agents with 403; mirror
        // the browser-shaped headers build.mjs uses for the same series.
        headers: {
          "user-agent": UA,
          accept: "text/csv,application/csv,text/plain,*/*;q=0.5",
          "accept-language": "en-US,en;q=0.9",
          referer: "https://fred.stlouisfed.org/",
        },
        // FRED's Cloudflare hop can take >8s under load — give it room.
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(",");
      if (parts.length < 2) continue;
      const raw = parts[1].trim();
      if (raw === "" || raw === ".") continue;
      const value = Number(raw);
      if (!plausibleRate(value)) continue;
      return { rate: value, asOf: parts[0].trim(), source: "FRED:DFF" };
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  try {
    const last = (await fetchNyFedEffr()) || (await fetchFredDff());
    if (!last) {
      return res.status(502).json({ error: "fed-rate unavailable" });
    }
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res.status(200).json({
      ...last,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Log full upstream error for debugging; return a generic message so
    // we don't leak upstream/WAF internals to the browser.
    console.error("fed-rate upstream failed", { message: String(err?.message || err) });
    return res.status(502).json({ error: "fed-rate unavailable" });
  }
}
