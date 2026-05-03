// Renders index.html — a single-purpose Option Contract Rater.
// Pure client-side: the page fetches Yahoo's option chain through public
// CORS proxies at request time. No build-time data fetching.
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../index.html");

function optionEvalSection() {
  return `<section class="card" id="opt-eval-section">
    <p class="hint">Enter a ticker and pick a call or put. We grade the bid-ask spread and Greeks (delta/theta) so you can spot a good contract from a poor one. Underlying direction is up to you.</p>
    <form id="opt-eval-form" class="opt-form">
      <input type="text" id="opt-symbol" placeholder="Ticker (e.g. AAPL)" autocomplete="off" maxlength="10" spellcheck="false" />
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
  // Free CORS proxies tried in order — first one that returns 2xx wins.
  // Public proxies come and go; keeping a list lets the page survive one going down.
  var CORS_PROXIES = [
    function(u){ return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
    function(u){ return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
    function(u){ return 'https://corsproxy.io/?' + encodeURIComponent(u); },
    function(u){ return 'https://thingproxy.freeboard.io/fetch/' + u; }
  ];
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

  async function fetchViaProxies(url){
    var lastErr=null;
    for(var i=0;i<CORS_PROXIES.length;i++){
      try{
        var res=await fetch(CORS_PROXIES[i](url),{headers:{'Accept':'application/json'}});
        if(!res.ok){ lastErr=new Error('HTTP '+res.status+' from proxy '+(i+1)); continue; }
        var text=await res.text();
        var json;
        try{ json=JSON.parse(text); }catch(parseErr){
          lastErr=new Error('Proxy '+(i+1)+' returned non-JSON'); continue;
        }
        return json;
      }catch(err){ lastErr=err; }
    }
    throw lastErr || new Error('All CORS proxies failed');
  }

  async function fetchChain(symbol, expEpoch){
    var base='https://query1.finance.yahoo.com/v7/finance/options/'+encodeURIComponent(symbol);
    var url=expEpoch?base+'?date='+expEpoch:base;
    var json=await fetchViaProxies(url);
    if(json && json.optionChain && json.optionChain.error){
      throw new Error(json.optionChain.error.description||'Yahoo returned an error');
    }
    var result=json && json.optionChain && json.optionChain.result && json.optionChain.result[0];
    if(!result)throw new Error('No option chain returned for '+symbol);
    return result;
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
    var rows=(type==='call'?chain.calls:chain.puts)||[];
    if(!rows.length){
      var o=document.createElement('option'); o.textContent='No '+type+'s available'; o.disabled=true; sel.appendChild(o); return;
    }
    // Pre-select the strike nearest spot.
    var spot=state.spot;
    var bestIdx=0, bestDist=Infinity;
    rows.forEach(function(r,i){
      var d=Math.abs((r.strike||0)-spot);
      if(d<bestDist){bestDist=d;bestIdx=i;}
      var o=document.createElement('option');
      o.value=r.contractSymbol||String(i);
      var bidAsk = ' (bid '+fmt(r.bid)+' / ask '+fmt(r.ask)+')';
      o.textContent='$'+fmt(r.strike)+bidAsk;
      sel.appendChild(o);
    });
    sel.selectedIndex=bestIdx;
  }

  function findContract(){
    var type=$('opt-type').value;
    var chain=state.chains[state.currentExp]; if(!chain)return null;
    var rows=(type==='call'?chain.calls:chain.puts)||[];
    var sym=$('opt-strike').value;
    return rows.find(function(r){return (r.contractSymbol||'')===sym;}) || null;
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
    var bid=c.bid, ask=c.ask;
    var mid = (bid!=null&&ask!=null && (bid+ask)>0) ? (bid+ask)/2 : (c.lastPrice||null);
    var spread = (bid!=null&&ask!=null) ? (ask-bid) : null;
    var spreadPct = (spread!=null && mid>0) ? (spread/mid*100) : null;
    var iv = c.impliedVolatility;
    var expEpoch = state.currentExp;
    var T = (expEpoch*1000 - Date.now()) / (365*24*3600*1000);
    var g = (T>0 && iv>0) ? greeks(type, state.spot, c.strike, T, iv, RFR) : null;

    var sGrade = spreadPct!=null ? gradeSpread(spreadPct) : {label:'—', cls:'fair', note:'no quote'};
    var dGrade = g ? gradeDelta(g.delta, type) : {label:'—', cls:'fair', note:'delta unavailable'};
    var tGrade = g ? gradeTheta(g.thetaDay, mid) : {label:'—', cls:'fair', note:'theta unavailable'};
    var verdict = overallVerdict([sGrade, dGrade, tGrade]);

    var html = '';
    html += '<div class="opt-verdict '+verdict.cls+'">'+verdict.label+'</div>';
    html += '<div class="opt-contract">'+(c.contractSymbol||'')+' · spot $'+fmt(state.spot)+' · '+Math.max(0,Math.round(T*365))+' days to expiry</div>';
    html += '<div class="opt-grid">';
    html += row('Bid / Ask', '$'+fmt(bid)+' / $'+fmt(ask));
    html += row('Mid', mid!=null?'$'+fmt(mid):'—');
    html += row('Spread', spread!=null?('$'+fmt(spread)+' ('+fmtPct(spreadPct)+')'):'—', gradeChip(sGrade));
    html += row('IV', iv!=null?fmtPct(iv*100):'—');
    html += row('Delta', g?fmt(g.delta,3):'—', g?gradeChip(dGrade):'');
    html += row('Theta / day', g?'$'+fmt(g.thetaDay,3):'—', g?gradeChip(tGrade):'');
    html += row('Gamma', g?fmt(g.gamma,4):'—');
    html += row('Vega (per 1 vol pt)', g?'$'+fmt(g.vega,3):'—');
    html += row('Open interest', c.openInterest!=null?String(c.openInterest):'—');
    html += row('Volume', c.volume!=null?String(c.volume):'—');
    html += '</div>';
    html += '<ul class="opt-notes">';
    html += '<li><b>Spread:</b> '+sGrade.note+'.</li>';
    html += '<li><b>Delta:</b> '+dGrade.note+'.</li>';
    html += '<li><b>Theta:</b> '+tGrade.note+'.</li>';
    html += '</ul>';
    html += '<p class="opt-disclaimer">Greeks are computed with Black-Scholes using Yahoo&apos;s implied vol and a '+(RFR*100).toFixed(1)+'% risk-free rate. Liquidity, earnings risk, and IV crush are not graded — for information only.</p>';
    $('opt-eval-result').innerHTML=html;
    setStatus('','');
  }

  async function loadChain(){
    var symbol=$('opt-symbol').value.trim().toUpperCase();
    if(!symbol){ setStatus('Enter a ticker first.','err'); return; }
    setStatus('Loading chain for '+symbol+'…','');
    $('opt-eval-result').innerHTML='';
    $('opt-chain-row').hidden=true;
    $('opt-load-btn').disabled=true;
    try{
      var first=await fetchChain(symbol, null);
      var quote=first.quote||{};
      state.symbol=symbol;
      state.spot=quote.regularMarketPrice||quote.postMarketPrice||quote.preMarketPrice||null;
      state.expirations=first.expirationDates||[];
      state.chains={};
      if(!state.spot){ throw new Error('No spot price returned for '+symbol); }
      if(!state.expirations.length){ throw new Error('No option expirations returned for '+symbol); }
      var firstExp=(first.options&&first.options[0]&&first.options[0].expirationDate)||state.expirations[0];
      state.currentExp=firstExp;
      state.chains[firstExp]=first.options&&first.options[0];
      populateExpiry();
      $('opt-expiry').value=String(firstExp);
      populateStrikes();
      $('opt-chain-row').hidden=false;
      setStatus(symbol+' loaded · spot $'+fmt(state.spot)+' · '+state.expirations.length+' expirations available','ok');
    }catch(e){
      setStatus('Could not load chain: '+e.message,'err');
    }finally{
      $('opt-load-btn').disabled=false;
    }
  }

  async function onExpiryChange(){
    var exp=Number($('opt-expiry').value);
    state.currentExp=exp;
    if(state.chains[exp]){ populateStrikes(); return; }
    setStatus('Loading '+fmtExpiryLabel(exp)+' chain…','');
    try{
      var r=await fetchChain(state.symbol, exp);
      state.chains[exp]=r.options&&r.options[0];
      populateStrikes();
      setStatus('','');
    }catch(e){ setStatus('Could not load expiration: '+e.message,'err'); }
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

function renderHtml() {
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
  .opt-form input, .opt-form select, .opt-chain-row select {
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 10px; color: var(--text);
    font: inherit; font-size: 14px; min-width: 120px;
  }
  .opt-form input { text-transform: uppercase; letter-spacing: 0.04em; min-width: 160px; }
  .opt-form input:focus, .opt-form select:focus, .opt-chain-row select:focus {
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
  <div class="sub">Grade a single options contract on spread quality, delta, and theta.</div>
</header>
<main>
  ${optionEvalSection()}
</main>
<footer>
  Data: Yahoo Finance option chain (via public CORS proxies). Greeks computed locally with Black-Scholes. For information only — not investment advice.
</footer>
${optionEvalScript()}
</body>
</html>`;
}

async function main() {
  const html = renderHtml();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  console.log("wrote " + OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
