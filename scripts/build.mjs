// Fetches today's earnings calendar, biggest movers, and key volatility/index
// quotes, then writes index.html. The page also embeds a client-side
// Black-Scholes options calculator.
// Sources:
//   - Nasdaq earnings calendar & market movers (api.nasdaq.com)
//   - Yahoo Finance chart endpoint for index/ETF quotes
// No API keys required.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "index.html");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const NY_TZ = "America/New_York";

function nyDateParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return parts; // { year, month, day, weekday }
}

function nyToday() {
  const p = nyDateParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function nyPretty() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function nyTimestamp() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

async function fetchJson(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchEarnings(dateStr) {
  // Nasdaq returns earnings scheduled for a given date (YYYY-MM-DD).
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
  try {
    const data = await fetchJson(url, {
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const rows = data?.data?.rows ?? [];
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      time: r.time, // "time-pre-market" | "time-after-hours" | "time-not-supplied"
      epsForecast: r.epsForecast,
      lastYearEPS: r.lastYearEPS,
      marketCap: r.marketCap,
    }));
  } catch (err) {
    console.error("earnings fetch failed:", err.message);
    return [];
  }
}

// Parse Nasdaq's stringified numbers like "$190.45", "+5.00", "+2.70%",
// "75,123,456", "$3,200,000,000" → number. Returns null if unparseable.
function parseNasdaqNum(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[$,%+\s]/g, "");
  if (cleaned === "" || cleaned === "N/A" || cleaned === "--") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahooQuote(symbol) {
  // Yahoo's chart endpoint returns regularMarketPrice + previousClose in meta
  // and is reliable without an API key. We request a small range so the
  // payload stays tiny.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=5d`;
  try {
    const data = await fetchJson(url);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change = price != null && prev != null ? price - prev : null;
    const changePct =
      price != null && prev ? ((price - prev) / prev) * 100 : null;
    return {
      symbol: meta.symbol || symbol,
      price,
      prev,
      change,
      changePct,
      currency: meta.currency || "USD",
    };
  } catch (err) {
    console.error(`yahoo quote ${symbol} failed:`, err.message);
    return null;
  }
}

async function fetchVolatilityPanel() {
  const symbols = [
    { sym: "^VIX", label: "VIX" },
    { sym: "^VVIX", label: "VVIX" },
    { sym: "SPY", label: "SPY" },
    { sym: "QQQ", label: "QQQ" },
    { sym: "IWM", label: "IWM" },
    { sym: "DIA", label: "DIA" },
  ];
  const quotes = await Promise.all(symbols.map((s) => fetchYahooQuote(s.sym)));
  return symbols
    .map((s, i) => (quotes[i] ? { ...quotes[i], label: s.label } : null))
    .filter(Boolean);
}

async function fetchMovers(direction, count = 15) {
  // Nasdaq market movers. Direction: "GAINERS" | "LOSERS" | "ACTIVE".
  const url = `https://api.nasdaq.com/api/marketmovers/STOCKS?direction=${direction}&limit=${count}`;
  try {
    const data = await fetchJson(url, {
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const rows = data?.data?.table?.rows ?? [];
    return rows.slice(0, count).map((r) => ({
      symbol: r.symbol,
      name: r.name || r.companyName || r.symbol,
      price: parseNasdaqNum(r.lastSalePrice ?? r.lastSale),
      change: parseNasdaqNum(r.netChange),
      changePct: parseNasdaqNum(r.percentageChange),
      volume: parseNasdaqNum(r.volume),
      marketCap: parseNasdaqNum(r.marketCap),
    }));
  } catch (err) {
    console.error(`movers ${direction} failed:`, err.message);
    return [];
  }
}

const fmtNum = new Intl.NumberFormat("en-US");
const fmtPrice = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtPct = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function compactCap(n) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${fmtNum.format(Math.round(n))}`;
}

function compactVol(n) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmtNum.format(n);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function earningsTimeLabel(t) {
  switch (t) {
    case "time-pre-market":
      return "Before open";
    case "time-after-hours":
      return "After close";
    default:
      return "TBD";
  }
}

function symbolLinks(symbol) {
  const enc = encodeURIComponent(symbol);
  const quote = `https://finance.yahoo.com/quote/${enc}`;
  const chain = `https://finance.yahoo.com/quote/${enc}/options`;
  return `<a href="${quote}" target="_blank" rel="noopener">${escapeHtml(symbol)}</a><a class="chain" href="${chain}" target="_blank" rel="noopener" title="Open option chain">⛓</a>`;
}

function moverRow(q) {
  const pct = q.changePct ?? 0;
  const cls = pct >= 0 ? "pos" : "neg";
  const sign = pct >= 0 ? "+" : "";
  return `<tr>
    <td class="sym">${symbolLinks(q.symbol)}<button class="calc-link" data-sym="${escapeHtml(q.symbol)}" data-spot="${q.price ?? ""}" title="Send to options calculator">→ calc</button></td>
    <td class="name">${escapeHtml(q.name)}</td>
    <td class="num">${q.price != null ? `$${fmtPrice.format(q.price)}` : "—"}</td>
    <td class="num ${cls}">${sign}${fmtPct.format(pct)}%</td>
    <td class="num">${compactVol(q.volume)}</td>
    <td class="num">${compactCap(q.marketCap)}</td>
  </tr>`;
}

function earningsRow(e) {
  return `<tr>
    <td class="sym">${symbolLinks(e.symbol)}<button class="calc-link" data-sym="${escapeHtml(e.symbol)}" title="Send to options calculator">→ calc</button></td>
    <td class="name">${escapeHtml(e.name)}</td>
    <td>${earningsTimeLabel(e.time)}</td>
    <td class="num">${escapeHtml(e.epsForecast || "—")}</td>
    <td class="num">${escapeHtml(e.lastYearEPS || "—")}</td>
    <td class="num">${escapeHtml(e.marketCap || "—")}</td>
  </tr>`;
}

function volQuoteCard(q) {
  const pct = q.changePct;
  const enc = encodeURIComponent(q.symbol);
  const chain = q.symbol.startsWith("^")
    ? `https://finance.yahoo.com/quote/${enc}`
    : `https://finance.yahoo.com/quote/${enc}/options`;
  let pctHtml;
  if (pct == null) {
    pctHtml = `<div class="vol-pct">—</div>`;
  } else {
    const cls = pct >= 0 ? "pos" : "neg";
    const sign = pct >= 0 ? "+" : "";
    pctHtml = `<div class="vol-pct ${cls}">${sign}${fmtPct.format(pct)}%</div>`;
  }
  return `<a class="vol-tile" href="${chain}" target="_blank" rel="noopener">
    <div class="vol-label">${escapeHtml(q.label)}</div>
    <div class="vol-price">${q.price != null ? fmtPrice.format(q.price) : "—"}</div>
    ${pctHtml}
  </a>`;
}

function volatilitySection(quotes) {
  if (!quotes.length) return "";
  return `<section class="card full">
    <h2>Volatility &amp; Indexes</h2>
    <div class="vol-grid">${quotes.map(volQuoteCard).join("")}</div>
    <p class="hint">VIX above 20 = elevated S&amp;P implied vol; click a tile to open its chain.</p>
  </section>`;
}

function calculatorSection() {
  return `<section class="card full" id="calc">
    <h2>Black-Scholes Options Calculator</h2>
    <form id="bs-form" class="bs-form" onsubmit="return false">
      <label>Symbol<input id="bs-sym" type="text" value="SPY" autocomplete="off" /></label>
      <label>Spot ($)<input id="bs-spot" type="number" step="0.01" value="500" /></label>
      <label>Strike ($)<input id="bs-strike" type="number" step="0.01" value="500" /></label>
      <label>Days to expiry<input id="bs-dte" type="number" step="1" min="0" value="30" /></label>
      <label>IV (%)<input id="bs-iv" type="number" step="0.1" min="0" value="20" /></label>
      <label>Rate (%)<input id="bs-rate" type="number" step="0.05" value="4.5" /></label>
      <label>Dividend (%)<input id="bs-div" type="number" step="0.05" value="0" /></label>
      <label>Type
        <select id="bs-type">
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
      </label>
    </form>
    <div class="bs-out" id="bs-out"></div>
    <p class="hint">Pure Black-Scholes-Merton with continuous dividend yield. Greeks are per 1-share contract; multiply by 100 for a standard contract. Inputs auto-recalculate.</p>
  </section>`;
}

const calculatorScript = `
<script>
(function(){
  // Abramowitz & Stegun 26.2.17 — standard normal CDF.
  function ncdf(x){
    var a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x)/Math.sqrt(2);
    var t = 1/(1+p*x);
    var y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
    return 0.5*(1+sign*y);
  }
  function npdf(x){ return Math.exp(-x*x/2)/Math.sqrt(2*Math.PI); }

  function bs(opts){
    var S=opts.S,K=opts.K,T=opts.T,sigma=opts.sigma,r=opts.r,q=opts.q,type=opts.type;
    if(!(S>0 && K>0 && sigma>=0)) return null;
    if(T<=0){
      var intrinsic = type==='call' ? Math.max(0,S-K) : Math.max(0,K-S);
      return {price: intrinsic, delta: type==='call'? (S>K?1:0):(S<K?-1:0), gamma:0, theta:0, vega:0, rho:0};
    }
    var sqrtT = Math.sqrt(T);
    var d1 = (Math.log(S/K) + (r-q+sigma*sigma/2)*T) / (sigma*sqrtT);
    var d2 = d1 - sigma*sqrtT;
    var Nd1=ncdf(d1), Nd2=ncdf(d2), nd1=npdf(d1);
    var disc_q=Math.exp(-q*T), disc_r=Math.exp(-r*T);
    var price, delta, theta, rho;
    if(type==='call'){
      price = S*disc_q*Nd1 - K*disc_r*Nd2;
      delta = disc_q*Nd1;
      theta = (-S*disc_q*nd1*sigma/(2*sqrtT) - r*K*disc_r*Nd2 + q*S*disc_q*Nd1);
      rho   = K*T*disc_r*Nd2;
    } else {
      price = K*disc_r*ncdf(-d2) - S*disc_q*ncdf(-d1);
      delta = -disc_q*ncdf(-d1);
      // Deep-ITM European puts can have positive theta when r is high relative to q — that is the BSM result, not a bug.
      theta = (-S*disc_q*nd1*sigma/(2*sqrtT) + r*K*disc_r*ncdf(-d2) - q*S*disc_q*ncdf(-d1));
      rho   = -K*T*disc_r*ncdf(-d2);
    }
    var gamma = disc_q*nd1/(S*sigma*sqrtT);
    var vega  = S*disc_q*nd1*sqrtT;
    return {price:price, delta:delta, gamma:gamma, theta:theta/365, vega:vega/100, rho:rho/100};
  }

  function fmt(n, d){ if(!isFinite(n)) return '—'; return n.toFixed(d==null?4:d); }
  function fmtMoney(n){ if(!isFinite(n)) return '—'; return '$'+n.toFixed(2); }

  function recalc(){
    var S=parseFloat(document.getElementById('bs-spot').value);
    var K=parseFloat(document.getElementById('bs-strike').value);
    var dte=parseFloat(document.getElementById('bs-dte').value);
    var iv=parseFloat(document.getElementById('bs-iv').value)/100;
    var r=parseFloat(document.getElementById('bs-rate').value)/100;
    var q=parseFloat(document.getElementById('bs-div').value)/100;
    var type=document.getElementById('bs-type').value;
    var T=dte/365;
    var res = bs({S:S,K:K,T:T,sigma:iv,r:r,q:q,type:type});
    var out = document.getElementById('bs-out');
    if(!res){ out.innerHTML = '<div class="bs-cell"><span>Enter valid inputs</span></div>'; return; }
    var oneSDMove = S*iv*Math.sqrt(T);
    var rows = [
      ['Price',         fmtMoney(res.price)],
      ['Delta',         fmt(res.delta,4)],
      ['Gamma',         fmt(res.gamma,5)],
      ['Theta / day',   fmtMoney(res.theta)],
      ['Vega / 1% IV',  fmtMoney(res.vega)],
      ['Rho / 1% rate', fmtMoney(res.rho)],
      ['1σ move (T)',   '±'+fmtMoney(oneSDMove)],
      ['Break-even',    type==='call' ? fmtMoney(K+res.price) : fmtMoney(K-res.price)],
    ];
    out.innerHTML = rows.map(function(r){
      return '<div class="bs-cell"><span>'+r[0]+'</span><b>'+r[1]+'</b></div>';
    }).join('');
  }

  function bind(){
    var ids=['bs-spot','bs-strike','bs-dte','bs-iv','bs-rate','bs-div','bs-type','bs-sym'];
    ids.forEach(function(id){
      var el=document.getElementById(id);
      if(el){ el.addEventListener('input', recalc); el.addEventListener('change', recalc); }
    });
    document.querySelectorAll('.calc-link').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var sym=btn.getAttribute('data-sym');
        var spot=btn.getAttribute('data-spot');
        document.getElementById('bs-sym').value=sym;
        if(spot){
          document.getElementById('bs-spot').value=spot;
          document.getElementById('bs-strike').value=spot;
        }
        recalc();
        document.getElementById('calc').scrollIntoView({behavior:'smooth',block:'start'});
      });
    });
    recalc();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
</script>`;

function moverTable(title, rows) {
  if (!rows.length) {
    return `<section class="card"><h2>${title}</h2><p class="empty">No data available right now.</p></section>`;
  }
  return `<section class="card">
    <h2>${title}</h2>
    <div class="scroll">
    <table>
      <thead><tr>
        <th>Symbol</th><th>Name</th><th class="num">Price</th>
        <th class="num">Change</th><th class="num">Volume</th><th class="num">Mkt Cap</th>
      </tr></thead>
      <tbody>${rows.map(moverRow).join("")}</tbody>
    </table>
    </div>
  </section>`;
}

function earningsSection(rows) {
  if (!rows.length) {
    return `<section class="card"><h2>Earnings Today</h2><p class="empty">No earnings reported for today (or data is unavailable).</p></section>`;
  }
  // sort: pre-market first, after-hours next, TBD last; then by market cap desc when available
  const order = { "time-pre-market": 0, "time-after-hours": 1 };
  const sorted = [...rows].sort((a, b) => {
    const ao = order[a.time] ?? 2;
    const bo = order[b.time] ?? 2;
    if (ao !== bo) return ao - bo;
    return 0;
  });
  return `<section class="card">
    <h2>Earnings Today <span class="count">${sorted.length}</span></h2>
    <div class="scroll">
    <table>
      <thead><tr>
        <th>Symbol</th><th>Name</th><th>When</th>
        <th class="num">EPS Forecast</th><th class="num">EPS LY</th><th class="num">Mkt Cap</th>
      </tr></thead>
      <tbody>${sorted.map(earningsRow).join("")}</tbody>
    </table>
    </div>
  </section>`;
}

function renderHtml({ today, prettyDate, updated, earnings, gainers, losers, actives, volatility }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stonks Hub — ${prettyDate}</title>
<meta name="description" content="Daily one-stop hub for U.S. stock earnings and biggest movers." />
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d12;
    --panel: #141822;
    --panel-2: #1b2030;
    --border: #232838;
    --text: #e7ecf3;
    --muted: #8a93a6;
    --accent: #6ea8ff;
    --pos: #2ecc71;
    --neg: #ff5c5c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: radial-gradient(1200px 600px at 10% -10%, #1a2440 0%, transparent 60%),
                radial-gradient(900px 500px at 110% 0%, #2a1a40 0%, transparent 60%),
                var(--bg);
    color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
  }
  header {
    padding: 32px 24px 8px;
    max-width: 1200px;
    margin: 0 auto;
  }
  header h1 {
    margin: 0 0 6px;
    font-size: 28px;
    letter-spacing: -0.02em;
  }
  header h1 .sub-tag {
    font-size: 12px;
    color: var(--accent);
    background: rgba(110,168,255,0.12);
    border: 1px solid rgba(110,168,255,0.35);
    padding: 2px 8px;
    border-radius: 999px;
    vertical-align: middle;
    margin-left: 6px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  header .sub a { color: var(--accent); }
  header .sub {
    color: var(--muted);
    font-size: 14px;
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px 24px 64px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
  }
  @media (min-width: 980px) {
    main { grid-template-columns: 1fr 1fr; }
    main > section.full { grid-column: 1 / -1; }
  }
  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 18px 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.25);
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 16px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .count {
    background: var(--border);
    color: var(--text);
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .scroll { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th, td {
    text-align: left;
    padding: 10px 10px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  tbody tr:hover { background: rgba(110,168,255,0.05); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.sym a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
  td.sym a:hover { text-decoration: underline; }
  td.sym a.chain {
    margin-left: 6px;
    font-weight: 400;
    opacity: 0.6;
    font-size: 13px;
  }
  td.sym a.chain:hover { opacity: 1; text-decoration: none; }
  .calc-link {
    margin-left: 8px;
    background: transparent;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .calc-link:hover { color: var(--accent); border-color: var(--accent); }
  .vol-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 10px;
  }
  .vol-tile {
    display: block;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.15s, transform 0.15s;
  }
  .vol-tile:hover { border-color: var(--accent); transform: translateY(-1px); }
  .vol-label { color: var(--muted); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
  .vol-price { font-size: 20px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .vol-pct { font-size: 13px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .hint { color: var(--muted); font-size: 12px; margin: 6px 0 10px; }
  .bs-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .bs-form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .bs-form input, .bs-form select {
    background: var(--panel-2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .bs-form input:focus, .bs-form select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .bs-out {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 6px;
  }
  .bs-cell {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bs-cell span {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .bs-cell b {
    font-weight: 600;
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }
  td.name {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }
  .pos { color: var(--pos); }
  .neg { color: var(--neg); }
  .empty { color: var(--muted); padding: 8px 0 16px; }
  footer {
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px 24px 48px;
    color: var(--muted);
    font-size: 12px;
  }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Stonks Hub <span class="sub-tag">options edition</span></h1>
  <div class="sub">${prettyDate} · Updated ${updated} (NY) · auto-refreshed daily · <a href="#calc">jump to calculator</a></div>
</header>
<main>
  ${volatilitySection(volatility)}
  ${earningsSection(earnings)}
  ${moverTable("Top Gainers", gainers)}
  ${moverTable("Top Losers", losers)}
  ${moverTable("Most Active", actives)}
  ${calculatorSection()}
</main>
<footer>
  Data: Nasdaq earnings calendar, Nasdaq market movers, Yahoo Finance chart endpoint.
  Click ⛓ on any ticker to open its option chain on Yahoo. For information only — not investment advice.
  <br/>Date key: ${today}
</footer>
${calculatorScript}
</body>
</html>`;
}

async function main() {
  const today = nyToday();
  const { weekday } = nyDateParts();
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  const [earnings, gainers, losers, actives, volatility] = await Promise.all([
    fetchEarnings(today),
    fetchMovers("GAINERS", 15),
    fetchMovers("LOSERS", 15),
    fetchMovers("ACTIVE", 15),
    fetchVolatilityPanel(),
  ]);

  const html = renderHtml({
    today,
    prettyDate: nyPretty() + (isWeekend ? " (markets closed)" : ""),
    updated: nyTimestamp(),
    earnings,
    gainers,
    losers,
    actives,
    volatility,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  console.log(
    `wrote ${OUT} — earnings:${earnings.length} gainers:${gainers.length} losers:${losers.length} actives:${actives.length} vol:${volatility.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
