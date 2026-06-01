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
        <input type="search" id="tickers-search" class="tickers-search" placeholder="Search ticker…" autocomplete="off" aria-label="Search tickers" />
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
    <div id="picks-market-note" class="picks-market-note" role="status" aria-live="polite" hidden></div>
    <div class="picks-search" role="search">
      <label class="picks-search-label" for="picks-search-input">Grade any ticker</label>
      <div class="combo picks-search-combo" id="picks-search-combo">
        <input type="text" id="picks-search-input" role="combobox"
               aria-expanded="false" aria-controls="picks-search-listbox"
               aria-autocomplete="list"
               aria-label="Search any tracked ticker to see its 4-pillar grade and conviction"
               placeholder="Search a symbol or sector — e.g. AAPL, NVDA, Energy…"
               autocomplete="off" spellcheck="false">
        <button type="button" class="combo-clear" id="picks-search-clear" aria-label="Clear" tabindex="-1">&times;</button>
        <ul id="picks-search-listbox" role="listbox" hidden></ul>
      </div>
      <p class="picks-search-hint">See the full 4-pillar grade &amp; conviction for any of the tracked tickers &mdash; not just today&rsquo;s top picks.</p>
    </div>
    <div id="picks-listview" class="picks-listview">
    <p class="hint">A 4-pillar scoring system. Every signal scores from -3 to +3, signals roll up into <b>Fundamentals</b>, <b>Technicals</b>, <b>Mechanicals</b>, and <b>Narrative</b>, and the four pillar scores sum to a total. Tiers: <b>+20 or higher</b> Strong Call (Very High conviction, Load the Boat), <b>+16&nbsp;to&nbsp;+19</b> Call (High, standard size), <b>-15 to +15</b> No Trade (skipped), <b>-16 to -19</b> Put (High, standard size), <b>-20 or lower</b> Strong Put (Very High, Load the Boat). Each card has a <b>Recommendation&nbsp;&#8644;&nbsp;Grade</b> toggle &mdash; flip to Grade to audit every signal that produced the score, right next to the call. Each pick also carries a <b>named entry strategy</b> (a scale-in plan with confluence buy zones) and a layered exit ladder with an action at every level, plus how it stacks up against same-sector peers. The <b>Track record</b> tab grades past picks against what actually happened.</p>
    <details class="picks-howto">
      <summary>How the 4-pillar score works &rarr;</summary>
      <div class="picks-howto-body">
        <p><b>Fundamentals (9 signals).</b> Earnings surprise (beat/miss &gt;25% &plusmn;2, 1-24% &plusmn;1), EPS growth YoY +1 / -2, revenue growth YoY +1 / -2, analyst price target &plusmn;1, P/E vs sector median &plusmn;1, guidance (raised +3, in line +2, lowered -3), major contract +2 / -3, free cash flow TTM &plusmn;1 (positive / negative), net margin growth &plusmn;1 (expanding / contracting QoQ).</p>
        <p><b>Technicals (12 signals).</b> RSI 14 &plusmn;1, MACD &plusmn;1, current streak &plusmn;1, broke 20d support/resistance &plusmn;1, broke 50d S/R &plusmn;1, broke 100d S/R &plusmn;2, 52-week proximity (high -1 / low +1, contrarian read), volume confirmation &plusmn;1 (relative volume &ge;1.3x the 20d average = +1, low volume &lt;0.8x = -1), the moving-average stack &mdash; price above/below the 20d SMA &plusmn;1, 50d SMA &plusmn;1, 100d SMA &plusmn;2 &mdash; and an AI-identified chart pattern &plusmn;1 (&plusmn;2 at high confidence), one of 7 classic formations (Cup and Handle, Head and Shoulders, Inverse Head and Shoulders, Bull Flag, Ascending Triangle, Descending Triangle, Double Bottom) read off the daily chart, bullish patterns positive / bearish negative.</p>
        <p><b>Mechanicals (8 signals).</b> Unusual flow &plusmn;1, open interest C/P ratio &plusmn;1, short interest &plusmn;1 (high short + rising stock = squeeze +1, short interest rising month-over-month = -1, falling = +1), unusual volume &plusmn;1 (underlying hourly volume &ge;1.3x its 20d-average hourly volume, direction from the move), SPY flows &plusmn;1 (a move &ge;0.6% sets risk-on +1 / risk-off -1; flat = 0), put/call ratio extreme &plusmn;1 (contrarian: P/C &gt;1.25 = fear &rarr; +1, &lt;0.65 = greed &rarr; -1), VIX tracking (rising &amp; &gt;25 = -2, falling = +1), VIX spot (&lt;15 = -1 complacency, &gt;35 = +2 capitulation).</p>
        <p><b>Narrative (8 signals).</b> Positive catalyst +3 / 0, sector tailwind/headwind &plusmn;2, social sentiment &plusmn;1, media coverage surge &plusmn;1, negative catalyst 0 / -3, macro tail/headwinds +1 / -2 (tariffs, regulation, war, Fed, trade policy), DXY 1-day move (&ge;0.9%: strong dollar -2 / weak dollar +1), 10-year yield 1-day move (&ge;13 bps: rising -2 / falling +1).</p>
        <p><b>Suggested contract criteria.</b> 5-30% OTM, delta 0.20-0.40, IV &lt;200%, &ge;14 days to expiry, standard monthly expirations only (third Friday), premium &le;$35/share (&le;$3,500 / contract), tight spread, liquid. The "In plain English" panel under each contract translates the bet into beginner terms.</p>
        <p><b>Entry plan.</b> Each pick matches one of six named strategies to the current setup &mdash; <b>Pullback to Confluence</b>, <b>Breakout + Retest</b>, <b>Moving-Average Pullback</b>, <b>Support + Confirmation</b>, <b>RSI + Divergence</b>, or <b>Volume Breakout</b> &mdash; then lays out whether to take a full position or scale in over 2-4 tranches and the exact confluence prices to buy at (best entries cluster where support, a moving average, and volume all line up). The default is the spec&rsquo;s 50% at the first signal + 50% on confirmation, and entries never sit beyond the exit cut. A <b>&#9873; 50D SMA</b> chip flags the prime case: a &plusmn;20-graded name sitting right on its 50-day moving average.</p>
        <p><b>Exit plan.</b> Each pick carries a <b>layered price ladder</b> &mdash; multiple meaningful levels on the way up and down from spot, each with a clear action (trim, take 60-70% off, reduce, cut) and the Technical / Fundamental / Mechanical / Narrative reasoning that makes that level significant. Interim levels flag what to watch as price approaches (e.g. a gap through resistance on heavy volume opening the next level). All levels are dynamic to the current spot and the recommended strike/expiry, plus contextual exit triggers (earnings-in-window IV-crush risk, stretched RSI, time stops).</p>
        <p><b>Risk.</b> Buying a call or put can lose <i>at most</i> the premium you pay &mdash; but can lose all of it if the stock doesn&rsquo;t move enough in your direction before expiry. None of this is financial advice; the picks are a starting watchlist, not a recommendation to trade.</p>
      </div>
    </details>
    <div class="picks-controls" role="toolbar" aria-label="Sort top picks">
      <label class="picks-sort">
        <span class="picks-sort-label">Sort</span>
        <select id="picks-sort-select" aria-label="Sort top picks">
          <option value="conviction">Highest conviction</option>
          <option value="alpha">A → Z</option>
          <option value="sector">Sector</option>
          <option value="side">Side (calls first)</option>
          <option value="dte">Soonest expiry</option>
          <option value="breakeven">Smallest move to breakeven</option>
          <option value="premium">Cheapest premium</option>
        </select>
      </label>
    </div>
      <div id="picks-summary" class="picks-summary"></div>
      <div id="picks-grid" class="picks-grid">Loading top picks…</div>
      <div id="picks-empty" class="picks-empty" hidden>No actionable picks in this build — every ticker scored in the No Trade band (-15 to +15).</div>
      <p class="picks-foot">Picks rebuild from scratch on every daily refresh. Each pick clears the |total|&nbsp;&ge;&nbsp;16 actionable threshold and a tradeable contract that fits the suggested-contract criteria above.</p>
    </div>
    <div id="picks-detail" class="picks-detail" hidden>
      <button type="button" id="picks-back" class="picks-back">&larr;&nbsp;All picks</button>
      <div id="picks-detail-card" class="picks-detail-card"></div>
    </div>
  </section>`;
}

function trackRecordSection() {
  // Skeleton chrome only — renderAccuracy() in app.js fetches
  // data/picks-accuracy.json lazily on first tab activation and fills the
  // containers in. The tracker grades whether each past pick's SCORE actually
  // predicted the move, so we can see if the judgment held up.
  return `<section class="card" id="accuracy-section">
    <header class="card-header">
      <h2 class="card-title">Pick track record</h2>
      <span class="card-eyebrow" id="accuracy-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">The five strongest Top Picks each refresh are logged and marked to market. A pick <b>resolves</b> when the underlying reaches its take-profit (<span class="acc-ok">win</span>), hits its cut (<span class="acc-bad">loss</span>), expires (graded vs. breakeven), or hits a 14-day time-stop. The <b>win rate by tier</b> asks whether higher-conviction scores actually win more. <b>Grade changes</b> logs every ticker whose grade moves up or down (and why); each pick&rsquo;s <b>Day&nbsp;0 / 2wk / 1mo</b> checkpoints show whether the price moved the way the score predicted. Build cadence (~3 checks/day), not intraday.</p>
    <div id="accuracy-stats" class="accuracy-stats"></div>
    <div id="accuracy-grade-log" class="accuracy-grade-log"></div>
    <div id="accuracy-root" class="accuracy-root">Loading track record…</div>
    <div id="accuracy-empty" class="accuracy-empty" hidden>No picks have been tracked yet — the record starts filling in on the next daily refresh.</div>
    <p class="picks-foot">Track record is informational, not a performance claim: it follows the underlying stock against each pick&rsquo;s own take-profit / cut levels, not the realised option P&amp;L, and samples only at build time. Not financial advice.</p>
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
    <p class="hint">Confirmed earnings dates (with AM/PM session tagging) for every curated ticker, ticker-specific catalysts (FDA dates, contract decisions, product launches, court rulings, investor days — extracted from recent news), structured economic-report releases (NFP, Unemployment, JOLTS, CPI, PPI) with Actual / Previous / Consensus / Forecast values, upcoming FOMC meetings, and the current effective Fed Funds rate plus CME FedWatch hike/hold/cut probabilities at four lookbacks.</p>
    <div id="fomc-widget" class="fomc-widget" hidden></div>
    <div class="calendar-controls" role="toolbar" aria-label="Filter calendar">
      <div class="calendar-type-filter" role="radiogroup" aria-label="Filter by event type">
        <button type="button" class="calendar-pill is-on" data-cal-type="all" role="radio" aria-checked="true">All</button>
        <button type="button" class="calendar-pill" data-cal-type="earnings" role="radio" aria-checked="false">Earnings</button>
        <button type="button" class="calendar-pill" data-cal-type="catalysts" role="radio" aria-checked="false">Catalysts</button>
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
            <option value="volume">Most total volume</option>
            <option value="premium">Biggest premium</option>
            <option value="repeats">Most 🔥 repeats</option>
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

function oiTrackerSection() {
  // Card shell only — per-ticker rows render client-side from
  // MANIFEST.oi (populated by scripts/scan-oi.mjs). Twice-daily scan,
  // front 2 expirations (this week + next week).
  return `<section class="card oi-card" id="oi-section">
    <header class="card-header oi-card-header">
      <button type="button" id="oi-collapse" class="oi-collapse-btn" aria-expanded="true" aria-controls="oi-body" title="Collapse section">
        <svg class="oi-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <h2 class="card-title">Near-term OI &amp; gamma squeeze</h2>
      </button>
      <span class="card-eyebrow" id="oi-eyebrow" aria-live="polite"></span>
    </header>
    <div id="oi-body" class="oi-body">
      <p class="hint">Top 12 highest open-interest strikes (calls + puts) across this week's and next week's expirations, laid out as an <strong>options ladder</strong> — calls and puts grouped on their own sides, each sorted closest-to-spot first and extending outwards. Each ticker carries a <strong>Gamma Squeeze Score</strong> (0–5): heavy near-the-money call OI · C/P ratio ≥ 2:1 · call wall Vol/OI ≥ 1.5× · spot within 10% of the call wall · aggressive ask-side call flow today. A score of <strong>4–5</strong> flags a potential setup. Strikes with <strong>OI &gt; 1000</strong> get a chip; ΔOI day-over-day chips fire at <strong>+30%</strong> (new buying) and <strong>+100%</strong> (very aggressive). Twice-daily scan: pre-market (~08:30 ET) and EOD (~19:00 ET).</p>
      <div class="oi-controls" role="toolbar" aria-label="Filter OI tracker">
        <label class="oi-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" id="oi-search-input" placeholder="Search ticker (e.g. NVDA, TSLA)" autocomplete="off" spellcheck="false" />
          <button type="button" id="oi-search-clear" class="oi-search-clear" aria-label="Clear search" hidden>&times;</button>
        </label>
        <label class="oi-toggle">
          <input type="checkbox" id="oi-flagged-only" />
          <span>Flagged only (score ≥ 4)</span>
        </label>
        <label class="oi-sort">
          <span class="oi-sort-label">Sort</span>
          <select id="oi-sort-select" aria-label="Sort">
            <option value="score">Gamma score</option>
            <option value="oi">Total OI</option>
            <option value="cp">Highest C/P ratio</option>
            <option value="delta">Biggest ΔOI %</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <button type="button" id="oi-expand-toggle" class="oi-action-btn" aria-pressed="false">Expand all</button>
      </div>
      <div id="oi-list" class="oi-list" role="list"></div>
      <div id="oi-empty" class="oi-empty" hidden>Waiting for the first OI scan to land.</div>
      <div id="oi-no-results" class="oi-empty" hidden>No tickers match these filters.</div>
    </div>
  </section>`;
}

function volumeFlagsSection() {
  // Card shell only — the per-ticker rows render client-side from
  // MANIFEST.volumeFlags (populated by scripts/scan-unusual.mjs's volume
  // pass). See lib/volume-flags.mjs for the flag classification rules.
  return `<section class="card vol-card" id="vol-section">
    <header class="card-header">
      <h2 class="card-title">Volume &amp; S/R breaks</h2>
      <span class="card-eyebrow" id="vol-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Hourly volume vs the U-shaped 25/14/11/11/14/25% intraday distribution: tickers trading at <strong>≥1.2×</strong> their expected hour-bucket volume are flagged. At/after 16:00 ET, full-day volume <strong>≥1.3×</strong> the 20D average flags as EOD. When spot crosses the 20D support or resistance line, the break is confirmed against the same hour's vol ratio — Strong Alert (≥1.3×), Watch (0.8–1.3×), or Likely Fakeout (&lt;0.8×).</p>
    <p class="hint">Each row reads <em>Vol actual / expected · ratio</em> — shares traded in that bucket vs. the bucket's share of the 20-day average, and the multiple between them. The trailing % is the price change across the bucket. A flag leans <span class="vol-key-up">bullish</span> when price is up on heavy volume (real demand) and <span class="vol-key-dn">bearish</span> when price is down on heavy volume (real selling pressure).</p>
    <div class="vol-controls" role="toolbar" aria-label="Filter volume flags">
      <label class="vol-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="vol-search-input" placeholder="Search ticker (e.g. NVDA, TSLA)" autocomplete="off" spellcheck="false" />
        <button type="button" id="vol-search-clear" class="vol-search-clear" aria-label="Clear search" hidden>&times;</button>
      </label>
      <div class="vol-filter" role="radiogroup" aria-label="Filter by flag type">
        <button type="button" class="vol-pill is-on" data-vol-filter="all" role="radio" aria-checked="true">All</button>
        <button type="button" class="vol-pill" data-vol-filter="hourly" role="radio" aria-checked="false">Hourly</button>
        <button type="button" class="vol-pill" data-vol-filter="sr" role="radio" aria-checked="false">S/R breaks</button>
        <button type="button" class="vol-pill" data-vol-filter="eod" role="radio" aria-checked="false">EOD</button>
      </div>
      <label class="vol-sort">
        <span class="vol-sort-label">Sort</span>
        <select id="vol-sort-select" aria-label="Sort volume flags">
          <option value="ratio">Hottest hour ratio</option>
          <option value="eod">EOD day ratio</option>
          <option value="dayvol">Day volume</option>
          <option value="move">Largest day move</option>
          <option value="sr">S/R break conviction</option>
          <option value="alpha">A → Z</option>
        </select>
      </label>
    </div>
    <div id="vol-list" class="vol-list" role="list"></div>
    <div id="vol-empty" class="vol-empty" hidden>No volume or S/R-break flags in the latest scan.</div>
    <div id="vol-no-results" class="vol-empty" hidden>No tickers match these filters.</div>
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
               aria-label="Search ticker or sector to grade a contract"
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
    <div id="opt-toppick" class="opt-toppick" hidden aria-live="polite" aria-label="Top Picks grade for this ticker"></div>
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
          <p class="opt-tech-foot">Indicators are computed at build time from ~1 year of Yahoo daily closes. Use them as context for your option strike pick — they describe the stock, not the contract itself.</p>
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
          <li><b>Delta:</b> Balanced (0.40&ndash;0.70), Slightly OTM (0.30&ndash;0.40), OTM (0.15&ndash;0.30), Deep ITM (&gt;0.70), Far OTM (&lt;0.15). <em>Assumes a single-leg directional buy</em> — spread sellers (credit spreads, iron condors) read these bands inverted and should ignore the delta grade.</li>
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

function strategiesSection() {
  // Multi-leg options strategy builder. The card shell is static; everything
  // inside #strat-templates, #strat-legs-list, #strat-results is populated
  // by the Strategies module in app-js.mjs once a ticker is picked. Chains
  // and technicals are loaded via the same fetchChain() helper Grade uses
  // — no new data files.
  return `<section class="card strat-card" id="strat-section">
    <header class="card-header">
      <h2 class="card-title">Options strategies</h2>
      <span class="card-eyebrow" id="strat-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Build multi-leg strategies — buy or sell calls and puts together. Pick a template or compose by hand, and we'll add up the greeks, sketch the expiration payoff, and score the structure against this ticker's technicals + IV rank.</p>
    <div class="strat-controls">
      <div class="combo" id="strat-symbol-combo">
        <input type="text" id="strat-symbol-input" role="combobox"
               aria-expanded="false" aria-controls="strat-symbol-listbox"
               aria-autocomplete="list"
               aria-label="Search ticker or sector for strategies"
               placeholder="Search ticker or sector…"
               autocomplete="off" spellcheck="false">
        <button type="button" class="combo-clear" id="strat-symbol-clear" aria-label="Clear" tabindex="-1">&times;</button>
        <ul id="strat-symbol-listbox" role="listbox" hidden></ul>
      </div>
      <button type="button" class="strat-btn-ghost" id="strat-clear" hidden>Clear strategy</button>
    </div>
    <div id="strat-status" class="opt-status" role="status"></div>
    <div id="strat-ticker-meta" class="strat-ticker-meta" hidden aria-live="polite"></div>
    <div id="strat-templates" class="strat-templates" hidden>
      <h3 class="strat-section-title">Strategy templates</h3>
      <div class="strat-tpl-groups">
        <div class="strat-tpl-group">
          <div class="strat-tpl-group-head">Directional</div>
          <div class="strat-tpl-chips" id="strat-tpl-directional"></div>
        </div>
        <div class="strat-tpl-group">
          <div class="strat-tpl-group-head">Volatility</div>
          <div class="strat-tpl-chips" id="strat-tpl-volatility"></div>
        </div>
        <div class="strat-tpl-group">
          <div class="strat-tpl-group-head">Range &amp; neutral</div>
          <div class="strat-tpl-chips" id="strat-tpl-neutral"></div>
        </div>
        <div class="strat-tpl-group">
          <div class="strat-tpl-group-head">Income</div>
          <div class="strat-tpl-chips" id="strat-tpl-income"></div>
        </div>
      </div>
      <p class="strat-tpl-foot">Templates auto-populate the legs below using strikes nearest ATM and the nearest expiration. Tweak any leg afterwards.</p>
    </div>
    <div id="strat-legs" class="strat-legs" hidden>
      <header class="strat-legs-head">
        <h3 class="strat-section-title">Legs <span class="strat-leg-counter" id="strat-leg-count">0</span></h3>
        <div class="strat-legs-actions">
          <button type="button" class="strat-btn-ghost" id="strat-add-leg">+ Add leg</button>
        </div>
      </header>
      <div id="strat-legs-list" class="strat-legs-list" role="list"></div>
    </div>
    <div id="strat-results" class="strat-results" hidden>
      <header class="strat-results-head">
        <div class="strat-results-head-left">
          <h3 class="strat-section-title" id="strat-name">Custom strategy</h3>
          <span class="strat-bias" id="strat-bias"></span>
        </div>
        <div class="strat-score-wrap" id="strat-score-wrap" hidden>
          <span class="strat-score-label">Strategy score</span>
          <span class="strat-score-chip" id="strat-score-chip"></span>
        </div>
      </header>
      <div id="strat-summary" class="strat-summary"></div>
      <div class="strat-results-body">
        <div class="strat-payoff-wrap">
          <div class="strat-payoff-head">
            <div class="strat-payoff-title">Payoff at expiration</div>
            <div class="strat-payoff-axis" id="strat-payoff-axis"></div>
          </div>
          <div id="strat-payoff" class="strat-payoff"></div>
        </div>
        <div class="strat-greeks-wrap">
          <div class="strat-greeks-title">Net greeks</div>
          <div id="strat-greeks" class="strat-greeks"></div>
          <div class="strat-score-explain" id="strat-score-explain" hidden></div>
        </div>
      </div>
      <p class="strat-foot">Payoff is plotted at the nearest leg's expiration. For calendar spreads the far leg is repriced with Black-Scholes at that instant using its chain IV. Max gain / loss labelled "unlimited" when a naked leg leaves one side open.</p>
    </div>
  </section>`;
}

export function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], sectorOverviews = {}, recentlyEnded = [], macroHeadlines = [], unusual = null, spots = {}, fearGreed = null, macro = null, volumeFlags = null, marketBackdrop = null, nextFomcDates = [], oi = null }) {
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
    volumeFlags: volumeFlags || null,
    marketBackdrop: marketBackdrop || null,
    nextFomcDates: Array.isArray(nextFomcDates) ? nextFomcDates : [],
    oi: oi || null,
  }).replace(/</g, "\\u003C").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500;1,9..144,600&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css?v=${cacheBust}">
</head>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="/" aria-label="stonks home">
      <svg class="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="3.3" fill="currentColor"/>
        <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.4 2.6" opacity="0.55"/>
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
  <span id="market-status" class="market-status" aria-live="off" hidden></span>
</div>
<nav class="page-tabs" role="tablist" aria-label="Page sections">
  <button type="button" class="page-tab" role="tab" data-page-tab="home" aria-selected="true" aria-controls="page-pane-home" id="page-tab-home">Home</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="tickers" aria-selected="false" aria-controls="page-pane-tickers" id="page-tab-tickers">Tickers</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="narratives" aria-selected="false" aria-controls="page-pane-narratives" id="page-tab-narratives">Narratives</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="picks" aria-selected="false" aria-controls="page-pane-picks" id="page-tab-picks">Top picks</button>
  <button type="button" class="page-tab" role="tab" data-page-tab="track" aria-selected="false" aria-controls="page-pane-track" id="page-tab-track">Track record</button>
  <div class="page-tab-group" data-group="flow">
    <button type="button" class="page-tab page-tab-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="page-tab-menu-flow" id="page-tab-trigger-flow">
      <span class="page-tab-trigger-label">Flow</span>
      <svg class="page-tab-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  <div class="page-tab-group" data-group="macro">
    <button type="button" class="page-tab page-tab-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="page-tab-menu-macro" id="page-tab-trigger-macro">
      <span class="page-tab-trigger-label">Macro</span>
      <svg class="page-tab-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  <div class="page-tab-group" data-group="tools">
    <button type="button" class="page-tab page-tab-trigger" aria-haspopup="menu" aria-expanded="false" aria-controls="page-tab-menu-tools" id="page-tab-trigger-tools">
      <span class="page-tab-trigger-label">Tools</span>
      <svg class="page-tab-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
</nav>
<!-- Dropdown menus live outside .page-tabs so the strip's edge-fade
     mask-image doesn't clip them. The triggers link to these menus via
     aria-controls + getElementById — keeping the markup colocated near the
     nav still reads cleanly, just escapes the stacking context. -->
<div class="page-tab-menus" data-group-menus>
  <div class="page-tab-menu" role="menu" id="page-tab-menu-flow" aria-labelledby="page-tab-trigger-flow" data-group="flow" hidden>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="heatmap" aria-controls="page-pane-heatmap" id="page-tab-heatmap">Heatmap</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="flow" aria-controls="page-pane-flow" id="page-tab-flow">Unusual flow</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="volume" aria-controls="page-pane-volume" id="page-tab-volume">Volume</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="oi" aria-controls="page-pane-oi" id="page-tab-oi">Gamma OI</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="streaks" aria-controls="page-pane-streaks" id="page-tab-streaks">Streaks</button>
  </div>
  <div class="page-tab-menu" role="menu" id="page-tab-menu-macro" aria-labelledby="page-tab-trigger-macro" data-group="macro" hidden>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="calendar" aria-controls="page-pane-calendar" id="page-tab-calendar">Calendar</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="fear-greed" aria-controls="page-pane-fear-greed" id="page-tab-fear-greed">Fear &amp; Greed</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="bonds-usd" aria-controls="page-pane-bonds-usd" id="page-tab-bonds-usd">Bonds &amp; USD</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="f13" aria-controls="page-pane-f13" id="page-tab-f13">13F filings</button>
  </div>
  <div class="page-tab-menu" role="menu" id="page-tab-menu-tools" aria-labelledby="page-tab-trigger-tools" data-group="tools" hidden>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="grade" aria-controls="page-pane-grade" id="page-tab-grade">Grade a contract</button>
    <button type="button" class="page-tab-menu-item" role="menuitem" data-page-tab="strategies" aria-controls="page-pane-strategies" id="page-tab-strategies">Strategies</button>
    <a class="page-tab-menu-item" role="menuitem" href="/cheatsheet.html" style="text-decoration:none">Buyer's manual</a>
  </div>
</div>
<main>
  <div class="page-pane" id="page-pane-home" role="tabpanel" aria-labelledby="page-tab-home">
    <section class="landing-hero">
      <span class="landing-hero-eyebrow">Today's desk</span>
      <h1 class="landing-hero-title">What do you want to look at?</h1>
      <p class="landing-hero-sub">${tickerCount} curated tickers</p>
      <div id="landing-pulse" class="landing-pulse" role="list" aria-label="Market pulse — major index ETFs, last close" hidden></div>
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
        <p class="landing-section-sub">Pull the trigger on a specific contract you're eyeing.</p>
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
  <div class="page-pane" id="page-pane-track" role="tabpanel" aria-labelledby="page-tab-track" hidden>
  ${trackRecordSection()}
  </div>
  <div class="page-pane" id="page-pane-heatmap" role="tabpanel" aria-labelledby="page-tab-heatmap" hidden>
    <section class="card" id="heatmap-section">
      <header class="card-header">
        <h2 class="card-title">Market heatmap</h2>
        <span class="card-eyebrow" id="heatmap-eyebrow" aria-live="polite"></span>
      </header>
      <p class="hint">A Finviz-style market map of our curated tickers. Each tile is sized by market cap and colored by today's % change — deeper green for bigger gainers, deeper red for bigger losers. Grouped by sector. Scroll to zoom (or use the zoom controls), drag to pan when zoomed in, and click a tile to jump to that ticker. ETFs are surfaced on the Bonds &amp; USD tab.</p>
      <div class="heatmap-controls" role="toolbar" aria-label="Heatmap controls">
        <label class="heatmap-control">
          <span class="heatmap-control-label">Group by</span>
          <select id="heatmap-group-select" aria-label="Group heatmap by">
            <option value="sector">Sector</option>
            <option value="industry">Industry</option>
          </select>
        </label>
        <label class="heatmap-control heatmap-live-toggle">
          <input type="checkbox" id="heatmap-live-toggle" />
          <span class="heatmap-control-label">Live overlay</span>
        </label>
        <div class="heatmap-control heatmap-zoom" role="group" aria-label="Zoom">
          <span class="heatmap-control-label">Zoom</span>
          <button type="button" class="heatmap-zoom-btn" id="heatmap-zoom-out" aria-label="Zoom out" disabled>&minus;</button>
          <span class="heatmap-zoom-level" id="heatmap-zoom-level" aria-live="polite">100%</span>
          <button type="button" class="heatmap-zoom-btn" id="heatmap-zoom-in" aria-label="Zoom in">+</button>
          <button type="button" class="heatmap-zoom-btn heatmap-zoom-reset" id="heatmap-zoom-reset" aria-label="Reset zoom" disabled>Reset</button>
        </div>
        <span class="heatmap-live-state" id="heatmap-live-state" aria-live="polite"></span>
      </div>
      <div id="heatmap-root" class="heatmap-root">Loading heatmap…</div>
      <div class="heatmap-legend" aria-hidden="true">
        <span class="heatmap-legend-label">−3%</span>
        <span class="heatmap-legend-bar"></span>
        <span class="heatmap-legend-label">+3%</span>
      </div>
      <div id="heatmap-eod-summary" class="heatmap-eod-summary" hidden></div>
    </section>
  </div>
  <div class="page-pane" id="page-pane-calendar" role="tabpanel" aria-labelledby="page-tab-calendar" hidden>
  ${calendarSection()}
  </div>
  <div class="page-pane" id="page-pane-flow" role="tabpanel" aria-labelledby="page-tab-flow" hidden>
  ${unusualFlowSection()}
  </div>
  <div class="page-pane" id="page-pane-volume" role="tabpanel" aria-labelledby="page-tab-volume" hidden>
  ${volumeFlagsSection()}
  </div>
  <div class="page-pane" id="page-pane-oi" role="tabpanel" aria-labelledby="page-tab-oi" hidden>
  ${oiTrackerSection()}
  </div>
  <div class="page-pane" id="page-pane-grade" role="tabpanel" aria-labelledby="page-tab-grade" hidden>
  ${optionEvalSection()}
  </div>
  <div class="page-pane" id="page-pane-strategies" role="tabpanel" aria-labelledby="page-tab-strategies" hidden>
  ${strategiesSection()}
  </div>
  <div class="page-pane" id="page-pane-streaks" role="tabpanel" aria-labelledby="page-tab-streaks" hidden>
    <section class="card" id="streaks-section">
      <header class="card-header">
        <h2 class="card-title">Daily green / red streaks</h2>
        <span class="card-eyebrow" id="streaks-eyebrow" aria-live="polite"></span>
      </header>
      <p class="hint">Each ticker's current run of green or red daily closes. Streaks of 2+ days survive small counter days (a "tolerance bank" up to 1.5% cumulative, or up to 3 counter days in a row); a single counter day greater than 1.2%, hitting the 1.5% bank, or 4 counter days in a row breaks the run. Same-direction days heal the bank back to zero.</p>
      <div class="streaks-controls" role="toolbar" aria-label="Sort streaks">
        <label class="streaks-sort">
          <span class="streaks-sort-label">Sort</span>
          <select id="streaks-sort-select" aria-label="Sort streaks">
            <option value="streak">Longest streak</option>
            <option value="cum">Biggest cumulative move</option>
            <option value="last">Last close</option>
            <option value="tol">Tolerance bank used</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
      </div>
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
      <p class="hint">Yields and DXY are taken from the last daily build. Each tile shows the 1-day move (basis points for yields, % for DXY) classified against the movement scale below, plus the 5-day trend. A <span class="bonds-live-alert" aria-hidden="true">!</span> chip flags moves that hit the alert thresholds (DXY ±0.6% or 10Y ±10 bps on a daily close).</p>
    </section>

    <section class="card" id="bonds-scale-card">
      <header class="card-header">
        <h2 class="card-title">Movement scale</h2>
        <span class="card-eyebrow">What counts as a big move</span>
      </header>
      <p class="hint">Reference bands for sizing a daily change. Small daily moves are normal market noise; notable / big / very-large moves usually signal a catalyst (CPI, FOMC, jobs report, geopolitical shock) and tend to push equity sentiment within days. Pair with volume and a news catalyst — a big move on low volume is less reliable than the same move on high volume.</p>
      <table class="bonds-usd-table bonds-scale-table">
        <thead><tr><th>Asset</th><th><span class="bonds-live-band band-normal">Normal</span></th><th><span class="bonds-live-band band-notable">Notable</span></th><th><span class="bonds-live-band band-big">Big</span></th><th><span class="bonds-live-band band-very-large">Very large</span></th></tr></thead>
        <tbody>
          <tr><td>DXY</td><td>0.2–0.4%</td><td>0.5%</td><td>0.7–1.0%</td><td>&gt;1.0%</td></tr>
          <tr><td>10Y yield</td><td>&lt; 8 bps</td><td>8–10 bps</td><td>10–15 bps</td><td>15+ bps</td></tr>
          <tr><td>2Y yield</td><td>&lt; 8 bps</td><td>8–12 bps</td><td>12–20 bps</td><td>20+ bps</td></tr>
          <tr><td>30Y yield</td><td>&lt; 8 bps</td><td>8–10 bps</td><td>10–15 bps</td><td>15+ bps</td></tr>
        </tbody>
      </table>
      <p class="hint"><em>Weekly context.</em> DXY weekly moves of 0.5–1.0% are meaningful; 1.5%+ is a strong trend signal. For the 10Y yield, weekly moves of 20–30 bps are significant and 40+ bps signal a clear regime shift. Sustained DXY moves of 2–3%+ over a month can shift the regime for multinationals and commodities.</p>
      <p class="hint"><em>Alert defaults.</em> DXY ±0.6% on a daily close, or the 10Y yield ±10 bps on a daily close. Correlate with volume and a catalyst — moves with both behind them tend to follow through.</p>
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
      <input type="text" id="cmd-palette-input" placeholder="Jump to ticker, narrative, or tab…" autocomplete="off" spellcheck="false" aria-label="Jump to ticker, narrative, or tab" aria-controls="cmd-palette-results" aria-expanded="true" />
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
<script src="app.js?v=${cacheBust}" defer></script>
<script type="module" src="js/streaks.js?v=${cacheBust}"></script>
</body>
</html>`;
}
