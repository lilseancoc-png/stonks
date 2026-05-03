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

// Curated list of high-volume optionable US names. Keep under ~60 so the
// embedded JSON stays well below 1 MB.
const TICKERS = [
  // Index & sector ETFs
  "SPY", "QQQ", "IWM", "DIA", "TLT", "GLD", "USO", "XLF", "XLE", "XLK",
  // Mega-caps
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO",
  // Other tech / semis
  "ORCL", "CRM", "ADBE", "TSM", "MU", "INTC",
  // Banks / payments
  "JPM", "BAC", "V", "MA",
  // Retail / consumer
  "WMT", "COST", "DIS", "BA", "MCD", "SBUX",
  // Healthcare / pharma
  "NVO", "LLY", "UNH", "JNJ", "PFE",
  // Energy
  "XOM", "CVX",
  // Travel / modern consumer
  "UBER", "ABNB",
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
    <h2 class="card-title">From a curated ticker</h2>
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
  </section>
  <section class="card" id="opt-manual-section">
    <h2 class="card-title">Or grade your own contract</h2>
    <p class="hint">Looking at a contract on Robinhood, Schwab, etc.? Copy the numbers straight off the screen — we strip <code>$</code>, <code>%</code>, commas, and the <code>× 55</code> size suffix automatically. IV, OI and volume are optional; without IV we skip the Greeks.</p>
    <form id="opt-manual-form" class="opt-manual-grid">
      <label class="opt-manual-field opt-manual-field-row1">Type
        <select id="m-type">
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
      </label>
      <label class="opt-manual-field opt-manual-field-row1">Share price
        <input id="m-spot" type="text" inputmode="decimal" placeholder="100.77" autocomplete="off" required>
      </label>
      <label class="opt-manual-field opt-manual-field-row1">Strike price
        <input id="m-strike" type="text" inputmode="decimal" placeholder="103" autocomplete="off" required>
      </label>
      <label class="opt-manual-field opt-manual-field-row1">Expiration
        <input id="m-expiry" type="date" required>
      </label>
      <label class="opt-manual-field opt-manual-field-row2">Bid
        <input id="m-bid" type="text" inputmode="decimal" placeholder="3.15 (or 3.15 × 55)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field opt-manual-field-row2">Ask
        <input id="m-ask" type="text" inputmode="decimal" placeholder="3.30 (or 3.30 × 74)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field opt-manual-field-row3">Implied volatility <span class="opt-manual-opt">optional</span>
        <input id="m-iv" type="text" inputmode="decimal" placeholder="100.81%" autocomplete="off">
      </label>
      <label class="opt-manual-field opt-manual-field-row3">Open interest <span class="opt-manual-opt">optional</span>
        <input id="m-oi" type="text" inputmode="numeric" placeholder="996" autocomplete="off">
      </label>
      <label class="opt-manual-field opt-manual-field-row3">Volume <span class="opt-manual-opt">optional</span>
        <input id="m-vol" type="text" inputmode="numeric" placeholder="1,251" autocomplete="off">
      </label>
      <button type="submit" class="opt-manual-submit">Grade contract</button>
    </form>
    <div id="opt-manual-status" class="opt-status"></div>
    <div id="opt-manual-result" class="opt-result"></div>
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
  function setStatus(elemId, msg, kind){
    var el=$(elemId); if(!el)return;
    el.textContent=msg||'';
    el.className='opt-status'+(kind?' '+kind:'');
  }
  function fmt(n,d){ if(n==null||!isFinite(n))return '—'; return Number(n).toFixed(d==null?2:d); }
  function fmtPct(n){ if(n==null||!isFinite(n))return '—'; return n.toFixed(2)+'%'; }

  // Tolerant parse: strip currency / percent / commas / thin-spaces and
  // anything after a "x" / "×" (Robinhood's bid size suffix), then parseFloat.
  // Handles "$3.15", "3.15 × 55", "100.81%", "1,251", "  3.15  ".
  function parseLoose(raw){
    if(raw==null)return NaN;
    var s=String(raw).trim();
    if(!s)return NaN;
    s=s.split(/[x×]/i)[0];           // drop size suffix
    s=s.replace(/[\\$,%\\s\\u00a0]/g,''); // strip $, %, commas, any whitespace
    return parseFloat(s);
  }

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

  // Build the result HTML for a contract from any source (curated chain or
  // manual entry). Input keys: type, spot, strike, expEpoch, bid, ask, last,
  // iv (decimal e.g. 0.42), oi, volume, label, source ('chain'|'manual').
  function buildResultHtml(input){
    var bid=input.bid, ask=input.ask;
    var mid = (bid!=null&&ask!=null && (bid+ask)>0) ? (bid+ask)/2 : (input.last||null);
    var spread = (bid!=null&&ask!=null) ? (ask-bid) : null;
    var spreadPct = (spread!=null && mid>0) ? (spread/mid*100) : null;
    var iv = input.iv;
    var T = (input.expEpoch*1000 - Date.now()) / (365*24*3600*1000);
    var g = (T>0 && iv>0 && input.spot>0 && input.strike>0)
      ? greeks(input.type, input.spot, input.strike, T, iv, RFR) : null;

    var sGrade = spreadPct!=null ? gradeSpread(spreadPct) : {label:'—', cls:'fair', note:'no quote'};
    var dGrade = g ? gradeDelta(g.delta, input.type) : {label:'—', cls:'fair', note:'delta unavailable — IV missing'};
    var tGrade = g ? gradeTheta(g.thetaDay, mid) : {label:'—', cls:'fair', note:'theta unavailable — IV missing'};
    var verdict = overallVerdict([sGrade, dGrade, tGrade]);

    var html = '';
    html += '<div class="opt-verdict '+verdict.cls+'">'+verdict.label+'</div>';
    html += '<div class="opt-contract">'+(input.label||'')+' · spot $'+fmt(input.spot)+' · '+Math.max(0,Math.round(T*365))+' days to expiry</div>';
    html += '<div class="opt-grid">';
    html += row('Bid / Ask', '$'+fmt(bid)+' / $'+fmt(ask));
    html += row('Mid', mid!=null?'$'+fmt(mid):'—');
    html += row('Spread', spread!=null?('$'+fmt(spread)+' ('+fmtPct(spreadPct)+')'):'—', gradeChip(sGrade));
    html += row('IV', iv!=null?fmtPct(iv*100):'—');
    html += row('Delta', g?fmt(g.delta,3):'—', g?gradeChip(dGrade):'');
    html += row('Theta / day', g?'$'+fmt(g.thetaDay,3):'—', g?gradeChip(tGrade):'');
    html += row('Gamma', g?fmt(g.gamma,4):'—');
    html += row('Vega (per 1 vol pt)', g?'$'+fmt(g.vega,3):'—');
    html += row('Open interest', input.oi!=null?String(input.oi):'—');
    html += row('Volume', input.volume!=null?String(input.volume):'—');
    html += '</div>';
    html += '<ul class="opt-notes">';
    html += '<li><b>Spread:</b> '+sGrade.note+'.</li>';
    html += '<li><b>Delta:</b> '+dGrade.note+'.</li>';
    html += '<li><b>Theta:</b> '+tGrade.note+'.</li>';
    html += '</ul>';
    var disc = input.source==='manual'
      ? 'Greeks computed locally with Black-Scholes from your IV and a '+(RFR*100).toFixed(1)+'% risk-free rate. You are the data source — only as accurate as the numbers you typed.'
      : 'Greeks computed with Black-Scholes from Yahoo&apos;s implied vol and a '+(RFR*100).toFixed(1)+'% risk-free rate. Quotes are end-of-session as of the build timestamp shown below — for information only, not investment advice.';
    html += '<p class="opt-disclaimer">'+disc+'</p>';
    return html;
  }

  function evaluate(){
    var c=findContract();
    if(!c){ setStatus('opt-eval-status','Pick a strike first.','err'); return; }
    var type=$('opt-type').value;
    $('opt-eval-result').innerHTML = buildResultHtml({
      type: type, spot: state.spot, strike: c.s, expEpoch: state.currentExp,
      bid: c.b, ask: c.a, last: c.l, iv: c.iv,
      oi: c.oi, volume: c.v, label: c.n||'', source: 'chain'
    });
    setStatus('opt-eval-status','','');
  }

  function evaluateManual(ev){
    if(ev) ev.preventDefault();
    var type = $('m-type').value;
    var spot = parseLoose($('m-spot').value);
    var strike = parseLoose($('m-strike').value);
    var expDateStr = $('m-expiry').value;
    var bid = parseLoose($('m-bid').value);
    var ask = parseLoose($('m-ask').value);
    var ivRaw = $('m-iv').value.trim();
    var oiRaw = $('m-oi').value.trim();
    var volRaw = $('m-vol').value.trim();
    var ivPct = parseLoose(ivRaw);
    var oi = parseLoose(oiRaw);
    var vol = parseLoose(volRaw);

    if(!(spot>0)){ setStatus('opt-manual-status','Share price is required.','err'); return; }
    if(!(strike>0)){ setStatus('opt-manual-status','Strike price is required.','err'); return; }
    if(!expDateStr){ setStatus('opt-manual-status','Expiration date is required.','err'); return; }
    if(!isFinite(bid) || !isFinite(ask) || bid<0 || ask<0){ setStatus('opt-manual-status','Bid and ask are required (enter 0 if you have no quote).','err'); return; }
    if(ask<bid){ setStatus('opt-manual-status','Ask is below bid — check your numbers.','err'); return; }

    // Treat the date as US-market 4pm ET on that day. Constructing from
    // "YYYY-MM-DDT16:00:00-04:00" handles either DST without us caring —
    // close enough for "days to expiry" math.
    var expEpoch = Math.floor(new Date(expDateStr+'T16:00:00-04:00').getTime()/1000);

    var label = type.toUpperCase()+' $'+strike+' · exp '+expDateStr;
    $('opt-manual-result').innerHTML = buildResultHtml({
      type: type, spot: spot, strike: strike, expEpoch: expEpoch,
      bid: bid, ask: ask, last: null,
      iv: (ivRaw && isFinite(ivPct) && ivPct>=0) ? ivPct/100 : null,
      oi: (oiRaw && isFinite(oi)) ? Math.round(oi) : null,
      volume: (volRaw && isFinite(vol)) ? Math.round(vol) : null,
      label: label, source: 'manual'
    });
    setStatus('opt-manual-status','Graded.','ok');
  }

  function loadChain(){
    var symbol=$('opt-symbol').value;
    if(!symbol){ setStatus('opt-eval-status','Pick a ticker first.','err'); return; }
    var entry = DATA[symbol];
    if(!entry){ setStatus('opt-eval-status','No chain data for '+symbol+' in this build.','err'); return; }
    state.symbol=symbol;
    state.spot=entry.spot;
    state.expirations=(entry.expirations||[]).slice();
    state.chains=entry.chains||{};
    if(!state.expirations.length){ setStatus('opt-eval-status','No expirations for '+symbol+'.','err'); return; }
    state.currentExp=state.expirations[0];
    populateExpiry();
    $('opt-expiry').value=String(state.currentExp);
    populateStrikes();
    $('opt-chain-row').hidden=false;
    $('opt-eval-result').innerHTML='';
    setStatus('opt-eval-status',symbol+' loaded · spot $'+fmt(state.spot)+' · '+state.expirations.length+' expirations','ok');
  }

  function onExpiryChange(){
    var exp=Number($('opt-expiry').value);
    state.currentExp=exp;
    populateStrikes();
  }

  function bind(){
    var form=$('opt-eval-form');
    if(form){
      form.addEventListener('submit',function(e){e.preventDefault();loadChain();});
      $('opt-type').addEventListener('change',function(){ if(state.currentExp)populateStrikes(); });
      $('opt-expiry').addEventListener('change',onExpiryChange);
      $('opt-eval-btn').addEventListener('click',evaluate);
    }
    var manualForm=$('opt-manual-form');
    if(manualForm){
      manualForm.addEventListener('submit',evaluateManual);
    }
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
    margin-bottom: 18px;
  }
  .card-title { margin: 0 0 6px; font-size: 18px; letter-spacing: -0.01em; }
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
  /* Manual contract form */
  .opt-manual-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 10px 14px;
    margin: 6px 0 10px;
  }
  .opt-manual-field {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 12px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.04em;
    grid-column: span 12;
  }
  /* Row 1: type / share price / strike / expiration — Robinhood header */
  .opt-manual-field-row1 { grid-column: span 6; }
  /* Row 2: bid / ask — the quote */
  .opt-manual-field-row2 { grid-column: span 6; }
  /* Row 3: IV / OI / volume — the rest */
  .opt-manual-field-row3 { grid-column: span 4; }
  @media (min-width: 560px) {
    .opt-manual-field-row1 { grid-column: span 3; }
  }
  .opt-manual-field input, .opt-manual-field select {
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; color: var(--text);
    font: inherit; font-size: 14px; text-transform: none; letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .opt-manual-field input::placeholder { color: var(--muted); opacity: 0.55; }
  .opt-manual-field input:focus, .opt-manual-field select:focus {
    outline: none; border-color: var(--accent);
  }
  .opt-manual-opt { font-size: 10px; color: var(--muted); text-transform: lowercase; opacity: 0.7; }
  .opt-manual-submit {
    grid-column: 1 / -1;
    background: var(--accent); color: #0b0d12; border: none;
    border-radius: 8px; padding: 10px 14px; font-weight: 700; cursor: pointer;
    font-size: 14px; transition: background 0.15s;
    justify-self: start; margin-top: 4px;
  }
  .opt-manual-submit:hover { background: #8bbfff; }
  .hint code {
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 4px; padding: 1px 5px; font-size: 12px;
  }
</style>
</head>
<body>
<header>
  <h1>Option Contract Rater</h1>
  <div class="sub">Grade a single options contract on spread quality, delta, and theta. ${tickerCount} curated tickers refreshed daily, or enter your own contract below.</div>
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
