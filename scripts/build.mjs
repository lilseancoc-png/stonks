// Fetches today's earnings calendar, biggest movers, key volatility/index
// quotes, and momentum plays, then writes index.html.
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

// Returns the next `n` NY weekdays as [{ dateStr: "YYYY-MM-DD", prettyStr: "Mon May 4" }]
function nextNyWeekdays(n) {
  const results = [];
  let cursor = new Date();
  while (results.length < n) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const { weekday, year, month, day } = nyDateParts(cursor);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const dateStr = `${year}-${month}-${day}`;
    const prettyStr = new Intl.DateTimeFormat("en-US", {
      timeZone: NY_TZ,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(cursor);
    results.push({ dateStr, prettyStr });
  }
  return results;
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

async function fetchUpcomingEarnings(nDays = 2) {
  const weekdays = nextNyWeekdays(nDays);
  const results = await Promise.all(
    weekdays.map(async ({ dateStr, prettyStr }) => {
      const rows = await fetchEarnings(dateStr);
      return { dateStr, prettyStr, rows };
    }),
  );
  return results.filter((r) => r.rows.length > 0);
}

async function fetchSectorPanel() {
  const sectors = [
    { sym: "XLK", label: "Tech" },
    { sym: "XLF", label: "Finance" },
    { sym: "XLE", label: "Energy" },
    { sym: "XLV", label: "Health" },
    { sym: "XLY", label: "Cons Disc" },
    { sym: "XLC", label: "Comm Svc" },
    { sym: "XLI", label: "Industrl" },
    { sym: "XLP", label: "Cons Stpl" },
  ];
  const quotes = await Promise.all(sectors.map((s) => fetchYahooQuote(s.sym)));
  return sectors
    .map((s, i) => (quotes[i] ? { ...quotes[i], label: s.label } : null))
    .filter(Boolean);
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
    <td class="sym">${symbolLinks(q.symbol)}</td>
    <td class="name">${escapeHtml(q.name)}</td>
    <td class="num">${q.price != null ? `$${fmtPrice.format(q.price)}` : "—"}</td>
    <td class="num ${cls}">${sign}${fmtPct.format(pct)}%</td>
    <td class="num">${compactVol(q.volume)}</td>
    <td class="num">${compactCap(q.marketCap)}</td>
  </tr>`;
}

function earningsRow(e) {
  return `<tr>
    <td class="sym">${symbolLinks(e.symbol)}</td>
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

function sectorSection(quotes) {
  if (!quotes.length) return "";
  return `<section class="card full">
    <h2>Sector Performance</h2>
    <div class="vol-grid">${quotes.map(volQuoteCard).join("")}</div>
    <p class="hint">SPDR sector ETFs — spot rotation and relative strength. Click a tile for its options chain.</p>
  </section>`;
}

function earningsTimeChip(t) {
  switch (t) {
    case "time-pre-market":
      return `<span class="chip-time bmo">BMO</span>`;
    case "time-after-hours":
      return `<span class="chip-time amc">AMC</span>`;
    default:
      return `<span class="chip-time">TBD</span>`;
  }
}

function upcomingEarningsSection(upcoming) {
  if (!upcoming.length) return "";
  const days = upcoming
    .map(({ prettyStr, rows }) => {
      const sorted = [...rows].sort((a, b) => {
        const order = { "time-pre-market": 0, "time-after-hours": 1 };
        return (order[a.time] ?? 2) - (order[b.time] ?? 2);
      });
      const chips = sorted
        .map((e) => {
          const enc = encodeURIComponent(e.symbol);
          return `<a class="upcoming-chip" href="https://finance.yahoo.com/quote/${enc}/options" target="_blank" rel="noopener">${escapeHtml(e.symbol)}${earningsTimeChip(e.time)}</a>`;
        })
        .join("");
      return `<div class="upcoming-day">
        <div class="upcoming-day-label">${escapeHtml(prettyStr)}</div>
        <div class="upcoming-chips">${chips}</div>
      </div>`;
    })
    .join("");
  const total = upcoming.reduce((s, d) => s + d.rows.length, 0);
  return `<section class="card full">
    <h2>Upcoming Earnings <span class="count">${total}</span></h2>
    <div class="upcoming-grid">${days}</div>
    <p class="hint">BMO = before market open · AMC = after market close · click any ticker to open its options chain</p>
  </section>`;
}

// Score gainers by momentum: change% × log10(volume).
// Stocks also appearing in the actives list get a 1.5× volume-conviction boost.
function computeSpotlight(gainers, actives) {
  const activeSyms = new Set(actives.map((r) => r.symbol));
  return gainers
    .filter((g) => g.changePct != null && g.volume != null && g.price != null && g.changePct > 0)
    .map((g) => ({
      ...g,
      score: g.changePct * Math.log10(g.volume + 1) * (activeSyms.has(g.symbol) ? 1.5 : 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function spotlightCard(q) {
  const enc = encodeURIComponent(q.symbol);
  const chain = `https://finance.yahoo.com/quote/${enc}/options`;
  const quote = `https://finance.yahoo.com/quote/${enc}`;
  const sign = q.changePct >= 0 ? "+" : "";
  return `<a class="spot-card" href="${chain}" target="_blank" rel="noopener" title="Open option chain for ${escapeHtml(q.symbol)}">
    <div class="spot-sym">${escapeHtml(q.symbol)}</div>
    <div class="spot-name">${escapeHtml(q.name)}</div>
    <div class="spot-price">$${fmtPrice.format(q.price)}</div>
    <div class="spot-pct pos">${sign}${fmtPct.format(q.changePct)}%</div>
    <div class="spot-vol">${compactVol(q.volume)} vol</div>
    <div class="spot-chain-hint">tap for options chain</div>
  </a>`;
}

function spotlightSection(picks) {
  if (!picks.length) return "";
  return `<section class="card full">
    <h2>Momentum Plays <span class="count">${picks.length}</span></h2>
    <p class="hint">Top gainers ranked by move size × volume — highest-conviction moves today. Click any card for its options chain.</p>
    <div class="spot-grid">${picks.map(spotlightCard).join("")}</div>
  </section>`;
}

// Exchange prefixes required by TradingView for each watchlist symbol.
const WATCHLIST_TV = [
  { sym: "SPY",   tv: "AMEX:SPY"     },
  { sym: "QQQ",   tv: "NASDAQ:QQQ"   },
  { sym: "IWM",   tv: "AMEX:IWM"     },
  { sym: "NVDA",  tv: "NASDAQ:NVDA"  },
  { sym: "AAPL",  tv: "NASDAQ:AAPL"  },
  { sym: "MSFT",  tv: "NASDAQ:MSFT"  },
  { sym: "META",  tv: "NASDAQ:META"  },
  { sym: "AMZN",  tv: "NASDAQ:AMZN"  },
  { sym: "GOOGL", tv: "NASDAQ:GOOGL" },
  { sym: "TSLA",  tv: "NASDAQ:TSLA"  },
  { sym: "AMD",   tv: "NASDAQ:AMD"   },
  { sym: "COIN",  tv: "NASDAQ:COIN"  },
];

function watchlistSection() {
  const tvSymbols = WATCHLIST_TV.map((e) => `{"s":"${e.tv}","d":"${e.sym}"}`).join(",");
  const chainLinks = WATCHLIST_TV.map(({ sym }) => {
    const enc = encodeURIComponent(sym);
    return `<a class="chain-quick" href="https://finance.yahoo.com/quote/${enc}/options" target="_blank" rel="noopener">${sym}</a>`;
  }).join("");
  return `<section class="card full">
    <h2>Live Watchlist</h2>
    <div class="tradingview-widget-container" style="height:420px;margin-bottom:14px;">
      <div class="tradingview-widget-container__widget" style="height:100%;"></div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js" async>
      {
        "colorTheme": "dark",
        "dateRange": "1D",
        "showChart": true,
        "locale": "en",
        "isTransparent": true,
        "showSymbolLogo": false,
        "showFloatingTooltip": false,
        "width": "100%",
        "height": "420",
        "plotLineColorGrowing": "rgba(110,168,255,1)",
        "plotLineColorFalling": "rgba(255,92,92,1)",
        "gridLineColor": "rgba(35,40,56,0.5)",
        "scaleFontColor": "rgba(138,147,166,1)",
        "belowLineFillColorGrowing": "rgba(110,168,255,0.1)",
        "belowLineFillColorFalling": "rgba(255,92,92,0.1)",
        "belowLineFillColorGrowingBottom": "rgba(110,168,255,0)",
        "belowLineFillColorFallingBottom": "rgba(255,92,92,0)",
        "symbolActiveColor": "rgba(110,168,255,0.1)",
        "tabs": [{"title":"Watchlist","symbols":[${tvSymbols}],"originalTitle":"Watchlist"}]
      }
      <\/script>
    </div>
    <div class="chain-quick-row">${chainLinks}</div>
    <p class="hint">Click a row in the list for its chart · Click a symbol button below to jump straight to its options chain on Yahoo</p>
  </section>`;
}

function chatHtml() {
  return `
<button class="chat-fab" id="chat-fab" title="Ask AI about stocks">&#x1F4AC;</button>
<div class="chat-panel" id="chat-panel">
  <div class="chat-header">
    <div>
      <span class="chat-title">AI Stock Assistant</span>
      <span class="chat-badge">Free</span>
    </div>
    <button class="chat-icon-btn" id="chat-close" title="Close">&#x2715;</button>
  </div>
  <div class="chat-messages" id="chat-messages">
    <div class="chat-msg assistant">Hi! I have today&apos;s earnings, movers, and volatility loaded. Ask me about any stock, for trade ideas, or what looks interesting today.</div>
  </div>
  <div class="chat-input-row">
    <textarea class="chat-input" id="chat-input" rows="1" placeholder="Ask about a stock or strategy…"></textarea>
    <button class="chat-send" id="chat-send">&#x27A4;</button>
  </div>
</div>`;
}

function chatScript(data) {
  const safeData = JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>");
  return `
<script>window.STONKS_DATA=${safeData};<\/script>
<script>
(function(){
  var hist=[];
  var busy=false;

  function sysPrompt(){
    var d=window.STONKS_DATA||{};
    var L=[
      'You are a stock market and options trading assistant in Stonks Hub.',
      'Today is '+d.date+'.',
      '',
      '=== CRITICAL RULES ===',
      '1. ONLY use the market data below for facts about prices, earnings dates, and movers.',
      '2. The EARNINGS TODAY list is ONLY companies reporting on '+d.date+'. Do NOT state earnings dates for any company not in this list — say you do not have that data and direct them to earningswhispers.com or the company investor relations page.',
      '3. Do NOT invent or guess specific stock prices, earnings dates, EPS figures, or analyst targets. If the information is not in the data below, say so clearly.',
      '4. For general market concepts, options strategies, and educational questions you may use your training knowledge — but label it as general knowledge, not current data.',
      '=== END RULES ===',
      ''
    ];
    if(d.earnings&&d.earnings.length){
      L.push('EARNINGS REPORTING TODAY ('+d.date+') — '+d.earnings.length+' companies:');
      d.earnings.forEach(function(e){
        L.push('  '+e.symbol+' ('+e.name+') | When: '+e.time+' | EPS forecast: '+(e.epsForecast||'n/a')+' | Last year EPS: '+(e.lastYearEPS||'n/a')+' | Mkt cap: '+(e.marketCap||'n/a'));
      });
    } else {
      L.push('EARNINGS TODAY: No earnings data available for '+d.date+'.');
    }
    if(d.upcoming&&d.upcoming.length){
      L.push('\\nUPCOMING EARNINGS (next 2 trading days):');
      d.upcoming.forEach(function(day){
        var tickers=day.rows.map(function(e){return e.symbol+'('+e.time+')'}).join(', ');
        L.push('  '+day.prettyStr+': '+tickers);
      });
    }
    if(d.gainers&&d.gainers.length){
      L.push('\\nTOP GAINERS TODAY:');
      d.gainers.forEach(function(g){L.push('  '+g.symbol+' +'+((g.changePct||0).toFixed(2))+'% $'+((g.price||0).toFixed(2))+' vol '+g.volume);});
    }
    if(d.losers&&d.losers.length){
      L.push('\\nTOP LOSERS TODAY:');
      d.losers.forEach(function(g){L.push('  '+g.symbol+' '+((g.changePct||0).toFixed(2))+'% $'+((g.price||0).toFixed(2)));});
    }
    if(d.actives&&d.actives.length){
      L.push('\\nMOST ACTIVE TODAY:');
      d.actives.slice(0,6).forEach(function(g){L.push('  '+g.symbol+' vol '+g.volume);});
    }
    if(d.volatility&&d.volatility.length){
      L.push('\\nVOLATILITY/INDEXES:');
      d.volatility.forEach(function(v){L.push('  '+v.label+' '+v.price+' ('+(v.changePct>=0?'+':'')+(v.changePct||0).toFixed(2)+'%)');});
    }
    L.push('\\nBe concise and practical. Flag risks. Add a brief disclaimer when giving specific trade ideas.');
    return L.join('\\n');
  }

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function renderMd(s){
    return esc(s)
      .replace(/\\*\\*(.+?)\\*\\*/g,'<b>$1</b>')
      .replace(/\\*(.+?)\\*/g,'<em>$1</em>')
      .replace(/\`(.+?)\`/g,'<code style="background:var(--border);padding:1px 4px;border-radius:3px;font-size:13px;">$1</code>')
      .replace(/\\n/g,'<br>');
  }

  function scrollBottom(){var m=document.getElementById('chat-messages');if(m)m.scrollTop=m.scrollHeight;}

  function addMsg(role,content,isHtml){
    var m=document.getElementById('chat-messages');if(!m)return null;
    var d=document.createElement('div');
    d.className='chat-msg '+role;
    if(isHtml)d.innerHTML=content;else d.textContent=content;
    m.appendChild(d);scrollBottom();return d;
  }

  function setSend(on){var b=document.getElementById('chat-send');if(b)b.disabled=!on;}

  async function send(text){
    if(busy||!text.trim())return;
    busy=true;setSend(false);
    addMsg('user',text,false);
    hist.push({role:'user',content:text});
    var thinking=addMsg('thinking','Thinking…',false);
    try{
      var messages=[{role:'system',content:sysPrompt()}].concat(hist);
      var res=await fetch('https://text.pollinations.ai/',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:messages,model:'openai-large',seed:Date.now()%9999,private:true})
      });
      if(!res.ok)throw new Error('Service returned HTTP '+res.status+'. Please try again.');
      var reply=await res.text();
      if(thinking&&thinking.parentNode)thinking.parentNode.removeChild(thinking);
      addMsg('assistant',renderMd(reply),true);
      hist.push({role:'assistant',content:reply});
    }catch(e){
      if(thinking&&thinking.parentNode)thinking.parentNode.removeChild(thinking);
      addMsg('assistant','Sorry, couldn\\'t get a response: '+esc(e.message),true);
    }finally{busy=false;setSend(true);}
  }

  function bind(){
    var fab=document.getElementById('chat-fab');
    var panel=document.getElementById('chat-panel');
    var input=document.getElementById('chat-input');
    var sendBtn=document.getElementById('chat-send');
    var closeBtn=document.getElementById('chat-close');

    fab.addEventListener('click',function(){
      var open=panel.classList.toggle('open');
      if(open&&input)input.focus();
    });
    closeBtn.addEventListener('click',function(){panel.classList.remove('open');});
    sendBtn.addEventListener('click',function(){
      var v=input.value.trim();if(!v)return;
      input.value='';input.style.height='';send(v);
    });
    input.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendBtn.click();}
    });
    input.addEventListener('input',function(){
      this.style.height='auto';
      this.style.height=Math.min(this.scrollHeight,120)+'px';
    });
    document.addEventListener('keydown',function(e){if(e.key==='Escape')panel.classList.remove('open');});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
<\/script>`;
}

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

function renderHtml({ today, prettyDate, updated, earnings, upcoming, gainers, losers, actives, volatility, sectors, spotlight, chatData }) {
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
  /* Live Watchlist */
  .tradingview-widget-container { border-radius: 10px; overflow: hidden; }
  .chain-quick-row {
    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;
  }
  .chain-quick {
    display: inline-block;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 12px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    letter-spacing: 0.03em;
    transition: border-color 0.15s, background 0.15s;
  }
  .chain-quick:hover { border-color: var(--accent); background: rgba(110,168,255,0.1); }
  .spot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 6px;
  }
  .spot-card {
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: linear-gradient(145deg, var(--panel-2), #1a2540);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 14px 12px;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  }
  .spot-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(110,168,255,0.12);
  }
  .spot-sym {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--accent);
  }
  .spot-name {
    font-size: 11px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 6px;
  }
  .spot-price {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .spot-pct {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .spot-vol {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    margin-top: 2px;
  }
  .spot-chain-hint {
    font-size: 10px;
    color: var(--accent);
    opacity: 0.6;
    margin-top: 6px;
    letter-spacing: 0.04em;
  }
  .spot-card:hover .spot-chain-hint { opacity: 1; }
  /* Upcoming Earnings */
  .upcoming-grid { display: flex; flex-direction: column; gap: 18px; }
  .upcoming-day-label {
    font-size: 12px; color: var(--muted); text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 8px; font-weight: 600;
  }
  .upcoming-chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .upcoming-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 8px; padding: 5px 10px;
    color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 700;
    transition: border-color 0.15s;
  }
  .upcoming-chip:hover { border-color: var(--accent); }
  .chip-time {
    font-size: 10px; font-weight: 500; color: var(--muted);
    padding: 1px 5px; border-radius: 4px; background: var(--border);
  }
  .chip-time.bmo { color: #f39c12; background: rgba(243,156,18,0.15); }
  .chip-time.amc { color: var(--accent); background: rgba(110,168,255,0.12); }
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
  /* AI Chat */
  .chat-fab {
    position: fixed; bottom: 24px; right: 24px; width: 54px; height: 54px;
    border-radius: 50%; background: var(--accent); color: #0b0d12;
    border: none; font-size: 22px; cursor: pointer; z-index: 300;
    box-shadow: 0 4px 20px rgba(110,168,255,0.45);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .chat-fab:hover { transform: scale(1.07); box-shadow: 0 6px 26px rgba(110,168,255,0.55); }
  .chat-panel {
    position: fixed; bottom: 92px; right: 24px;
    width: 390px; max-width: calc(100vw - 32px);
    height: 550px; max-height: calc(100vh - 120px);
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    z-index: 300; display: none; flex-direction: column; overflow: hidden;
  }
  .chat-panel.open { display: flex; }
  .chat-header {
    padding: 13px 14px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
  }
  .chat-title { font-weight: 700; font-size: 14px; }
  .chat-badge {
    display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
    background: rgba(46,204,113,0.15); color: var(--pos);
    border: 1px solid rgba(46,204,113,0.3); border-radius: 999px;
    padding: 1px 7px; margin-left: 7px; vertical-align: middle;
  }
  .chat-icon-btn {
    background: none; border: none; color: var(--muted); cursor: pointer;
    padding: 4px 7px; border-radius: 6px; font-size: 14px; line-height: 1;
  }
  .chat-icon-btn:hover { color: var(--text); background: var(--border); }
  .chat-messages {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .chat-msg {
    max-width: 88%; padding: 9px 12px; border-radius: 12px;
    font-size: 14px; line-height: 1.55; word-break: break-word;
  }
  .chat-msg.user {
    background: var(--accent); color: #0b0d12;
    align-self: flex-end; border-bottom-right-radius: 3px;
  }
  .chat-msg.assistant {
    background: var(--panel-2); border: 1px solid var(--border);
    align-self: flex-start; border-bottom-left-radius: 3px;
  }
  .chat-msg.thinking {
    background: var(--panel-2); border: 1px solid var(--border);
    align-self: flex-start; color: var(--muted); border-bottom-left-radius: 3px;
    animation: chat-pulse 1.4s ease-in-out infinite;
  }
  @keyframes chat-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
  .chat-input-row {
    padding: 10px 12px; border-top: 1px solid var(--border);
    display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
  }
  .chat-input {
    flex: 1; background: var(--panel-2); border: 1px solid var(--border);
    border-radius: 10px; padding: 8px 12px; color: var(--text);
    font: inherit; font-size: 14px; resize: none; overflow-y: auto;
    max-height: 120px; line-height: 1.4;
  }
  .chat-input:focus { outline: none; border-color: var(--accent); }
  .chat-send {
    background: var(--accent); color: #0b0d12; border: none;
    border-radius: 10px; padding: 9px 13px; font-size: 16px;
    cursor: pointer; flex-shrink: 0; transition: background 0.15s;
  }
  .chat-send:hover { background: #8bbfff; }
  .chat-send:disabled { background: var(--border); color: var(--muted); cursor: default; }
</style>
</head>
<body>
<header>
  <h1>Stonks Hub <span class="sub-tag">options edition</span></h1>
  <div class="sub">${prettyDate} · Updated ${updated} (NY) · auto-refreshed daily</div>
</header>
<main>
  ${volatilitySection(volatility)}
  ${sectorSection(sectors)}
  ${watchlistSection()}
  ${spotlightSection(spotlight)}
  ${earningsSection(earnings)}
  ${upcomingEarningsSection(upcoming)}
  ${moverTable("Top Gainers", gainers)}
  ${moverTable("Top Losers", losers)}
  ${moverTable("Most Active", actives)}
</main>
<footer>
  Data: Nasdaq earnings calendar, Nasdaq market movers, Yahoo Finance chart endpoint.
  Click ⛓ on any ticker or a Momentum card to open its option chain on Yahoo. For information only — not investment advice.
  <br/>Date key: ${today}
</footer>
${chatHtml()}
${chatScript(chatData)}
</body>
</html>`;
}

async function main() {
  const today = nyToday();
  const { weekday } = nyDateParts();
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  const [earnings, gainers, losers, actives, volatility, sectors, upcoming] = await Promise.all([
    fetchEarnings(today),
    fetchMovers("GAINERS", 15),
    fetchMovers("LOSERS", 15),
    fetchMovers("ACTIVE", 15),
    fetchVolatilityPanel(),
    fetchSectorPanel(),
    fetchUpcomingEarnings(2),
  ]);

  const spotlight = computeSpotlight(gainers, actives);

  const html = renderHtml({
    today,
    prettyDate: nyPretty() + (isWeekend ? " (markets closed)" : ""),
    updated: nyTimestamp(),
    earnings,
    upcoming,
    gainers,
    losers,
    actives,
    volatility,
    sectors,
    spotlight,
    chatData: { date: today, earnings, upcoming, gainers, losers, actives, volatility },
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  const upcomingCount = upcoming.reduce((s, d) => s + d.rows.length, 0);
  console.log(
    `wrote ${OUT} — earnings:${earnings.length} upcoming:${upcomingCount} gainers:${gainers.length} losers:${losers.length} actives:${actives.length} vol:${volatility.length} sectors:${sectors.length} spotlight:${spotlight.length}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
