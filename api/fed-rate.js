// Vercel serverless function: live effective Federal Funds Rate.
//
// Surfaces the latest FRED:DFF (Federal Funds Effective Rate) observation
// so the FOMC widget at the top of the Calendar tab stays fresh between
// daily builds. FRED publishes a new value every business day around
// 16:00 ET. Cache 1 hour at the edge — the rate is set once per day so
// anything tighter is wasted hits.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  try {
    const csvUrl = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF";
    const r = await fetch(csvUrl, {
      // FRED's Cloudflare WAF rejects bare user-agents with 403; mirror the
      // browser-shaped headers build.mjs uses for the same series so the
      // calendar's live Fed-rate refresh keeps working between daily builds.
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/csv,application/csv,text/plain,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://fred.stlouisfed.org/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return res.status(502).json({ error: "FRED HTTP " + r.status });
    }
    const csv = await r.text();
    const lines = csv.split(/\r?\n/).filter(Boolean);
    let last = null;
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(",");
      if (parts.length < 2) continue;
      const raw = parts[1].trim();
      if (raw === "" || raw === ".") continue;
      const value = Number(raw);
      // Reject any value outside the plausible Fed-rate range — catches a
      // mis-parsed column (which has hit FRED CSV consumers before) so
      // we never ship "rate: 10000" to the FOMC widget.
      if (!Number.isFinite(value) || value < 0 || value > 25) continue;
      last = { rate: value, asOf: parts[0].trim() };
      break;
    }
    if (!last) {
      return res.status(502).json({ error: "no DFF observations" });
    }
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    return res.status(200).json({
      ...last,
      source: "FRED:DFF",
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    return res.status(502).json({ error: msg.slice(0, 200) });
  }
}
