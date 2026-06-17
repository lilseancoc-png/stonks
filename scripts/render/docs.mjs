// Reference / legal / info pages, rendered as in-app tabs.
//
// These were formerly standalone HTML files (cheatsheet.html, chart-patterns.html,
// features.html, privacy.html, terms.html). They are now mounted into a Shadow
// DOM per tab (scripts/render/app-js.mjs → mountDocPane) — the shadow root still
// isolates each page's layout CSS from the app's global stylesheet, but the
// shared DOC_THEME_OVERRIDE (below) is appended inside every page's <style> so
// they're re-skinned onto the app's design tokens and read as part of the site
// (not their own standalone design). To edit a page, edit its `style`/`body`
// below — the markup is the page's original <body>, and the CSS is its original
// <style> adapted for a shadow root (:root/body → :host, fixed overlays →
// absolute). To retune the shared skin (colours/fonts/chrome), edit
// DOC_THEME_OVERRIDE. Hand-maintained; no build step regenerates this file.

import { DISCORD_INVITE_URL } from "../../lib/links.mjs";

export const DOC_ORDER = ["cheatsheet","chart-patterns","features","privacy","terms"];

// Shared theme override, appended (in source order, so it wins) inside every
// doc page's <style> by html.mjs. These pages were former standalone HTML files
// with their own dark palette/fonts/atmosphere, which made them read as a
// different site once embedded as tabs. This re-skins them onto stonks' shared
// design tokens — brass accent, ledger surfaces, the same fonts — and, because
// custom properties inherit across the shadow boundary, makes them follow the
// app's light/dark toggle too. Token names that collide with app tokens
// (--bg/--surface/--muted/--warn) are `unset` so they inherit the app value;
// the rest remap onto app tokens. It also strips the standalone-page chrome
// (noise + radial atmosphere, the "← Back to stonks" link) and brings the
// oversized masthead down to the app's heading scale. Edit here to retune the
// whole doc-tab skin in one place rather than per page.
export const DOC_THEME_OVERRIDE = `
/* ── stonks app-theme skin (shared, appended last) ───────────────────── */
:host{
  --bg:unset; --surface:unset; --muted:unset; --warn:unset;
  --bg2:var(--surface);
  --surface2:var(--surface-2);
  --line:var(--border);
  --line2:var(--border-strong);
  --ink:var(--text-strong);
  --faint:color-mix(in srgb, var(--muted) 70%, transparent);
  --gold:var(--accent);
  --gold-dim:var(--accent-line);
  --call:var(--pos);
  --put:var(--neg);
  --vega:var(--info);
  --theta:var(--accent-strong);
  --danger:var(--neg);
  --green:var(--pos);
  --green-dim:color-mix(in srgb, var(--pos) 50%, var(--border));
  /* --blurple is left as the page's Discord brand colour — the "Join Discord"
     CTA stays recognizable (and white-on-blurple keeps its contrast). */
  --radius:var(--r-4);
  --mono:var(--font-mono);
  --disp:var(--font-serif);
  --body:var(--font-sans);
}
:host::before, :host::after{ content:none !important; background:none !important; }
.backlink{ display:none !important; }
header{ padding-top:6px !important; }
h1{ font-size:clamp(30px,4.5vw,44px) !important; }
`;

export const DOC_PAGES = {
  "cheatsheet": {
    label: "Buyer's manual",
    title: "Buyer's manual",
    style: `:host{position:relative;display:block}

  :host{
    --bg:#0d0e12;
    --bg2:#11131a;
    --surface:#171922;
    --surface2:#1d2029;
    --line:#2a2e3a;
    --line2:#363b49;
    --ink:#e9e6dd;
    --muted:#8b8f9c;
    --faint:#5c606d;
    --gold:#e6b24a;
    --gold-dim:#a07e34;
    --call:#4ade80;
    --put:#fb6f76;
    --vega:#6db5f0;
    --theta:#d59bf0;
    --warn:#f0a23a;
    --danger:#f0595f;
    --radius:14px;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Fraunces',Georgia,serif;
    --body:'Hanken Grotesk',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  
  :host{
    background:var(--bg);
    color:var(--ink);
    font-family:var(--body);
    line-height:1.55;
    font-size:15px;
    -webkit-font-smoothing:antialiased;
    position:relative;
    overflow-x:hidden;
  }
  /* atmosphere */
  :host::before{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
    background:
      radial-gradient(900px 600px at 12% -5%, rgba(230,178,74,.10), transparent 60%),
      radial-gradient(800px 700px at 100% 0%, rgba(109,181,240,.07), transparent 55%),
      radial-gradient(700px 700px at 50% 120%, rgba(74,222,128,.05), transparent 60%);
  }
  :host::after{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.035;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:0 22px 90px}

  .backlink{
    display:inline-flex;align-items:center;gap:8px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);text-decoration:none;
    margin-top:28px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;
    transition:color .2s ease,border-color .2s ease,background .2s ease;
  }
  .backlink:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--surface)}

  /* masthead */
  header{padding:28px 0 38px;border-bottom:1px solid var(--line)}
  .kicker{
    font-family:var(--mono);font-size:11px;letter-spacing:.34em;text-transform:uppercase;
    color:var(--gold);display:flex;align-items:center;gap:14px;margin:36px 0 20px;
  }
  .kicker::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--gold-dim),transparent)}
  h1{
    font-family:var(--disp);font-weight:600;font-size:clamp(38px,7vw,76px);
    line-height:.96;letter-spacing:-.02em;
  }
  h1 em{font-style:italic;color:var(--gold)}
  .sub{margin-top:22px;max-width:620px;color:var(--muted);font-size:16.5px}
  .scope{
    margin-top:26px;display:inline-flex;align-items:center;gap:10px;
    font-family:var(--mono);font-size:12px;letter-spacing:.05em;color:var(--ink);
    background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--gold);
    padding:9px 16px;border-radius:8px;
  }
  .scope b{color:var(--gold);font-weight:500}

  /* section scaffolding */
  section{padding-top:54px}
  .shead{display:flex;align-items:baseline;gap:16px;margin-bottom:22px}
  .snum{
    font-family:var(--mono);font-size:13px;color:var(--gold);
    border:1px solid var(--gold-dim);border-radius:6px;padding:3px 9px;flex:none;
  }
  .shead h2{font-family:var(--disp);font-weight:500;font-size:clamp(24px,3.4vw,33px);letter-spacing:-.01em}
  .shead p{margin-left:auto;color:var(--faint);font-size:13px;font-family:var(--mono);align-self:center;text-align:right}

  .grid{display:grid;gap:16px}
  .g2{grid-template-columns:repeat(2,1fr)}
  .g3{grid-template-columns:repeat(3,1fr)}
  @media(max-width:780px){.g2,.g3{grid-template-columns:1fr}}

  .card{
    background:linear-gradient(180deg,var(--surface),var(--bg2));
    border:1px solid var(--line);border-radius:var(--radius);padding:22px 22px 20px;
    transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease;
  }
  .card:hover{transform:translateY(-3px);border-color:var(--line2);box-shadow:0 14px 40px -22px rgba(0,0,0,.9)}
  .card h3{font-family:var(--disp);font-weight:600;font-size:19px;margin-bottom:8px}
  .card h3 .tag{font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--faint);text-transform:uppercase;margin-left:8px}
  .card p{color:var(--muted);font-size:14.5px}
  .card p strong{color:var(--ink);font-weight:600}
  .lead-call{border-left:3px solid var(--call)}
  .lead-put{border-left:3px solid var(--put)}
  .lead-gold{border-left:3px solid var(--gold)}

  .term{font-family:var(--mono);color:var(--gold);font-weight:500}
  .up{color:var(--call);font-weight:600}
  .down{color:var(--put);font-weight:600}

  /* formula callouts */
  .formula{
    background:var(--surface2);border:1px dashed var(--line2);border-radius:10px;
    padding:16px 18px;font-family:var(--mono);font-size:14px;color:var(--ink);
  }
  .formula .lbl{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:7px}
  .formula b{color:var(--call)}
  .formula .r b{color:var(--put)}

  /* greeks table */
  .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
  table{border-collapse:collapse;width:100%;min-width:640px}
  th,td{text-align:left;padding:14px 16px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}
  thead th{
    font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:var(--faint);background:var(--bg2);font-weight:500;
  }
  tbody tr:last-child td{border-bottom:none}
  tbody tr:hover{background:rgba(255,255,255,.018)}
  .gk{font-family:var(--disp);font-weight:600;font-size:17px;display:flex;align-items:center;gap:9px}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  td .hook{font-family:var(--mono);font-size:11.5px;color:var(--faint)}
  td.muted{color:var(--muted)}

  /* day timeline */
  .clock{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  @media(max-width:780px){.clock{grid-template-columns:1fr}}
  .slot{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;position:relative;overflow:hidden}
  .slot .time{font-family:var(--mono);font-size:12px;color:var(--gold);letter-spacing:.05em}
  .slot .name{font-family:var(--disp);font-size:20px;font-weight:600;margin:4px 0 9px}
  .slot p{color:var(--muted);font-size:13.5px}
  .slot .bar{position:absolute;top:0;left:0;height:3px;width:100%}
  .bar-hot{background:linear-gradient(90deg,var(--danger),var(--warn))}
  .bar-cool{background:linear-gradient(90deg,var(--vega),#3a4658)}
  .bar-warm{background:linear-gradient(90deg,var(--warn),var(--gold))}

  /* lists */
  ul.clean{list-style:none;display:flex;flex-direction:column;gap:10px}
  ul.clean li{position:relative;padding-left:24px;color:var(--muted);font-size:14.5px}
  ul.clean li strong{color:var(--ink);font-weight:600}
  ul.clean li::before{content:"▸";position:absolute;left:0;top:0;color:var(--gold);font-size:13px}

  /* checklist */
  .checklist{background:linear-gradient(180deg,var(--surface),var(--bg2));border:1px solid var(--gold-dim);border-radius:var(--radius);padding:24px 26px}
  .checklist ul{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:13px 28px}
  @media(max-width:780px){.checklist ul{grid-template-columns:1fr}}
  .checklist li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:var(--ink)}
  .checklist .box{flex:none;width:18px;height:18px;border:1.5px solid var(--gold);border-radius:4px;margin-top:2px}
  .checklist li span{color:var(--muted)}
  .checklist li b{color:var(--ink);font-weight:600}

  /* traps */
  .traps{background:linear-gradient(180deg,#1c1417,#15101280);border:1px solid #54262b;border-radius:var(--radius);padding:24px 26px}
  .traps h3{font-family:var(--disp);font-weight:600;font-size:21px;color:var(--put);margin-bottom:6px}
  .traps .lead{color:var(--muted);font-size:14px;margin-bottom:16px}
  .traps ul{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:12px 26px}
  @media(max-width:780px){.traps ul{grid-template-columns:1fr}}
  .traps li{position:relative;padding-left:26px;font-size:14px;color:var(--ink)}
  .traps li::before{content:"✕";position:absolute;left:0;top:1px;color:var(--danger);font-family:var(--mono);font-size:12px}
  .traps li span{color:var(--muted)}

  footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px;font-family:var(--mono);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}

  /* load animation */
  .reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
  @keyframes rise{to{opacity:1;transform:none}}
  header .reveal:nth-child(1){animation-delay:.05s}
  header .reveal:nth-child(2){animation-delay:.13s}
  header .reveal:nth-child(3){animation-delay:.21s}
  header .reveal:nth-child(4){animation-delay:.29s}
  header .reveal:nth-child(5){animation-delay:.37s}
  section{animation:rise .6s cubic-bezier(.2,.7,.2,1) both}`,
    body: `<div class="wrap">

  <header>
    <a class="backlink reveal" href="/">← Back to stonks</a>
    <div class="kicker reveal">Options Trading · Reference Card</div>
    <h1 class="reveal">The Buyer's<br><em>Field Manual</em></h1>
    <p class="sub reveal">Everything that matters for buying calls and puts — the concepts, the levers you actually control, and the habits that keep you in the game. Built to scan, not to read cover to cover.</p>
    <div class="scope reveal">SCOPE&nbsp;→&nbsp;<b>long calls &amp; puts only</b>&nbsp;· directional bets, sold back before expiry</div>
  </header>

  <!-- 01 BASICS -->
  <section>
    <div class="shead"><span class="snum">01</span><h2>The Building Blocks</h2><p>start here</p></div>
    <div class="grid g3">
      <div class="card lead-call"><h3>Call <span class="tag">bet up ↑</span></h3><p>The right to <strong>buy</strong> 100 shares at a fixed price. You want this when you think the stock <span class="up">rises</span>.</p></div>
      <div class="card lead-put"><h3>Put <span class="tag">bet down ↓</span></h3><p>The right to <strong>sell</strong> 100 shares at a fixed price. You want this when you think the stock <span class="down">falls</span>.</p></div>
      <div class="card lead-gold"><h3>Premium <span class="tag">×100</span></h3><p>The price of the contract itself. <strong>1 contract = 100 shares</strong>, so a "$2.00" option costs you <strong>$200</strong>.</p></div>
    </div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>Strike</h3><p>The fixed price you'd buy or sell at if you exercised.</p></div>
      <div class="card"><h3>Expiration <span class="tag">DTE</span></h3><p>The deadline. After it, the option is worthless. "DTE" = days to expiration.</p></div>
      <div class="card"><h3>Exit</h3><p>You almost always <strong>sell the option back</strong> before expiry — you rarely exercise.</p></div>
    </div>
  </section>

  <!-- 02 MONEYNESS -->
  <section>
    <div class="shead"><span class="snum">02</span><h2>Moneyness &amp; Value</h2><p>where the strike sits</p></div>
    <div class="grid g2">
      <div class="card lead-call">
        <h3>For a Call</h3>
        <ul class="clean">
          <li><strong class="up">ITM</strong> — strike <strong>below</strong> the stock price (already has real value)</li>
          <li><strong>ATM</strong> — strike <strong>around</strong> the stock price</li>
          <li><strong class="down">OTM</strong> — strike <strong>above</strong> the stock price (pure bet on the future)</li>
        </ul>
      </div>
      <div class="card lead-put">
        <h3>For a Put</h3>
        <ul class="clean">
          <li><strong class="up">ITM</strong> — strike <strong>above</strong> the stock price</li>
          <li><strong>ATM</strong> — strike <strong>around</strong> the stock price</li>
          <li><strong class="down">OTM</strong> — strike <strong>below</strong> the stock price</li>
        </ul>
      </div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card">
        <h3>Intrinsic vs. Extrinsic</h3>
        <p><strong>Intrinsic</strong> = the "real" value, how far in-the-money you already are. <strong>Extrinsic (time value)</strong> = everything you're paying for future possibility — and it's the part <span class="term">theta</span> and IV destroy. An OTM option is <strong>100% extrinsic</strong>, which is why it can rot to zero.</p>
      </div>
      <div class="card lead-gold">
        <h3>Breakeven <span class="tag">don't forget the premium</span></h3>
        <div class="formula">
          <span class="lbl">Call</span>breakeven = strike <b>+</b> premium paid
        </div>
        <div class="formula r" style="margin-top:10px">
          <span class="lbl">Put</span>breakeven = strike <b>−</b> premium paid
        </div>
      </div>
    </div>
  </section>

  <!-- 03 GREEKS -->
  <section>
    <div class="shead"><span class="snum">03</span><h2>The Greeks</h2><p>what moves your option's price</p></div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Greek</th><th>Measures</th><th>What it means for a buyer</th><th>Hook</th></tr></thead>
        <tbody>
          <tr>
            <td><span class="gk"><span class="dot" style="background:var(--call)"></span>Delta</span></td>
            <td class="muted">Price change per <strong>$1</strong> stock move. Also ≈ the odds of expiring ITM.</td>
            <td class="muted">Your <strong>direction</strong> exposure — usually the <strong>dominant</strong> driver of your P&amp;L.</td>
            <td><span class="hook">"speed"</span></td>
          </tr>
          <tr>
            <td><span class="gk"><span class="dot" style="background:var(--gold)"></span>Gamma</span></td>
            <td class="muted">How fast delta itself changes. Highest when <strong>ATM</strong>.</td>
            <td class="muted">Acceleration. Makes near-the-money options swing wildly.</td>
            <td><span class="hook">"acceleration"</span></td>
          </tr>
          <tr>
            <td><span class="gk"><span class="dot" style="background:var(--theta)"></span>Theta</span></td>
            <td class="muted">Value lost <strong>per day</strong> to time decay.</td>
            <td class="muted">Almost always <strong>against you</strong>. Accelerates as expiration nears.</td>
            <td><span class="hook">"the bleed"</span></td>
          </tr>
          <tr>
            <td><span class="gk"><span class="dot" style="background:var(--vega)"></span>Vega</span></td>
            <td class="muted">Sensitivity to a 1-point move in <strong>IV</strong>.</td>
            <td class="muted">Your volatility risk. High vega = exposed to IV collapsing.</td>
            <td><span class="hook">"volatility"</span></td>
          </tr>
          <tr>
            <td><span class="gk"><span class="dot" style="background:var(--faint)"></span>Rho</span></td>
            <td class="muted">Sensitivity to interest rates.</td>
            <td class="muted">Minor on short trades — mostly safe to ignore.</td>
            <td><span class="hook">"ignore-ish"</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- 04 IV -->
  <section>
    <div class="shead"><span class="snum">04</span><h2>Implied Volatility</h2><p>the market's guess at movement</p></div>
    <div class="grid g2">
      <div class="card lead-gold">
        <h3>What IV is</h3>
        <p>The market's expectation of <strong>how much</strong> a stock will move — not which direction. It's backed out of the option's price. <strong class="up">High IV = expensive</strong> options; <strong class="down">low IV = cheap</strong>. Bigger expected swings make options worth more.</p>
      </div>
      <div class="card">
        <h3>IV Rank / Percentile</h3>
        <p>Tells you if <strong>today's IV is high or low versus the stock's own past year</strong>. Low → buying is cheaper and safer. High → options are pricey and favor sellers. <strong>Check this before you buy.</strong></p>
      </div>
      <div class="card lead-put">
        <h3>IV Crush <span class="tag">the buyer's trap</span></h3>
        <p>Around <strong>earnings / binary events</strong>, IV inflates beforehand, then collapses the instant the news drops. You can be <strong>right on direction and still lose</strong> as IV deflates. A product announcement is a milder cousin — event-day IV that quietly fades, not a true crush.</p>
      </div>
      <div class="card">
        <h3>The Rule</h3>
        <ul class="clean">
          <li><strong>Prefer buying when IV is low.</strong></li>
          <li><strong>Avoid buying right before earnings.</strong></li>
          <li>A flat stock + a rising option = an <strong class="term">IV-driven</strong> move (vega, not delta).</li>
        </ul>
      </div>
    </div>
  </section>

  <!-- 05 LIQUIDITY -->
  <section>
    <div class="shead"><span class="snum">05</span><h2>Liquidity</h2><p>can you actually get out?</p></div>
    <div class="grid g3">
      <div class="card"><h3>Bid–Ask Spread</h3><p>The gap between buyers' and sellers' prices = your <strong>cost to transact</strong>. <span class="up">Tight</span> = liquid &amp; cheap. <span class="down">Wide</span> = illiquid &amp; a hidden tax every round trip.</p></div>
      <div class="card"><h3>Volume</h3><p>How many contracts traded <strong>today</strong>. High volume = active right now = quick, fair fills.</p></div>
      <div class="card"><h3>Open Interest</h3><p>How many contracts are <strong>currently open</strong> = the size of the existing crowd ready to take the other side.</p></div>
    </div>
    <div class="card lead-gold" style="margin-top:16px">
      <p><strong>Why it matters:</strong> getting <em>in</em> is easy; getting <em>out</em> is the problem. An illiquid option can trap you — forced to dump it below fair value, or no buyer at all near expiry. Stick to deep names (META, NVDA, SPY); obscure strikes and far-out expiries are where liquidity dries up.</p>
    </div>
  </section>

  <!-- 06 STRIKE & EXPIRY -->
  <section>
    <div class="shead"><span class="snum">06</span><h2>Your Two Levers</h2><p>strike &amp; expiration</p></div>
    <div class="grid g3">
      <div class="card lead-put"><h3>OTM <span class="tag">lottery ticket</span></h3><p>Cheap, explosive % gains, but <strong>100% time value</strong> — decays fast and needs a big, fast move. <strong>Where beginners quietly lose.</strong></p></div>
      <div class="card lead-gold"><h3>ATM</h3><p>Balanced cost. <strong>Highest gamma</strong> (most acceleration) <em>and</em> highest theta. Big swings both ways.</p></div>
      <div class="card lead-call"><h3>ITM</h3><p>Pricier but <strong>behaves like the stock</strong> (high delta), decays slower, smaller % swings. Safer, less leveraged.</p></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Short DTE</h3><p>Cheap and fast — but <strong>theta is brutal</strong> and accelerates near the end. Can evaporate over a weekend.</p></div>
      <div class="card"><h3>Long DTE</h3><p>Costs more, but slow decay and <strong>time for your thesis to play out</strong>.</p></div>
    </div>
    <div class="card lead-gold" style="margin-top:16px"><p><strong>The hard-learned rule:</strong> give yourself more time than you think you need. Being <em>right but early</em> still loses money if the option expires first.</p></div>
  </section>

  <!-- 07 DAY CLOCK -->
  <section>
    <div class="shead"><span class="snum">07</span><h2>The Trading Day</h2><p>execution timing · ET</p></div>
    <div class="clock">
      <div class="slot"><span class="bar bar-hot"></span><span class="time">9:30 – 10:00</span><div class="name">The Open</div><p><strong>Widest spreads, wildest prices.</strong> Market makers don't know fair value yet. Quotes can be stale. Wait 15–30 min for it to settle. <strong>Never market orders.</strong></p></div>
      <div class="slot"><span class="bar bar-cool"></span><span class="time">11:30 – 2:00</span><div class="name">Midday Lull</div><p>Thin volume, quiet ranges, calmest stretch. Reasonable spreads but little to act on.</p></div>
      <div class="slot"><span class="bar bar-warm"></span><span class="time">3:00 – 4:00</span><div class="name">Power Hour</div><p>Volume &amp; volatility return as desks rebalance and traders close out. Late directional moves live here.</p></div>
    </div>
    <div class="card lead-gold" style="margin-top:16px"><p><strong>Always use limit orders near the mid.</strong> The big moves cluster at the open and power hour — but the open is also where fills are worst. Separate <em>where the action is</em> from <em>where you can fill cleanly</em>.</p></div>
  </section>

  <!-- 08 ENTRY/EXIT -->
  <section>
    <div class="shead"><span class="snum">08</span><h2>Entry &amp; Exit Discipline</h2><p>the part you control</p></div>
    <div class="grid g2">
      <div class="card lead-call">
        <h3>Entering</h3>
        <ul class="clean">
          <li>Buy when <strong>IV is reasonable or low</strong>.</li>
          <li><strong>Limit orders</strong> near the mid — never market, never the chaotic open.</li>
          <li>Confirm <strong>liquidity</strong> first (spread, volume, OI).</li>
          <li>Define your <strong>profit target AND stop</strong> before you click buy.</li>
        </ul>
      </div>
      <div class="card lead-put">
        <h3>Exiting</h3>
        <ul class="clean">
          <li><strong>Take momentum gains</strong> — don't let theta erode a winner waiting for a perfect price.</li>
          <li><strong>Honor your stop.</strong> Long options can go to <strong>zero</strong>.</li>
          <li>"It'll come back" is how a small loss becomes a total one.</li>
        </ul>
      </div>
    </div>
  </section>

  <!-- 09 RISK -->
  <section>
    <div class="shead"><span class="snum">09</span><h2>Risk Management</h2><p>the one that actually matters</p></div>
    <div class="card lead-gold" style="padding:28px 26px">
      <h3 style="font-size:23px">Position Sizing</h3>
      <p style="font-size:15.5px;margin-top:6px">Decide the <strong>maximum dollars a single trade can lose — before you enter</strong> — and size to it. Long options can go to zero, so survival is about never letting one trade hurt you badly. <strong>More accounts die from oversizing than from picking the wrong direction.</strong> This outranks every concept above.</p>
    </div>
  </section>

  <!-- 10 DECOMPOSITION -->
  <section>
    <div class="shead"><span class="snum">10</span><h2>Read Your Own Trades</h2><p>the skill that compounds</p></div>
    <div class="grid g2">
      <div class="card">
        <h3>Decompose every move</h3>
        <p>When your option wins or loses, split the cause: <span class="up">delta</span> (stock moved) · <span class="term" style="color:var(--theta)">theta</span> (time passed) · <span class="term" style="color:var(--vega)">vega</span> (IV shifted). <strong>Reach for the simplest explanation first</strong> — usually it's delta + theta, not an exotic vega story.</p>
      </div>
      <div class="card lead-gold">
        <h3>Journal it <span class="tag">do this</span></h3>
        <p>Log every trade: <strong>strike, expiration, entry price, IV at entry, your thesis, and why you exited.</strong> Recording IV at entry is what lets you prove (or rule out) a vega move later. The journal teaches you more than any guide.</p>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <p style="color:var(--faint);font-family:var(--mono);font-size:12.5px">REMEMBER · The Greeks aren't static — delta shifts as the stock moves (gamma), theta accelerates toward expiry, and vega shrinks as expiration nears. The option you hold a week later is a different instrument.</p>
    </div>
  </section>

  <!-- CHECKLIST -->
  <section>
    <div class="shead"><span class="snum">✓</span><h2>Pre-Trade Checklist</h2><p>run it every time</p></div>
    <div class="checklist">
      <ul>
        <li><span class="box"></span><span><b>Liquid?</b> Tight spread, real volume, solid open interest.</span></li>
        <li><span class="box"></span><span><b>IV low / reasonable?</b> Not buying inflated premium.</span></li>
        <li><span class="box"></span><span><b>No earnings</b> before my expiry (unless that's the plan).</span></li>
        <li><span class="box"></span><span><b>Enough time?</b> DTE gives the thesis room to work.</span></li>
        <li><span class="box"></span><span><b>Strike fits conviction?</b> OTM only for a strong, fast-move thesis.</span></li>
        <li><span class="box"></span><span><b>Profit target + stop</b> defined before entry.</span></li>
        <li><span class="box"></span><span><b>Size within</b> my max-loss-per-trade rule.</span></li>
        <li><span class="box"></span><span><b>Limit order</b> near mid — not market, not at the open.</span></li>
      </ul>
    </div>
  </section>

  <!-- TRAPS -->
  <section>
    <div class="traps">
      <h3>Common Traps</h3>
      <p class="lead">The recurring ways buyers lose money — recognize them before they cost you.</p>
      <ul>
        <li>Cheap <b>OTM lottery tickets</b> <span>that expire worthless</span></li>
        <li>Buying <b>into earnings</b> <span>→ IV crush guts you even when right</span></li>
        <li><b>Forgetting the premium</b> <span>in your breakeven math</span></li>
        <li><b>Market orders</b> <span>/ trading the chaotic open</span></li>
        <li><b>Oversizing</b> <span>— one trade that can really hurt you</span></li>
        <li>Blaming <b>vega</b> <span>when it was really delta + theta</span></li>
        <li><b>Illiquid contracts</b> <span>you can't escape near expiry</span></li>
        <li><b>Holding a winner</b> <span>until theta eats the gain</span></li>
      </ul>
    </div>
  </section>

  <footer>
    <span>OPTIONS BUYER'S FIELD MANUAL · personal study reference</span>
    <span>Educational only — not financial advice.</span>
  </footer>

</div>`,
  },
  "chart-patterns": {
    label: "Chart patterns",
    title: "Chart patterns",
    style: `:host{position:relative;display:block}

  :host{
    --bg:#0d0e12;--bg2:#11131a;--surface:#171922;--surface2:#1d2029;
    --line:#2a2e3a;--line2:#363b49;--ink:#e9e6dd;--muted:#8b8f9c;--faint:#5c606d;
    --gold:#e6b24a;--gold-dim:#a07e34;--call:#4ade80;--put:#fb6f76;
    --radius:14px;--mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Fraunces',Georgia,serif;--body:'Hanken Grotesk',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  
  :host{background:var(--bg);color:var(--ink);font-family:var(--body);line-height:1.55;font-size:15px;-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden}
  :host::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
    background:radial-gradient(900px 600px at 12% -5%, rgba(230,178,74,.10), transparent 60%),radial-gradient(800px 700px at 100% 0%, rgba(109,181,240,.07), transparent 55%),radial-gradient(700px 700px at 50% 120%, rgba(74,222,128,.05), transparent 60%)}
  :host::after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.035;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .wrap{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:0 22px 90px}
  .backlink{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-decoration:none;margin-top:28px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;transition:color .2s ease,border-color .2s ease,background .2s ease}
  .backlink:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--surface)}
  header{padding:28px 0 38px;border-bottom:1px solid var(--line)}
  .kicker{font-family:var(--mono);font-size:11px;letter-spacing:.34em;text-transform:uppercase;color:var(--gold);display:flex;align-items:center;gap:14px;margin:36px 0 20px}
  .kicker::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--gold-dim),transparent)}
  h1{font-family:var(--disp);font-weight:600;font-size:clamp(38px,7vw,76px);line-height:.96;letter-spacing:-.02em}
  h1 em{font-style:italic;color:var(--gold)}
  .sub{margin-top:22px;max-width:660px;color:var(--muted);font-size:16.5px}
  .scope{margin-top:26px;display:inline-flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;letter-spacing:.05em;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--gold);padding:9px 16px;border-radius:8px}
  .scope b{color:var(--gold);font-weight:500}
  section{padding-top:54px}
  .shead{display:flex;align-items:baseline;gap:16px;margin-bottom:22px}
  .snum{font-family:var(--mono);font-size:13px;color:var(--gold);border:1px solid var(--gold-dim);border-radius:6px;padding:3px 9px;flex:none}
  .shead h2{font-family:var(--disp);font-weight:500;font-size:clamp(24px,3.4vw,33px);letter-spacing:-.01em}
  .shead p{margin-left:auto;color:var(--faint);font-size:13px;font-family:var(--mono);align-self:center;text-align:right}
  .legend{display:flex;flex-wrap:wrap;gap:18px;margin:-6px 0 4px;font-family:var(--mono);font-size:12px;color:var(--muted)}
  .legend span{display:inline-flex;align-items:center;gap:7px}
  .legend i{width:16px;height:0;border-top:2px solid currentColor;display:inline-block}
  .legend .dash{border-top:2px dashed var(--faint)}
  .legend .up{color:var(--call)}.legend .down{color:var(--put)}.legend .gd{color:var(--gold)}
  .pgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
  @media(max-width:820px){.pgrid{grid-template-columns:1fr}}
  .pcard{background:linear-gradient(180deg,var(--surface),var(--bg2));border:1px solid var(--line);border-left-width:3px;border-radius:var(--radius);overflow:hidden;transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease;display:flex;flex-direction:column}
  .pcard:hover{transform:translateY(-3px);border-color:var(--line2);box-shadow:0 14px 40px -22px rgba(0,0,0,.9)}
  .lead-call{border-left-color:var(--call)}
  .lead-put{border-left-color:var(--put)}
  .pchart-wrap{background:radial-gradient(120% 120% at 50% 0%, rgba(255,255,255,.025), transparent 70%);border-bottom:1px solid var(--line);padding:6px 8px 2px}
  svg.pchart{width:100%;height:auto;display:block}
  svg.pchart .lvl{font-family:var(--mono);font-size:8.5px;fill:var(--faint);letter-spacing:.02em}
  svg.pchart .mk{font-family:var(--mono);font-size:8px;fill:var(--muted);letter-spacing:.01em}
  .pcard-body{padding:16px 18px 18px;display:flex;flex-direction:column;gap:11px;flex:1}
  .pcard-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pcard-head h3{font-family:var(--disp);font-weight:600;font-size:20px}
  .badge{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;border:1px solid;white-space:nowrap}
  .b-bull{color:var(--call);border-color:rgba(74,222,128,.4);background:rgba(74,222,128,.08)}
  .b-bear{color:var(--put);border-color:rgba(251,111,118,.4);background:rgba(251,111,118,.08)}
  .tagline{font-family:var(--disp);font-style:italic;color:var(--ink);font-size:15.5px;margin-top:-2px}
  dl.pmeta{display:flex;flex-direction:column;gap:9px;margin-top:2px}
  dl.pmeta>div{display:grid;grid-template-columns:74px 1fr;gap:12px;align-items:start}
  dl.pmeta dt{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);padding-top:2px}
  dl.pmeta dd{color:var(--muted);font-size:14px}
  @media(max-width:430px){dl.pmeta>div{grid-template-columns:1fr;gap:2px}dl.pmeta dt{padding-top:0}}
  .note{background:var(--surface2);border:1px dashed var(--line2);border-radius:10px;padding:16px 18px;color:var(--muted);font-size:14.5px;margin-top:8px}
  .note b{color:var(--ink);font-weight:600}
  .note code{font-family:var(--mono);color:var(--gold);font-size:13px}
  footer{margin-top:64px;padding-top:24px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px;font-family:var(--mono);display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
  @keyframes rise{to{opacity:1;transform:none}}
  header .reveal:nth-child(1){animation-delay:.05s}
  header .reveal:nth-child(2){animation-delay:.13s}
  header .reveal:nth-child(3){animation-delay:.21s}
  header .reveal:nth-child(4){animation-delay:.29s}
  header .reveal:nth-child(5){animation-delay:.37s}`,
    body: `<div class="wrap">

  <header>
    <a class="backlink reveal" href="/">← Back to stonks</a>
    <div class="kicker reveal">Technical Analysis · Reference Card</div>
    <h1 class="reveal">Chart <em>Patterns</em></h1>
    <p class="sub reveal">The eight classic formations stonks flags on the intraday chart — drawn the way they actually look, with the tell, the trigger, and the trap for each. Built to eyeball, not to memorize.</p>
    <div class="scope reveal">SCOPE&nbsp;→&nbsp;<b>the 8 patterns the detector grades</b>&nbsp;· 1-month / 30-min intraday timeframe</div>
  </header>

  <section>
    <div class="shead"><span class="snum">★</span><h2>The Eight Shapes</h2><p>reversal &amp; continuation</p></div>
    <div class="legend">
      <span class="up"><i></i>bullish shape</span>
      <span class="down"><i></i>bearish shape</span>
      <span><i class="dash"></i>key level (neckline / support / resistance)</span>
      <span class="gd"><i class="dash" style="border-color:var(--gold)"></i>breakout / confirmation</span>
    </div>
    <div class="pgrid" style="margin-top:18px">
      <article class="pcard lead-call">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Cup and Handle chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-0" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--call)" stop-opacity=".22"/><stop offset="1" stop-color="var(--call)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="63.4" x2="324" y2="63.4" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/><text x="324" y="60.4" text-anchor="end" class="lvl">Rim resistance / breakout</text><line x1="14" y1="83.9" x2="324" y2="83.9" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="80.9" text-anchor="end" class="lvl">Handle support</text>
  <path d="M 14 110.8 C 16.1 108.7 22.3 102.9 26.4 98.2 C 30.5 93.5 34.7 87.2 38.8 82.4 C 42.9 77.7 47.1 72.9 51.2 69.7 C 55.3 66.5 59.5 63.4 63.6 63.4 C 67.7 63.4 71.9 66.5 76 69.7 C 80.1 72.9 84.3 77.7 88.4 82.4 C 92.5 87.2 96.7 92.9 100.8 98.2 C 104.9 103.5 109.1 109.5 113.2 114 C 117.3 118.5 121.5 122.4 125.6 125 C 129.7 127.6 133.9 129.3 138 129.8 C 142.1 130.3 146.3 129.8 150.4 128.2 C 154.5 126.6 158.7 123.7 162.8 120.3 C 166.9 116.9 171.1 112.3 175.2 107.6 C 179.3 102.8 183.5 96.8 187.6 91.8 C 191.7 86.8 195.9 81.8 200 77.6 C 204.1 73.4 208.3 69.0 212.4 66.6 C 216.5 64.2 220.7 62.6 224.8 63.4 C 228.9 64.2 233.1 68.7 237.2 71.3 C 241.3 73.9 245.5 77.1 249.6 79.2 C 253.7 81.3 257.9 83.6 262 83.9 C 266.1 84.2 270.3 84.2 274.4 80.8 C 278.5 77.4 282.7 68.9 286.8 63.4 C 290.9 57.9 295.1 52.9 299.2 47.6 C 303.3 42.3 307.5 36.0 311.6 31.8 C 315.7 27.6 321.9 23.9 324 22.3 L 324 174 L 14 174 Z" fill="url(#g-0)" stroke="none"/>
  <path d="M 14 110.8 C 16.1 108.7 22.3 102.9 26.4 98.2 C 30.5 93.5 34.7 87.2 38.8 82.4 C 42.9 77.7 47.1 72.9 51.2 69.7 C 55.3 66.5 59.5 63.4 63.6 63.4 C 67.7 63.4 71.9 66.5 76 69.7 C 80.1 72.9 84.3 77.7 88.4 82.4 C 92.5 87.2 96.7 92.9 100.8 98.2 C 104.9 103.5 109.1 109.5 113.2 114 C 117.3 118.5 121.5 122.4 125.6 125 C 129.7 127.6 133.9 129.3 138 129.8 C 142.1 130.3 146.3 129.8 150.4 128.2 C 154.5 126.6 158.7 123.7 162.8 120.3 C 166.9 116.9 171.1 112.3 175.2 107.6 C 179.3 102.8 183.5 96.8 187.6 91.8 C 191.7 86.8 195.9 81.8 200 77.6 C 204.1 73.4 208.3 69.0 212.4 66.6 C 216.5 64.2 220.7 62.6 224.8 63.4 C 228.9 64.2 233.1 68.7 237.2 71.3 C 241.3 73.9 245.5 77.1 249.6 79.2 C 253.7 81.3 257.9 83.6 262 83.9 C 266.1 84.2 270.3 84.2 274.4 80.8 C 278.5 77.4 282.7 68.9 286.8 63.4 C 290.9 57.9 295.1 52.9 299.2 47.6 C 303.3 42.3 307.5 36.0 311.6 31.8 C 315.7 27.6 321.9 23.9 324 22.3" fill="none" stroke="var(--call)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="286.8" y1="168" x2="286.8" y2="26" stroke="var(--call)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="282.8,32 290.8,32 286.8,26" fill="var(--call)"/><circle cx="63.6" cy="63.4" r="2.6" fill="var(--call)"/><text x="63.6" y="55.4" text-anchor="middle" class="mk">Left rim</text><circle cx="138" cy="129.8" r="2.6" fill="var(--call)"/><text x="138" y="142.8" text-anchor="middle" class="mk">Cup bottom</text><circle cx="224.8" cy="63.4" r="2.6" fill="var(--call)"/><text x="224.8" y="55.4" text-anchor="middle" class="mk">Right rim</text><circle cx="262" cy="83.9" r="2.6" fill="var(--call)"/><text x="262" y="75.9" text-anchor="middle" class="mk">Handle</text><circle cx="286.8" cy="63.4" r="2.6" fill="var(--call)"/><text x="286.8" y="55.4" text-anchor="middle" class="mk">Breakout</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Cup and Handle</h3>
            <span class="badge b-bull">↑ Bullish Continuation</span>
          </div>
          <p class="tagline">Rounded base, small dip, breakout higher</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for a smooth, rounded U-shaped bottom whose two rims sit at nearly the same height, followed by a short, gently downward-drifting pullback (the handle) in the upper-right that stays in the top half of the cup.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive close above the rim/handle resistance (here ~y=70) on expanding volume confirms the bullish breakout; measured target is the cup depth added to the breakout level.</dd></div>
            <div><dt>Fails if</dt><dd>The setup is invalidated if price breaks below handle support and keeps falling, or breaks out on weak, declining volume and stalls back under the rim.</dd></div>
            <div><dt>Watch out</dt><dd>Don't confuse it with a rounding top or a deep, sloppy "V" — a valid handle drifts down only mildly (shallow retrace) and should not sink below the lower half of the cup, otherwise it signals real distribution rather than a healthy shakeout.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-put">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Head and Shoulders chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-1" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--put)" stop-opacity=".22"/><stop offset="1" stop-color="var(--put)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="98.2" x2="324" y2="98.2" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="95.2" text-anchor="end" class="lvl">Neckline</text><line x1="14" y1="41.3" x2="324" y2="41.3" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="38.3" text-anchor="end" class="lvl">Head (resistance)</text>
  <path d="M 14 110.8 C 17.1 108.7 26.4 102.4 32.6 98.2 C 38.8 94.0 46.0 89.2 51.2 85.5 C 56.4 81.8 59.5 76.0 63.6 76 C 67.7 76.0 71.9 81.8 76 85.5 C 80.1 89.2 83.2 98.7 88.4 98.2 C 93.6 97.7 100.8 88.7 107 82.4 C 113.2 76.1 119.4 67.1 125.6 60.2 C 131.8 53.4 139.0 41.8 144.2 41.3 C 149.4 40.8 152.5 47.9 156.6 57.1 C 160.7 66.3 163.8 91.9 169 96.6 C 174.2 101.3 181.4 89.7 187.6 85.5 C 193.8 81.3 201.0 71.8 206.2 71.3 C 211.4 70.8 214.5 78.5 218.6 82.4 C 222.7 86.4 226.9 91.3 231 95 C 235.1 98.7 238.2 101.3 243.4 104.5 C 248.6 107.7 255.8 110.6 262 114 C 268.2 117.4 273.4 121.3 280.6 125 C 287.8 128.7 298.2 133.2 305.4 136.1 C 312.6 139.0 320.9 141.3 324 142.4 L 324 174 L 14 174 Z" fill="url(#g-1)" stroke="none"/>
  <path d="M 14 110.8 C 17.1 108.7 26.4 102.4 32.6 98.2 C 38.8 94.0 46.0 89.2 51.2 85.5 C 56.4 81.8 59.5 76.0 63.6 76 C 67.7 76.0 71.9 81.8 76 85.5 C 80.1 89.2 83.2 98.7 88.4 98.2 C 93.6 97.7 100.8 88.7 107 82.4 C 113.2 76.1 119.4 67.1 125.6 60.2 C 131.8 53.4 139.0 41.8 144.2 41.3 C 149.4 40.8 152.5 47.9 156.6 57.1 C 160.7 66.3 163.8 91.9 169 96.6 C 174.2 101.3 181.4 89.7 187.6 85.5 C 193.8 81.3 201.0 71.8 206.2 71.3 C 211.4 70.8 214.5 78.5 218.6 82.4 C 222.7 86.4 226.9 91.3 231 95 C 235.1 98.7 238.2 101.3 243.4 104.5 C 248.6 107.7 255.8 110.6 262 114 C 268.2 117.4 273.4 121.3 280.6 125 C 287.8 128.7 298.2 133.2 305.4 136.1 C 312.6 139.0 320.9 141.3 324 142.4" fill="none" stroke="var(--put)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="237.2" y1="22" x2="237.2" y2="164" stroke="var(--put)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="233.2,158 241.2,158 237.2,164" fill="var(--put)"/><circle cx="63.6" cy="76" r="2.6" fill="var(--put)"/><text x="63.6" y="68" text-anchor="middle" class="mk">Left shoulder</text><circle cx="144.2" cy="41.3" r="2.6" fill="var(--put)"/><text x="144.2" y="33.3" text-anchor="middle" class="mk">Head</text><circle cx="206.2" cy="71.3" r="2.6" fill="var(--put)"/><text x="206.2" y="63.3" text-anchor="middle" class="mk">Right shoulder</text><circle cx="237.2" cy="98.2" r="2.6" fill="var(--put)"/><text x="237.2" y="111.2" text-anchor="middle" class="mk">Neckline break</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Head and Shoulders</h3>
            <span class="badge b-bear">↓ Bearish Reversal</span>
          </div>
          <p class="tagline">Three peaks, the middle highest, tops out</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for three consecutive peaks where the middle one (the head) towers above the two flanking peaks (shoulders), which sit at roughly equal height, all resting on a near-flat neckline connecting the two dips between them.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive close BELOW the neckline after the right shoulder, ideally on rising/above-average volume, confirms the bearish reversal; measured target is roughly the head-to-neckline height projected down from the break.</dd></div>
            <div><dt>Fails if</dt><dd>Price closing back above the neckline (or above the right shoulder peak) after the break invalidates the pattern and signals the downtrend thesis is wrong.</dd></div>
            <div><dt>Watch out</dt><dd>Don't short the right shoulder early — the pattern isn't valid until price actually closes through the neckline; a weak-volume break often gets reclaimed, trapping shorts on the throwback.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-call">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Inverse Head and Shoulders chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-2" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--call)" stop-opacity=".22"/><stop offset="1" stop-color="var(--call)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="88.7" x2="324" y2="88.7" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="85.7" text-anchor="end" class="lvl">Neckline / breakout</text><line x1="14" y1="142.4" x2="324" y2="142.4" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="139.4" text-anchor="end" class="lvl">Head (lowest trough)</text>
  <path d="M 14 60.2 C 16.1 61.8 22.3 66.0 26.4 69.7 C 30.5 73.4 34.7 78.2 38.8 82.4 C 42.9 86.6 47.1 90.8 51.2 95 C 55.3 99.2 59.5 103.9 63.6 107.6 C 67.7 111.3 71.9 117.1 76 117.1 C 80.1 117.1 84.3 111.3 88.4 107.6 C 92.5 103.9 97.2 98.2 100.8 95 C 104.4 91.8 107.0 88.2 110.1 88.7 C 113.2 89.2 115.8 94.0 119.4 98.2 C 123.0 102.4 127.7 108.7 131.8 114 C 135.9 119.3 140.1 125.1 144.2 129.8 C 148.3 134.5 152.5 141.9 156.6 142.4 C 160.7 142.9 164.9 137.1 169 132.9 C 173.1 128.7 177.3 122.4 181.4 117.1 C 185.5 111.8 189.7 105.5 193.8 101.3 C 197.9 97.1 202.1 93.9 206.2 91.8 C 210.3 89.7 214.5 87.6 218.6 88.7 C 222.7 89.8 226.9 95.1 231 98.2 C 235.1 101.3 239.3 105.0 243.4 107.6 C 247.5 110.2 252.7 113.5 255.8 114 C 258.9 114.5 259.4 113.4 262 110.8 C 264.6 108.2 268.2 102.9 271.3 98.2 C 274.4 93.5 277.5 87.7 280.6 82.4 C 283.7 77.1 286.8 71.3 289.9 66.6 C 293.0 61.8 295.6 58.1 299.2 53.9 C 302.8 49.7 307.5 45.0 311.6 41.3 C 315.7 37.6 321.9 33.4 324 31.8 L 324 174 L 14 174 Z" fill="url(#g-2)" stroke="none"/>
  <path d="M 14 60.2 C 16.1 61.8 22.3 66.0 26.4 69.7 C 30.5 73.4 34.7 78.2 38.8 82.4 C 42.9 86.6 47.1 90.8 51.2 95 C 55.3 99.2 59.5 103.9 63.6 107.6 C 67.7 111.3 71.9 117.1 76 117.1 C 80.1 117.1 84.3 111.3 88.4 107.6 C 92.5 103.9 97.2 98.2 100.8 95 C 104.4 91.8 107.0 88.2 110.1 88.7 C 113.2 89.2 115.8 94.0 119.4 98.2 C 123.0 102.4 127.7 108.7 131.8 114 C 135.9 119.3 140.1 125.1 144.2 129.8 C 148.3 134.5 152.5 141.9 156.6 142.4 C 160.7 142.9 164.9 137.1 169 132.9 C 173.1 128.7 177.3 122.4 181.4 117.1 C 185.5 111.8 189.7 105.5 193.8 101.3 C 197.9 97.1 202.1 93.9 206.2 91.8 C 210.3 89.7 214.5 87.6 218.6 88.7 C 222.7 89.8 226.9 95.1 231 98.2 C 235.1 101.3 239.3 105.0 243.4 107.6 C 247.5 110.2 252.7 113.5 255.8 114 C 258.9 114.5 259.4 113.4 262 110.8 C 264.6 108.2 268.2 102.9 271.3 98.2 C 274.4 93.5 277.5 87.7 280.6 82.4 C 283.7 77.1 286.8 71.3 289.9 66.6 C 293.0 61.8 295.6 58.1 299.2 53.9 C 302.8 49.7 307.5 45.0 311.6 41.3 C 315.7 37.6 321.9 33.4 324 31.8" fill="none" stroke="var(--call)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="280.6" y1="168" x2="280.6" y2="26" stroke="var(--call)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="276.6,32 284.6,32 280.6,26" fill="var(--call)"/><circle cx="76" cy="117.1" r="2.6" fill="var(--call)"/><text x="76" y="130.1" text-anchor="middle" class="mk">Left shoulder</text><circle cx="156.6" cy="142.4" r="2.6" fill="var(--call)"/><text x="156.6" y="155.4" text-anchor="middle" class="mk">Head</text><circle cx="255.8" cy="114" r="2.6" fill="var(--call)"/><text x="255.8" y="127" text-anchor="middle" class="mk">Right shoulder</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Inverse Head and Shoulders</h3>
            <span class="badge b-bull">↑ Bullish Reversal</span>
          </div>
          <p class="tagline">Lower middle trough flips a downtrend bullish</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for three valleys after a downtrend where the middle valley (head) digs noticeably deeper than the two shoulders on either side. The two bounce-highs between the troughs line up to form a roughly flat neckline across the top.</dd></div>
            <div><dt>Confirms</dt><dd>Confirmed when price closes decisively ABOVE the neckline (the line connecting the two interior rally peaks), ideally on a surge of above-average volume after the right shoulder forms.</dd></div>
            <div><dt>Fails if</dt><dd>Thesis is invalidated if price rolls back below the right-shoulder low after the breakout, or never reclaims the neckline and instead makes a new low beneath the head.</dd></div>
            <div><dt>Watch out</dt><dd>Don't jump in at the head or while the right shoulder is still forming — the pattern is only tradable once the neckline breaks; a weak, low-volume break often gets sucked back down (a fakeout).</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-call">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Bull Flag chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-3" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--call)" stop-opacity=".22"/><stop offset="1" stop-color="var(--call)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="47.6" x2="324" y2="47.6" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/><text x="324" y="44.6" text-anchor="end" class="lvl">Flag top / breakout</text><line x1="14" y1="74.5" x2="324" y2="74.5" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="71.5" text-anchor="end" class="lvl">Flag support</text><line x1="14" y1="145.6" x2="324" y2="145.6" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="142.6" text-anchor="end" class="lvl">Pole base</text>
  <path d="M 14 145.6 C 16.1 145.8 22.3 147.6 26.4 147.1 C 30.5 146.6 34.7 144.2 38.8 142.4 C 42.9 140.6 47.1 139.5 51.2 136.1 C 55.3 132.7 59.5 127.4 63.6 121.9 C 67.7 116.4 71.9 109.5 76 102.9 C 80.1 96.3 84.3 89.0 88.4 82.4 C 92.5 75.8 96.7 69.2 100.8 63.4 C 104.9 57.6 109.1 49.7 113.2 47.6 C 117.3 45.5 121.5 48.9 125.6 50.8 C 129.7 52.6 133.9 57.9 138 58.7 C 142.1 59.5 146.3 54.7 150.4 55.5 C 154.5 56.3 158.7 62.4 162.8 63.4 C 166.9 64.5 171.1 60.8 175.2 61.8 C 179.3 62.8 183.5 68.9 187.6 69.7 C 191.7 70.5 195.9 65.8 200 66.6 C 204.1 67.4 208.3 73.7 212.4 74.5 C 216.5 75.3 220.7 74.2 224.8 71.3 C 228.9 68.4 233.1 61.8 237.2 57.1 C 241.3 52.4 245.5 46.9 249.6 42.9 C 253.7 38.9 257.9 35.8 262 33.4 C 266.1 31.0 270.3 30.2 274.4 28.6 C 278.5 27.0 282.7 25.2 286.8 23.9 C 290.9 22.6 295.1 21.8 299.2 20.7 C 303.3 19.6 309.5 18.1 311.6 17.6 L 311.6 174 L 14 174 Z" fill="url(#g-3)" stroke="none"/>
  <path d="M 14 145.6 C 16.1 145.8 22.3 147.6 26.4 147.1 C 30.5 146.6 34.7 144.2 38.8 142.4 C 42.9 140.6 47.1 139.5 51.2 136.1 C 55.3 132.7 59.5 127.4 63.6 121.9 C 67.7 116.4 71.9 109.5 76 102.9 C 80.1 96.3 84.3 89.0 88.4 82.4 C 92.5 75.8 96.7 69.2 100.8 63.4 C 104.9 57.6 109.1 49.7 113.2 47.6 C 117.3 45.5 121.5 48.9 125.6 50.8 C 129.7 52.6 133.9 57.9 138 58.7 C 142.1 59.5 146.3 54.7 150.4 55.5 C 154.5 56.3 158.7 62.4 162.8 63.4 C 166.9 64.5 171.1 60.8 175.2 61.8 C 179.3 62.8 183.5 68.9 187.6 69.7 C 191.7 70.5 195.9 65.8 200 66.6 C 204.1 67.4 208.3 73.7 212.4 74.5 C 216.5 75.3 220.7 74.2 224.8 71.3 C 228.9 68.4 233.1 61.8 237.2 57.1 C 241.3 52.4 245.5 46.9 249.6 42.9 C 253.7 38.9 257.9 35.8 262 33.4 C 266.1 31.0 270.3 30.2 274.4 28.6 C 278.5 27.0 282.7 25.2 286.8 23.9 C 290.9 22.6 295.1 21.8 299.2 20.7 C 303.3 19.6 309.5 18.1 311.6 17.6" fill="none" stroke="var(--call)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="249.6" y1="168" x2="249.6" y2="26" stroke="var(--call)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="245.6,32 253.6,32 249.6,26" fill="var(--call)"/><circle cx="26.4" cy="147.1" r="2.6" fill="var(--call)"/><text x="26.4" y="160.1" text-anchor="middle" class="mk">Pole base</text><circle cx="113.2" cy="47.6" r="2.6" fill="var(--call)"/><text x="113.2" y="39.6" text-anchor="middle" class="mk">Pole top</text><circle cx="125.6" cy="50.8" r="2.6" fill="var(--call)"/><text x="125.6" y="42.8" text-anchor="middle" class="mk">Flag</text><circle cx="212.4" cy="74.5" r="2.6" fill="var(--call)"/><text x="212.4" y="66.5" text-anchor="middle" class="mk">Flag low</text><circle cx="249.6" cy="42.9" r="2.6" fill="var(--call)"/><text x="249.6" y="34.9" text-anchor="middle" class="mk">Breakout</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Bull Flag</h3>
            <span class="badge b-bull">↑ Bullish Continuation</span>
          </div>
          <p class="tagline">Sharp rally, brief dip, trend resumes higher</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for a near-vertical price spike (the pole), then a tight, slightly downward-tilting channel of lower highs and lower lows (the flag) that drifts against the trend on shrinking range.</dd></div>
            <div><dt>Confirms</dt><dd>A close back above the flag's upper trendline, ideally on a surge in volume, confirms the breakout and continuation higher.</dd></div>
            <div><dt>Fails if</dt><dd>A decisive close below the flag's lower support (giving back most of the pole) invalidates the setup and signals the rally has failed.</dd></div>
            <div><dt>Watch out</dt><dd>Don't confuse a healthy shallow flag with a deep, steep, or prolonged sell-off retracing more than half the pole — that's a reversal, not a flag, and chasing it gets you trapped.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-call">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Ascending Triangle chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-4" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--call)" stop-opacity=".22"/><stop offset="1" stop-color="var(--call)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="66.6" x2="324" y2="66.6" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/><text x="324" y="63.599999999999994" text-anchor="end" class="lvl">Resistance (flat top) — breakout level</text>
  <path d="M 14 110.8 C 16.1 108.2 22.3 100.8 26.4 95 C 30.5 89.2 35.2 80.7 38.8 76 C 42.4 71.3 45.0 66.6 48.1 66.6 C 51.2 66.6 53.8 72.3 57.4 76 C 61.0 79.7 65.7 84.5 69.8 88.7 C 73.9 92.9 78.1 97.6 82.2 101.3 C 86.3 105.0 90.5 111.3 94.6 110.8 C 98.7 110.3 102.9 102.9 107 98.2 C 111.1 93.5 115.3 87.2 119.4 82.4 C 123.5 77.7 127.7 72.3 131.8 69.7 C 135.9 67.1 140.1 65.0 144.2 66.6 C 148.3 68.2 152.5 75.5 156.6 79.2 C 160.7 82.9 164.9 86.1 169 88.7 C 173.1 91.3 177.3 95.5 181.4 95 C 185.5 94.5 189.7 89.2 193.8 85.5 C 197.9 81.8 202.1 76.1 206.2 72.9 C 210.3 69.8 214.5 66.1 218.6 66.6 C 222.7 67.1 226.9 73.6 231 76 C 235.1 78.4 239.3 81.3 243.4 80.8 C 247.5 80.3 251.7 75.3 255.8 72.9 C 259.9 70.5 264.1 70.8 268.2 66.6 C 272.3 62.4 276.5 53.1 280.6 47.6 C 284.7 42.1 288.4 37.4 293 33.4 C 297.6 29.4 303.3 26.3 308.5 23.9 C 313.7 21.5 321.4 20.0 324 19.2 L 324 174 L 14 174 Z" fill="url(#g-4)" stroke="none"/>
  <path d="M 14 110.8 C 16.1 108.2 22.3 100.8 26.4 95 C 30.5 89.2 35.2 80.7 38.8 76 C 42.4 71.3 45.0 66.6 48.1 66.6 C 51.2 66.6 53.8 72.3 57.4 76 C 61.0 79.7 65.7 84.5 69.8 88.7 C 73.9 92.9 78.1 97.6 82.2 101.3 C 86.3 105.0 90.5 111.3 94.6 110.8 C 98.7 110.3 102.9 102.9 107 98.2 C 111.1 93.5 115.3 87.2 119.4 82.4 C 123.5 77.7 127.7 72.3 131.8 69.7 C 135.9 67.1 140.1 65.0 144.2 66.6 C 148.3 68.2 152.5 75.5 156.6 79.2 C 160.7 82.9 164.9 86.1 169 88.7 C 173.1 91.3 177.3 95.5 181.4 95 C 185.5 94.5 189.7 89.2 193.8 85.5 C 197.9 81.8 202.1 76.1 206.2 72.9 C 210.3 69.8 214.5 66.1 218.6 66.6 C 222.7 67.1 226.9 73.6 231 76 C 235.1 78.4 239.3 81.3 243.4 80.8 C 247.5 80.3 251.7 75.3 255.8 72.9 C 259.9 70.5 264.1 70.8 268.2 66.6 C 272.3 62.4 276.5 53.1 280.6 47.6 C 284.7 42.1 288.4 37.4 293 33.4 C 297.6 29.4 303.3 26.3 308.5 23.9 C 313.7 21.5 321.4 20.0 324 19.2" fill="none" stroke="var(--call)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="274.4" y1="168" x2="274.4" y2="26" stroke="var(--call)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="270.4,32 278.4,32 274.4,26" fill="var(--call)"/><circle cx="48.1" cy="66.6" r="2.6" fill="var(--call)"/><text x="48.1" y="58.599999999999994" text-anchor="middle" class="mk">Resistance</text><circle cx="94.6" cy="110.8" r="2.6" fill="var(--call)"/><text x="94.6" y="123.8" text-anchor="middle" class="mk">Higher low 1</text><circle cx="144.2" cy="66.6" r="2.6" fill="var(--call)"/><text x="144.2" y="58.599999999999994" text-anchor="middle" class="mk">Resistance</text><circle cx="181.4" cy="95" r="2.6" fill="var(--call)"/><text x="181.4" y="108" text-anchor="middle" class="mk">Higher low 2</text><circle cx="218.6" cy="66.6" r="2.6" fill="var(--call)"/><text x="218.6" y="58.599999999999994" text-anchor="middle" class="mk">Resistance</text><circle cx="243.4" cy="80.8" r="2.6" fill="var(--call)"/><text x="243.4" y="72.8" text-anchor="middle" class="mk">Higher low 3</text><circle cx="280.6" cy="47.6" r="2.6" fill="var(--call)"/><text x="280.6" y="39.6" text-anchor="middle" class="mk">Breakout</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Ascending Triangle</h3>
            <span class="badge b-bull">↑ Bullish Continuation</span>
          </div>
          <p class="tagline">Flat ceiling, rising floor, buyers win</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for a flat horizontal line capping two or more equal highs, while the lows beneath keep stair-stepping higher and press toward that ceiling, squeezing price into a narrowing triangle with a flat top.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive close ABOVE the flat resistance line, ideally on a surge of above-average volume, confirms the bullish breakout.</dd></div>
            <div><dt>Fails if</dt><dd>A close below the rising lower trendline (the ascending support of higher lows) breaks the structure and invalidates the bullish setup.</dd></div>
            <div><dt>Watch out</dt><dd>Don't jump in early on a touch of resistance or an intraday wick above it; only a confirmed CLOSE beyond the flat top counts, since unconfirmed pokes often fake out and snap back into the triangle.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-call">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Double Bottom chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-5" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--call)" stop-opacity=".22"/><stop offset="1" stop-color="var(--call)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="74.5" x2="324" y2="74.5" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="71.5" text-anchor="end" class="lvl">Neckline / breakout (middle-peak resistance)</text><line x1="14" y1="134.5" x2="324" y2="134.5" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="131.5" text-anchor="end" class="lvl">Support (twin-trough floor)</text>
  <path d="M 14 50.8 C 16.1 52.4 22.3 56.5 26.4 60.2 C 30.5 63.9 34.7 68.2 38.8 72.9 C 42.9 77.7 47.1 83.4 51.2 88.7 C 55.3 94.0 59.5 99.2 63.6 104.5 C 67.7 109.8 71.9 115.6 76 120.3 C 80.1 125.0 84.3 130.3 88.4 132.9 C 92.5 135.5 96.7 137.2 100.8 136.1 C 104.9 135.0 109.1 130.8 113.2 126.6 C 117.3 122.4 121.5 116.1 125.6 110.8 C 129.7 105.5 133.9 99.7 138 95 C 142.1 90.3 146.3 85.6 150.4 82.4 C 154.5 79.2 159.7 77.3 162.8 76 C 165.9 74.7 166.9 74.0 169 74.5 C 171.1 75.0 172.1 76.3 175.2 79.2 C 178.3 82.1 183.5 87.1 187.6 91.8 C 191.7 96.5 195.9 102.6 200 107.6 C 204.1 112.6 208.3 118.0 212.4 121.9 C 216.5 125.9 220.7 128.9 224.8 131.3 C 228.9 133.7 233.1 136.9 237.2 136.1 C 241.3 135.3 245.5 130.8 249.6 126.6 C 253.7 122.4 257.9 116.1 262 110.8 C 266.1 105.5 270.3 100.3 274.4 95 C 278.5 89.7 283.7 82.9 286.8 79.2 C 289.9 75.5 290.9 75.5 293 72.9 C 295.1 70.3 297.1 67.1 299.2 63.4 C 301.3 59.7 302.8 55.0 305.4 50.8 C 308.0 46.6 311.6 41.8 314.7 38.1 C 317.8 34.4 322.4 30.2 324 28.6 L 324 174 L 14 174 Z" fill="url(#g-5)" stroke="none"/>
  <path d="M 14 50.8 C 16.1 52.4 22.3 56.5 26.4 60.2 C 30.5 63.9 34.7 68.2 38.8 72.9 C 42.9 77.7 47.1 83.4 51.2 88.7 C 55.3 94.0 59.5 99.2 63.6 104.5 C 67.7 109.8 71.9 115.6 76 120.3 C 80.1 125.0 84.3 130.3 88.4 132.9 C 92.5 135.5 96.7 137.2 100.8 136.1 C 104.9 135.0 109.1 130.8 113.2 126.6 C 117.3 122.4 121.5 116.1 125.6 110.8 C 129.7 105.5 133.9 99.7 138 95 C 142.1 90.3 146.3 85.6 150.4 82.4 C 154.5 79.2 159.7 77.3 162.8 76 C 165.9 74.7 166.9 74.0 169 74.5 C 171.1 75.0 172.1 76.3 175.2 79.2 C 178.3 82.1 183.5 87.1 187.6 91.8 C 191.7 96.5 195.9 102.6 200 107.6 C 204.1 112.6 208.3 118.0 212.4 121.9 C 216.5 125.9 220.7 128.9 224.8 131.3 C 228.9 133.7 233.1 136.9 237.2 136.1 C 241.3 135.3 245.5 130.8 249.6 126.6 C 253.7 122.4 257.9 116.1 262 110.8 C 266.1 105.5 270.3 100.3 274.4 95 C 278.5 89.7 283.7 82.9 286.8 79.2 C 289.9 75.5 290.9 75.5 293 72.9 C 295.1 70.3 297.1 67.1 299.2 63.4 C 301.3 59.7 302.8 55.0 305.4 50.8 C 308.0 46.6 311.6 41.8 314.7 38.1 C 317.8 34.4 322.4 30.2 324 28.6" fill="none" stroke="var(--call)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="293" y1="168" x2="293" y2="26" stroke="var(--call)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="289,32 297,32 293,26" fill="var(--call)"/><circle cx="100.8" cy="136.1" r="2.6" fill="var(--call)"/><text x="100.8" y="149.1" text-anchor="middle" class="mk">Bottom 1</text><circle cx="169" cy="74.5" r="2.6" fill="var(--call)"/><text x="169" y="66.5" text-anchor="middle" class="mk">Middle peak</text><circle cx="237.2" cy="136.1" r="2.6" fill="var(--call)"/><text x="237.2" y="149.1" text-anchor="middle" class="mk">Bottom 2</text><circle cx="305.4" cy="50.8" r="2.6" fill="var(--call)"/><text x="305.4" y="42.8" text-anchor="middle" class="mk">Breakout</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Double Bottom</h3>
            <span class="badge b-bull">↑ Bullish Reversal</span>
          </div>
          <p class="tagline">Twin floors confirm a reversal higher</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for a "W": a sharp drop to a low, a rebound to a middle peak, a second drop that bottoms at nearly the SAME price as the first, then a rally back toward that middle peak. The two lows should sit on a flat horizontal floor with a clear hump between them.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive daily close ABOVE the middle-peak resistance (the neckline), ideally on a surge in volume that exceeds the volume of the two troughs.</dd></div>
            <div><dt>Fails if</dt><dd>A close back below the support floor formed by the two troughs, or failure to break the neckline on the rally, voids the setup and warns of further downside.</dd></div>
            <div><dt>Watch out</dt><dd>Don't buy the second bottom or the approach to the neckline early — without a confirmed breakout above resistance it's just a range, and the second low must hold near the first (not break materially lower) to count as a valid double bottom.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-put">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Double Top chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-7" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--put)" stop-opacity=".22"/><stop offset="1" stop-color="var(--put)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="61.5" x2="324" y2="61.5" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="58.5" text-anchor="end" class="lvl">Resistance (twin-peak ceiling)</text><line x1="14" y1="121.5" x2="324" y2="121.5" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/><text x="324" y="118.5" text-anchor="end" class="lvl">Neckline / breakdown (middle-trough support)</text>
  <path d="M 14 145.2 C 16.1 143.6 22.3 139.5 26.4 135.8 C 30.5 132.1 34.7 127.8 38.8 123.1 C 42.9 118.3 47.1 112.6 51.2 107.3 C 55.3 102 59.5 96.8 63.6 91.5 C 67.7 86.2 71.9 80.4 76 75.7 C 80.1 71 84.3 65.7 88.4 63.1 C 92.5 60.5 96.7 58.8 100.8 59.9 C 104.9 61 109.1 65.2 113.2 69.4 C 117.3 73.6 121.5 79.9 125.6 85.2 C 129.7 90.5 133.9 96.3 138 101 C 142.1 105.7 146.3 110.4 150.4 113.6 C 154.5 116.8 159.7 118.7 162.8 120 C 165.9 121.3 166.9 122 169 121.5 C 171.1 121 172.1 119.7 175.2 116.8 C 178.3 113.9 183.5 108.9 187.6 104.2 C 191.7 99.5 195.9 93.4 200 88.4 C 204.1 83.4 208.3 78 212.4 74.1 C 216.5 70.1 220.7 67.1 224.8 64.7 C 228.9 62.3 233.1 59.1 237.2 59.9 C 241.3 60.7 245.5 65.2 249.6 69.4 C 253.7 73.6 257.9 79.9 262 85.2 C 266.1 90.5 270.3 95.7 274.4 101 C 278.5 106.3 283.7 113.1 286.8 116.8 C 289.9 120.5 290.9 120.5 293 123.1 C 295.1 125.7 297.1 128.9 299.2 132.6 C 301.3 136.3 302.8 141 305.4 145.2 C 308 149.4 311.6 154.2 314.7 157.9 C 317.8 161.6 322.4 165.8 324 167.4 L 324 174 L 14 174 Z" fill="url(#g-7)" stroke="none"/>
  <path d="M 14 145.2 C 16.1 143.6 22.3 139.5 26.4 135.8 C 30.5 132.1 34.7 127.8 38.8 123.1 C 42.9 118.3 47.1 112.6 51.2 107.3 C 55.3 102 59.5 96.8 63.6 91.5 C 67.7 86.2 71.9 80.4 76 75.7 C 80.1 71 84.3 65.7 88.4 63.1 C 92.5 60.5 96.7 58.8 100.8 59.9 C 104.9 61 109.1 65.2 113.2 69.4 C 117.3 73.6 121.5 79.9 125.6 85.2 C 129.7 90.5 133.9 96.3 138 101 C 142.1 105.7 146.3 110.4 150.4 113.6 C 154.5 116.8 159.7 118.7 162.8 120 C 165.9 121.3 166.9 122 169 121.5 C 171.1 121 172.1 119.7 175.2 116.8 C 178.3 113.9 183.5 108.9 187.6 104.2 C 191.7 99.5 195.9 93.4 200 88.4 C 204.1 83.4 208.3 78 212.4 74.1 C 216.5 70.1 220.7 67.1 224.8 64.7 C 228.9 62.3 233.1 59.1 237.2 59.9 C 241.3 60.7 245.5 65.2 249.6 69.4 C 253.7 73.6 257.9 79.9 262 85.2 C 266.1 90.5 270.3 95.7 274.4 101 C 278.5 106.3 283.7 113.1 286.8 116.8 C 289.9 120.5 290.9 120.5 293 123.1 C 295.1 125.7 297.1 128.9 299.2 132.6 C 301.3 136.3 302.8 141 305.4 145.2 C 308 149.4 311.6 154.2 314.7 157.9 C 317.8 161.6 322.4 165.8 324 167.4" fill="none" stroke="var(--put)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="293" y1="30" x2="293" y2="170" stroke="var(--put)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="289,164 297,164 293,170" fill="var(--put)"/><circle cx="100.8" cy="59.9" r="2.6" fill="var(--put)"/><text x="100.8" y="51.9" text-anchor="middle" class="mk">Peak 1</text><circle cx="169" cy="121.5" r="2.6" fill="var(--put)"/><text x="169" y="134.5" text-anchor="middle" class="mk">Middle trough</text><circle cx="237.2" cy="59.9" r="2.6" fill="var(--put)"/><text x="237.2" y="51.9" text-anchor="middle" class="mk">Peak 2</text><circle cx="305.4" cy="145.2" r="2.6" fill="var(--put)"/><text x="305.4" y="158.2" text-anchor="middle" class="mk">Breakdown</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Double Top</h3>
            <span class="badge b-bear">↓ Bearish Reversal</span>
          </div>
          <p class="tagline">Twin peaks cap the rally and reverse it lower</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for an "M": a sharp rally to a high, a pullback to a middle trough, a second rally that tops out at nearly the SAME price as the first, then a roll-over back toward that middle trough. The two highs should sit under a flat horizontal ceiling with a clear dip between them.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive daily close BELOW the middle-trough support (the neckline), ideally on a surge in volume that exceeds the volume on the two peaks — most reliable when the neckline breaks on expanding volume. Measured target is roughly the peak-to-neckline height projected down from the break.</dd></div>
            <div><dt>Fails if</dt><dd>A close back above the neckline after a break, or failure to break the neckline on the second roll-over (price reclaiming the twin-peak resistance), voids the setup and warns of further upside.</dd></div>
            <div><dt>Watch out</dt><dd>Don't short the second peak or the approach to the neckline early — without a confirmed breakdown below support it's just a range, and the second high must top out near the first (not push materially higher) to count as a valid double top.</dd></div>
          </dl>
        </div>
      </article>
      <article class="pcard lead-put">
        <div class="pchart-wrap"><svg viewBox="0 0 340 196" class="pchart" role="img" aria-label="Descending Triangle chart shape" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="g-6" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="var(--put)" stop-opacity=".22"/><stop offset="1" stop-color="var(--put)" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="14" y1="47.6" x2="324" y2="47.6" stroke="var(--faint)" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/><text x="324" y="44.6" text-anchor="end" class="lvl">Lower highs (falling)</text><line x1="14" y1="109.2" x2="324" y2="109.2" stroke="var(--gold)" stroke-width="1" stroke-dasharray="4 4" opacity="0.9"/><text x="324" y="106.2" text-anchor="end" class="lvl">Support (flat) — breakdown trigger</text>
  <path d="M 14 50.8 C 16.1 50.3 22.3 43.4 26.4 47.6 C 30.5 51.8 34.7 67.6 38.8 76 C 42.9 84.4 47.1 92.7 51.2 98.2 C 55.3 103.7 59.5 110.3 63.6 109.2 C 67.7 108.1 71.9 98.9 76 91.8 C 80.1 84.7 84.3 68.2 88.4 66.6 C 92.5 65.0 96.7 76.6 100.8 82.4 C 104.9 88.2 109.1 96.8 113.2 101.3 C 117.3 105.8 121.5 110.3 125.6 109.2 C 129.7 108.2 133.9 100.0 138 95 C 142.1 90.0 146.3 80.0 150.4 79.2 C 154.5 78.4 158.7 86.1 162.8 90.3 C 166.9 94.5 171.1 101.3 175.2 104.5 C 179.3 107.7 183.5 110.0 187.6 109.2 C 191.7 108.4 195.9 102.9 200 99.7 C 204.1 96.5 208.3 90.3 212.4 90.3 C 216.5 90.3 220.7 96.8 224.8 99.7 C 228.9 102.6 233.1 106.0 237.2 107.6 C 241.3 109.2 245.5 107.1 249.6 109.2 C 253.7 111.3 257.9 115.8 262 120.3 C 266.1 124.8 270.3 131.9 274.4 136.1 C 278.5 140.3 282.7 142.4 286.8 145.6 C 290.9 148.8 295.1 152.4 299.2 155 C 303.3 157.6 309.5 160.3 311.6 161.4 L 311.6 174 L 14 174 Z" fill="url(#g-6)" stroke="none"/>
  <path d="M 14 50.8 C 16.1 50.3 22.3 43.4 26.4 47.6 C 30.5 51.8 34.7 67.6 38.8 76 C 42.9 84.4 47.1 92.7 51.2 98.2 C 55.3 103.7 59.5 110.3 63.6 109.2 C 67.7 108.1 71.9 98.9 76 91.8 C 80.1 84.7 84.3 68.2 88.4 66.6 C 92.5 65.0 96.7 76.6 100.8 82.4 C 104.9 88.2 109.1 96.8 113.2 101.3 C 117.3 105.8 121.5 110.3 125.6 109.2 C 129.7 108.2 133.9 100.0 138 95 C 142.1 90.0 146.3 80.0 150.4 79.2 C 154.5 78.4 158.7 86.1 162.8 90.3 C 166.9 94.5 171.1 101.3 175.2 104.5 C 179.3 107.7 183.5 110.0 187.6 109.2 C 191.7 108.4 195.9 102.9 200 99.7 C 204.1 96.5 208.3 90.3 212.4 90.3 C 216.5 90.3 220.7 96.8 224.8 99.7 C 228.9 102.6 233.1 106.0 237.2 107.6 C 241.3 109.2 245.5 107.1 249.6 109.2 C 253.7 111.3 257.9 115.8 262 120.3 C 266.1 124.8 270.3 131.9 274.4 136.1 C 278.5 140.3 282.7 142.4 286.8 145.6 C 290.9 148.8 295.1 152.4 299.2 155 C 303.3 157.6 309.5 160.3 311.6 161.4" fill="none" stroke="var(--put)" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="262" y1="22" x2="262" y2="164" stroke="var(--put)" stroke-width="1.4" stroke-dasharray="3 3" opacity=".85"/><polygon points="258,158 266,158 262,164" fill="var(--put)"/><circle cx="26.4" cy="47.6" r="2.6" fill="var(--put)"/><text x="26.4" y="39.6" text-anchor="middle" class="mk">High 1</text><circle cx="88.4" cy="66.6" r="2.6" fill="var(--put)"/><text x="88.4" y="58.599999999999994" text-anchor="middle" class="mk">High 2 (lower)</text><circle cx="150.4" cy="79.2" r="2.6" fill="var(--put)"/><text x="150.4" y="71.2" text-anchor="middle" class="mk">High 3 (lower)</text><circle cx="212.4" cy="90.3" r="2.6" fill="var(--put)"/><text x="212.4" y="82.3" text-anchor="middle" class="mk">High 4 (lower)</text><circle cx="63.6" cy="109.2" r="2.6" fill="var(--put)"/><text x="63.6" y="122.2" text-anchor="middle" class="mk">Support</text><circle cx="125.6" cy="109.2" r="2.6" fill="var(--put)"/><text x="125.6" y="122.2" text-anchor="middle" class="mk">Support</text><circle cx="187.6" cy="109.2" r="2.6" fill="var(--put)"/><text x="187.6" y="122.2" text-anchor="middle" class="mk">Support</text><circle cx="274.4" cy="136.1" r="2.6" fill="var(--put)"/><text x="274.4" y="149.1" text-anchor="middle" class="mk">Breakdown</text>
</svg></div>
        <div class="pcard-body">
          <div class="pcard-head">
            <h3>Descending Triangle</h3>
            <span class="badge b-bear">↓ Bearish Continuation</span>
          </div>
          <p class="tagline">Flat floor, falling highs, sellers win</p>
          <dl class="pmeta">
            <div><dt>Spot it</dt><dd>Look for a horizontal support line tested 2-3 times at the same price, while each rally peaks lower than the last, drawing a downward-sloping line of highs that converges into the flat floor on the right.</dd></div>
            <div><dt>Confirms</dt><dd>A decisive close below the flat horizontal support, ideally on expanding (above-average) volume, confirms the bearish breakdown.</dd></div>
            <div><dt>Fails if</dt><dd>A close back above the descending line of lower highs (or a sustained reclaim of broken support) invalidates the bearish thesis and signals a bullish breakout instead.</dd></div>
            <div><dt>Watch out</dt><dd>Don't pre-short before the support actually breaks — price can bounce off the flat floor several times, and a low-volume break often turns into a false breakdown (bear trap) that snaps back into the triangle.</dd></div>
          </dl>
        </div>
      </article>
    </div>
  </section>

  <section>
    <div class="shead"><span class="snum">i</span><h2>How stonks uses these</h2><p>where you'll see them</p></div>
    <div class="note">
      <p>The <b>Technicals</b> and <b>Top&nbsp;Picks / Grade</b> tabs run an AI <b>chart-pattern detector</b> over each ticker's last ~month of 30-minute bars and label any of these eight it sees — as <code>forming</code> (the shape is two-thirds built, the decisive break hasn't happened) or <code>confirmed</code> (the break has happened). A confirmed bullish pattern nudges a borderline grade up; a bearish one nudges it down. This card is the human version: use it to sanity-check what the detector flags, or to spot a setup it hasn't caught yet.</p>
    </div>
  </section>

  <footer>
    <span>CHART PATTERN FIELD GUIDE · personal study reference</span>
    <span>Educational only — not financial advice. Patterns fail; size accordingly.</span>
  </footer>

</div>`,
  },
  "features": {
    label: "What's included",
    title: "What's included",
    style: `:host{position:relative;display:block}

  :host{
    --bg:#0d0e12;
    --bg2:#11131a;
    --surface:#171922;
    --surface2:#1d2029;
    --line:#2a2e3a;
    --line2:#363b49;
    --ink:#e9e6dd;
    --muted:#8b8f9c;
    --faint:#5c606d;
    --gold:#e6b24a;
    --gold-dim:#a07e34;
    --green:#5ad1a8;
    --green-dim:#2f8266;
    --blurple:#5865f2;
    --radius:14px;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Fraunces',Georgia,serif;
    --body:'Hanken Grotesk',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  
  :host{
    background:var(--bg);
    color:var(--ink);
    font-family:var(--body);
    line-height:1.65;
    font-size:15.5px;
    -webkit-font-smoothing:antialiased;
    position:relative;
    overflow-x:hidden;
  }
  :host::before{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
    background:
      radial-gradient(900px 600px at 12% -5%, rgba(230,178,74,.10), transparent 60%),
      radial-gradient(800px 700px at 100% 0%, rgba(90,209,168,.07), transparent 55%);
  }
  :host::after{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.035;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:0 22px 96px}

  .backlink{
    display:inline-flex;align-items:center;gap:8px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);text-decoration:none;
    margin-top:28px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;
    transition:color .2s ease,border-color .2s ease,background .2s ease;
  }
  .backlink:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--surface)}

  header.pg{padding:26px 0 34px;border-bottom:1px solid var(--line);margin-bottom:8px}
  .kicker{
    font-family:var(--mono);font-size:11px;letter-spacing:.34em;text-transform:uppercase;
    color:var(--gold);display:flex;align-items:center;gap:14px;margin:34px 0 18px;
  }
  .kicker::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--gold-dim),transparent)}
  h1{
    font-family:var(--disp);font-weight:600;font-size:clamp(34px,6vw,58px);
    line-height:1.0;letter-spacing:-.02em;
  }
  h1 em{font-style:italic;color:var(--gold)}
  .intro{margin-top:22px;color:var(--muted);font-size:16px;max-width:680px}
  .intro a{color:var(--gold);text-decoration:none}
  .intro a:hover{text-decoration:underline}

  nav.toc{
    margin-top:30px;background:linear-gradient(180deg,var(--surface),var(--bg2));
    border:1px solid var(--line);border-left:3px solid var(--gold-dim);
    border-radius:var(--radius);padding:18px 22px 20px;
  }
  nav.toc h2{
    font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;
    color:var(--faint);margin-bottom:12px;
  }
  nav.toc ol{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 28px;counter-reset:toc}
  @media(max-width:640px){nav.toc ol{grid-template-columns:1fr}}
  nav.toc li{counter-increment:toc;font-size:14px}
  nav.toc a{color:var(--muted);text-decoration:none;display:flex;gap:10px;align-items:baseline;padding:2px 0}
  nav.toc a::before{content:counter(toc,decimal-leading-zero);font-family:var(--mono);font-size:10.5px;color:var(--gold-dim);flex:none}
  nav.toc a:hover{color:var(--gold)}

  section{padding-top:46px;scroll-margin-top:20px}
  section h2{
    font-family:var(--disp);font-weight:500;font-size:clamp(22px,3.2vw,29px);letter-spacing:-.01em;
    padding-bottom:12px;margin-bottom:8px;border-bottom:1px solid var(--line);
  }
  section h2 .snum{font-family:var(--mono);font-size:13px;color:var(--gold);margin-right:12px}
  .sectlede{color:var(--muted);font-size:15px;margin:14px 0 22px;max-width:720px}

  /* Tier badge — FREE (green) / PREMIUM (gold) */
  .tier{
    display:inline-flex;align-items:center;gap:6px;flex:none;
    font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
    padding:3px 8px;border-radius:999px;border:1px solid;
  }
  .tier.free{color:var(--green);border-color:rgba(90,209,168,.4);background:rgba(90,209,168,.08)}
  .tier.prem{color:var(--gold);border-color:rgba(230,178,74,.4);background:rgba(230,178,74,.09)}
  .tier::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}

  /* At-a-glance comparison — two columns */
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px}
  @media(max-width:680px){.cmp{grid-template-columns:1fr}}
  .cmp-col{
    background:linear-gradient(180deg,var(--surface),var(--bg2));
    border:1px solid var(--line);border-radius:var(--radius);
    padding:20px 22px 22px;display:flex;flex-direction:column;
  }
  .cmp-col.free{border-top:3px solid var(--green-dim)}
  .cmp-col.prem{border-top:3px solid var(--gold-dim)}
  .cmp-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .cmp-title{font-family:var(--disp);font-weight:600;font-size:21px;letter-spacing:-.01em}
  .cmp-price{margin:10px 0 2px;font-family:var(--mono);font-size:13px;color:var(--muted)}
  .cmp-price b{color:var(--ink);font-weight:500}
  .cmp-sub{color:var(--faint);font-size:13px;margin-bottom:16px}
  .cmp-list{list-style:none;display:grid;gap:9px;margin-top:4px}
  .cmp-list li{position:relative;padding-left:24px;color:var(--muted);font-size:14px;line-height:1.5}
  .cmp-list li::before{
    content:"✓";position:absolute;left:2px;top:0;font-family:var(--mono);font-size:12px;font-weight:700;
  }
  .cmp-col.free .cmp-list li::before{color:var(--green)}
  .cmp-col.prem .cmp-list li::before{color:var(--gold)}
  .cmp-list li b{color:var(--ink);font-weight:600}
  .cmp-cta{margin-top:auto;padding-top:18px}

  .btn{
    display:inline-flex;align-items:center;justify-content:center;gap:10px;
    width:100%;padding:12px 16px;border-radius:11px;border:0;
    font-family:var(--body);font-size:14.5px;font-weight:600;cursor:pointer;text-decoration:none;
    transition:filter .15s ease,transform .15s ease;
  }
  .btn.discord{background:var(--blurple);color:#fff}
  .btn.discord:hover{filter:brightness(1.08);transform:translateY(-1px)}
  .btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line2)}
  .btn.ghost:hover{border-color:var(--gold-dim);color:var(--gold)}

  /* Feature catalog grid */
  .grouplabel{
    font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;
    color:var(--faint);margin:26px 0 12px;display:flex;align-items:center;gap:12px;
  }
  .grouplabel::after{content:"";flex:1;height:1px;background:var(--line)}
  .feat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  @media(max-width:680px){.feat-grid{grid-template-columns:1fr}}
  .feat{
    background:var(--surface);border:1px solid var(--line);border-radius:12px;
    padding:15px 17px;display:flex;flex-direction:column;gap:7px;
    transition:border-color .18s ease,transform .18s ease,background .18s ease;
  }
  .feat:hover{border-color:var(--line2);transform:translateY(-1px);background:var(--surface2)}
  .feat-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .feat-name{font-family:var(--disp);font-weight:600;font-size:16.5px;letter-spacing:-.01em;color:var(--ink)}
  .feat-desc{color:var(--muted);font-size:13.5px;line-height:1.5}

  /* Numbered steps */
  .steps{list-style:none;counter-reset:step;display:grid;gap:14px;margin-top:20px}
  .steps li{counter-increment:step;position:relative;padding-left:46px;color:var(--muted);font-size:14.5px;line-height:1.55}
  .steps li::before{
    content:counter(step);position:absolute;left:0;top:-2px;
    width:30px;height:30px;display:grid;place-items:center;
    font-family:var(--mono);font-size:13px;font-weight:700;color:var(--gold);
    border:1px solid var(--gold-dim);border-radius:50%;background:var(--surface);
  }
  .steps li b{color:var(--ink);font-weight:600}
  .steps li a{color:var(--gold);text-decoration:none}
  .steps li a:hover{text-decoration:underline}

  .ctarow{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px;max-width:480px}
  .ctarow .btn{width:auto;flex:1 1 200px}

  p{color:var(--muted);margin-bottom:14px}
  p strong,li strong{color:var(--ink);font-weight:600}
  p a,li a{color:var(--gold);text-decoration:none}
  p a:hover,li a:hover{text-decoration:underline}
  ul.plain{list-style:none;margin:6px 0 16px;display:grid;gap:9px}
  ul.plain li{position:relative;padding-left:22px;color:var(--muted)}
  ul.plain li::before{content:"";position:absolute;left:4px;top:11px;width:5px;height:5px;border-radius:50%;background:var(--gold-dim)}

  .callout{
    margin-top:22px;background:var(--surface);border:1px solid var(--line);
    border-left:3px solid var(--gold-dim);border-radius:var(--radius);padding:16px 20px;
    color:var(--muted);font-size:14px;line-height:1.6;
  }
  .callout b{color:var(--ink)}

  footer.pgfoot{
    margin-top:60px;padding-top:22px;border-top:1px solid var(--line);
    display:flex;flex-wrap:wrap;gap:12px 20px;justify-content:space-between;align-items:center;
    color:var(--faint);font-size:12.5px;
  }
  footer.pgfoot a{color:var(--muted);text-decoration:none}
  footer.pgfoot a:hover{color:var(--gold)}`,
    body: `<div class="wrap">
  <a class="backlink" href="/">&larr; Back to stonks</a>

  <header class="pg">
    <div class="kicker">stonks &middot; what's included</div>
    <h1>Free to browse.<br><em>Premium</em> to unlock.</h1>
    <p class="intro">stonks is a freemium options desk. Most of it is <strong>free to use right now</strong> — no account, no card. A focused set of members-only tools is unlocked with a <strong>premium Discord membership</strong>. Here's exactly what sits on each side of the line. <a href="/">Start browsing &rarr;</a></p>
  </header>

  <nav class="toc" aria-label="Table of contents">
    <h2>Contents</h2>
    <ol>
      <li><a href="#glance">Free vs Premium at a glance</a></li>
      <li><a href="#free">What's free</a></li>
      <li><a href="#premium">What premium unlocks</a></li>
      <li><a href="#how">How membership works</a></li>
      <li><a href="#good">Good to know</a></li>
    </ol>
  </nav>

  <main>
    <section id="glance">
      <h2><span class="snum">01</span>Free vs Premium at a glance</h2>
      <p class="sectlede">The whole app shell, every live quote/chain proxy, and the bulk of the research tabs are open to everyone. Premium adds the highest-signal, freshest, decision-grade layers — the stuff we'd charge for.</p>
      <div class="cmp">
        <div class="cmp-col free">
          <div class="cmp-head">
            <span class="cmp-title">Free</span>
            <span class="tier free">No login</span>
          </div>
          <div class="cmp-price"><b>$0</b> &middot; browse anytime</div>
          <div class="cmp-sub">Open to anyone — nothing to sign up for.</div>
          <ul class="cmp-list">
            <li><b>Grade a contract</b> — spread, delta, theta + AI conviction on any chain</li>
            <li><b>Tickers</b> — chains, technicals, Greeks, IV term structure, AI news takes</li>
            <li><b>Calendar</b> — earnings, macro prints, FOMC + FedWatch odds</li>
            <li><b>Market heatmap</b> — live map by performance or relative volume</li>
            <li><b>Macro</b> — Overnight markets, Fear &amp; Greed, Bonds &amp; USD, 13F filings</li>
            <li><b>Streaks</b> &amp; the <b>Strategies</b> entry engine</li>
            <li><b>Reference</b> — Buyer's manual + Chart-patterns field guide</li>
          </ul>
          <div class="cmp-cta">
            <a class="btn ghost" href="/">Browse the free site</a>
          </div>
        </div>
        <div class="cmp-col prem">
          <div class="cmp-head">
            <span class="cmp-title">Premium</span>
            <span class="tier prem">Discord member</span>
          </div>
          <div class="cmp-price"><b>Members</b> &middot; via Discord role</div>
          <div class="cmp-sub">Everything in Free, plus the decision-grade layers.</div>
          <ul class="cmp-list">
            <li><b>Top Picks</b> — highest-conviction contracts, sizing &amp; breakeven</li>
            <li><b>Briefs</b> — pre-market &amp; post-close market digests</li>
            <li><b>Narratives</b> — AI theses driving capital, longs/shorts, lifecycle</li>
            <li><b>Unusual flow</b> — abnormal options prints &amp; directional skew</li>
            <li><b>Volume</b> — intraday volume + support/resistance breaks</li>
            <li><b>Gamma exposure</b> — dealer net-gamma matrix, flip &amp; walls</li>
            <li><b>Hot stocks</b> — live pace board with buy/sell/wait verdicts</li>
            <li><b>Track Record</b> — resolved picks performance &amp; scorecard</li>
          </ul>
          <div class="cmp-cta">
            <a class="btn discord" href="/api/auth/discord-login">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5c1.6.4 2.9 1 4.1 1.8a13.5 13.5 0 0 0-11.5 0c1.2-.8 2.6-1.4 4.1-1.8L11.6 3A19.8 19.8 0 0 0 6.7 4.4 20.6 20.6 0 0 0 3 18.6 19.9 19.9 0 0 0 8 21l.6-.9c-.9-.3-1.7-.7-2.4-1.2.2-.1.4-.3.6-.4a14.2 14.2 0 0 0 12.4 0c.2.1.4.3.6.4-.7.5-1.5.9-2.4 1.2l.6.9a19.9 19.9 0 0 0 5-2.4 20.6 20.6 0 0 0-3.7-14.2ZM9 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
              Log in with Discord
            </a>
          </div>
        </div>
      </div>
    </section>

    <section id="free">
      <h2><span class="snum">02</span>What's free</h2>
      <p class="sectlede">No account required — open the site and these are all live. Refreshed automatically through the trading day.</p>

      <div class="grouplabel">Find &amp; act</div>
      <div class="feat-grid">
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Grade a contract</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Score any specific options contract on bid-ask spread, delta, and theta, with an AI conviction read blending news, fundamentals, technicals, and macro tilt.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Tickers</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Per-ticker option chains, technicals (RSI/MACD/SMA/S&amp;R/IV regime), Greeks, IV term structure, earnings history, and an AI news take — for every tracked symbol.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Calendar</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Earnings AM/PM sessions, macro releases (CPI, NFP, PPI, JOLTS), FOMC dates and live FedWatch probabilities — with countdowns and clickable tickers.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Strategies</span><span class="tier free">Free</span></div>
          <p class="feat-desc">An entry-strategy engine that frames how to express a directional view with defined-risk option structures.</p>
        </div>
      </div>

      <div class="grouplabel">Macro &amp; market context</div>
      <div class="feat-grid">
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Market heatmap</span><span class="tier free">Free</span></div>
          <p class="feat-desc">A Finviz-style map of the curated universe, sized by market cap and colored by performance or relative volume, with a live overlay, breadth ribbon, and ticker search.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Overnight markets</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Cross-market correlations — foreign indices, FX, US futures, commodities, rates, and crypto — and how each maps onto US names overnight.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Fear &amp; Greed</span><span class="tier free">Free</span></div>
          <p class="feat-desc">CNN's 7-indicator equity-market sentiment index, 0–100, with a redesigned gauge and a scrubbable history.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Bonds &amp; USD</span><span class="tier free">Free</span></div>
          <p class="feat-desc">How Treasury yields and the dollar shape equities — the yield curve, the 2s10s spread, sparklines, and the Fed anchor.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">13F filings</span><span class="tier free">Free</span></div>
          <p class="feat-desc">A quarterly snapshot of the largest institutional filers — top positions, biggest aggregate holdings, and rotation themes.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Streaks</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Current green/red daily-close streaks for every ticker, a counter-day tolerance bank, rarity context, and a just-snapped mean-reversion strip.</p>
        </div>
      </div>

      <div class="grouplabel">Live tools &amp; reference</div>
      <div class="feat-grid">
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Live quotes &amp; chains</span><span class="tier free">Free</span></div>
          <p class="feat-desc">Real-time spot, option chains, the live Fed Funds rate, and a "check a position you hold" pricer — the live data proxies are open to everyone.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Buyer's manual</span><span class="tier free">Free</span></div>
          <p class="feat-desc">A plain-language field guide to reading an option — what spread, delta, theta, and IV actually mean for the trade.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Chart patterns</span><span class="tier free">Free</span></div>
          <p class="feat-desc">A reference of the common chart formations and what they tend to signal.</p>
        </div>
      </div>
    </section>

    <section id="premium">
      <h2><span class="snum">03</span>What premium unlocks</h2>
      <p class="sectlede">The members-only layer — the freshest, highest-signal reads we'd put real money behind. These eight tabs (and the data that backs them) are gated behind a valid membership; everything above stays free.</p>
      <div class="feat-grid">
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Top Picks</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">The highest-conviction contracts pulled from today's chains — a cross-sectional grade, suggested contract, position sizing, move-to-breakeven, and an exit plan. Plus grade <em>any</em> ticker on demand.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Briefs</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">A pre-market and a post-close market digest — overnight moves, the day's movers, notable flow, dealer gamma, what's next — written each session.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Narratives</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">AI-built theses on what's driving capital — longs, shorts, the 6-stage lifecycle, a fundamentals-vs-hype gauge, bull/base/bear cases, and cited sources.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Unusual flow</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">Options prints with abnormal volume vs the prior session, the call-vs-put premium skew, and a directional lean — who's pricing in what.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Volume</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">Intraday volume standouts and support/resistance breaks, with an hour-by-hour volume-profile strip on every flagged name.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Gamma exposure</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">The dealer net-gamma (GEX) matrix per strike, the gamma flip line, and the call/put walls — where moves get pinned or amplified.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Hot stocks</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">What's trading heaviest right now — live volume pace, sector context, dealer gamma, flow skew, and a buy-calls / buy-puts / wait verdict per name.</p>
        </div>
        <div class="feat">
          <div class="feat-top"><span class="feat-name">Track Record</span><span class="tier prem">Premium</span></div>
          <p class="feat-desc">The resolved Top-Picks performance — win rate, win/loss payoff, expectancy vs SPY, the scorecard, and the roster's in/out churn over time.</p>
        </div>
      </div>
    </section>

    <section id="how">
      <h2><span class="snum">04</span>How membership works</h2>
      <p class="sectlede">Premium is unlocked through our Discord server. There's no separate stonks account — your Discord membership <em>is</em> your access.</p>
      <ol class="steps">
        <li><b><a href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener">Join the Discord</a> and get the member role.</b> Premium access rides on a role in our server. Members get it automatically; ask in the server if you don't see it yet.</li>
        <li><b>Log in with Discord.</b> Hit <a href="/api/auth/discord-login">Log in</a> (or the "Log in" button in the site header). We check your server membership and role — nothing else.</li>
        <li><b>The premium tabs unlock.</b> Once you hold the role, the eight members-only tabs and their data open up. A non-member just sees a polite upsell where those tabs would be — the rest of the site never locks.</li>
      </ol>
      <div class="callout">
        <b>Privacy &amp; sessions:</b> we only read your Discord user ID, username, and the roles relevant to access. Login mints a short-lived, secure session cookie — sign out anytime. See the <a href="/privacy.html">Privacy Policy</a> for the full detail.
      </div>
      <div class="ctarow">
        <a class="btn discord" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5c1.6.4 2.9 1 4.1 1.8a13.5 13.5 0 0 0-11.5 0c1.2-.8 2.6-1.4 4.1-1.8L11.6 3A19.8 19.8 0 0 0 6.7 4.4 20.6 20.6 0 0 0 3 18.6 19.9 19.9 0 0 0 8 21l.6-.9c-.9-.3-1.7-.7-2.4-1.2.2-.1.4-.3.6-.4a14.2 14.2 0 0 0 12.4 0c.2.1.4.3.6.4-.7.5-1.5.9-2.4 1.2l.6.9a19.9 19.9 0 0 0 5-2.4 20.6 20.6 0 0 0-3.7-14.2ZM9 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
          Join the Discord
        </a>
        <a class="btn ghost" href="/api/auth/discord-login">Already a member? Log in</a>
      </div>
    </section>

    <section id="good">
      <h2><span class="snum">05</span>Good to know</h2>
      <ul class="plain">
        <li><strong>Refreshed through the day.</strong> The data bakes multiple times each trading day — picks, grades, narratives, heatmap, and flow all update on a schedule, not just once.</li>
        <li><strong>Sources.</strong> Quotes and chains come from Yahoo Finance; macro from the Fed, BLS, Treasury, and SEC; sentiment from CNN's Fear &amp; Greed index. AI theses and news takes are generated by Google Gemini.</li>
        <li><strong>Greeks are computed locally.</strong> Black-Scholes math runs in your browser against the live risk-free rate — nothing about a contract you grade is uploaded.</li>
        <li><strong>Not financial advice.</strong> stonks is a research and educational tool. Nothing here is a recommendation to buy or sell any security. Options carry risk; do your own diligence.</li>
      </ul>
      <p>Questions about membership? Ask in the Discord, or see the <a href="/terms.html">Terms of Use</a> and <a href="/privacy.html">Privacy Policy</a>.</p>
    </section>
  </main>

  <footer class="pgfoot">
    <span>&copy; 2026 stonks &middot; Option Contract Rater</span>
    <span><a href="/">Home</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a></span>
  </footer>
</div>`,
  },
  "privacy": {
    label: "Privacy",
    title: "Privacy Policy",
    style: `:host{position:relative;display:block}

  :host{
    --bg:#0d0e12;
    --bg2:#11131a;
    --surface:#171922;
    --surface2:#1d2029;
    --line:#2a2e3a;
    --line2:#363b49;
    --ink:#e9e6dd;
    --muted:#8b8f9c;
    --faint:#5c606d;
    --gold:#e6b24a;
    --gold-dim:#a07e34;
    --radius:14px;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Fraunces',Georgia,serif;
    --body:'Hanken Grotesk',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  
  :host{
    background:var(--bg);
    color:var(--ink);
    font-family:var(--body);
    line-height:1.65;
    font-size:15.5px;
    -webkit-font-smoothing:antialiased;
    position:relative;
    overflow-x:hidden;
  }
  :host::before{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
    background:
      radial-gradient(900px 600px at 12% -5%, rgba(230,178,74,.10), transparent 60%),
      radial-gradient(800px 700px at 100% 0%, rgba(109,181,240,.06), transparent 55%);
  }
  :host::after{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.035;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap{position:relative;z-index:1;max-width:840px;margin:0 auto;padding:0 22px 96px}

  .backlink{
    display:inline-flex;align-items:center;gap:8px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);text-decoration:none;
    margin-top:28px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;
    transition:color .2s ease,border-color .2s ease,background .2s ease;
  }
  .backlink:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--surface)}

  header{padding:26px 0 34px;border-bottom:1px solid var(--line);margin-bottom:8px}
  .kicker{
    font-family:var(--mono);font-size:11px;letter-spacing:.34em;text-transform:uppercase;
    color:var(--gold);display:flex;align-items:center;gap:14px;margin:34px 0 18px;
  }
  .kicker::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--gold-dim),transparent)}
  h1{
    font-family:var(--disp);font-weight:600;font-size:clamp(34px,6vw,58px);
    line-height:1.0;letter-spacing:-.02em;
  }
  h1 em{font-style:italic;color:var(--gold)}
  .dates{
    margin-top:20px;display:flex;flex-wrap:wrap;gap:10px 18px;
    font-family:var(--mono);font-size:12px;letter-spacing:.04em;color:var(--muted);
  }
  .dates b{color:var(--ink);font-weight:500}
  .intro{margin-top:22px;color:var(--muted);font-size:16px;max-width:680px}
  .intro a{color:var(--gold);text-decoration:none}
  .intro a:hover{text-decoration:underline}

  nav.toc{
    margin-top:30px;background:linear-gradient(180deg,var(--surface),var(--bg2));
    border:1px solid var(--line);border-left:3px solid var(--gold-dim);
    border-radius:var(--radius);padding:18px 22px 20px;
  }
  nav.toc h2{
    font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;
    color:var(--faint);margin-bottom:12px;
  }
  nav.toc ol{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 28px;counter-reset:toc}
  @media(max-width:640px){nav.toc ol{grid-template-columns:1fr}}
  nav.toc li{counter-increment:toc;font-size:14px}
  nav.toc a{color:var(--muted);text-decoration:none;display:flex;gap:10px;align-items:baseline;padding:2px 0}
  nav.toc a::before{content:counter(toc,decimal-leading-zero);font-family:var(--mono);font-size:10.5px;color:var(--gold-dim);flex:none}
  nav.toc a:hover{color:var(--gold)}

  section{padding-top:44px;scroll-margin-top:20px}
  section h2{
    font-family:var(--disp);font-weight:500;font-size:clamp(22px,3.2vw,29px);letter-spacing:-.01em;
    padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid var(--line);
  }
  section h2 .snum{
    font-family:var(--mono);font-size:13px;color:var(--gold);margin-right:12px;
  }
  h3{
    font-family:var(--body);font-weight:600;font-size:16.5px;color:var(--ink);
    margin:24px 0 8px;
  }
  p{color:var(--muted);margin-bottom:14px}
  p strong, li strong{color:var(--ink);font-weight:600}
  p a, li a{color:var(--gold);text-decoration:none}
  p a:hover, li a:hover{text-decoration:underline}
  ul{list-style:none;margin:6px 0 16px;display:grid;gap:9px}
  ul li{position:relative;padding-left:22px;color:var(--muted)}
  ul li::before{
    content:"";position:absolute;left:4px;top:11px;width:5px;height:5px;border-radius:50%;
    background:var(--gold-dim);
  }
  .contact-card{
    margin-top:18px;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius);padding:18px 22px;
  }
  .contact-card .row{display:flex;gap:12px;align-items:baseline;margin-bottom:8px}
  .contact-card .row:last-child{margin-bottom:0}
  .contact-card .lab{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);width:80px;flex:none}
  .contact-card a{color:var(--gold);text-decoration:none}
  .contact-card a:hover{text-decoration:underline}

  footer.pgfoot{
    margin-top:60px;padding-top:22px;border-top:1px solid var(--line);
    display:flex;flex-wrap:wrap;gap:12px 20px;justify-content:space-between;align-items:center;
    color:var(--faint);font-size:12.5px;
  }
  footer.pgfoot a{color:var(--muted);text-decoration:none}
  footer.pgfoot a:hover{color:var(--gold)}`,
    body: `<div class="wrap">
  <a class="backlink" href="/">&larr; Back to stonks</a>

  <header>
    <div class="kicker">stonks &middot; legal</div>
    <h1>Privacy <em>Policy</em></h1>
    <div class="dates">
      <span>Effective Date: <b>June 14, 2026</b></span>
      <span>Last Updated: <b>June 14, 2026</b></span>
    </div>
    <p class="intro">Stonks (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the website <a href="https://stonks-indol.vercel.app">https://stonks-indol.vercel.app</a> (the &ldquo;Site&rdquo;) and provides stock market analysis tools, custom formulas, and related services (the &ldquo;Service&rdquo;). This Privacy Policy explains how we collect, use, disclose, and protect your personal information when you use our Site and Service.</p>
    <p class="intro">By using the Site or Service, you agree to the collection and use of information in accordance with this Privacy Policy.</p>
  </header>

  <nav class="toc" aria-label="Table of contents">
    <h2>Contents</h2>
    <ol>
      <li><a href="#collect">Information We Collect</a></li>
      <li><a href="#use">How We Use Your Information</a></li>
      <li><a href="#share">How We Share Your Information</a></li>
      <li><a href="#cookies">Cookies and Tracking Technologies</a></li>
      <li><a href="#security">Data Security</a></li>
      <li><a href="#retention">Data Retention</a></li>
      <li><a href="#rights">Your Privacy Rights</a></li>
      <li><a href="#children">Children&rsquo;s Privacy</a></li>
      <li><a href="#international">International Data Transfers</a></li>
      <li><a href="#changes">Changes to This Privacy Policy</a></li>
      <li><a href="#contact">Contact Us</a></li>
    </ol>
  </nav>

  <main>
    <section id="collect">
      <h2><span class="snum">01</span>Information We Collect</h2>
      <p>We collect several types of information from and about users of our Service, including:</p>

      <h3>Personal Information</h3>
      <ul>
        <li>Name, email address, and account credentials when you create an account.</li>
        <li>Payment information (processed securely through our third-party payment processor; we do not store full credit card details).</li>
        <li>Billing address and subscription details.</li>
      </ul>

      <h3>Usage and Technical Information</h3>
      <ul>
        <li>Information about how you use the Service (such as features accessed, formulas used, time spent on the Site).</li>
        <li>Device information, browser type, IP address, and operating system.</li>
        <li>Cookies and similar tracking technologies (see &ldquo;Cookies and Tracking Technologies&rdquo; below).</li>
      </ul>

      <h3>Discord Integration</h3>
      <p>If you choose to connect or link your Discord account with Stonks (for example, to receive subscription-based roles or access community features), we may collect and store your Discord user ID, username, and information about roles or permissions granted through our integration. We use this information to manage access, verify subscriptions, and provide related features.</p>

      <h3>Information from Third Parties</h3>
      <p>We may receive information about you from third-party services you connect with, such as payment processors or Discord.</p>
    </section>

    <section id="use">
      <h2><span class="snum">02</span>How We Use Your Information</h2>
      <p>We use the information we collect for the following purposes:</p>
      <ul>
        <li>To provide, maintain, and improve the Service.</li>
        <li>To process payments and manage your subscription.</li>
        <li>To handle Discord integration (such as assigning or removing roles based on your subscription status).</li>
        <li>To personalize your experience and deliver relevant content and features.</li>
        <li>To communicate with you (including sending account-related emails and updates).</li>
        <li>To detect and prevent fraud, security issues, and abuse.</li>
        <li>To comply with legal obligations.</li>
        <li>To analyze usage and improve our formulas, tools, and overall product.</li>
      </ul>
    </section>

    <section id="share">
      <h2><span class="snum">03</span>How We Share Your Information</h2>
      <p>We do not sell your personal information. We may share your information in the following limited circumstances:</p>
      <ul>
        <li><strong>Service Providers:</strong> With third-party vendors who help us operate the Service (e.g., payment processors, hosting providers, analytics services, and Discord). These providers are contractually obligated to protect your data.</li>
        <li><strong>Discord Integration:</strong> When you link your Discord account, we may share limited information (such as your subscription status) with Discord to manage roles and access within our community.</li>
        <li><strong>Legal Requirements:</strong> When required by law, regulation, or legal process.</li>
        <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
        <li><strong>With Your Consent:</strong> When you give us permission to share your information.</li>
      </ul>
    </section>

    <section id="cookies">
      <h2><span class="snum">04</span>Cookies and Tracking Technologies</h2>
      <p>We use cookies and similar technologies to:</p>
      <ul>
        <li>Keep you logged in.</li>
        <li>Understand how users interact with our Site.</li>
        <li>Improve performance and user experience.</li>
      </ul>
      <p>You can control cookies through your browser settings. Note that disabling certain cookies may affect the functionality of the Service.</p>
    </section>

    <section id="security">
      <h2><span class="snum">05</span>Data Security</h2>
      <p>We implement reasonable technical and organizational measures to protect your personal information. However, no method of transmission over the internet or electronic storage is 100% secure. We cannot guarantee absolute security.</p>
    </section>

    <section id="retention">
      <h2><span class="snum">06</span>Data Retention</h2>
      <p>We retain your personal information for as long as necessary to provide the Service, comply with our legal obligations, resolve disputes, and enforce our agreements. When we no longer need your information, we will securely delete or anonymize it.</p>
    </section>

    <section id="rights">
      <h2><span class="snum">07</span>Your Privacy Rights</h2>
      <p>Depending on your location, you may have certain rights regarding your personal information, including:</p>
      <ul>
        <li>The right to access the personal information we hold about you.</li>
        <li>The right to request correction or deletion of your data.</li>
        <li>The right to opt out of certain data sharing or marketing communications.</li>
        <li>The right to data portability.</li>
      </ul>
      <p>To exercise these rights, please contact us at the email below. We will respond to verifiable requests in accordance with applicable law.</p>
    </section>

    <section id="children">
      <h2><span class="snum">08</span>Children&rsquo;s Privacy</h2>
      <p>Our Service is not directed to individuals under the age of 18. We do not knowingly collect personal information from children under 18. If you believe we have collected information from a child, please contact us so we can take appropriate action.</p>
    </section>

    <section id="international">
      <h2><span class="snum">09</span>International Data Transfers</h2>
      <p>If you are accessing the Service from outside the United States, please note that your information may be transferred to, stored, and processed in the United States, where data protection laws may differ from those in your jurisdiction.</p>
    </section>

    <section id="changes">
      <h2><span class="snum">10</span>Changes to This Privacy Policy</h2>
      <p>We may update this Privacy Policy from time to time. When we do, we will revise the &ldquo;Last Updated&rdquo; date at the top of this page. We encourage you to review this Privacy Policy periodically. Your continued use of the Service after any changes constitutes your acceptance of the revised policy.</p>
    </section>

    <section id="contact">
      <h2><span class="snum">11</span>Contact Us</h2>
      <p>If you have any questions or concerns about this Privacy Policy or our data practices, please contact us at:</p>
      <div class="contact-card">
        <div class="row"><span class="lab">Email</span><a href="mailto:mingstreetllc@gmail.com">mingstreetllc@gmail.com</a></div>
        <div class="row"><span class="lab">Discord</span><span>Our community server</span></div>
      </div>
    </section>
  </main>

  <footer class="pgfoot">
    <span>&copy; 2026 stonks &middot; Option Contract Rater</span>
    <span><a href="/terms.html">Terms of Use</a> &middot; <a href="/">Home</a></span>
  </footer>
</div>`,
  },
  "terms": {
    label: "Terms",
    title: "Terms of Use",
    style: `:host{position:relative;display:block}

  :host{
    --bg:#0d0e12;
    --bg2:#11131a;
    --surface:#171922;
    --surface2:#1d2029;
    --line:#2a2e3a;
    --line2:#363b49;
    --ink:#e9e6dd;
    --muted:#8b8f9c;
    --faint:#5c606d;
    --gold:#e6b24a;
    --gold-dim:#a07e34;
    --warn:#f0a23a;
    --radius:14px;
    --mono:'JetBrains Mono',ui-monospace,monospace;
    --disp:'Fraunces',Georgia,serif;
    --body:'Hanken Grotesk',sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  
  :host{
    background:var(--bg);
    color:var(--ink);
    font-family:var(--body);
    line-height:1.65;
    font-size:15.5px;
    -webkit-font-smoothing:antialiased;
    position:relative;
    overflow-x:hidden;
  }
  :host::before{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;
    background:
      radial-gradient(900px 600px at 12% -5%, rgba(230,178,74,.10), transparent 60%),
      radial-gradient(800px 700px at 100% 0%, rgba(109,181,240,.06), transparent 55%);
  }
  :host::after{
    content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.035;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  }
  .wrap{position:relative;z-index:1;max-width:840px;margin:0 auto;padding:0 22px 96px}

  .backlink{
    display:inline-flex;align-items:center;gap:8px;
    font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);text-decoration:none;
    margin-top:28px;padding:7px 12px;border:1px solid var(--line);border-radius:7px;
    transition:color .2s ease,border-color .2s ease,background .2s ease;
  }
  .backlink:hover{color:var(--gold);border-color:var(--gold-dim);background:var(--surface)}

  header{padding:26px 0 34px;border-bottom:1px solid var(--line);margin-bottom:8px}
  .kicker{
    font-family:var(--mono);font-size:11px;letter-spacing:.34em;text-transform:uppercase;
    color:var(--gold);display:flex;align-items:center;gap:14px;margin:34px 0 18px;
  }
  .kicker::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--gold-dim),transparent)}
  h1{
    font-family:var(--disp);font-weight:600;font-size:clamp(32px,5.6vw,54px);
    line-height:1.02;letter-spacing:-.02em;
  }
  h1 em{font-style:italic;color:var(--gold)}
  .dates{
    margin-top:20px;display:flex;flex-wrap:wrap;gap:10px 18px;
    font-family:var(--mono);font-size:12px;letter-spacing:.04em;color:var(--muted);
  }
  .dates b{color:var(--ink);font-weight:500}
  .intro{margin-top:22px;color:var(--muted);font-size:16px;max-width:680px}

  nav.toc{
    margin-top:30px;background:linear-gradient(180deg,var(--surface),var(--bg2));
    border:1px solid var(--line);border-left:3px solid var(--gold-dim);
    border-radius:var(--radius);padding:18px 22px 20px;
  }
  nav.toc h2{
    font-family:var(--mono);font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;
    color:var(--faint);margin-bottom:12px;
  }
  nav.toc ol{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:6px 28px;counter-reset:toc}
  @media(max-width:640px){nav.toc ol{grid-template-columns:1fr}}
  nav.toc li{counter-increment:toc;font-size:14px}
  nav.toc a{color:var(--muted);text-decoration:none;display:flex;gap:10px;align-items:baseline;padding:2px 0}
  nav.toc a::before{content:counter(toc,decimal-leading-zero);font-family:var(--mono);font-size:10.5px;color:var(--gold-dim);flex:none}
  nav.toc a:hover{color:var(--gold)}

  section{padding-top:44px;scroll-margin-top:20px}
  section h2{
    font-family:var(--disp);font-weight:500;font-size:clamp(22px,3.2vw,29px);letter-spacing:-.01em;
    padding-bottom:12px;margin-bottom:18px;border-bottom:1px solid var(--line);
  }
  section h2 .snum{
    font-family:var(--mono);font-size:13px;color:var(--gold);margin-right:12px;
  }
  h3{
    font-family:var(--body);font-weight:600;font-size:16.5px;color:var(--ink);
    margin:24px 0 8px;
  }
  p{color:var(--muted);margin-bottom:14px}
  p strong, li strong{color:var(--ink);font-weight:600}
  p a, li a{color:var(--gold);text-decoration:none}
  p a:hover, li a:hover{text-decoration:underline}
  /* The all-caps liability / warranty paragraphs read as fine print — keep
     them legible but visually distinct from the prose. */
  p.caps{font-size:13px;letter-spacing:.01em;color:var(--faint);line-height:1.6}
  ul{list-style:none;margin:6px 0 16px;display:grid;gap:9px}
  ul li{position:relative;padding-left:22px;color:var(--muted)}
  ul li::before{
    content:"";position:absolute;left:4px;top:11px;width:5px;height:5px;border-radius:50%;
    background:var(--gold-dim);
  }
  .callout{
    margin:22px 0;background:var(--surface);border:1px solid var(--line);
    border-left:3px solid var(--warn);border-radius:var(--radius);padding:16px 20px;
  }
  .callout p{margin:0;color:var(--ink)}
  .contact-card{
    margin-top:18px;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius);padding:18px 22px;
  }
  .contact-card .row{display:flex;gap:12px;align-items:baseline;margin-bottom:8px}
  .contact-card .row:last-child{margin-bottom:0}
  .contact-card .lab{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);width:80px;flex:none}
  .contact-card a{color:var(--gold);text-decoration:none}
  .contact-card a:hover{text-decoration:underline}

  footer.pgfoot{
    margin-top:60px;padding-top:22px;border-top:1px solid var(--line);
    display:flex;flex-wrap:wrap;gap:12px 20px;justify-content:space-between;align-items:center;
    color:var(--faint);font-size:12.5px;
  }
  footer.pgfoot a{color:var(--muted);text-decoration:none}
  footer.pgfoot a:hover{color:var(--gold)}`,
    body: `<div class="wrap">
  <a class="backlink" href="/">&larr; Back to stonks</a>

  <header>
    <div class="kicker">stonks &middot; legal</div>
    <h1>Terms of Use <em>&amp; Conditions</em></h1>
    <div class="dates">
      <span>Effective Date: <b>June 14, 2026</b></span>
      <span>Last Updated: <b>June 14, 2026</b></span>
    </div>
    <p class="intro">These Terms of Use and Conditions govern your access to and use of stonks. Please read them carefully &mdash; by using the Site or Service you agree to be bound by them.</p>
  </header>

  <nav class="toc" aria-label="Table of contents">
    <h2>Contents</h2>
    <ol>
      <li><a href="#disclaimers">Disclaimers</a></li>
      <li><a href="#acceptance">Acceptance of Terms</a></li>
      <li><a href="#eligibility">Eligibility and User Accounts</a></li>
      <li><a href="#billing">Subscriptions and Billing</a></li>
      <li><a href="#ip">Intellectual Property and Ownership</a></li>
      <li><a href="#conduct">User Conduct</a></li>
      <li><a href="#ugc">User-Submitted Content</a></li>
      <li><a href="#thirdparty">Third-Party Links and Data</a></li>
      <li><a href="#changes">Changes to These Terms</a></li>
      <li><a href="#law">Governing Law and Disputes</a></li>
      <li><a href="#indemnification">Indemnification</a></li>
      <li><a href="#entire">Entire Agreement</a></li>
      <li><a href="#severability">Severability</a></li>
      <li><a href="#waiver">No Waiver</a></li>
      <li><a href="#assignment">Assignment</a></li>
      <li><a href="#contact">Contact Us</a></li>
    </ol>
  </nav>

  <main>
    <section id="disclaimers">
      <h2><span class="snum">01</span>Disclaimers</h2>
      <p>The information, tools, features, custom formulas, analysis, data visualizations, and other content available on <a href="https://stonks-indol.vercel.app">https://stonks-indol.vercel.app</a> (collectively, the &ldquo;Site&rdquo;, &ldquo;Stonks&rdquo;, the &ldquo;Service&rdquo;, &ldquo;Services&rdquo;, or &ldquo;Content&rdquo;) are provided for informational and educational purposes only. They should not be construed as investment, financial, tax, legal, or trading advice.</p>
      <p>The Content is intended only as a starting point for your own independent research and due diligence. You should form your own opinion and consult qualified professionals before making any investment or trading decisions.</p>
      <p>Stonks is operated by Ming Street (&ldquo;the Company,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). We are not registered investment advisors, broker-dealers, or financial professionals. Nothing on the Site constitutes a solicitation or recommendation to buy, sell, or hold any security.</p>
      <div class="callout">
        <p>Past performance is not indicative of future results. Trading and investing in securities, options, and related instruments involve a high degree of risk, including the potential loss of your entire investment. Any decision to trade with real funds is made entirely at your own risk and discretion. The Company assumes no responsibility or liability for your trading results, investment decisions, or any losses incurred.</p>
      </div>
      <p>All stock, market, and financial data is sourced from independent third-party providers. The Company does not guarantee the accuracy, completeness, timeliness, or reliability of any Information or formulas. Content is provided &ldquo;as is&rdquo; and may change without notice.</p>
      <p class="caps">THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT ANY WARRANTIES OF ANY KIND, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, title, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, secure, or meet your expectations.</p>
      <p class="caps">In no event shall the Company, its owners, employees, agents, affiliates, or licensors be liable to any user or third party for any damages of any kind (including investment losses, lost profits, lost opportunity, or any direct, indirect, incidental, special, consequential, or punitive damages) arising out of or relating to the use of, or inability to use, the Service or any Content, whether based in contract, tort (including negligence), strict liability, or otherwise, even if advised of the possibility of such damages.</p>
      <p class="caps">This limitation applies to any damages caused by any failure of performance, error, omission, interruption, deletion, defect, delay, computer virus, communication line failure, unauthorized access, or use of any information on the Site.</p>
      <p class="caps">FURTHERMORE, in no event shall the Company be liable for any damages to your computer equipment or other property resulting from your access to or use of the Site, or for any injury, loss, claim, or special, exemplary, punitive, indirect, incidental, or consequential damages (including lost profits or lost savings), whether based in contract, tort, strict liability, or otherwise, arising out of or connected with (i) any use of the Site or Content, (ii) any failure or delay in use of the Site, or (iii) the performance or non-performance by us or any third-party provider.</p>
      <p class="caps">NEITHER THE COMPANY NOR ANY OF ITS EMPLOYEES, AGENTS, SUCCESSORS, ASSIGNS, AFFILIATES, OR CONTENT OR SERVICE PROVIDERS shall be liable to you or any third party for any direct, indirect, incidental, special, or consequential damages arising out of use of the Services or inability to access or use the Services, or out of any breach of warranty. Because some jurisdictions do not allow the exclusion or limitation of liability for consequential or incidental damages, the above limitation may not apply to you.</p>
      <p>We reserve the right to change any information on the Site, including revising or deleting features, without prior notice. The Company assumes no responsibility for the content or availability of any third-party websites linked from the Site.</p>
      <p>By using the Service, you agree that your use is entirely at your own risk. You agree that your sole remedy for dissatisfaction with the Service is to stop using it.</p>
    </section>

    <section id="acceptance">
      <h2><span class="snum">02</span>Acceptance of Terms</h2>
      <p>By accessing, browsing, registering for, or using the Site or any Service (including free or paid features), you acknowledge that you have read, understood, and agree to be bound by these Terms of Use and Conditions and our <a href="/privacy.html">Privacy Policy</a>. If you do not agree, please do not use the Site.</p>
      <p>These Terms constitute a legally binding agreement between you and the Company.</p>
    </section>

    <section id="eligibility">
      <h2><span class="snum">03</span>Eligibility and User Accounts</h2>
      <p>You must be at least 18 years old (or the age of majority in your jurisdiction) to use the Service. By using the Site you represent that you meet this requirement.</p>
      <p>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify us immediately of any unauthorized use.</p>
      <p>We may refuse registration or terminate accounts at our sole discretion.</p>
    </section>

    <section id="billing">
      <h2><span class="snum">04</span>Subscriptions and Billing</h2>
      <p>Stonks offers both free and paid subscription tiers. Pricing and available features are clearly displayed at the time of purchase.</p>

      <h3>Account Creation and Security</h3>
      <p>To access certain features (including paid subscriptions), you must create an account. You agree to provide accurate, current, and complete information during registration and to keep this information up to date. You are solely responsible for maintaining the confidentiality of your password and account. You are fully responsible for all activity that occurs under your account, including any use by third parties, whether or not authorized by you. You must immediately notify us of any unauthorized use of your account or password.</p>
      <p>We reserve the right to refuse registration or terminate any account at our sole discretion.</p>

      <h3>Subscriptions and Auto-Renewal</h3>
      <p>Paid subscriptions automatically renew at the end of each billing period unless you cancel before the renewal date. You may cancel your subscription at any time through your account settings or by contacting support. Cancellations take effect at the end of the current billing period. Refunds are not provided except as required by applicable law or at our sole discretion.</p>
      <p>You authorize Stonks (or our designated payment processor) to charge your chosen payment method for all applicable fees, including any applicable taxes. You are responsible for keeping your payment information current.</p>

      <h3>Trial Periods</h3>
      <p>If a trial period is offered, you will receive confirmation by email. Unless you cancel before the end of the trial period, your subscription will automatically convert to a paid subscription at the end of the trial and you will be charged according to the plan you selected.</p>

      <h3>Payment and Anti-Fraud</h3>
      <p>You agree not to circumvent, or attempt to circumvent, any security or billing systems. Any attempt to obtain paid services without proper payment may result in immediate termination of your account and additional charges, in addition to any other remedies available to us.</p>

      <h3>Termination</h3>
      <p>We may suspend or terminate your account or subscription at any time for any reason, including violation of these Terms. You are responsible for all charges incurred up to the effective date of termination.</p>
    </section>

    <section id="ip">
      <h2><span class="snum">05</span>Intellectual Property and Ownership</h2>
      <p>All Content on the Site&mdash;including custom formulas, analysis tools, code, design, text, graphics, and data visualizations&mdash;is owned by the Company or its licensors and is protected by copyright, trademark, and other laws.</p>
      <p>You receive a limited, non-exclusive, non-transferable license to access and use the Service for your personal, non-commercial purposes only. You may not copy, modify, distribute, sell, reverse-engineer, or create derivative works from the Content or formulas without prior written permission.</p>
    </section>

    <section id="conduct">
      <h2><span class="snum">06</span>User Conduct</h2>
      <p>While using the Service, you agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in violation of these Terms.</li>
        <li>Publish, transmit, reproduce, distribute, or exploit any content, data, software, or other material from the Site that is protected by copyright or other intellectual property rights without proper authorization.</li>
        <li>Copy, modify, create derivative works from, or commercially exploit any component of the Service itself.</li>
        <li>Restrict or interfere with any other user&rsquo;s ability to use the Service.</li>
        <li>Violate any securities laws or rules of any securities exchange (including, without limitation, the Securities Act of 1933, the Securities Exchange Act of 1934, NYSE, or NASDAQ).</li>
        <li>Impersonate any person or entity or misrepresent your affiliation with any person or entity.</li>
        <li>Scrape, data-mine, use automated tools, or otherwise attempt to extract data from the Service without our prior written permission.</li>
        <li>Submit false, misleading, or inaccurate information.</li>
      </ul>
      <p>We have no obligation to monitor the Service. However, we reserve the right to monitor usage and, subject to our Privacy Policy, to disclose any information as necessary to comply with applicable law, operate the Service properly, or protect Stonks and its users. We may remove content or terminate accounts that violate these Terms.</p>
    </section>

    <section id="ugc">
      <h2><span class="snum">07</span>User-Submitted Content</h2>
      <p>If you submit comments, feedback, suggestions, or other content to the Site, you grant Stonks and its affiliates a non-exclusive, royalty-free, perpetual, irrevocable, worldwide, and fully sublicensable license to use, reproduce, modify, adapt, publish, translate, create derivative works from, distribute, and display such content in any form or media now known or later developed.</p>
      <p>You represent and warrant that you own or control all rights to the material you submit, that it is accurate and does not violate any third-party rights, and that you will indemnify and hold Stonks harmless from any claims arising from the material you provide.</p>
      <p>Stonks takes no responsibility and assumes no liability for any content submitted by users or third parties.</p>
    </section>

    <section id="thirdparty">
      <h2><span class="snum">08</span>Third-Party Links and Data</h2>
      <p>The Site may contain links to third-party websites, data sources, or services. We are not responsible for the content, accuracy, availability, or practices of any third-party sites or data providers. All stock, market, and financial data is provided by independent third parties. We do not guarantee its accuracy, completeness, or timeliness, and some data may be delayed as required by exchanges or information providers.</p>
      <p>You acknowledge that you are solely responsible for your own investment research and decisions. We shall not be liable for any action taken or decision made by you based on information obtained through the Service or any linked sites.</p>
    </section>

    <section id="changes">
      <h2><span class="snum">09</span>Changes to These Terms</h2>
      <p>We may update these Terms at any time. Changes will be effective upon posting (or as otherwise notified). Continued use after changes constitutes acceptance.</p>
    </section>

    <section id="law">
      <h2><span class="snum">10</span>Governing Law and Disputes</h2>
      <p>These Terms are governed by the laws of the State of California, without regard to its conflict of law principles. Any dispute arising out of or relating to these Terms shall be resolved through binding arbitration in Los Angeles, California, in accordance with the rules of JAMS. If arbitration is not permitted or available, the dispute shall be resolved in the state or federal courts located in Los Angeles County, California.</p>
    </section>

    <section id="indemnification">
      <h2><span class="snum">11</span>Indemnification</h2>
      <p>You agree to indemnify, defend, and hold harmless Stonks, its owners, employees, agents, affiliates, and licensors from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys&rsquo; fees) arising out of or relating to:</p>
      <ul>
        <li>Your use of the Service;</li>
        <li>Your violation of these Terms;</li>
        <li>Your violation of any applicable law or the rights of any third party; or</li>
        <li>Any content you submit to the Site.</li>
      </ul>
    </section>

    <section id="entire">
      <h2><span class="snum">12</span>Entire Agreement</h2>
      <p>These Terms, together with our <a href="/privacy.html">Privacy Policy</a> and any other agreements expressly incorporated by reference, constitute the entire agreement between you and Stonks concerning the Service and supersede all prior or contemporaneous agreements, representations, and understandings, whether written or oral.</p>
    </section>

    <section id="severability">
      <h2><span class="snum">13</span>Severability</h2>
      <p>If any provision of these Terms is held to be invalid, illegal, or unenforceable, the remaining provisions shall continue in full force and effect. The invalid provision shall be modified to the minimum extent necessary to make it valid and enforceable.</p>
    </section>

    <section id="waiver">
      <h2><span class="snum">14</span>No Waiver</h2>
      <p>The failure of Stonks to enforce any right or provision of these Terms shall not constitute a waiver of such right or provision. Any waiver must be in writing and signed by an authorized representative of Stonks to be effective.</p>
    </section>

    <section id="assignment">
      <h2><span class="snum">15</span>Assignment</h2>
      <p>You may not assign or transfer these Terms or any rights or obligations hereunder without the prior written consent of Stonks. Stonks may assign these Terms without restriction. These Terms shall be binding upon and inure to the benefit of the parties and their respective successors and permitted assigns.</p>
    </section>

    <section id="contact">
      <h2><span class="snum">16</span>Contact Us</h2>
      <p>For questions about these Terms:</p>
      <div class="contact-card">
        <div class="row"><span class="lab">Email</span><a href="mailto:mingstreetllc@gmail.com">mingstreetllc@gmail.com</a></div>
        <div class="row"><span class="lab">Discord</span><span>Our community server</span></div>
      </div>
    </section>
  </main>

  <footer class="pgfoot">
    <span>&copy; 2026 stonks &middot; Option Contract Rater</span>
    <span><a href="/privacy.html">Privacy Policy</a> &middot; <a href="/">Home</a></span>
  </footer>
</div>`,
  },
};
