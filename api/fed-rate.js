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
      headers: { "user-agent": "stonks-edge/1.0" },
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
      if (!Number.isFinite(value)) continue;
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
