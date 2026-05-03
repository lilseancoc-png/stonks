// Renders index.html — a single-purpose Option Contract Rater.
//
// Build-time: fetches Yahoo's option chain for a curated ticker list
// using the yahoo-finance2 client (handles consent cookie + crumb so
// it works from GitHub Actions runners — raw fetches to query1.* return
// 401 "Host not in allowlist") and embeds the compressed chains
// directly into index.html as window.STONKS_CHAINS.
//
// Runtime: the page does ZERO network calls — every lookup hits the
// embedded data. The daily GitHub Actions workflow refreshes the file
// each market-day morning and evening.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YahooFinance from "yahoo-finance2";

// Library prints a survey notice on first use and validates response
// schemas — silence both since Yahoo occasionally omits optional fields
// we don't read.
const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  validation: { logErrors: false },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../index.html");

// Curated list of high-volume optionable US names. Limit ~35 to keep the
// embedded JSON under a few hundred KB.
const TICKERS = [
  // Index & sector ETFs
  "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "USO", "XLF", "XLE", "XLK",
  // Mega-caps
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO",
  // Banks / payments
  "JPM", "BAC", "V", "MA",
  // Retail / consumer
  "WMT", "COST", "DIS", "BA",
  // High-volatility / popular
  "COIN", "PLTR", "SHOP", "BABA", "NIO",
  "GME", "AMC",
];

const STRIKE_BAND = 0.30; // keep ±30% strikes around spot
const MAX_EXPIRATIONS = 6;

async function fetchYahooOptions(symbol, expDate) {
  // yahoo-finance2 returns one expiration per call (the requested date,
  // or the nearest expiration when omitted) plus the full expirationDates
  // list as Date[]. Validation is silenced globally above.
  const opts = expDate ? { date: expDate } : {};
  return await yahooFinance.options(symbol, opts);
}

function toEpochSec(d) {
  return Math.floor((d instanceof Date ? d.getTime() : d) / 1000);
}

// Yahoo contract → compact shape. Single-letter keys keep the embedded
// payload small.
function compressContract(c) {
  return {
    s: c.strike ?? null,
    b: c.bid ?? null,
    a: c.ask ?? null,
    l: c.lastPrice ?? null,
    iv: c.impliedVolatility ?? null,
    oi: c.openInterest ?? null,
    v: c.volume ?? null,
    n: c.contractSymbol || null,
  };
}

async function fetchTickerChain(symbol) {
  const initial = await fetchYahooOptions(symbol);
  const spot =
    initial.quote?.regularMarketPrice ??
    initial.quote?.postMarketPrice ??
    initial.quote?.preMarketPrice ??
    null;
  const allExp = initial.expirationDates || [];
  if (!spot) throw new Error(`No spot for ${symbol}`);
  if (!allExp.length) throw new Error(`No expirations for ${symbol}`);

  const expirations = allExp.slice(0, MAX_EXPIRATIONS);
  const minK = spot * (1 - STRIKE_BAND);
  const maxK = spot * (1 + STRIKE_BAND);
  const filterStrike = (c) => c.strike != null && c.strike >= minK && c.strike <= maxK;

  const chains = {};
  for (let i = 0; i < expirations.length; i++) {
    const exp = expirations[i];
    const expSec = toEpochSec(exp);
    let chainEntry;
    if (i === 0 && initial.options?.[0]) {
      chainEntry = initial.options[0];
    } else {
      await new Promise((r) => setTimeout(r, 250));
      const r = await fetchYahooOptions(symbol, exp);
      chainEntry = r.options?.[0];
    }
    if (!chainEntry) continue;
    chains[expSec] = {
      c: (chainEntry.calls || []).filter(filterStrike).map(compressContract),
      p: (chainEntry.puts || []).filter(filterStrike).map(compressContract),
    };
  }

  return { spot, expirations: Object.keys(chains).map(Number).sort((a, b) => a - b), chains };
}

async function fetchAllTickerChains() {
  const out = {};
  for (const sym of TICKERS) {
    try {
      out[sym] = await fetchTickerChain(sym);
      console.log(`  ✓ ${sym} — spot $${out[sym].spot.toFixed(2)}, ${out[sym].expirations.length} expirations`);
    } catch (err) {
      console.error(`  ✗ ${sym} — ${err.message}`);
    }
    // Politeness pause between tickers.
    await new Promise((r) => setTimeout(r, 350));
  }
  return out;
}

function nyTimestamp() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

function optionEvalSection(symbols) {
  const optionsHtml = symbols.length
    ? symbols.map((s) => `<option value="${s}">${s}</option>`).join("")
    : `<option value="">(no chains available)</option>`;
  return `<section class="card" id="opt-eval-section">
    <p class="hint">Pick a ticker, then a call or put. We grade the bid-ask spread and Greeks (delta/theta) so you can spot a good contract from a poor one. Underlying direction is up to you.</p>
    <form id="opt-eval-form" class="opt-form">
      <select id="opt-symbol" aria-label="Ticker">${optionsHtml}</select>
      <select id="opt-type" aria-label="Option type">
        <option value="call">Call</option>
        <option value="put">Put</option>
      </select>
      <button type="submit" id="opt-load-btn">Load chain</button>
    </form>
    <div id="opt-chain-row" class="opt-chain-row" hidden>
      <select id="opt-expiry" aria-label="Expiration"></select>
      <select id="opt-strike" aria-label="Strike"></select>
      <button type="button" id="opt-eval-btn">Evaluate contract</button>
    </div>
    <div id="opt-eval-status" class="opt-status"></div>
    <div id="opt-eval-result" class="opt-result"></div>
  </section>`;
}

function optionEvalScript() {
  return `
<script>
(function(){
  var DATA = (window.STONKS_CHAINS && window.STONKS_CHAINS.tickers) || {};
  var RFR = 0.045; // assumed risk-free rate (annual)
  var state = { symbol: null, spot: null, expirations: [], chains: {}, currentExp: null };

  function $(id){return document.getElementById(id);}
  function setStatus(msg, kind){
    var el=$('opt-eval-status'); if(!el)return;
    el.textContent=msg||'';
    el.className='opt-status'+(kind?' '+kind:'');
  }
  function fmt(n,d){ if(n==null||!isFinite(n))return '—'; return Number(n).toFixed(d==null?2:d); }
  function fmtPct(n){ if(n==null||!isFinite(n))return '—'; return n.toFixed(2)+'%'; }

  // Standard normal PDF + CDF (Abramowitz & Stegun 7.1.26 approximation)
  function npdf(x){return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI);}
  function ncdf(x){
    var b1=0.319381530,b2=-0.356563782,b3=1.781477937,b4=-1.821255978,b5=1.330274429;
    var a=Math.abs(x), t=1/(1+0.2316419*a);
    var poly=((((b5*t+b4)*t+b3)*t+b2)*t+b1)*t;
    var p=1-npdf(a)*poly;
    return x<0?1-p:p;
  }

  function greeks(type, S, K, T, sigma, r){
    if(!(S>0&&K>0&&T>0&&sigma>0))return null;
    var sqrtT=Math.sqrt(T);
    var d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sqrtT);
    var d2=d1-sigma*sqrtT;
    var delta = type==='call' ? ncdf(d1) : ncdf(d1)-1;
    var thetaYr = type==='call'
      ? -S*npdf(d1)*sigma/(2*sqrtT) - r*K*Math.exp(-r*T)*ncdf(d2)
      : -S*npdf(d1)*sigma/(2*sqrtT) + r*K*Math.exp(-r*T)*ncdf(-d2);
    var gamma = npdf(d1)/(S*sigma*sqrtT);
    var vega = S*npdf(d1)*sqrtT/100; // per 1 vol pt
    return { delta:delta, thetaDay:thetaYr/365, gamma:gamma, vega:vega };
  }

  function fmtExpiryLabel(epoch){
    var d=new Date(epoch*1000);
    return d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'America/New_York'});
  }

  function populateExpiry(){
    var sel=$('opt-expiry'); sel.innerHTML='';
    state.expirations.forEach(function(epoch){
      var o=document.createElement('option');
      o.value=epoch; o.textContent=fmtExpiryLabel(epoch);
      sel.appendChild(o);
    });
  }

  function populateStrikes(){
    var type=$('opt-type').value;
    var chain=state.chains[state.currentExp];
    var sel=$('opt-strike'); sel.innerHTML='';
    if(!chain)return;
    var rows=(type==='call'?chain.c:chain.p)||[];
    if(!rows.length){
      var o=document.createElement('option'); o.textContent='No '+type+'s available'; o.disabled=true; sel.appendChild(o); return;
    }
    var spot=state.spot;
    var bestIdx=0, bestDist=Infinity;
    rows.forEach(function(r,i){
      var d=Math.abs((r.s||0)-spot);
      if(d<bestDist){bestDist=d;bestIdx=i;}
      var o=document.createElement('option');
      o.value=r.n||String(i);
      var bidAsk = ' (bid '+fmt(r.b)+' / ask '+fmt(r.a)+')';
      o.textContent='$'+fmt(r.s)+bidAsk;
      sel.appendChild(o);
    });
    sel.selectedIndex=bestIdx;
  }

  function findContract(){
    var type=$('opt-type').value;
    var chain=state.chains[state.currentExp]; if(!chain)return null;
    var rows=(type==='call'?chain.c:chain.p)||[];
    var sym=$('opt-strike').value;
    return rows.find(function(r){return (r.n||'')===sym;}) || null;
  }

  function gradeSpread(spreadPct){
    if(spreadPct<=5)return {label:'Tight', cls:'good', note:'narrow spread — easy fills'};
    if(spreadPct<=15)return {label:'Moderate', cls:'fair', note:'spread is workable but costs you on entry/exit'};
    return {label:'Wide', cls:'bad', note:'wide spread — illiquid, expect slippage'};
  }
  function gradeDelta(delta, type){
    var a=Math.abs(delta);
    if(a>=0.40 && a<=0.70) return {label:'Balanced', cls:'good', note:'good directional sensitivity without paying full intrinsic'};
    if(a>=0.30 && a<0.40) return {label:'Slightly OTM', cls:'fair', note:'cheaper but needs a real move to pay'};
    if(a>0.70) return {label:'Deep ITM', cls:'fair', note:'moves nearly 1:1 with the stock — limited leverage'};
    return {label:'Far OTM', cls:'bad', note:'lottery ticket — most likely expires worthless'};
  }
  function gradeTheta(thetaDay, mid){
    if(mid<=0||thetaDay==null)return {label:'—', cls:'fair', note:'theta unavailable'};
    var dailyBleed=Math.abs(thetaDay)/mid*100;
    if(dailyBleed<1) return {label:'Slow decay', cls:'good', note:'~'+dailyBleed.toFixed(2)+'% / day — plenty of runway'};
    if(dailyBleed<3) return {label:'Normal decay', cls:'fair', note:'~'+dailyBleed.toFixed(2)+'% / day — standard time pressure'};
    return {label:'Bleeding', cls:'bad', note:'~'+dailyBleed.toFixed(2)+'% / day — heavy time decay'};
  }

  function overallVerdict(grades){
    var bad=grades.filter(function(g){return g.cls==='bad';}).length;
    var good=grades.filter(function(g){return g.cls==='good';}).length;
    if(bad>=2) return {label:'Poor contract', cls:'bad'};
    if(bad===1) return {label:'Mixed — proceed with caution', cls:'fair'};
    if(good>=2) return {label:'Good contract', cls:'good'};
    return {label:'Acceptable', cls:'fair'};
  }

  function row(label, value, sub){
    return '<div class="opt-row"><div class="opt-row-label">'+label+'</div><div class="opt-row-value">'+value+(sub?' <span class="opt-row-sub">'+sub+'</span>':'')+'</div></div>';
  }
  function gradeChip(g){
    return '<span class="opt-grade '+g.cls+'">'+g.label+'</span>';
  }

  function evaluate(){
    var c=findContract();
    if(!c){ setStatus('Pick a strike first.','err'); return; }
    var type=$('opt-type').value;
    var bid=c.b, ask=c.a;
    var mid = (bid!=null&&ask!=null && (bid+ask)>0) ? (bid+ask)/2 : (c.l||null);
    var spread = (bid!=null&&ask!=null) ? (ask-bid) : null;
    var spreadPct = (spread!=null && mid>0) ? (spread/mid*100) : null;
    var iv = c.iv;
    var expEpoch = state.currentExp;
    var T = (expEpoch*1000 - Date.now()) / (365*24*3600*1000);
    var g = (T>0 && iv>0) ? greeks(type, state.spot, c.s, T, iv, RFR) : null;

    var sGrade = spreadPct!=null ? gradeSpread(spreadPct) : {label:'—', cls:'fair', note:'no quote'};
    var dGrade = g ? gradeDelta(g.delta, type) : {label:'—', cls:'fair', note:'delta unavailable'};
    var tGrade = g ? gradeTheta(g.thetaDay, mid) : {label:'—', cls:'fair', note:'theta unavailable'};
    var verdict = overallVerdict([sGrade, dGrade, tGrade]);

    var html = '';
    html += '<div class="opt-verdict '+verdict.cls+'">'+verdict.label+'</div>';
    html += '<div class="opt-contract">'+(c.n||'')+' · spot $'+fmt(state.spot)+' · '+Math.max(0,Math.round(T*365))+' days to expiry</div>';
    html += '<div class="opt-grid">';
    html += row('Bid / Ask', '$'+fmt(bid)+' / $'+fmt(ask));
    html += row('Mid', mid!=null?'$'+fmt(mid):'—');
    html += row('Spread', spread!=null?('$'+fmt(spread)+' ('+fmtPct(spreadPct)+')'):'—', gradeChip(sGrade));
    html += row('IV', iv!=null?fmtPct(iv*100):'—');
    html += row('Delta', g?fmt(g.delta,3):'—', g?gradeChip(dGrade):'');
    html += row('Theta / day', g?'$'+fmt(g.thetaDay,3):'—', g?gradeChip(tGrade):'');
    html += row('Gamma', g?fmt(g.gamma,4):'—');
    html += row('Vega (per 1 vol pt)', g?'$'+fmt(g.vega,3):'—');
    html += row('Open interest', c.oi!=null?String(c.oi):'—');
    html += row('Volume', c.v!=null?String(c.v):'—');
    html += '</div>';
    html += '<ul class="opt-notes">';
    html += '<li><b>Spread:</b> '+sGrade.note+'.</li>';
    html += '<li><b>Delta:</b> '+dGrade.note+'.</li>';
    html += '<li><b>Theta:</b> '+tGrade.note+'.</li>';
    html += '</ul>';
    html += '<p class="opt-disclaimer">Greeks computed with Black-Scholes from Yahoo&apos;s implied vol and a '+(RFR*100).toFixed(1)+'% risk-free rate. Quotes are end-of-session as of the build timestamp shown below — for information only, not investment advice.</p>';
    $('opt-eval-result').innerHTML=html;
    setStatus('','');
  }

  function loadChain(){
    var symbol=$('opt-symbol').value;
    if(!symbol){ setStatus('Pick a ticker first.','err'); return; }
    var entry = DATA[symbol];
    if(!entry){ setStatus('No chain data for '+symbol+' in this build.','err'); return; }
    state.symbol=symbol;
    state.spot=entry.spot;
    state.expirations=(entry.expirations||[]).slice();
    state.chains=entry.chains||{};
    if(!state.expirations.length){ setStatus('No expirations for '+symbol+'.','err'); return; }
    state.currentExp=state.expirations[0];
    populateExpiry();
    $('opt-expiry').value=String(state.currentExp);
    populateStrikes();
    $('opt-chain-row').hidden=false;
    $('opt-eval-result').innerHTML='';
    setStatus(symbol+' loaded · spot $'+fmt(state.spot)+' · '+state.expirations.length+' expirations','ok');
  }

  function onExpiryChange(){
    var exp=Number($('opt-expiry').value);
    state.currentExp=exp;
    populateStrikes();
  }

  function bind(){
    var form=$('opt-eval-form'); if(!form)return;
    form.addEventListener('submit',function(e){e.preventDefault();loadChain();});
    $('opt-type').addEventListener('change',function(){ if(state.currentExp)populateStrikes(); });
    $('opt-expiry').addEventListener('change',onExpiryChange);
    $('opt-eval-btn').addEventListener('click',evaluate);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
<\/script>`;
}

function renderHtml({ chains, builtAt }) {
  const symbols = Object.keys(chains).sort();
  const tickerCount = symbols.length;
  const dataPayload = JSON.stringify({ builtAt, tickers: chains });
  // Avoid an early </script> within the JSON breaking the inline script.
  const safePayload = dataPayload.replace(/<\/script>/gi, "<\\/script>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Option Contract Rater</title>
<meta name="description" content="Grade an options contract on bid-ask spread, delta, and theta." />
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
    padding: 48px 24px 8px;
    max-width: 760px;
    margin: 0 auto;
  }
  header h1 {
    margin: 0 0 6px;
    font-size: 28px;
    letter-spacing: -0.02em;
  }
  header .sub { color: var(--muted); font-size: 14px; }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 24px 64px;
  }
  .card {
    background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 22px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.25);
  }
  .hint { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
  footer {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px 24px 48px;
    color: var(--muted);
    font-size: 12px;
  }
  /* Option Contract Rater */
  .opt-form, .opt-chain-row {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin: 6px 0 10px;
  }
  .opt-form select, .opt-chain-row select {
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; color: var(--text);
    font: inherit; font-size: 14px; min-width: 120px;
  }
  .opt-form select:focus, .opt-chain-row select:focus {
    outline: none; border-color: var(--accent);
  }
  .opt-form button, .opt-chain-row button {
    background: var(--accent); color: #0b0d12; border: none;
    border-radius: 8px; padding: 8px 14px; font-weight: 700; cursor: pointer;
    font-size: 14px; transition: background 0.15s, opacity 0.15s;
  }
  .opt-form button:hover, .opt-chain-row button:hover { background: #8bbfff; }
  .opt-form button:disabled { opacity: 0.5; cursor: default; }
  .opt-chain-row select { flex: 1 1 200px; }
  .opt-status { font-size: 13px; min-height: 18px; margin: 4px 0; color: var(--muted); }
  .opt-status.err { color: var(--neg); }
  .opt-status.ok { color: var(--pos); }
  .opt-result:empty { display: none; }
  .opt-verdict {
    display: inline-block; padding: 6px 14px; border-radius: 999px;
    font-weight: 700; font-size: 14px; letter-spacing: 0.04em;
    text-transform: uppercase; margin: 8px 0;
  }
  .opt-verdict.good { background: rgba(46,204,113,0.18); color: var(--pos); border: 1px solid rgba(46,204,113,0.4); }
  .opt-verdict.fair { background: rgba(243,156,18,0.18); color: #f39c12; border: 1px solid rgba(243,156,18,0.4); }
  .opt-verdict.bad  { background: rgba(255,92,92,0.18); color: var(--neg); border: 1px solid rgba(255,92,92,0.4); }
  .opt-contract { font-size: 12px; color: var(--muted); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
  .opt-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 6px 18px; margin: 10px 0;
  }
  .opt-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 14px;
  }
  .opt-row-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .opt-row-value { font-variant-numeric: tabular-nums; font-weight: 600; }
  .opt-row-sub { font-weight: 400; }
  .opt-grade {
    display: inline-block; margin-left: 8px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; padding: 2px 7px; border-radius: 4px;
  }
  .opt-grade.good { color: var(--pos); background: rgba(46,204,113,0.15); }
  .opt-grade.fair { color: #f39c12; background: rgba(243,156,18,0.15); }
  .opt-grade.bad  { color: var(--neg); background: rgba(255,92,92,0.15); }
  .opt-notes { margin: 10px 0 4px; padding-left: 18px; font-size: 13px; color: var(--text); }
  .opt-notes li { margin-bottom: 3px; }
  .opt-disclaimer { font-size: 11px; color: var(--muted); margin-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>Option Contract Rater</h1>
  <div class="sub">Grade a single options contract on spread quality, delta, and theta. Quotes refreshed daily — ${tickerCount} tickers available.</div>
</header>
<main>
  ${optionEvalSection(symbols)}
</main>
<footer>
  Data: Yahoo Finance option chain, fetched server-side at build time. Built ${builtAt} (NY). Greeks computed locally with Black-Scholes. For information only — not investment advice.
</footer>
<script>window.STONKS_CHAINS=${safePayload};<\/script>
${optionEvalScript()}
</body>
</html>`;
}

async function main() {
  console.log("Fetching option chains for", TICKERS.length, "tickers…");
  const chains = await fetchAllTickerChains();
  const got = Object.keys(chains).length;
  if (got === 0) {
    throw new Error("No tickers fetched successfully — refusing to overwrite index.html");
  }
  console.log(`Got ${got} / ${TICKERS.length} tickers.`);
  const html = renderHtml({ chains, builtAt: nyTimestamp() });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  console.log("wrote " + OUT, `(${(html.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
