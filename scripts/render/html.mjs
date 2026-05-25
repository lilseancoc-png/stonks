import {
  VALID_INDUSTRY_SET,
  resolveNarrativeIndustry,
  SECTORS,
  SECTOR_ORDER,
  INDUSTRIES_BY_SECTOR,
  INDUSTRY_OF_TICKER,
  htmlEscape,
} from '../build.mjs';

// Section helpers — relocated from scripts/build.mjs.
// Each returns the static HTML for one tab pane; renderHtml below stitches
// them together. htmlEscape is the only external dep.
function tickersSection({ symbols, sectors, industries }) {
  const sorted = symbols.slice().sort();
  const cards = sorted.map((sym) => {
    const sec = sectors[sym] || "";
    const ind = industries[sym] || "";
    const subtitle = [sec, ind].filter(Boolean).join(" · ");
    return `<a class="ticker-card" href="?s=${encodeURIComponent(sym)}" data-ticker="${htmlEscape(sym)}" data-sector="${htmlEscape(sec)}">
      <span class="ticker-sym">${htmlEscape(sym)}</span>
      <span class="ticker-spot" data-spot-for="${htmlEscape(sym)}"></span>
      ${subtitle ? `<span class="ticker-sector">${htmlEscape(subtitle)}</span>` : ""}
    </a>`;
  }).join("");
  // Unique sectors for the filter chips. Sort by occurrence count so the
  // densest sectors come first — matches how the user is likely to scan.
  const sectorCounts = {};
  sorted.forEach((sym) => { const sec = sectors[sym] || ""; if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1; });
  const sectorChips = Object.keys(sectorCounts)
    .sort((a, b) => sectorCounts[b] - sectorCounts[a])
    .map((sec) => `<button type="button" class="tickers-chip" data-tickers-sector="${htmlEscape(sec)}">${htmlEscape(sec)} <span class="tickers-chip-count">${sectorCounts[sec]}</span></button>`)
    .join("");
  return `<section class="card" id="tickers-section">
    <header class="card-header">
      <h2 class="card-title">All supported tickers</h2>
      <span class="card-eyebrow"><span id="tickers-visible-count">${sorted.length}</span> / ${sorted.length} symbols</span>
    </header>
    <p class="hint">Every ticker the site tracks. Click any card to grade options on it.</p>
    <div class="tickers-controls">
      <div class="tickers-search-wrap">
        <input type="search" id="tickers-search" class="tickers-search" placeholder="Search ticker…" autocomplete="off" />
      </div>
      <div class="tickers-chips" id="tickers-chips">
        <button type="button" class="tickers-chip is-active" data-tickers-sector="">All <span class="tickers-chip-count">${sorted.length}</span></button>
        ${sectorChips}
      </div>
    </div>
    <div class="tickers-grid" id="tickers-grid">${cards}</div>
  </section>`;
}

function narrativesSection() {
  // Card chrome only — the sector tab strip, industry rows and narrative
  // cards are rendered client-side from the inline manifest in app.js so we
  // don't have to escape narrative text through Node's template literal.
  return `<section class="card" id="narratives-section">
    <header class="card-header">
      <h2 class="card-title">Active market narratives</h2>
      <span class="card-eyebrow" id="narratives-count" aria-live="polite"></span>
    </header>
    <p class="hint">The stories currently driving capital — AI capex, GLP-1, tariffs, rotations. Each sector tab opens to its dominant overview, then sub-industry narratives, each with a <em>Watch for narrative shift</em> panel listing the red flags that would break the thesis.</p>
    <div id="narratives-tabs" class="narr-tabs" role="tablist" aria-label="Market sectors"></div>
    <div id="narratives-panel" class="narr-panel" role="tabpanel"></div>
    <div id="narratives-empty" class="narr-empty" hidden>No narratives recorded for this build.</div>
    <div id="narratives-ended" class="narr-ended"></div>
    <div id="narratives-macro" class="narr-macro"></div>
  </section>`;
}

function topPicksSection() {
  // Skeleton chrome only — renderTopPicks() in app.js fetches
  // data/picks.json lazily on first tab activation and fills these
  // containers in. Card body is intentionally a list of cards rather
  // than a table so each pick can carry its own signal breakdown.
  return `<section class="card" id="picks-section">
    <header class="card-header">
      <h2 class="card-title">Top options picks</h2>
      <span class="card-eyebrow" id="picks-eyebrow" aria-live="polite"></span>
      <button type="button" id="picks-export-csv" class="csv-export-btn" title="Download picks as CSV">Export CSV</button>
    </header>
    <p class="hint">The ten highest-conviction tickers to trade options on right now, scored by fusing every signal the daily build already produces: active narratives this ticker rides, news sentiment, fundamentals verdict, RSI extremes, MACD direction, and the current daily streak. Each pick is tagged with the side (call or put) the signal stack points to and a thesis enumerating the drivers.</p>
    <div id="picks-root" class="picks-root">Loading top picks…</div>
    <div id="picks-empty" class="picks-empty" hidden>No high-conviction picks in this build — every ticker scored below the minimum.</div>
    <p class="picks-foot">Picks rebuild from scratch on every daily refresh. Conviction is the absolute signal score (typically 3-12); higher means more independent signals lined up the same direction.</p>
  </section>`;
}

function calendarSection() {
  // Card chrome only — the timeline rows, FOMC widget, and macro-report
  // rows render client-side from data/calendar.json (fetched lazily on
  // first tab activation by loadCalendar() in app.js).
  return `<section class="card" id="calendar-section">
    <header class="card-header">
      <h2 class="card-title">30-day calendar</h2>
      <span class="card-eyebrow" id="calendar-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Confirmed earnings dates (with AM/PM session tagging) for every curated ticker, structured economic-report releases (NFP, Unemployment, JOLTS, CPI, PPI) with Actual / Previous / Consensus / Forecast values, upcoming FOMC meetings, and the current effective Fed Funds rate plus CME FedWatch hike/hold/cut probabilities at four lookbacks.</p>
    <div id="fomc-widget" class="fomc-widget" hidden></div>
    <div class="calendar-controls" role="toolbar" aria-label="Filter calendar">
      <div class="calendar-type-filter" role="radiogroup" aria-label="Filter by event type">
        <button type="button" class="calendar-pill is-on" data-cal-type="all" role="radio" aria-checked="true">All</button>
        <button type="button" class="calendar-pill" data-cal-type="earnings" role="radio" aria-checked="false">Earnings</button>
        <button type="button" class="calendar-pill" data-cal-type="reports" role="radio" aria-checked="false">Reports</button>
        <button type="button" class="calendar-pill" data-cal-type="fomc" role="radio" aria-checked="false">FOMC</button>
        <button type="button" class="calendar-pill" data-cal-type="macro" role="radio" aria-checked="false">Macro</button>
      </div>
      <button type="button" id="calendar-export-csv" class="csv-export-btn" title="Download visible events as CSV">Export CSV</button>
    </div>
    <div id="calendar-root" class="calendar-root">Loading calendar…</div>
    <div id="calendar-empty" class="calendar-empty" hidden>No events in the next 30 days.</div>
  </section>`;
}

function f13Section() {
  // Card chrome only — content renders client-side from data/13f.json,
  // fetched lazily on first tab activation by loadF13() in app.js. The
  // data file is a curated quarterly summary aggregating headline numbers
  // from the largest 13F filers; see data/13f.json for the schema.
  return `<section class="card" id="f13-section">
    <header class="card-header">
      <h2 class="card-title">13F filings summary</h2>
      <span class="card-eyebrow" id="f13-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Quarterly institutional-holdings snapshot for the largest 13F filers ($5B+ AUM). Includes top reporting firms, marquee positions, the 20 biggest aggregate holdings across all filers, and rotation themes (most bought vs. most sold). 13F filings are released 45 days after quarter-end and exclude bonds, options details, and most international holdings.</p>
    <div id="f13-root" class="f13-root">Loading 13F summary…</div>
    <div id="f13-empty" class="f13-empty" hidden>13F summary will appear after the next daily build refresh.</div>
  </section>`;
}

function unusualFlowSection() {
  // Card chrome only — the per-ticker rows and contract chips render
  // client-side from the inline manifest in app.js. Populated by the hourly
  // GitHub Actions scan (scripts/scan-unusual.mjs). The controls bar
  // (search/side/hot-only/sort + collapse-all) and the section collapse
  // chevron are also wired in app.js. Rows render collapsed by default so
  // the section stays a scannable list of headers.
  return `<section class="card flow-card" id="flow-section">
    <header class="card-header flow-card-header">
      <button type="button" id="flow-collapse" class="flow-collapse-btn" aria-expanded="true" aria-controls="flow-body" title="Collapse section">
        <svg class="flow-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <h2 class="card-title">Unusual options flow</h2>
      </button>
      <span class="card-eyebrow" id="flow-eyebrow" aria-live="polite"></span>
    </header>
    <div id="flow-body" class="flow-body">
      <p class="hint">Block/sweep flow: 5–50% OTM contracts that picked up at least 2,000 contracts of volume this hour (4,000 if expiring within 2 weeks) with vol &gt; OI. The kind of single-shot directional buying that often signals informed positioning. A 🔥 ×N badge means the same contract has flagged that many times in the last 5 trading days — recurring conviction. Hourly scan, front 3 expirations.</p>
      <div class="flow-controls" role="toolbar" aria-label="Filter unusual flow">
        <label class="flow-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="flow-search-input" placeholder="Search ticker (e.g. NVDA, TSLA)" autocomplete="off" spellcheck="false" />
          <button type="button" id="flow-search-clear" class="flow-search-clear" aria-label="Clear search" hidden>&times;</button>
        </label>
        <div class="flow-side-filter" role="radiogroup" aria-label="Filter by side">
          <button type="button" class="flow-pill is-on" data-side="all" role="radio" aria-checked="true">All</button>
          <button type="button" class="flow-pill" data-side="call" role="radio" aria-checked="false">Calls</button>
          <button type="button" class="flow-pill" data-side="put" role="radio" aria-checked="false">Puts</button>
        </div>
        <label class="flow-toggle">
          <input type="checkbox" id="flow-near-only" />
          <span>Near-term ≤14d</span>
        </label>
        <label class="flow-toggle">
          <input type="checkbox" id="flow-repeat-only" />
          <span>🔥 Repeats only</span>
        </label>
        <label class="flow-sort">
          <select id="flow-sort-select" aria-label="Sort">
            <option value="delta">Biggest hourly delta</option>
            <option value="contracts">Most contracts</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <button type="button" id="flow-expand-toggle" class="flow-action-btn" aria-pressed="true">Expand all</button>
        <button type="button" id="flow-export-csv" class="flow-action-btn csv-export-btn" title="Download visible rows as CSV">Export CSV</button>
      </div>
      <div id="flow-list" class="flow-list" role="list"></div>
      <div id="flow-empty" class="flow-empty" hidden>No unusual flow flagged in the latest scan.</div>
      <div id="flow-no-results" class="flow-empty" hidden>No tickers match these filters.</div>
    </div>
  </section>`;
}

function optionEvalSection() {
  // The ticker combobox + segmented call/put control + chain selects all
  // bind live in app.js — picking a ticker auto-loads its chain and any
  // change to type/expiry/strike re-grades immediately. No Evaluate button.
  return `<section class="card" id="opt-eval-section">
    <header class="card-header">
      <h2 class="card-title">Grade a contract</h2>
    </header>
    <p class="hint">Type to search a curated ticker, pick a call or put, then dial in expiry and strike. The verdict regrades as you go.</p>
    <div id="opt-pinned-strip" class="opt-pinned-strip" hidden aria-label="Pinned contracts for comparison"></div>
    <div class="opt-controls">
      <div class="combo" id="symbol-combo">
        <input type="text" id="symbol-input" role="combobox"
               aria-expanded="false" aria-controls="symbol-listbox"
               aria-autocomplete="list"
               placeholder="Search ticker or sector…"
               autocomplete="off" spellcheck="false">
        <button type="button" class="combo-clear" id="symbol-clear" aria-label="Clear" tabindex="-1">&times;</button>
        <ul id="symbol-listbox" role="listbox" hidden></ul>
      </div>
      <div class="segmented" role="radiogroup" aria-label="Option type">
        <input type="radio" name="opt-type" id="opt-type-call" value="call" checked>
        <label for="opt-type-call">Call</label>
        <input type="radio" name="opt-type" id="opt-type-put" value="put">
        <label for="opt-type-put">Put</label>
      </div>
    </div>
    <div id="opt-chain-row" class="opt-chain-row" hidden>
      <label class="field">
        <span class="field-label">Expiration</span>
        <select id="opt-expiry" aria-label="Expiration"></select>
      </label>
      <label class="field">
        <span class="field-label">Strike</span>
        <select id="opt-strike" aria-label="Strike"></select>
      </label>
    </div>
    <div id="opt-eval-status" class="opt-status" role="status"></div>
    <div id="opt-live-quote" class="opt-live" hidden aria-live="polite"></div>
    <div id="opt-live-refresh" class="opt-live-refresh" hidden aria-live="polite"></div>
    <div id="opt-max-pain" class="opt-max-pain" hidden aria-live="polite"></div>
    <div id="opt-narr-chips" class="opt-narr-chips" hidden aria-label="Narratives this ticker rides"></div>
    <div class="opt-result-wrap">
      <div id="opt-result-sticky" class="opt-result-sticky" hidden></div>
      <div id="opt-eval-result" class="opt-result"></div>
    </div>
    <div id="opt-analysis" class="opt-analysis" hidden>
      <div class="opt-tabs" role="tablist" aria-label="Ticker analysis">
        <button type="button" class="opt-tab" role="tab" aria-selected="true" aria-controls="opt-tab-pane-fund" id="opt-tab-btn-fund" data-tab="fund">Fundamentals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-tech" id="opt-tab-btn-tech" data-tab="tech">Technicals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-iv" id="opt-tab-btn-iv" data-tab="iv">Implied vol</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-news" id="opt-tab-btn-news" data-tab="news">News</button>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-fund" aria-labelledby="opt-tab-btn-fund">
        <section id="opt-fundamentals" class="opt-fund" hidden aria-label="Fundamentals and earnings for this ticker">
          <header class="opt-fund-head">
            <h3 class="opt-fund-title">Fundamentals &amp; earnings</h3>
            <span id="opt-fund-verdict" class="opt-fund-verdict"></span>
          </header>
          <p id="opt-fund-summary" class="opt-fund-summary"></p>
          <div id="opt-fund-recap" class="opt-fund-recap" hidden></div>
          <div class="opt-fund-columns">
            <div class="opt-fund-col opt-fund-pos">
              <div class="opt-fund-col-head">Positives</div>
              <ul id="opt-fund-pos-list" class="opt-fund-list"></ul>
            </div>
            <div class="opt-fund-col opt-fund-neg">
              <div class="opt-fund-col-head">Negatives</div>
              <ul id="opt-fund-neg-list" class="opt-fund-list"></ul>
            </div>
          </div>
          <div id="opt-fund-metrics" class="opt-fund-metrics"></div>
          <div id="opt-fund-segments" class="opt-fund-segments" hidden>
            <div id="opt-fund-seg-product" class="opt-fund-seg-chart"></div>
            <div id="opt-fund-seg-geo" class="opt-fund-seg-chart"></div>
          </div>
          <div class="opt-fund-charts" id="opt-fund-charts">
            <div id="opt-fund-earnings-history"     class="opt-fund-eh" hidden></div>
            <div id="opt-fund-revenue-history"      class="opt-fund-eh" hidden></div>
            <div id="opt-fund-gross-profit-history" class="opt-fund-eh" hidden></div>
            <div id="opt-fund-net-income-history"   class="opt-fund-eh" hidden></div>
            <div id="opt-fund-net-margin-history"   class="opt-fund-eh" hidden></div>
          </div>
          <p class="opt-fund-foot">Verdict + bullets are AI-generated from Yahoo's last-reported fundamentals and earnings. For information only — cross-check before trading.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-tech" aria-labelledby="opt-tab-btn-tech" hidden>
        <section id="opt-technicals" class="opt-tech" hidden aria-label="Technical signals for this ticker">
          <header class="opt-tech-head">
            <h3 class="opt-tech-title">Technical signals</h3>
            <span class="opt-tech-sub">Momentum &amp; recent price structure on the daily chart</span>
          </header>
          <div class="opt-tech-grid" id="opt-tech-grid"></div>
          <p class="opt-tech-foot">Indicators are computed at build time from ~6 months of Yahoo daily closes. Use them as context for your option strike pick — they describe the stock, not the contract itself.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-iv" aria-labelledby="opt-tab-btn-iv" hidden>
        <section id="opt-iv" class="opt-iv" hidden aria-label="Implied vol term structure and rank">
          <header class="opt-iv-head">
            <h3 class="opt-iv-title">Implied volatility</h3>
            <span id="opt-iv-rank" class="opt-iv-rank"></span>
          </header>
          <div class="opt-iv-term" id="opt-iv-term"></div>
          <p class="opt-iv-foot">Term structure plots ATM (call/put average) IV for every expiration in the chain — rising left-to-right is contango, falling is backwardation. IV rank is today's nearest-30d ATM IV as a percentile of the prior ~18 months of daily snapshots; needs 60+ days of history before a rank is shown.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-news" aria-labelledby="opt-tab-btn-news" hidden>
        <div id="opt-news-pane" class="opt-news-pane"></div>
      </div>
    </div>
    <details class="opt-explainer" id="opt-grade-explainer">
      <summary>How is the grade computed?</summary>
      <div class="opt-explainer-body">
        <p>The verdict you see has two halves working together &mdash; a <b>YES / NO buy panel</b> that walks every signal we have, and a short <b>mechanical verdict chip</b> that grades just the contract structure (spread / delta / theta). The panel is the one to read carefully; the chip is a quick mechanical read.</p>
        <h4>YES / NO buy panel</h4>
        <p>This is the one that aims at profitable trades. It collects <b>every</b> reason in play &mdash; not just the first one to break &mdash; and lays them out so you can weigh the full picture:</p>
        <ul>
          <li><b>Hard fails</b> &mdash; mechanical deal-breakers (wide spread, far-OTM delta, bleeding theta, &le;3 DTE, &gt;80% time value with &lt;14 DTE). Any one forces NO and overrides the mechanical verdict to Poor &mdash; no more &ldquo;Mixed&rdquo; sitting next to a NO badge.</li>
          <li><b>What&rsquo;s pulling for / against</b> &mdash; each signal in the stack listed with its weight: news (&plusmn;2), RSI / MACD / volume conviction (&plusmn;1 each), fundamentals verdict (&plusmn;1), macro backdrop (&plusmn;1). The aligned score is the sum &times; direction (+1 for calls, &minus;1 for puts).</li>
          <li><b>Soft warnings</b> &mdash; the 30-DTE theta-acceleration penalty and similar nudges that don&rsquo;t kill the trade but you should know about.</li>
          <li><b>Try this instead</b> &mdash; when NO is driven by a hard fail and the chain has a cleaner alternative, the panel surfaces it: usually a longer expiry (to defuse theta / DTE crunch) or a closer-to-ATM strike (to fix far-OTM delta / wide spread). Click the button to switch the chain dropdowns to that contract and regrade.</li>
        </ul>
        <p><b>Confidence</b> rates how decisive the call is: <em>Strong</em> (aligned score &ge;+3 or two-plus hard fails), <em>Moderate</em> (aligned score &ge;+2), <em>Tentative</em> (clean mechanics, no opposing signals, but no positive conviction either). Take Tentative YES as a green light to consider, not to size in heavy.</p>
        <h4>Mechanical verdict chip</h4>
        <p>A quick read of just spread + delta + theta:</p>
        <ul>
          <li>1+ hard fail &rarr; <b>Poor contract</b> (forced by the buy panel)</li>
          <li>2+ bad grades &rarr; <b>Poor contract</b></li>
          <li>1 bad grade &rarr; <b>Mixed &mdash; proceed with caution</b></li>
          <li>2+ good grades &rarr; <b>Good contract</b></li>
          <li>otherwise &rarr; <b>Acceptable</b></li>
        </ul>
        <p>A clear <b>news tailwind</b> or <b>headwind</b> can nudge an <em>Acceptable</em> verdict to Good or Poor based on the AI-summarized headline sentiment<span class="tip ai-info" tabindex="0" role="button" aria-label="About this AI signal" data-tip="Generated by Google Gemini (model: gemini-2.5-flash-lite). Reads the recent reputable-publisher headlines fetched per ticker each daily refresh and emits a short paragraph + bullish/neutral/bearish tag.">i</span> (but only when no hard fails are in play).</p>
        <h4>Per-metric thresholds</h4>
        <ul>
          <li><b>Spread:</b> Tight (&le;5% of mid, or absolute spread &le;$0.02, or &le;$0.05 with &le;15% relative), Moderate (5&ndash;15% of mid), Wide (&gt;15%). The absolute-cents floor stops a 1-cent gap on a $0.10 contract from being flagged "Moderate" just because the percentage is high.</li>
          <li><b>Delta:</b> Balanced (0.40&ndash;0.70), Slightly OTM (0.30&ndash;0.40), Deep ITM (&gt;0.70), Far OTM (&lt;0.30). <em>Assumes a single-leg directional buy</em> — spread sellers (credit spreads, iron condors) read these bands inverted and should ignore the delta grade.</li>
          <li><b>Theta:</b> Slow decay (&lt;1% of mid/day), Normal (1&ndash;3%), Bleeding (&gt;3%). Skipped when mid &lt; $0.10 — a fraction of a cent per day on a nickel contract is just how cheap short-dated options behave, not a real bleed.</li>
          <li><b>Liquidity (open interest):</b> Thin (&lt;10), Light (&lt;100), Liquid (&ge;100)</li>
          <li><b>30d realized vol:</b> Calm (bottom 30% of this name&rsquo;s own history), Normal, Elevated (top 30%)</li>
        </ul>
        <h4>Volume conviction</h4>
        <p>Today&rsquo;s daily volume vs the trailing 20-day average, paired with today&rsquo;s 1-day price move, sorts the print into one of four buckets:</p>
        <ul>
          <li><b>Strong:</b> large move (&ge;1.5%) on heavy volume (&ge;1.5&times; avg) &mdash; real conviction</li>
          <li><b>Indecision:</b> small move (&lt;0.5%) on heavy volume &mdash; accumulation or distribution</li>
          <li><b>Weak:</b> large move on light volume (&lt;0.7&times; avg) &mdash; treat with skepticism (a 10% after-hours pop on 1,000 shares is not 10% of conviction)</li>
          <li><b>None:</b> small move on light volume &mdash; nothing to react to</li>
        </ul>
        <h4>Open positions: free-ride / roll rule</h4>
        <p>On the portfolio side: if a position is <b>ITM</b> or <b>up &ge;100%</b> with <b>&le;40 DTE</b> and conviction is still bullish, the recommendation flips to <b>trim-to-cost</b> (sell enough contracts to recover original cost, let the rest free-ride) or <b>roll</b> (extend the expiration / move the strike) instead of plain hold.</p>
        <p class="opt-explainer-foot">All thresholds are simple heuristics, not optimal strategies.</p>
      </div>
    </details>
  </section>
  <section class="card" id="opt-manual-section">
    <details class="opt-manual-details">
      <summary class="card-header">
        <h2 class="card-title">Grade your own contract</h2>
        <span class="opt-manual-trigger-sub">paste from your broker</span>
      </summary>
      <div class="opt-manual-body">
        <p class="hint">Paste numbers straight off Robinhood, Schwab, etc. — we strip <code>$</code>, <code>%</code>, commas, and size suffixes. IV / OI / volume are optional; without IV the Greeks are skipped.</p>
        <form id="opt-manual-form" class="opt-manual-grid">
      <label class="opt-manual-field opt-manual-paste">
        <span class="opt-manual-field-label">Paste contract symbol <span class="opt-manual-opt">optional · fills type / strike / expiry</span></span>
        <input id="m-paste" type="text" placeholder="AAPL250117C00150000" autocomplete="off" spellcheck="false">
        <span class="opt-paste-hint" id="m-paste-hint"></span>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Type</span>
        <select id="m-type">
          <option value="call">Call</option>
          <option value="put">Put</option>
        </select>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Share price</span>
        <input id="m-spot" type="text" inputmode="decimal" placeholder="100.77" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Strike price</span>
        <input id="m-strike" type="text" inputmode="decimal" placeholder="103" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Expiration</span>
        <input id="m-expiry" type="date" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Bid</span>
        <input id="m-bid" type="text" inputmode="decimal" placeholder="3.15 (or 3.15 × 55)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Ask</span>
        <input id="m-ask" type="text" inputmode="decimal" placeholder="3.30 (or 3.30 × 74)" autocomplete="off" required>
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Implied volatility <span class="opt-manual-opt">optional</span></span>
        <input id="m-iv" type="text" inputmode="decimal" placeholder="100.81%" autocomplete="off">
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Open interest <span class="opt-manual-opt">optional</span></span>
        <input id="m-oi" type="text" inputmode="numeric" placeholder="996" autocomplete="off">
      </label>
      <label class="opt-manual-field">
        <span class="opt-manual-field-label">Volume <span class="opt-manual-opt">optional</span></span>
        <input id="m-vol" type="text" inputmode="numeric" placeholder="1,251" autocomplete="off">
      </label>
      <button type="submit" class="opt-manual-submit">Grade contract</button>
        </form>
        <div id="opt-manual-status" class="opt-status" role="status"></div>
        <div id="opt-manual-result" class="opt-result"></div>
      </div>
    </details>
  </section>`;
}

export function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], sectorOverviews = {}, recentlyEnded = [], macroHeadlines = [], unusual = null, spots = {}, fearGreed = null, macro = null }) {
  const tickerCount = symbols.length;
  // Backfill industry on narratives loaded from older trends.json snapshots
  // (pre-taxonomy builds didn't tag one). Also accept legacy `triggers` as
  // `watchFor` so stale-fallback data still renders red flags. resolveNarrativeIndustry
  // votes from each narrative's longs/shorts so they slot into the right tab
  // even without a fresh AI run.
  const narrativesTagged = narratives.map((n) => {
    const out = {
      ...n,
      industry: n.industry && VALID_INDUSTRY_SET.has(n.industry)
        ? n.industry
        : resolveNarrativeIndustry(n.industry, n.longs || [], n.shorts || []),
    };
    if (!Array.isArray(out.watchFor) || !out.watchFor.length) {
      if (Array.isArray(n.triggers) && n.triggers.length) out.watchFor = n.triggers;
    }
    return out;
  });
  // Manifest is embedded inline so the narratives card + combobox can paint
  // on first frame. Per-ticker chain JSON is still lazy-fetched from
  // data/<SYMBOL>.json on demand.
  const manifestPayload = JSON.stringify({
    builtAt,
    builtAtIso,
    symbols,
    narratives: narrativesTagged,
    sectorOverviews: sectorOverviews || {},
    recentlyEnded,
    macroHeadlines,
    sectors: SECTORS,
    industries: INDUSTRY_OF_TICKER,
    sectorOrder: SECTOR_ORDER,
    industriesBySector: INDUSTRIES_BY_SECTOR,
    unusual: unusual || null,
    spots,
    fearGreed: fearGreed || null,
    macro: macro || null,
  }).replace(/<\/script>/gi, "<\\/script>");
  // Browser Supabase config — anon key is safe to ship publicly (RLS does
  // the actual access control). Service-role key stays server-side only.
  // Missing env vars produce an empty object; the portfolio tab falls back
  // to a "configure Supabase" message instead of crashing.
  const supabasePayload = JSON.stringify({
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || "",
  }).replace(/<\/script>/gi, "<\\/script>");
  const cacheBust = encodeURIComponent(builtAtIso);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>stonks · Option Contract Rater</title>
<meta name="description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital." />
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="apple-touch-icon" href="favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="stonks · Option Contract Rater">
<meta property="og:description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="stonks · Option Contract Rater">
<meta name="twitter:description" content="Grade an options contract on bid-ask spread, delta, and theta. Track the market narratives currently driving capital.">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css?v=${cacheBust}">
<link rel="stylesheet" href="portfolio.css?v=${cacheBust}">
</head>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="/" aria-label="stonks home">
      <svg class="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M3 16 L8 9 L12 13 L19 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="19" cy="4" r="1.6" fill="currentColor"/>
      </svg>
      <span class="brand-word">stonks</span>
      <span class="brand-tag">Option Rater</span>
    </a>
    <nav class="site-nav">
      <button id="cmd-palette-trigger" class="cmd-palette-trigger" type="button" aria-label="Search ticker, narrative, or tab" title="Jump to ticker, narrative, or tab (⌘K / Ctrl+K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span class="cmd-palette-trigger-label">Search ticker, narrative, tab…</span>
        <kbd class="cmd-palette-trigger-kbd">⌘K</kbd>
      </button>
      <button id="theme-toggle" class="icon-btn" aria-label="Toggle theme" type="button">
        <svg class="i-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="i-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </nav>
  </div>
</header>
<p class="page-sub">Grade an options contract on spread, delta, and theta. ${tickerCount} curated tickers, refreshed daily.</p>
<div id="freshness-banner" class="freshness" data-built-at="${builtAtIso}" role="status" aria-live="polite">
  <span class="freshness-dot" aria-hidden="true"></span>
  <span id="freshness-text">Refreshed ${builtAt} (NY)</span>
</div>
<nav class="page-tabs" role="tablist" aria-label="Page sections">
  <button type="button" class="page-tab" role="tab" data-page-tab="home" aria-selected="true" aria-controls="page-pane-home" id="page-tab-home">Home</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="tickers" aria-selected="false" aria-controls="page-pane-tickers" id="page-tab-tickers">Tickers</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="narratives" aria-selected="false" aria-controls="page-pane-narratives" id="page-tab-narratives">Narratives</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="picks" aria-selected="false" aria-controls="page-pane-picks" id="page-tab-picks">Top picks</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="calendar" aria-selected="false" aria-controls="page-pane-calendar" id="page-tab-calendar">Calendar</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="flow" aria-selected="false" aria-controls="page-pane-flow" id="page-tab-flow">Unusual flow</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="grade" aria-selected="false" aria-controls="page-pane-grade" id="page-tab-grade">Grade a contract</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="streaks" aria-selected="false" aria-controls="page-pane-streaks" id="page-tab-streaks">Streaks</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="fear-greed" aria-selected="false" aria-controls="page-pane-fear-greed" id="page-tab-fear-greed">Fear &amp; Greed</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="bonds-usd" aria-selected="false" aria-controls="page-pane-bonds-usd" id="page-tab-bonds-usd">Bonds &amp; USD</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="f13" aria-selected="false" aria-controls="page-pane-f13" id="page-tab-f13">13F filings</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="portfolio" aria-selected="false" aria-controls="page-pane-portfolio" id="page-tab-portfolio">Portfolio</button>
</nav>
<main>
  <div class="page-pane" id="page-pane-home" role="tabpanel" aria-labelledby="page-tab-home">
    <section class="landing-hero">
      <span class="landing-hero-eyebrow">Today's desk</span>
      <h1 class="landing-hero-title">What do you want to look at?</h1>
      <p class="landing-hero-sub">${tickerCount} curated tickers</p>
    </section>
    <section class="landing-section">
      <header class="landing-section-head">
        <h2 class="landing-section-title">Find ideas</h2>
        <p class="landing-section-sub">Where the next trade comes from — what's hot, what's lining up, what's on the calendar.</p>
      </header>
      <div class="landing-grid">
        <button type="button" class="landing-card" data-go="picks" aria-label="View top picks">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Top picks</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-picks">Today</div>
          <div class="landing-card-sub" id="land-sub-picks">highest conviction</div>
          <p class="landing-card-desc">Standout contracts the model pulled from today's chain — what we'd buy if we had to pick.</p>
        </button>
        <button type="button" class="landing-card landing-card-hot" data-go="flow" aria-label="View unusual flow">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Unusual flow</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-flow">—</div>
          <div class="landing-card-sub">flagged today</div>
          <p class="landing-card-desc">Options prints with abnormal volume vs the prior session — who's pricing in what.</p>
        </button>
        <button type="button" class="landing-card" data-go="narratives" aria-label="Browse narratives">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Narratives</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-narratives">—</div>
          <div class="landing-card-sub">sectors covered</div>
          <p class="landing-card-desc">AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About AI-built theses" data-tip="Theses built by Google Gemini (default: gemma-4-26b-a4b-it; override via NARRATIVES_MODEL env). Inputs: sector + industry news filtered to reputable publishers. Refreshed each daily build.">i</span>-built theses on what's driving capital today — longs, shorts, and the triggers to watch.</p>
        </button>
        <button type="button" class="landing-card" data-go="calendar" aria-label="View calendar">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Calendar</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-calendar">30d</div>
          <div class="landing-card-sub" id="land-sub-calendar">earnings + macro</div>
          <p class="landing-card-desc">Earnings AM/PM sessions, macro releases (CPI, NFP, JOLTS), FOMC dates, FedWatch probabilities.</p>
        </button>
      </div>
    </section>
    <section class="landing-section">
      <header class="landing-section-head">
        <h2 class="landing-section-title">Research</h2>
        <p class="landing-section-sub">Context for the trade — who's holding what, what the tape's been doing, where the macro is.</p>
      </header>
      <div class="landing-grid">
        <button type="button" class="landing-card" data-go="tickers" aria-label="Browse tickers">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Tickers</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-tickers">${tickerCount}</div>
          <div class="landing-card-sub">symbols tracked</div>
          <p class="landing-card-desc">Per-ticker chains, technicals, Greeks, IV term structure, AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About AI news takes" data-tip="News takes generated by Google Gemini (gemini-2.5-flash-lite) from per-ticker reputable-publisher headlines. Runs once per daily refresh.">i</span> news takes.</p>
        </button>
        <button type="button" class="landing-card" data-go="f13" aria-label="View 13F filings">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">13F filings</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-f13">Q</div>
          <div class="landing-card-sub" id="land-sub-f13">institutional holdings</div>
          <p class="landing-card-desc">Quarterly snapshot of the largest 13F filers — top positions, biggest aggregate holdings, rotation themes.</p>
        </button>
        <button type="button" class="landing-card" data-go="fear-greed" aria-label="View Fear and Greed">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Fear &amp; Greed</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-fg">0–100</div>
          <div class="landing-card-sub" id="land-sub-fg">CNN sentiment gauge</div>
          <p class="landing-card-desc">The 7-indicator equity-market sentiment index — extreme fear has historically preceded rebounds.</p>
        </button>
        <button type="button" class="landing-card" data-go="streaks" aria-label="View green/red streaks">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Streaks</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-streaks">G/R</div>
          <div class="landing-card-sub" id="land-sub-streaks">daily runs</div>
          <p class="landing-card-desc">Current green or red daily-close streaks for every ticker, with counter-day tolerance bank.</p>
        </button>
        <button type="button" class="landing-card" data-go="bonds-usd" aria-label="Read bonds and USD primer">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Bonds &amp; USD</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-bonds">10Y / DXY</div>
          <div class="landing-card-sub" id="land-sub-bonds">yields + dollar</div>
          <p class="landing-card-desc">How Treasury yields and the dollar shape equity behavior — risk-on / risk-off, exporters, commodities.</p>
        </button>
      </div>
    </section>
    <section class="landing-section">
      <header class="landing-section-head">
        <h2 class="landing-section-title">Act</h2>
        <p class="landing-section-sub">Pull the trigger or check what you're already holding.</p>
      </header>
      <div class="landing-grid">
        <button type="button" class="landing-card" data-go="grade" aria-label="Grade a contract">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Grade a contract</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat">Score it</div>
          <div class="landing-card-sub">any chain</div>
          <p class="landing-card-desc">Spread, delta, theta + AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About AI conviction" data-tip="Conviction blends news sentiment (Gemini, gemini-2.5-flash-lite), fundamentals verdict (Gemini, gemini-2.5-flash-lite), technicals (RSI/MACD/volume — deterministic, no AI), and macro tilt. Recomputed each daily build.">i</span> conviction for any specific contract you're eyeing.</p>
        </button>
        <button type="button" class="landing-card" data-go="portfolio" aria-label="Open portfolio">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Portfolio</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat">Track</div>
          <div class="landing-card-sub">positions + AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About the AI portfolio review" data-tip="Portfolio review is generated by Google Gemini (gemini-2.5-flash-lite) from your current positions plus live Yahoo quotes. Runs on demand when you click 'AI review' — not on the daily build.">i</span> review</div>
          <p class="landing-card-desc">Save what you own, then ask the model for hold / sell / roll on each position.</p>
        </button>
      </div>
    </section>
    <p class="landing-foot">Or jump anywhere with the tab strip above · press <kbd>⌘K</kbd> for the command palette.</p>
  </div>
  <div class="page-pane" id="page-pane-tickers" role="tabpanel" aria-labelledby="page-tab-tickers" hidden>
  ${tickersSection({ symbols, sectors: SECTORS, industries: INDUSTRY_OF_TICKER })}
  </div>
  <div class="page-pane" id="page-pane-narratives" role="tabpanel" aria-labelledby="page-tab-narratives" hidden>
  ${narrativesSection()}
  </div>
  <div class="page-pane" id="page-pane-picks" role="tabpanel" aria-labelledby="page-tab-picks" hidden>
  ${topPicksSection()}
  </div>
  <div class="page-pane" id="page-pane-calendar" role="tabpanel" aria-labelledby="page-tab-calendar" hidden>
  ${calendarSection()}
  </div>
  <div class="page-pane" id="page-pane-flow" role="tabpanel" aria-labelledby="page-tab-flow" hidden>
  ${unusualFlowSection()}
  </div>
  <div class="page-pane" id="page-pane-grade" role="tabpanel" aria-labelledby="page-tab-grade" hidden>
  ${optionEvalSection()}
  </div>
  <div class="page-pane" id="page-pane-streaks" role="tabpanel" aria-labelledby="page-tab-streaks" hidden>
    <section class="card" id="streaks-section">
      <header class="card-header">
        <h2 class="card-title">Daily green / red streaks</h2>
        <span class="card-eyebrow" id="streaks-eyebrow" aria-live="polite"></span>
      </header>
      <p class="hint">Each ticker's current run of green or red daily closes. Streaks of 2+ days survive small counter days (a "tolerance bank" up to 1.5% cumulative, or up to 3 counter days in a row); a single counter day greater than 1.2%, hitting the 1.5% bank, or 4 counter days in a row breaks the run. Same-direction days heal the bank back to zero.</p>
      <div id="streaks-root" class="streaks-root">Loading streaks…</div>
      <div id="streaks-footer" class="streaks-footer"></div>
    </section>
  </div>
  <div class="page-pane" id="page-pane-fear-greed" role="tabpanel" aria-labelledby="page-tab-fear-greed" hidden>
    <section class="card" id="fng-section">
      <header class="card-header">
        <h2 class="card-title">CNN Fear &amp; Greed Index</h2>
        <span class="card-eyebrow" id="fng-eyebrow" aria-live="polite"></span>
      </header>
      <p class="hint">A 0–100 sentiment gauge built by CNN from seven equally-weighted indicators of US equity-market psychology. Low readings (extreme fear) have historically preceded rebounds; high readings (extreme greed) often mark overheated conditions. Refreshed each build from <a href="https://www.cnn.com/markets/fear-and-greed" target="_blank" rel="noopener noreferrer">cnn.com/markets/fear-and-greed</a>.</p>
      <div id="fng-root" class="fng-root">Loading Fear &amp; Greed…</div>
    </section>
  </div>
  <div class="page-pane" id="page-pane-bonds-usd" role="tabpanel" aria-labelledby="page-tab-bonds-usd" hidden>
    <section class="card" id="bonds-live-card">
      <header class="card-header">
        <h2 class="card-title">Live snapshot</h2>
        <span class="card-eyebrow" id="bonds-live-eyebrow">as of last build</span>
      </header>
      <div class="bonds-live-grid" id="bonds-live-grid">
        <!-- Populated client-side from window.STONKS_MANIFEST.macro -->
      </div>
      <p class="hint">Yields and DXY are taken from the last daily build; the educational notes below explain how each one moves equities.</p>
    </section>
    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Bonds, Treasury yields &amp; the US dollar</h2>
        <span class="card-eyebrow">Primer</span>
      </header>
      <p class="hint">A primer on how Treasury yields and the US Dollar Index (DXY) shape stock-market behavior. US Treasuries are debt securities issued by the US government and are considered among the safest financial assets in the world. They influence borrowing costs globally, impact stock-market valuations, affect mortgage and loan rates, drive risk-on / risk-off behavior, and shape the strength of the US dollar.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Types of US Treasuries</h2>
      </header>
      <table class="bonds-usd-table">
        <thead><tr><th>Type</th><th>Maturity</th><th>Interest payment</th></tr></thead>
        <tbody>
          <tr><td>T-Bills</td><td>4 weeks to 1 year</td><td>No coupon. Sold at discount, mature at face value.</td></tr>
          <tr><td>T-Notes</td><td>2 to 10 years</td><td>Semiannual interest payments.</td></tr>
          <tr><td>T-Bonds</td><td>20 to 30 years</td><td>Semiannual interest payments.</td></tr>
        </tbody>
      </table>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">2-Year Treasury yield</h2>
        <span class="card-eyebrow">Fed policy proxy</span>
      </header>
      <p class="hint">Most sensitive to current Federal Reserve policy. Reacts quickly to Fed rate hikes or cuts, reflects short-term interest-rate expectations, and is closely tied to monetary policy.</p>
      <p class="hint"><em>Higher 2-year yields</em> generally tighten financial conditions, hurt growth stocks and speculative assets, and make bonds more attractive relative to equities. Example: if the 2-year yields 5%, investors may prefer a guaranteed return over taking stock-market risk.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">10-Year Treasury yield</h2>
        <span class="card-eyebrow">Benchmark</span>
      </header>
      <p class="hint">The benchmark yield and arguably the most important Treasury rate. Influences 30-year mortgage rates, corporate borrowing costs, stock valuations, consumer loans, and the discount rate used for equities.</p>
      <p class="hint"><em>Higher 10-year yields</em> pressure stock valuations, increase borrowing costs, reduce future-earnings valuations, and tighten credit conditions.</p>
      <p class="hint"><em>Lower 10-year yields</em> support growth stocks, encourage borrowing and investing, and improve liquidity conditions.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">30-Year Treasury yield</h2>
        <span class="card-eyebrow">Long-term inflation</span>
      </header>
      <p class="hint">A gauge for long-term inflation expectations and fiscal sustainability. Sensitive to government deficits, long-term inflation expectations, pension and insurance demand, and global risk sentiment.</p>
      <p class="hint"><em>Higher 30-year yields</em> can signal inflation concerns, fiscal stress, or weak demand for long-duration bonds.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Treasury yields &amp; the stock market</h2>
      </header>
      <p class="hint">Higher Treasury yields make bonds more attractive relative to stocks. As yields rise, investors may move from stocks into bonds, borrowing becomes more expensive, corporate investment slows, credit conditions tighten, and interest on new loans increases.</p>
      <p class="hint">Risk assets often struggle when Treasury yields rise rapidly, when the Federal Reserve hikes interest rates, or when liquidity conditions tighten.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">US Dollar strength (DXY)</h2>
        <span class="card-eyebrow">Overview</span>
      </header>
      <p class="hint">The US Dollar Index (DXY) measures the strength of the US dollar relative to a basket of foreign currencies. Dollar strength has major effects on corporate earnings, commodity prices, emerging markets, global liquidity, and risk appetite.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Stronger US dollar (rising DXY)</h2>
        <span class="card-eyebrow">Bearish for stocks</span>
      </header>
      <p class="hint"><em>Multinational earnings take a hit.</em> Approximately 40% of S&amp;P 500 revenue comes from overseas. A stronger dollar means foreign earnings convert into fewer US dollars, and reported earnings decline.</p>
      <p class="hint"><em>US exports become more expensive.</em> American goods become less competitive globally — a headwind for exporters, industrial companies, and manufacturing sectors.</p>
      <p class="hint"><em>Commodities often fall.</em> Commodities are priced in USD, so a stronger dollar typically pressures energy, materials, agriculture, and metals.</p>
      <p class="hint"><em>Emerging markets suffer.</em> Borrowing in USD becomes more expensive — capital outflows, higher debt stress, and weakening foreign currencies follow.</p>
      <p class="hint"><em>Higher yields often accompany a stronger dollar.</em> The combination makes risk assets less attractive.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Weaker US dollar (falling DXY)</h2>
        <span class="card-eyebrow">Bullish for stocks</span>
      </header>
      <p class="hint"><em>Good for stocks.</em> Supports earnings growth, global liquidity, and risk appetite.</p>
      <p class="hint"><em>Boosts multinational earnings.</em> Foreign earnings convert into more US dollars — positive for large multinationals, technology companies, and global consumer brands.</p>
      <p class="hint"><em>US exports become cheaper.</em> American goods become more competitive internationally.</p>
      <p class="hint"><em>Commodities often rise.</em> A weaker dollar is a major tailwind for gold, industrials, materials, and energy.</p>
      <p class="hint"><em>Emerging markets &amp; international stocks perform better.</em> Foreign assets become worth more in USD terms — supportive for international equities, EM, and foreign currencies.</p>
      <p class="hint"><em>Easier global financial conditions.</em> Encourages risk-on behavior across markets.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Winners during weak-dollar environments</h2>
      </header>
      <ul class="bonds-usd-list">
        <li>Multinationals</li>
        <li>Exporters</li>
        <li>Cyclicals</li>
        <li>Commodities</li>
        <li>International stocks</li>
        <li>Emerging markets</li>
      </ul>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Dollar &amp; stock-market relationship</h2>
        <span class="card-eyebrow">Caveats</span>
      </header>
      <p class="hint">The relationship is not always perfectly inverse.</p>
      <p class="hint"><em>Strong growth periods.</em> Sometimes stocks and the dollar rise together — this can occur during strong US economic growth.</p>
      <p class="hint"><em>Risk-off environments.</em> Typically the dollar rises while stocks fall — investors seek safety in USD assets.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Gold &amp; dollar inverse correlation</h2>
      </header>
      <p class="hint"><em>Gold is priced in USD.</em> A stronger dollar makes gold more expensive for foreign buyers and less attractive globally.</p>
      <p class="hint"><em>Gold pays no yield.</em> A stronger dollar often comes with higher interest rates and higher Treasury yields, which increases the opportunity cost of holding gold.</p>
      <p class="hint"><em>The dollar competes with gold as a safe haven.</em> When investors seek safety, capital can flow into either USD or gold — a strengthening dollar often pressures gold prices.</p>
    </section>

    <section class="card">
      <header class="card-header">
        <h2 class="card-title">Summary</h2>
        <span class="card-eyebrow">TL;DR</span>
      </header>
      <p class="hint"><em>Weak dollar</em> — generally bullish for stocks, bullish for commodities, supportive of risk assets. Weak dollar + falling yields often supports strong bull-market rallies.</p>
      <p class="hint"><em>Strong dollar</em> — generally bearish for stocks, tightens financial conditions, hurts risk assets. Strong dollar + rising Treasury yields can create severe market stress.</p>
    </section>
  </div>
  <div class="page-pane" id="page-pane-f13" role="tabpanel" aria-labelledby="page-tab-f13" hidden>
  ${f13Section()}
  </div>
  <div class="page-pane" id="page-pane-portfolio" role="tabpanel" aria-labelledby="page-tab-portfolio" hidden>
    <section class="card"><p class="hint">Loading portfolio…</p></section>
  </div>
</main>
<footer class="site-footer">
  <div>Built <span class="muted">${builtAt} (NY)</span></div>
  <div class="muted">Greeks computed locally with Black-Scholes. Data: Yahoo Finance. For information only — not investment advice.</div>
  <div><a href="https://github.com/lilseancoc-png/stonks" target="_blank" rel="noopener">Source on GitHub</a></div>
</footer>
<div id="cmd-palette" class="cmd-palette" hidden role="dialog" aria-modal="true" aria-labelledby="cmd-palette-title">
  <div class="cmd-palette-backdrop" data-cmd-close></div>
  <div class="cmd-palette-modal" role="document">
    <h2 id="cmd-palette-title" class="cmd-palette-srtitle">Command palette</h2>
    <div class="cmd-palette-input-wrap">
      <svg class="cmd-palette-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="text" id="cmd-palette-input" placeholder="Jump to ticker, narrative, or tab…" autocomplete="off" spellcheck="false" aria-controls="cmd-palette-results" aria-expanded="true" />
      <kbd class="cmd-palette-kbd">esc</kbd>
    </div>
    <ul id="cmd-palette-results" class="cmd-palette-results" role="listbox" aria-label="Command palette results"></ul>
    <div class="cmd-palette-footer">
      <span><kbd>↑↓</kbd> navigate</span>
      <span><kbd>↵</kbd> open</span>
      <span><kbd>esc</kbd> close</span>
    </div>
  </div>
</div>
<script>window.STONKS_MANIFEST=${manifestPayload};<\/script>
<script>window.STONKS_SUPABASE=${supabasePayload};<\/script>
<script src="app.js?v=${cacheBust}" defer></script>
<script type="module" src="js/portfolio.js?v=${cacheBust}"></script>
<script type="module" src="js/streaks.js?v=${cacheBust}"></script>
</body>
</html>`;
}
