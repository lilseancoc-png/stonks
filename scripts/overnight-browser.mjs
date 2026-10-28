// Offline browser check of the Overnight tab (overnight review, 2026-10-26):
// the saved pre-open call, its five groups, events and the track record render
// at desktop and phone widths, light and dark, with no page errors and no
// sideways scroll. Synthetic data only; no network.
// PLAYWRIGHT_MODULE may point at an installed Playwright module.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildCorrelationsPayload, GLOBAL_MARKETS } from "./build.mjs";
import { OVERNIGHT_TONE } from "../lib/overnight-tone.mjs";
import { etParts } from "../lib/overnight-inputs.mjs";
import { mergeOvernightLog } from "../lib/overnight-log.mjs";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const chromium = playwright.chromium || playwright.default?.chromium;
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = resolve(process.env.QA_OUTPUT || resolve(tmpdir(), "stonks-overnight-browser"));
await mkdir(output, { recursive: true });

const today = etParts(Date.now()).date;
const wig = (i, k) => ((((i * 7919 + k * 104729) % 200) - 100) / 100);
function dates(n) {
  const out = [];
  const d = new Date(`${today}T12:00:00Z`);
  while (out.length < n) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}
const days = dates(80);
const globalMarkets = {};
Object.keys(GLOBAL_MARKETS).forEach((sym, k) => {
  let c = 100 + k;
  const bars = days.map((t, i) => { c = c * (1 + wig(i, k) / 100); return { t, c }; });
  const last = bars.at(-1).c, prevClose = bars.at(-2).c;
  globalMarkets[sym] = { bars, last, prevClose, chPct: ((last - prevClose) / prevClose) * 100, asOf: bars.at(-1).t, quoteTimeIso: new Date().toISOString() };
});

// A saved call for today and ~30 graded past calls.
const fresh = (movePct, sigmaPct, extra = {}) => ({ movePct, sigmaPct, fresh: true, ...extra });
function toneFor(i) {
  const s = wig(i, 99);
  return OVERNIGHT_TONE.scoreTone({
    "ES=F": fresh(s, 1), "NQ=F": fresh(s * 1.2, 1.2), "^N225": fresh(s * 0.8, 1.1, { name: "Nikkei 225" }),
    "^HSI": { fresh: false, staleWhy: "closed since " + days[0] + " (holiday or no session yet)", name: "Hang Seng" },
    "^VIX": fresh(-s * 6, 6, { level: 17 }), "^VIX3M": { fresh: false, level: 19, staleWhy: "context level" },
    "ZN=F": fresh(-s * 0.2, 0.35), "AUDJPY=X": fresh(s * 0.5, 0.6), "CNH=X": fresh(-s * 0.1, 0.25),
    "HG=F": fresh(s * 0.9, 1.3), "BTC-USD": fresh(s * 2, 3), "000660.KS": fresh(s * 2, 2.5),
  }, { asiaEcho: { beta: 0.6, residSigmaPct: 0.8 }, priorUsPct: 0.3 });
}
const calls = days.slice(-30).map((date, i) => ({ date, version: OVERNIGHT_TONE.VERSION, reconstructed: i < 20, capturedAtIso: `${date}T13:20:00.000Z`, tone: toneFor(i) }));
const spyBars = days.map((t, i) => ({ t, o: 600 + i + wig(i, 3), c: 600 + i + wig(i, 4) }));
const log = mergeOvernightLog(null, { calls, spyBars, qqqBars: spyBars });
const todayTone = toneFor(7);
const todayCall = {
  date: today, version: OVERNIGHT_TONE.VERSION, reconstructed: false,
  capturedAtIso: new Date().toISOString(), tone: todayTone,
  session: OVERNIGHT_TONE.sessionCall(todayTone, log.stats),
  events: [{ kind: "central-bank", label: "Bank of Japan decision overnight" }, { kind: "us-data", label: "CPI before the open (8:30 AM ET)" }, { kind: "holiday", label: "Closed overnight: Hang Seng" }],
  esRange: { rangePct: 0.84, volumeVsAvg: 1.32 },
  premarket: { indexes: { SPY: 0.42, QQQ: 0.61, IWM: 0.2, SMH: 1.1 }, movers: { gainers: [{ sym: "NVDA", chPct: 3.2 }, { sym: "AMD", chPct: 2.1 }], losers: [{ sym: "TSLA", chPct: -2.4 }] }, earnings: [{ sym: "MSFT", chPct: 4.1 }] },
};
log.entries.push(todayCall);
const correlations = buildCorrelationsPayload({}, globalMarkets, new Date().toISOString(), null, { log, todayCall, nowMs: Date.now() });
assert.equal(correlations.tone.source, "preopen");
assert.ok(correlations.preopen?.stats?.gapCall?.n > 0, "the fixture log is graded");

const html = await readFile(resolve(root, "index.html"), "utf8");
const manifest = JSON.parse(html.match(/window\.STONKS_MANIFEST=(\{.*\});<\/script>/)[1]);
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const json = (v) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(v)); };
  if (u.pathname === "/api/auth/me" && !u.searchParams.has("data")) return json({ enabled: false });
  const name = u.searchParams.get("data") || (u.pathname.startsWith("/data/") ? u.pathname.slice(6) : null);
  if (name === "correlations.json") return json(correlations);
  if (name === "manifest.json" || name === "manifest-free.json") return json(manifest);
  if (name) return json({});
  if (u.pathname.startsWith("/api/")) return json({});
  if (u.pathname.startsWith("/_vercel/")) return res.end("");
  const path = resolve(root, "." + (u.pathname === "/" ? "/index.html" : u.pathname));
  if (!path.startsWith(root + "/")) { res.statusCode = 403; return res.end(); }
  try {
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(path)] || "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ timeout: 15000, headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const width of [1366, 390]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: "reduce", timezoneId: "America/New_York" });
    const page = await context.newPage();
    const errors = [];
    await page.addInitScript((t) => { localStorage.setItem("stonks-theme", t); }, theme);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => (new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ body: "" })));
    await page.goto(base + "/?tab=overnight", { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.locator("#overnight-decision .ovn-bucket").first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator("#overnight-decision .ovn-bucket").count(), 5);
    const desk = await page.locator("#overnight-decision").innerText();
    assert.match(desk, /Saved pre-open call/);
    assert.match(desk, /Gap call/i);
    assert.match(desk, /Session call/i);
    assert.match(desk, /Bank of Japan decision overnight/);
    assert.match(desk, /Hang Seng/);
    assert.equal(await page.locator(".ovn-record").count(), 1);
    assert.match(await page.locator(".ovn-record").innerText(), /For scale: over the same \d+ days SPY opened up/);
    assert.ok(await page.locator(".ovn-record-table tbody tr").count() >= 5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `no sideways page scroll at ${width}px (${overflow}px)`);
    assert.deepEqual(errors, []);
    await page.locator("#overnight-decision").screenshot({ path: resolve(output, `overnight-desk-${width}-${theme}.png`) });
    await page.locator(".ovn-record").screenshot({ path: resolve(output, `overnight-record-${width}-${theme}.png`) });
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`overnight browser: ok (screenshots in ${output})`);
