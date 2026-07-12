import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  VALID_INDUSTRY_SET,
  resolveNarrativeIndustry,
  SECTORS,
  SECTOR_ORDER,
  INDUSTRIES_BY_SECTOR,
  INDUSTRY_OF_TICKER,
  htmlEscape,
} from '../build.mjs';
import { DOC_PAGES, DOC_ORDER, DOC_THEME_OVERRIDE } from './docs.mjs';
import { DISCORD_INVITE_URL } from '../../lib/links.mjs';

// Reference / legal / info pages (Buyer's manual, Chart patterns, What's
// included, Privacy, Terms) — formerly standalone .html files, now in-app tabs.
// Each is emitted as a pane carrying an empty shadow-host + an inert <template>
// of the page's own <style> (+ the shared DOC_THEME_OVERRIDE appended last, so
// the pages are re-skinned onto the app's design tokens) + markup; app.js mounts
// the template into a shadow root on first open (mountDocPane). The shadow root
// still isolates the pages' layout CSS from the app's global stylesheet.
// Source: scripts/render/docs.mjs.
function docPanesHtml() {
  return DOC_ORDER.map((key) => {
    const d = DOC_PAGES[key];
    if (!d) return '';
    return `<div class="page-pane doc-pane" id="page-pane-${key}" role="tabpanel" aria-labelledby="page-tab-${key}" hidden>` +
      `<div class="doc-host" data-doc="${key}"></div>` +
      `<template data-doc-tpl="${key}"><style>${d.style}${DOC_THEME_OVERRIDE}</style>${d.body}</template>` +
      `</div>`;
  }).join('\n  ');
}

// Sidebar navigation glyphs — one hand-picked 24×24 stroke icon per
// destination (feather/lucide vocabulary, drawn with currentColor so the
// stylesheet owns all tinting). Stored as bare path data; sideNavItem()
// wraps each in the shared <svg class="pt-ico"> shell.
const SIDE_NAV_ICONS = {
  home: '<path d="m3 9.8 9-7.3 9 7.3V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20Z"/><path d="M9.5 21.5V14h5v7.5"/>',
  brief: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V6"/><path d="M18 14h-8M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  tickers: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  narratives: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  market: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  picks: '<path d="m12 2.5 2.9 5.9 6.5 1-4.7 4.5 1.1 6.4L12 17.3l-5.8 3 1.1-6.4-4.7-4.5 6.5-1z"/>',
  stocks: '<path d="M3.5 20.5v-17"/><path d="M3.5 20.5h17"/><path d="m6.5 15.5 4-4.5 3 2.5 4.5-6"/><path d="M14.5 7.5H18V11"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18"/>',
  'index-cal': '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18M8 15h.01M12 15h.01M16 15h.01"/>',
  track: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14.5 2 2 4-4.5"/>',
  heatmap: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
  flow: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  volume: '<path d="M6 20v-5M12 20V9M18 20V4"/>',
  oi: '<path d="m12 3 10 5.5L12 14 2 8.5Z"/><path d="m2 14.5 10 5.5 10-5.5"/>',
  streaks: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'iv-trend': '<path d="m3 17.5 6-6 4 4 8-8.5"/><path d="M14.5 7h6.5v6.5"/>',
  overnight: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'fear-greed': '<path d="m12 14.5 3.5-3.5"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  'bonds-usd': '<path d="M12 2.5v19M16.5 5.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7"/>',
  'ai-capex': '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
  'ram-prices': '<rect x="2.5" y="6.5" width="19" height="9" rx="1.5"/><path d="M6 15.5v3M10 15.5v3M14 15.5v3M18 15.5v3"/><path d="M6.5 10v2M12 10v2M17.5 10v2"/>',
  'capital-raises': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  f13: '<path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z"/><path d="M14 2.5v5h5"/><path d="M9 13h6M9 17h6"/>',
  grade: '<circle cx="12" cy="8.5" r="5.5"/><path d="m8.8 13.2-1.3 8 4.5-2.7 4.5 2.7-1.3-8"/>',
  compare: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M12 3.5v17"/>',
  strategies: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6z"/>',
  cheatsheet: '<path d="M2.5 4.5H8a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2.5zM21.5 4.5H16a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h6.5z"/>',
  'chart-patterns': '<path d="M3.5 3.5v17h17"/><path d="m7.5 14 3.5-4 3 3 5-6.5"/>',
  features: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.5 2.5 2.5 4.8-5.5"/>',
  privacy: '<path d="M12 21.5s7.5-3.7 7.5-9.5V5.5L12 2.5l-7.5 3V12c0 5.8 7.5 9.5 7.5 9.5z"/>',
  terms: '<path d="M12 3v18M7 21h10"/><path d="M4 7h2.5c1.8 0 3.8-.7 5.5-1.7C13.7 6.3 15.7 7 17.5 7H20"/><path d="m6.5 7-2.8 6.7c.8.6 1.8.9 2.8.9s2-.3 2.8-.9zM17.5 7l-2.8 6.7c.8.6 1.8.9 2.8.9s2-.3 2.8-.9z"/>',
};

// One sidebar destination. Keeps the exact id / data-page-tab / aria-controls
// wiring the app JS, cmd-K palette, premium lock marker and role-hidden tab
// removal all key off — only the inner structure (icon + label span) is new.
// `label` is trusted static HTML (entities like &amp; allowed).
function sideNavItem(id, label, { selected = false } = {}) {
  const icon = SIDE_NAV_ICONS[id] || '';
  return `<button type="button" class="page-tab" role="tab" data-page-tab="${id}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="page-pane-${id}" id="page-tab-${id}"><svg class="pt-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span class="pt-label">${label}</span></button>`;
}

// Collapsible explainer — keeps the full descriptive text on the page (nothing
// is removed) but defaults it CLOSED so each tab is faster to scan, on small
// screens especially. The user clicks the summary to read the methodology.
// Reuses the established <details> disclosure pattern (cf. .picks-howto /
// .bonds-primer). `body` is trusted static HTML (one or more <p>…</p>).
function infoNote(summary, body) {
  return `<details class="info-note">
      <summary>${summary}</summary>
      <div class="info-note-body">${body}</div>
    </details>`;
}

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
      <span class="ticker-card-row">
        <span class="ticker-spot" data-spot-for="${htmlEscape(sym)}"></span>
        <span class="ticker-chg" data-chg-for="${htmlEscape(sym)}" hidden></span>
      </span>
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
      <span class="tab-live-state" id="tickers-live-state" aria-live="polite"></span>
    </header>
    <p class="hint">Every ticker the site tracks. Click any card to grade options on it. Prices refresh live every 30s while this tab is open.</p>
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
    <div class="tickers-empty" id="tickers-empty" hidden>
      <span>No tickers match the current search + sector filter.</span>
      <button type="button" class="tickers-empty-reset" id="tickers-empty-reset">Clear filters</button>
    </div>
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
    ${infoNote('What are market narratives?', `<p>The stories currently driving capital — AI capex, GLP-1, tariffs, rotations. Each sector tab opens to its overview — whose grade is the <em>average of the industry-group grades</em> inside it — then the sub-industry narratives. Every story is placed on its 6-stage <em>lifecycle</em> (catalysts → amplification → validation → peak → challenges → collapse), rated on a <em>fundamentals-vs-hype</em> gauge, and broken into <em>bull / base / bear</em> cases, with a <em>Watch for narrative shift</em> panel of the red flags that would break the thesis.</p>`)}
    <div id="narratives-pulse" class="narr-pulse" hidden></div>
    <div id="narratives-tabs" class="narr-tabs" role="tablist" aria-label="Market sectors"></div>
    <div id="narratives-panel" class="narr-panel" role="tabpanel"></div>
    <div id="narratives-empty" class="narr-empty" hidden>No narratives recorded for this build.</div>
    <div id="narratives-ended" class="narr-ended"></div>
    <div id="narratives-macro" class="narr-macro"></div>
  </section>`;
}

function marketAnalysisSection() {
  // Skeleton chrome only — the Market analysis tab is the risk-on / risk-off
  // home: the live market-tape regime read (chip + expandable panel), the
  // cross-asset barometer, the regime history calendar, plus the free tools
  // that used to ride the Top Picks tab (grade-any-ticker search, the
  // held-position checker). The actual picks roster lives on the separate,
  // role-gated Top Picks tab. The regime widgets keep their historical
  // `picks-*` element ids — renderMacroTape()/renderRiskBarometer()/
  // renderRegimeHistory() in app.js target these ids, and the CSS keys off
  // the same classes; only their host pane moved.
  return `<section class="card" id="market-section">
    <header class="card-header">
      <h2 class="card-title">Market analysis</h2>
      <span class="card-eyebrow" id="market-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">The cross-asset risk read that sets the engine&rsquo;s posture &mdash; the live market tape (VIX, dollar, yields, commodities, Fed path, geopolitics, sentiment), a risk-on / risk-off barometer, and the daily regime history &mdash; plus a grade lookup for any tracked ticker and a checker for a position you already hold.</p>
    <div id="market-regime-strip" class="picks-summary"><span id="picks-regime-chip" class="picks-regime-slot"></span></div>
    <div id="picks-tape" class="picks-tape" hidden></div>
    <div id="picks-barometer" class="picks-barometer" hidden></div>
    <div id="picks-regime-hist" class="picks-regime-hist" hidden></div>
    <div id="picks-regime-drift" class="picks-regime-drift" hidden aria-live="polite"></div>
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
    <details class="picks-position" id="picks-position">
      <summary>Check a position you already hold &rarr;</summary>
      <div class="picks-position-body">
        <p class="hint">Already own a call or put? Enter it below and get a <b>hold / trim / sell / wait</b> read &mdash; priced live and judged against the <b>full picture</b>: the engine&rsquo;s current grade, the AI news take, the chart pattern, sector narrative, entry-timing, and the same premium take-profit / stop the track record uses. Tracked tickers only. Not financial advice.</p>
        <div class="pos-form">
          <label class="pos-field"><span>Ticker</span><input type="text" id="pos-symbol" autocomplete="off" spellcheck="false" placeholder="e.g. NVDA" maxlength="6"></label>
          <label class="pos-field pos-field-sm"><span>Side</span><select id="pos-side"><option value="call">Call</option><option value="put">Put</option></select></label>
          <label class="pos-field"><span>Expiry</span><select id="pos-expiry" disabled><option value="">&mdash;</option></select></label>
          <label class="pos-field pos-field-sm"><span>Strike</span><input type="number" id="pos-strike" list="pos-strike-list" step="0.5" min="0" inputmode="decimal" placeholder="&mdash;" disabled><datalist id="pos-strike-list"></datalist></label>
          <label class="pos-field pos-field-sm"><span>Price paid</span><input type="number" id="pos-entry" step="0.01" min="0" inputmode="decimal" placeholder="per share"></label>
          <label class="pos-field pos-field-xs"><span>Contracts</span><input type="number" id="pos-qty" step="1" min="1" value="1" inputmode="numeric"></label>
          <button type="button" id="pos-check" class="pos-check-btn" disabled>Check position</button>
        </div>
        <div id="pos-status" class="pos-status" role="status" aria-live="polite"></div>
        <div id="pos-result" class="pos-result" role="status" aria-live="polite" hidden></div>
      </div>
    </details>
  </section>`;
}

function topPicksSection() {
  // Skeleton chrome only — renderPicks() in app.js fetches data/picks.json
  // lazily on first tab activation and fills these containers in. Card body is
  // intentionally a list of cards rather than a table so each pick can carry
  // its own signal breakdown. ROLE-GATED like Track Record: the tab is hidden
  // (nav button + pane removed at boot) for anyone without the Top Picks
  // Discord role, and api/data 401s picks.json/picks-open.json without it.
  // The market-tape / barometer / regime widgets moved to marketAnalysisSection().
  return `<section class="card" id="picks-section">
    <header class="card-header">
      <h2 class="card-title">Top options picks</h2>
      <span class="card-eyebrow" id="picks-eyebrow" aria-live="polite"></span>
      <span class="tab-live-state" id="picks-live-state" aria-live="polite"></span>
      <button type="button" id="picks-export-csv" class="csv-export-btn" title="Download picks as CSV">Export CSV</button>
    </header>
    <div id="picks-market-note" class="picks-market-note" role="status" aria-live="polite" hidden></div>
    <div id="picks-live-board" class="picks-live-board" hidden></div>
    <div id="picks-listview" class="picks-listview">
    <details class="picks-howto">
      <summary>How the grade works &mdash; and how the market tape moves it &rarr;</summary>
      <div class="picks-howto-body">
        <p>A <b>cross-sectional</b> grading system. Every tracked name is scored on five components &mdash; four asset pillars (<b>Fundamentals</b>, <b>Technicals</b>, <b>Mechanicals</b>, <b>Narrative</b>) plus an <b>Entry-timing</b> read &mdash; and those scores are standardized <i>against the rest of the universe this build</i>. A grade therefore means &ldquo;strong relative to its peers right now,&rdquo; not a fixed number: the names at the top of that ranking that <i>also</i> clear an absolute quality floor become the actionable list. The list is deliberately allowed to be <b>short, or empty</b>, on a poor day &mdash; the engine would rather hold cash than pad it. Each card has a <b>Recommendation&nbsp;&#8644;&nbsp;Grade</b> toggle &mdash; flip to Grade to audit every signal behind the score &mdash; plus a named entry strategy, a layered exit ladder, and a same-sector peer comparison. The <b>Track record</b> tab marks past picks to market (modeled option P&amp;L).</p>
        <p><b>The five components.</b> Each name&rsquo;s grade is the sum of four asset pillars plus an entry-timing read. The per-name <i>continuous</i> signals (growth rates, ratios, RSI level, relative volume&hellip;) are <b>standardized against the rest of the universe this build</b> rather than scored on fixed thresholds, so &ldquo;cheap / fast-growing / overbought&rdquo; recalibrate every refresh; discrete events and the market-wide signals below keep fixed scores.</p>
        <p><b>Fundamentals (10 signals).</b> Earnings surprise (beat/miss &gt;25% &plusmn;2, 10-24% &plusmn;1), EPS growth YoY +1 / -2, revenue growth YoY +1 / -2, analyst price target &plusmn;1, analyst rating changes &plusmn;2 (net of recent upgrades vs downgrades over ~90 days), P/E vs sector median &plusmn;1, guidance (raised +3, in line +2, lowered -3), major contract / deal +2 / -3 (incl. a bank&rsquo;s lead-underwriter mandate on a marquee IPO/M&amp;A), free cash flow TTM &plusmn;1, net-margin trend &plusmn;1. <i>Is the business getting better or worse?</i></p>
        <p><b>Technicals (11 signals).</b> RSI movement &plusmn;1, RSI reading &plusmn;3 (contrarian &mdash; 75+ overbought -3 / 25 or below oversold +3, the oversold credit only with a reversal bar), MACD &plusmn;1, a 3-day-plus streak &plusmn;1, confirmed 20/50/100D support-resistance breaks (&plusmn;1/&plusmn;1/&plusmn;2), the 52-week read (within 5% of the high -1 / low +1, contrarian), volume confirmation &plusmn;1 (relative volume &ge;1.3x +1, &lt;0.8x -1), the moving-average stack as <b>one</b> read (above the majority of the 20/50/100D SMAs +1, below -1), and an AI-read chart pattern (&plusmn;1 confirmed, 0 while still forming). <i>What is the chart doing?</i></p>
        <p><b>Mechanicals (8 signals).</b> Unusual options flow &plusmn;1, open-interest call/put skew &plusmn;1, short interest &plusmn;1 (squeeze setup +1 / rising -1 / falling +1), unusual underlying volume &plusmn;1, SPY flows &plusmn;1 (&ge;&plusmn;0.6%), put/call ratio extreme (contrarian: P/C &gt;1.15 fear &rarr; +2, &lt;0.65 greed &rarr; -2), VIX tracking (rising &amp; &gt;25 = -2, falling from an elevated &ge;20 = +1), VIX spot (&lt;15 complacency -1, &gt;35 capitulation +2, contrarian &mdash; needs a per-name reversal bar). <i>What are options &amp; the broad market doing?</i></p>
        <p><b>Narrative (8 signals).</b> AI-read news catalysts (good +2 / bad -3, asymmetric &mdash; one sentiment read is noisy so good news is weighted lighter), sector tail/headwind &plusmn;2 (faded by lifecycle &amp; hype), social sentiment &plusmn;1, media coverage (informational, 0 &mdash; not double-counted), macro tail/headwinds +1 / -2, DXY 1-day move (&ge;0.9%: strong dollar -2 / weak +1), 10-year yield 1-day move (&ge;13 bps: rising -2 / falling +1). <i>What story is driving it?</i></p>
        <p><b>Entry timing (the 5th component, -8 &hellip; +4).</b> Asset quality aside, <i>is now a good moment?</i> It reads confirmed daily bars for the two dominant ways trades fail &mdash; catching a falling knife and chasing an extended top (each a flat -8) &mdash; and credits the setups we want (a confirmed breakout on volume, or a healthy pullback to the 20-day average with momentum turning back up) up to +4. It also docks rich premium (high implied vol vs the name&rsquo;s own history) and an inverted vol term structure, and it tightens when the broad tape is fighting the trade. This folds straight into the total, so a badly-timed name drops below the bar on its own &mdash; without ever flipping the side.</p>
        <p><b>How the market tape moves the picks.</b> Macro enters two ways: as direct signals on every name (above), and as a market <b>regime</b> that changes the engine&rsquo;s whole posture. The regime is a <b>cross-asset gauge</b> &mdash; the VIX, the dollar (DXY), long yields, a commodity / war-shock axis (crude&nbsp;+&nbsp;gold), the Fed path, a geopolitical-news read, inflation&nbsp;/&nbsp;jobs, and CNN Fear&nbsp;&amp;&nbsp;Greed &mdash; surfaced in the expandable <b>Market tape</b> panel above the list. The fast price axes <b>refresh live</b> while the tab is open (so a shock like an oil spike or a peace-deal vol-crush moves the tape within seconds); the slow news&nbsp;/&nbsp;data axes carry from the last build, and on a recovery the headline regime holds the more defensive read until a fresh build confirms it (no whipsaw).</p>
        <p><b>&bull; The VIX (fear gauge).</b> Rising and above 25 docks -2; falling back from an elevated level adds +1 (vol relief); sub-15 complacency is -1; a spike above 35 (capitulation) flips contrarian-<i>bullish</i> +2, but only once a name&rsquo;s own chart confirms a turn (no catching the knife).</p>
        <p><b>&bull; Bonds (the 10-year yield).</b> A sharp one-day jump (&ge;13 bps) docks -2 across the board &mdash; rising yields pressure growth and long-duration risk assets; a sharp fall adds +1.</p>
        <p><b>&bull; The dollar (DXY).</b> A &ge;0.9% one-day rise is a -2 headwind (a strong dollar squeezes multinationals and risk assets); a fall is +1.</p>
        <p><b>&bull; A sell-off (risk-off regime).</b> When the S&amp;P drops about a percent or more <i>and</i> the VIX is elevated or rising, the engine flips to <b>risk-off</b> and several things happen at once: the bearish macro signals pull most grades down; entry timing turns defensive (a long bought <i>into</i> a falling tape is penalized and the falling-knife thresholds tighten ~25%, so more longs drop below the bar); the <b>tactical-put path opens</b> &mdash; bearish-leaning names that don&rsquo;t clear the long bar can ship as reduced-size puts on a clean breakdown, which is how a long-biased universe produces shorts; and sizing holds more cash. The mirror &mdash; a firm up day on a calm VIX &mdash; is <b>risk-on</b>, a tailwind where the engine leans long. So a calm tape favors a longer, call-heavy list sized up; a sell-off shrinks it, demands cleaner entries, tilts it toward puts, and sizes it down.</p>
        <p><b>Tiers &amp; sizing.</b> Tiers are <b>relative</b> &mdash; roughly the top 5% of the universe by conviction this build grade Strong (Very High), the band out to about the top 12% are actionable Call/Put (High), the rest are No&nbsp;Trade &mdash; but a name must <i>also</i> clear an absolute floor (about &plusmn;16 Strong / &plusmn;12 actionable), so on a weak tape where nothing clears it the list is short or empty by design. Size is risk-based, not flat: each pick is weighted inverse to the premium it would lose to its stop (delta, theta over the hold, and a modeled vol-drop), tilted by conviction, and the book&rsquo;s overall gross is trimmed when the recent <i>realized</i> track record is negative.</p>
        <p><b>Suggested contract.</b> A near-the-money option &mdash; delta 0.45-0.65 (target ~0.55), which carries far less theta and IV-crush fragility than a cheap far-OTM lottery ticket &mdash; with IV &lt;200%, &ge;14 days to expiry (roster picks &ge;21), standard monthly expirations, a tight spread, real open interest, and premium capped at the greater of $35/share or 12% of spot. The &ldquo;In plain English&rdquo; panel translates the bet into beginner terms.</p>
        <p><b>Entry &amp; exit plan.</b> Each pick matches one of six named strategies (Pullback to Confluence, Breakout + Retest, Moving-Average Pullback, Support + Confirmation, RSI + Divergence, Volume Breakout) with scale-in tranches at confluence prices, and a layered exit ladder &mdash; meaningful levels above and below spot, each with an action and its reasoning. The hard stop is volatility-aware (a multiple of ATR, so ordinary noise doesn&rsquo;t shake the trade out), and the track record additionally cuts in <b>premium</b> terms (a fixed % loss of the option), since a symmetric move on the stock is a very asymmetric move on the contract. Triggers also cover earnings-in-window IV-crush risk and stretched RSI. There is <b>no time stop and no pre-earnings exit</b>: a trade is held &mdash; through earnings prints included &mdash; for as long as its original thesis stays intact and the contract hasn&rsquo;t expired.</p>
        <p><b>How to read it &mdash; and what it isn&rsquo;t.</b> Because the grade is relative, it ranks names against each other; it does not promise an absolute edge. The engine is candidly <b>research / unproven</b> &mdash; its directional signal has not yet shown a validated edge on forward data, and the track record&rsquo;s option P&amp;L is <i>modeled</i> (there is no live options-price feed). Buying a call or put risks the entire premium. None of this is financial advice; treat the picks as a starting watchlist, not a recommendation to trade.</p>
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
      <div id="picks-empty" class="picks-empty" hidden>No actionable picks in this build — nothing cleared every bar (a strong grade, a strong thesis <em>and</em> a confirmed buy-now entry). A short or empty list is by design: the engine holds cash rather than pad a weak tape, and strong names still waiting on their entry sit in the watch list with a trigger price.</div>
      <p class="picks-foot">Picks rebuild from scratch on every refresh. Each actionable pick clears the conviction ranking, an absolute quality floor <em>and</em> a confirmed buy-now entry (never an extended/overbought chase), and has a tradeable near-the-money contract that fits the suggested-contract criteria above. The list can be short, or empty, on a poor day.</p>
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
  // The body is split into sub-tabs (Summary / Scorecard / Top 10 / Activity /
  // Picks / Equity / Breakdowns / Simulator / Monte Carlo) wired by
  // bindAccuracyTabs() in app.js — one short view at a time instead of the old
  // single long scroll. Summary is the default: a deterministic plain-English
  // engine report (health verdict, loss anatomy, what is working vs what needs
  // work, per-pick win/loss attribution) rendered by renderSummaryView().
  // renderAccuracy() still fills the same container IDs (now nested inside the
  // panes) and toggles the per-pane empty notes + the count badges on the tabs.
  // Each pane opens with an "At a glance" summary strip (the acc-sum-* slots,
  // filled by accPaneSummary() in app.js) highlighting that view's key numbers
  // + a one-line takeaway before the detail below.
  return `<section class="card" id="accuracy-section">
    <header class="card-header">
      <h2 class="card-title">Pick track record</h2>
      <span class="card-eyebrow" id="accuracy-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Every Top Pick shipped each refresh is logged and marked to market against each pick&rsquo;s own take-profit / cut levels. Use the tabs below to switch between the plain-English engine summary, the scorecard, the live Top&nbsp;10 roster, the activity logs, and the open / resolved picks. Each view opens with an <b>At a glance</b> strip — its key numbers and a one-line takeaway — with the full detail below.</p>
    <details class="accuracy-how">
      <summary>How this works</summary>
      <p>A pick <b>resolves</b> when the underlying reaches its take-profit (<span class="acc-ok">win</span>), hits its cut (<span class="acc-bad">loss</span>), <b>breaks its thesis</b> (the live grade flips to the opposite side, the stop level is breached, or every supporting driver goes quiet), or expires (graded vs. breakeven). There is no time stop, no pre-earnings exit, and no weekly force-close &mdash; a position is held, through earnings prints included, for as long as its original thesis stays intact and the contract has time left. The <b>Summary</b> tab is the rules-based engine report: an overall health verdict, why the losers lost (direction miss vs. theta bleed), why the winners won, which segments are working vs. lagging, and a specific "what to fix next" list — all computed from the resolved record, no AI. The <b>win rate by tier</b> asks whether higher-conviction scores actually win more. <b>Top&nbsp;10 — picks in &amp; out</b> shows the current 10-name roster, what changed in the 4 pillars since the last refresh, what dropped out and what replaced it, and a rules-based upgrade/downgrade read on each name (click a row for the full rubric); <b>Recent crossings</b> is the chronological log of names crossing the conviction bar on or off the actionable set; <b>Grade changes</b> logs every ticker whose grade moves up or down (and why); each pick&rsquo;s <b>Day&nbsp;0 / 2wk / 1mo</b> checkpoints show whether the price moved the way the score predicted. The <b>Equity</b>, <b>Breakdowns</b>, <b>Simulator</b>, and <b>Monte&nbsp;Carlo</b> tabs add a modeled-dollar profitability lens — an equity curve + drawdown, per-DTE / PoP / thesis / conviction tables and cross-tabs, a hypothetical $1M risk-managed book, and a bootstrap of the outcome distribution. Build cadence (~3 checks/day), not intraday.</p>
    </details>
    <div class="acc-tabs" role="tablist" aria-label="Track record view">
      <button type="button" class="acc-tab" role="tab" aria-selected="true" aria-controls="acc-pane-summary" id="acc-tab-summary" data-acc-tab="summary">Summary</button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-scorecard" id="acc-tab-scorecard" data-acc-tab="scorecard">Scorecard</button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-top10" id="acc-tab-top10" data-acc-tab="top10">Top&nbsp;10<span class="acc-tab-n" id="acc-tab-n-top10" hidden></span></button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-activity" id="acc-tab-activity" data-acc-tab="activity">Activity<span class="acc-tab-n" id="acc-tab-n-activity" hidden></span></button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-picks" id="acc-tab-picks" data-acc-tab="picks">Picks<span class="acc-tab-n" id="acc-tab-n-picks" hidden></span></button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-equity" id="acc-tab-equity" data-acc-tab="equity">Equity</button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-breakdowns" id="acc-tab-breakdowns" data-acc-tab="breakdowns">Breakdowns</button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-sim" id="acc-tab-sim" data-acc-tab="sim">Simulator</button>
      <button type="button" class="acc-tab" role="tab" aria-selected="false" aria-controls="acc-pane-montecarlo" id="acc-tab-montecarlo" data-acc-tab="montecarlo">Monte&nbsp;Carlo</button>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-summary" aria-labelledby="acc-tab-summary">
      <div id="acc-sum-summary" class="acc-pane-sum-slot"></div>
      <div id="an-summary" class="acc-analytics">Loading engine summary…</div>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-scorecard" aria-labelledby="acc-tab-scorecard" hidden>
      <div id="acc-sum-scorecard" class="acc-pane-sum-slot"></div>
      <div id="accuracy-stats" class="accuracy-stats">Loading track record…</div>
      <div id="accuracy-empty" class="accuracy-empty" hidden>No picks have been tracked yet — the record starts filling in on the next daily refresh.</div>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-top10" aria-labelledby="acc-tab-top10" hidden>
      <div id="acc-sum-top10" class="acc-pane-sum-slot"></div>
      <div id="accuracy-roster" class="accuracy-roster"></div>
      <p class="acc-pane-empty" id="acc-empty-top10" hidden>No Top-10 roster snapshot yet — it appears after the next daily refresh.</p>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-activity" aria-labelledby="acc-tab-activity" hidden>
      <div id="acc-sum-activity" class="acc-pane-sum-slot"></div>
      <div id="accuracy-grade-log" class="accuracy-grade-log"></div>
      <div id="accuracy-picks-changes" class="accuracy-picks-changes"></div>
      <p class="acc-pane-empty" id="acc-empty-activity" hidden>No grade changes or conviction-bar crossings logged yet.</p>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-picks" aria-labelledby="acc-tab-picks" hidden>
      <div id="acc-sum-picks" class="acc-pane-sum-slot"></div>
      <div id="accuracy-root" class="accuracy-root"></div>
      <p class="acc-pane-empty" id="acc-empty-picks" hidden>No open or resolved picks yet.</p>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-equity" aria-labelledby="acc-tab-equity" hidden>
      <div id="acc-sum-equity" class="acc-pane-sum-slot"></div>
      <div id="an-equity" class="acc-analytics"></div>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-breakdowns" aria-labelledby="acc-tab-breakdowns" hidden>
      <div id="acc-sum-breakdowns" class="acc-pane-sum-slot"></div>
      <div id="an-breakdowns" class="acc-analytics"></div>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-sim" aria-labelledby="acc-tab-sim" hidden>
      <div id="acc-sum-sim" class="acc-pane-sum-slot"></div>
      <div id="an-sim" class="acc-analytics"></div>
    </div>
    <div class="acc-pane" role="tabpanel" id="acc-pane-montecarlo" aria-labelledby="acc-tab-montecarlo" hidden>
      <div id="acc-sum-montecarlo" class="acc-pane-sum-slot"></div>
      <div id="an-mc" class="acc-analytics"></div>
    </div>
    <p class="picks-foot">Track record is informational, not a performance claim: it follows the underlying stock against each pick&rsquo;s own take-profit / cut levels, not the realised option P&amp;L, and samples only at build time. The <b>$ profitability, equity curve, Simulator, and Monte&nbsp;Carlo</b> views are <b>modeled and hypothetical</b> — Black-Scholes marks on a notional book, not realised fills. Not financial advice.</p>
  </section>`;
}

function calendarSection() {
  // Card chrome only — the timeline rows, FOMC widget, and macro-report
  // rows render client-side from data/calendar.json (fetched lazily on
  // first tab activation by loadCalendar() in app.js).
  return `<section class="card" id="calendar-section">
    <header class="card-header">
      <h2 class="card-title">Calendar</h2>
      <span class="card-eyebrow" id="calendar-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote("What's on this calendar?", `<p>A month-at-a-time view of every dated market event, opening on the <b>current month</b> — use <b>&lsaquo;</b> / <b>&rsaquo;</b> to step between months (or <b>Today</b> to jump back), and tap any day to see its full details below the grid. It tracks: confirmed earnings dates (with AM/PM session tagging) for every curated ticker, ticker-specific catalysts (FDA dates, contract decisions, product launches, court rulings, investor days — extracted from recent news), structured economic-report releases (NFP, Unemployment, JOLTS, CPI, PPI) with Actual / Previous / Consensus values, upcoming FOMC meetings, and the current effective Fed Funds rate plus CME FedWatch hike/hold/cut probabilities at four lookbacks. Ticker chips are clickable.</p>`)}
    <div id="calendar-overview" class="cal-overview" hidden></div>
    <div id="fomc-widget" class="fomc-widget" hidden></div>
    <div class="calendar-controls" role="toolbar" aria-label="Filter calendar">
      <div class="calendar-type-filter" role="radiogroup" aria-label="Filter by event type">
        <button type="button" class="calendar-pill is-on" data-cal-type="all" role="radio" aria-checked="true">All<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="earnings" role="radio" aria-checked="false">Earnings<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="catalysts" role="radio" aria-checked="false">Catalysts<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="reports" role="radio" aria-checked="false">Reports<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="fomc" role="radio" aria-checked="false">FOMC<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="macro" role="radio" aria-checked="false">Macro<span class="calendar-pill-count" aria-hidden="true"></span></button>
      </div>
      <button type="button" id="calendar-export-csv" class="csv-export-btn" title="Download visible events as CSV">Export CSV</button>
    </div>
    <div id="calendar-root" class="calendar-root">Loading calendar…</div>
    <div id="calendar-empty" class="calendar-empty" hidden>No upcoming events.</div>
  </section>`;
}

function indexCalSection() {
  // Card chrome only — the monthly index-close grid (SPY/QQQ/IWM/SMH/DIA/VXUS/
  // TLT/GLD/VIX red/green + %change), the index toggle, the month nav, and the
  // per-month summary render
  // client-side from data/index-calendar.json (premium; lazy-fetched on first
  // tab activation by loadIndexCal() in app.js).
  return `<section class="card" id="index-cal-section">
    <header class="card-header">
      <h2 class="card-title">Index calendar</h2>
      <span class="card-eyebrow" id="index-cal-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read the index calendar', `<p>A month-at-a-time record of how the three major index ETFs &mdash; <b>SPY</b> (S&amp;P&nbsp;500), <b>QQQ</b> (Nasdaq&nbsp;100) and <b>IWM</b> (Russell&nbsp;2000) &mdash; closed each trading day: <b class="idx-up">green</b> for an up day, <b class="idx-dn">red</b> for a down day, with the close-to-close <b>%&nbsp;change</b> in every cell. Toggle between the three indexes, step months with <b>&lsaquo;</b>&nbsp;/&nbsp;<b>&rsaquo;</b> (or <b>Today</b> to jump back), and read the per-month tally &mdash; green vs red days and the month&rsquo;s compounded return &mdash; beneath the grid. Today&rsquo;s cell updates through the session and finalizes at the 4&nbsp;pm&nbsp;ET close; history accumulates from each build. Not financial advice.</p>`)}
    <div id="index-cal-root" class="idx-cal-root">Loading index calendar&hellip;</div>
  </section>`;
}

function stockPicksSection() {
  // Card chrome only — the quality-dip candidate cards render client-side
  // from data/stock-picks.json (premium; lazy-fetched on first tab activation
  // by loadStocks() in app.js). A separate product from Top Picks: shares,
  // not option contracts.
  return `<section class="card" id="stocks-section">
    <header class="card-header">
      <h2 class="card-title">Stock picks</h2>
      <span class="card-eyebrow" id="stocks-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read stock picks', `<p>Share ideas, <em>not</em> option contracts &mdash; the Top Picks tab times leveraged trades; this page runs one buy-the-dip playbook over the same ${'~'}138-name universe, built on <b>three separate questions answered independently</b> (never blended into one number). <b>1&nbsp;&middot;&nbsp;Is it a good business?</b> A hard quality gate: consistently profitable (positive net margin or free cash flow), a manageable debt load (more cash than debt, or debt/equity &le;&nbsp;2x), net margins holding vs a year ago, and revenue still growing on a trailing-twelve-month view. Names that fail are never shown, however far they&rsquo;ve fallen &mdash; that&rsquo;s how value traps get in. <b>2&nbsp;&middot;&nbsp;Is it beaten down right now?</b> Five reads of &ldquo;cheap vs its own recent self&rdquo;: RSI(14) under 35, 4%+ below the 50-day average, 15%+ off the 52-week high, stretched &minus;2&sigma; against its 20-day mean (&asymp; the lower Bollinger band), and lagging SPY by 4+ points over ten sessions (company-specific selling, not a market-wide selloff). Each read is z-scored <em>across the quality-passed universe</em> and averaged into the card&rsquo;s <b>dip score</b>, so the page surfaces the most unloved names relative to each other rather than leaning on fragile fixed thresholds; a name needs at least two reads fired to list at all. <b>3&nbsp;&middot;&nbsp;Is it down because something actually broke?</b> Yellow trap flags &mdash; a fresh earnings print inside the drop, heavy-volume selling, a long red streak, analysts cutting estimates, a bearish news tone, or a binary event just ahead. Flags never block a candidate; they ride the card so the final call stays with you. A candidate with zero flags is badged <b>buy zone</b>: good business + beaten down + nothing broken. Every card also carries an expandable <b>investment thesis checklist</b> &mdash; the full owner&rsquo;s due-diligence list (management &amp; moat, financial health &amp; cash flow, unit economics, valuation &amp; growth, macro sensitivity, risks &amp; scenarios) with each question answered from the tracked data where possible and honestly labeled <em>unsure</em> (a heuristic or proxy read) or <em>unanswered</em> (not visible in our data) where it isn&rsquo;t. Fully deterministic, refreshed with each hourly build, and honest &mdash; a tape with no quality name on sale shows nothing. Not financial advice.</p>`)}
    <div id="stocks-root" class="stk-root">Loading stock picks&hellip;</div>
  </section>`;
}

function briefSection() {
  // Card chrome only — the rolling hourly brief card renders client-side
  // from data/briefs.json (fetched lazily on first tab activation by
  // loadBrief() in app.js).
  return `<section class="card" id="brief-section">
    <header class="card-header">
      <h2 class="card-title">Market brief</h2>
      <span class="card-eyebrow" id="brief-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">An AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About the market brief" data-tip="One rolling digest per trading day, re-minted hourly by the build (default gemini-2.5-flash-lite; override AI_BRIEF_MODEL). The open build writes the morning setup from overnight &amp; foreign moves, macro levels, Fear &amp; Greed, the day's calendar and the top picks; mid-session builds refresh it with the session's breadth, movers and flow; the post-close build writes the closing read. Headlines are AI prose grounded in the numbers shown; the chips and stats are computed, not generated.">i</span>-written market digest, refreshed hourly with each build &mdash; the overnight setup at the open, where the tape stands mid-session, and the closing read after 4&nbsp;pm ET. Ticker chips are clickable. Not financial advice.</p>
    <div id="brief-root" class="brief-root">Loading brief&hellip;</div>
  </section>`;
}

function overnightSection() {
  // Card chrome only — the risk-tone strip, the broad backdrop chips, and the
  // per-region tiles render client-side from data/correlations.json (fetched
  // lazily on first tab activation by loadOvernight() in app.js).
  return `<section class="card" id="overnight-section">
    <header class="card-header">
      <h2 class="card-title">Overnight markets</h2>
      <span class="card-eyebrow" id="overnight-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read overnight markets', `<p>Cross-market lead-lag signals. Asian cash markets and FX trade and close <em>before</em> the US opens, so an overnight move in a foreign peer is a leading read on its US counterpart — Samsung &amp; SK Hynix selling off in Seoul flags memory names like MU; a yen-carry unwind in Tokyo flags broad US risk. Beyond tech, commodities and rates drive their own sectors: crude (energy &amp; fuel-heavy logistics), copper (industrials), gold/silver vs the dollar (metals), nat gas (power), long yields (banks, homebuilders, TLT) and bitcoin (crypto-levered names). Each tile shows a symbol&rsquo;s move &mdash; the completed-session change for Asian cash markets, or the live overnight gap vs the prior settle for the 24h instruments (futures, FX, commodities, crypto) and the cash vol/yield indices &mdash; its current level, and the US tickers it leads (click a tag to grade it). Markets that close before the US open are genuine <b>leading</b> reads; <b>concurrent</b> (Europe, cash VIX/yields) and <b>24h</b> tiles are tagged as co-movement, not a lead. Captured at build time &mdash; the 9:30&nbsp;ET build is the first to see the just-closed Asian session.</p>`)}
    <div id="overnight-tone" class="overnight-tone" hidden></div>
    <div id="overnight-broad" class="overnight-broad" aria-label="Global backdrop"></div>
    <div id="overnight-root" class="overnight-root">Loading overnight markets&hellip;</div>
    <p class="hint">Correlation (r) and sensitivity (&beta;) are computed from up to 150 trading days of daily-return overlap (sample size <em>n</em> is shown &mdash; faint / asterisked low-n fits are noisier); &beta; &times; the peer&rsquo;s move is a rough implied read, not a forecast. Yield moves are shown in basis points. Foreign closes can lag the US session by up to a day. Not financial advice.</p>
  </section>`;
}

function aiCapexSection() {
  // Card chrome only — content renders client-side from data/ai-capex.json,
  // lazy-fetched on first tab activation by loadAiCapex() in app.js. SEC XBRL
  // CapEx for the Mag 7: aggregate this-FY-vs-last-FY + per-company comparison.
  return `<section class="card" id="ai-capex-section">
    <header class="card-header">
      <h2 class="card-title">AI CapEx — the Magnificent 7</h2>
      <span class="card-eyebrow" id="ai-capex-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>Aggregate capital expenditure (CapEx) for the seven mega-caps driving the AI buildout — MSFT, GOOGL, AMZN, META, NVDA, AAPL, TSLA. CapEx is the cash they spend on property, plant &amp; equipment (data centers, GPUs, networking), pulled straight from the cash-flow statement in their SEC filings. We total the latest full fiscal year vs. the year before — so you can see how much aggregate AI infrastructure spend has grown (or shrunk), and by how much — plus each name's trailing-12-month run-rate and CapEx as a share of revenue. The <b>revenue check</b> compares that spend against the group's combined revenue on the same fiscal years: total revenue, revenue growth vs. CapEx growth, and CapEx as a share of revenue — is the buildout outrunning the money coming in? Figures are as-filed; fiscal years differ by company.</p>`)}
    <div id="ai-capex-root" class="ai-capex-root">Loading AI CapEx…</div>
    <div id="ai-capex-empty" class="ai-capex-empty" hidden>AI CapEx data will appear after the next daily build refresh.</div>
  </section>`;
}

function ramPricesSection() {
  // Card chrome only — content renders client-side from data/ram-prices.json,
  // lazy-fetched on first tab activation by loadRamPrices() in app.js.
  // Wholesale DRAM spot (TrendForce/DRAMeXchange) + US retail DDR5 kit prices
  // (WhereIsMyRam), with % increases over 1d/7d/30d/1y.
  return `<section class="card" id="ram-prices-section">
    <header class="card-header">
      <h2 class="card-title">RAM prices</h2>
      <span class="card-eyebrow" id="ram-prices-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>Memory (DRAM) pricing from two independent angles. <b>Wholesale spot</b> is the price at which DRAM chips and modules change hands between vendors, module makers and brokers &mdash; the upstream signal that moves first when AI data-center demand soaks up supply. <b>US retail</b> tracks what a desktop DDR5 kit actually costs across major US retailers, by kit category. Rising RAM prices are a direct read on the AI hardware buildout (see the AI CapEx tab) &mdash; and a margin headwind for anyone buying memory. Spot data: TrendForce / DRAMeXchange; retail data: WhereIsMyRam. The 7d/30d spot changes accumulate from our own daily snapshots, so they deepen over time.</p>`)}
    <div id="ram-prices-root" class="ram-prices-root">Loading RAM prices&hellip;</div>
    <div id="ram-prices-empty" class="ram-prices-empty" hidden>RAM price data will appear after the next daily build refresh.</div>
    <p class="hint">Spot prices are per chip/module in USD (session average); retail prices are per kit in USD (lowest in-stock offer / category average). Sources are scraped best-effort and can go stale. Not financial advice.</p>
  </section>`;
}

function ivTrendSection() {
  // Card chrome only — content renders client-side from data/iv-trending.json,
  // lazy-fetched on first tab activation by loadIvTrend() in app.js. Every
  // tracked name's current ATM ~30d IV vs its own ~18-month history (z-score,
  // percentile) plus short-term direction (5d/20d IV change, rising streak);
  // elevated-and-climbing names are tiered (surging / trending / building).
  return `<section class="card" id="iv-trend-section">
    <header class="card-header">
      <h2 class="card-title">Trending IV</h2>
      <span class="card-eyebrow" id="iv-trend-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>Each name's <b>implied volatility</b> (ATM ~30-day, sampled daily for ~18 months) compared to its <b>own</b> history. When IV runs well above a name's historical average <b>and is still climbing</b>, the options market is pricing in a bigger-than-usual move &mdash; scheduled event risk (an earnings badge is shown when a print is near), heavy positioning, or something leaking. Rising IV says <b>magnitude</b>, not direction: it makes long options expensive and is not by itself a buy signal. Score = z-score of current IV vs the name's own mean (weighted heaviest) + 5-day/20-day IV momentum + a consecutive-rising-days streak; fixed absolute tiers with a materiality floor (current IV must sit meaningfully above the name's own average in real terms), no cross-sectional curve. Names whose IV is already well above their own history but not currently climbing are marked <b>Elevated</b> in the table &mdash; premium is rich either way.</p>`)}
    <div id="iv-trend-root" class="ivt-root">Loading Trending IV&hellip;</div>
    <div id="iv-trend-empty" class="ivt-empty" hidden>Trending-IV data will appear after the next daily build refresh.</div>
    <p class="hint">IV history accumulates one sample per trading day; names with under a month of samples are excluded. Elevated IV is a read on expected move size, not direction. Not financial advice.</p>
  </section>`;
}

function capitalRaisesSection() {
  // Card chrome only — renders client-side from data/capital-raises.json,
  // lazy-fetched on first tab activation by loadCapitalRaises() in app.js.
  return `<section class="card" id="capital-raises-section">
    <header class="card-header">
      <h2 class="card-title">Capital raises &amp; buybacks</h2>
      <span class="card-eyebrow" id="capital-raises-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>When a tracked company issues new debt, bonds, convertibles or shares — or launches a buyback — it usually hits the news cycle first. This feed scans each name's recent headlines for issuance language and pairs the flagged event with the hard dollar amount from its latest SEC filing, so you can size the raise. New debt/shares dilute or lever a balance sheet; a buyback does the opposite. Headlines are from the trailing few weeks; filed numbers lag by up to a quarter.</p>`)}
    <div id="capital-raises-root" class="capital-raises-root">Loading capital raises…</div>
    <div id="capital-raises-empty" class="capital-raises-empty" hidden>No capital-raise headlines flagged recently — check back after the next refresh.</div>
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
    ${infoNote('What is a 13F filing?', `<p>Quarterly institutional-holdings snapshot for the largest 13F filers ($5B+ AUM). Includes top reporting firms, marquee positions, the 20 biggest aggregate holdings across all filers, and rotation themes (most bought vs. most sold). 13F filings are released 45 days after quarter-end and exclude bonds, options details, and most international holdings.</p>`)}
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
      ${infoNote('What counts as unusual flow?', `<p>Block/sweep flow: 5–50% OTM contracts that picked up at least 2,000 contracts of volume this hour (4,000 if expiring within 2 weeks) with vol &gt; OI. The kind of single-shot directional buying that often signals informed positioning. Each chip shows the <strong>volume-to-OI multiple</strong> (e.g. 4×, the canonical unusual read) and the <strong>premium that hit this hour</strong>; the bar above sums call vs put premium for a directional lean. A 🔥 ×N badge means the same contract has flagged that many times in the last 5 trading days — recurring conviction. Hourly scan, front 2 expirations.</p>`)}
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
            <option value="premium">Biggest premium (this hr)</option>
            <option value="repeats">Most 🔥 repeats</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
        <button type="button" id="flow-expand-toggle" class="flow-action-btn" aria-pressed="true">Expand all</button>
        <button type="button" id="flow-export-csv" class="flow-action-btn csv-export-btn" title="Download visible rows as CSV">Export CSV</button>
      </div>
      <div id="flow-summary" class="flow-summary" hidden></div>
      <div id="flow-list" class="flow-list" role="list"></div>
      <div id="flow-empty" class="flow-empty" hidden>No unusual flow flagged in the latest scan.</div>
      <div id="flow-no-results" class="flow-empty" hidden>No tickers match these filters.</div>
    </div>
  </section>`;
}

function gexSection() {
  // Card shell only — the per-ticker gamma-exposure heatmap renders
  // client-side in scripts/render/app-js.mjs (computeGex/renderGex). It
  // computes dealer GEX (Γ × OI × 100 × spot² × 1%) for every strike and
  // expiration from the baked per-ticker chain (data/<SYM>.json, lazy-loaded
  // via the shared fetchChain()), so it works for any tracked name with no
  // bake-time data file of its own. The <select> is populated from
  // MANIFEST.symbols at init.
  return `<section class="card gex-card" id="gex-section">
    <header class="card-header">
      <h2 class="card-title">Gamma exposure (GEX)</h2>
      <span class="card-eyebrow" id="gex-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is gamma exposure (GEX)?', `<p>Dealer <strong>gamma exposure</strong> per strike and expiration — <code>Γ × OI × 100 × spot² × 1%</code>, the dollar-gamma each contract adds for a 1% move, with Black-Scholes gamma computed from the contract's implied vol. Calls add <span class="gex-key-pos">positive</span> gamma (dealers buy dips / sell rips — <strong>stabilizing</strong>); puts add <span class="gex-key-neg">negative</span> gamma (dealers amplify moves). Net GEX at a cell is call GEX − put GEX. Rows are strikes centered on spot; columns are expirations, near-term first, with a <strong>Net&nbsp;Σ</strong> column beside each strike summing its gamma across the shown expirations — the aggregate profile whose peaks are the <strong>call wall</strong> (<span class="gex-key-pos">CW</span>) and <strong>put wall</strong> (<span class="gex-key-neg">PW</span>), tagged in-grid. <strong>Total net GEX &gt; 0</strong> pins price toward the largest walls; <strong>&lt; 0</strong> means moves get amplified. The <strong>gamma flip</strong> (dashed amber line) is the spot level where net dealer gamma crosses zero. Open interest is end-of-session data (published next morning), so this reflects the prior session's positioning; only spot moves intraday, so the grid recomputes at the live spot while the market is open.</p>
      <p><strong class="gex-key-pos">Above the gamma flip (positive gamma):</strong> market makers are long gamma. To hedge their options portfolios they act as a <strong>dampener</strong> to the market — they buy dips and sell rallies, which creates a highly stable, rangebound, and mean-reverting environment.</p>
      <p><strong class="gex-key-neg">Below the gamma flip (negative gamma):</strong> market makers are short gamma. To hedge, they are forced to <strong>sell into weakness and buy into strength</strong> (trend-following). This behavior can rapidly accelerate price swings, leading to flash-crash-style selloffs or explosive, volatile rallies.</p>`)}
    <div class="gex-controls" role="toolbar" aria-label="Gamma exposure controls">
      <div class="gex-control gex-control-ticker">
        <span class="gex-control-label" id="gex-symbol-label">Ticker</span>
        <div class="combo gex-combo" id="gex-symbol-combo">
          <input type="text" id="gex-symbol" role="combobox"
                 aria-expanded="false" aria-controls="gex-symbol-listbox"
                 aria-autocomplete="list" aria-labelledby="gex-symbol-label"
                 placeholder="Search ticker — e.g. SPY, NVDA…"
                 autocomplete="off" spellcheck="false">
          <button type="button" class="combo-clear" id="gex-symbol-clear" aria-label="Clear" tabindex="-1">&times;</button>
          <ul id="gex-symbol-listbox" role="listbox" hidden></ul>
        </div>
      </div>
      <label class="gex-control">
        <span class="gex-control-label">Strike range</span>
        <select id="gex-range" aria-label="Strike range">
          <option value="near">Near (±12)</option>
          <option value="mid" selected>Mid (±22)</option>
          <option value="wide">Wide (±40)</option>
        </select>
      </label>
      <button type="button" id="gex-refresh" class="gex-action-btn" title="Re-fetch the live spot and recompute">Refresh</button>
    </div>
    <div id="gex-summary" class="gex-summary"></div>
    <div class="gex-grid-wrap"><div id="gex-grid" class="gex-grid" role="region" aria-label="GEX heatmap"></div></div>
    <div class="gex-legend" aria-hidden="true">
      <span class="gex-legend-label">Put gamma (−)</span>
      <span class="gex-legend-bar"></span>
      <span class="gex-legend-label">Call gamma (+)</span>
    </div>
    <div id="gex-empty" class="gex-empty" hidden></div>
  </section>`;
}

function oiTrackerSection() {
  // Card shell only — per-ticker rows render client-side from
  // data/oi-tracker.json, lazy-fetched on tab entry (populated by
  // scripts/scan-oi.mjs; the manifest carries only oiMeta). Twice-daily scan,
  // front 2 expirations (this week + next week).
  return `<section class="card oi-card" id="oi-section">
    <header class="card-header oi-card-header">
      <button type="button" id="oi-collapse" class="oi-collapse-btn" aria-expanded="true" aria-controls="oi-body" title="Collapse section">
        <svg class="oi-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        <h2 class="card-title">Near-term OI &amp; gamma squeeze</h2>
      </button>
      <span class="card-eyebrow" id="oi-eyebrow" aria-live="polite"></span>
      <span class="tab-live-state" id="oi-live-state" aria-live="polite"></span>
    </header>
    <div id="oi-body" class="oi-body">
      ${infoNote('How the OI ladder & squeeze score work', `<p>Top 12 highest open-interest strikes (calls + puts) across this week's and next week's expirations, laid out as an <strong>options ladder</strong> — calls and puts grouped on their own sides, each sorted closest-to-spot first and extending outwards. Each ticker carries a <strong>Gamma Squeeze Score</strong> (0–5): heavy near-the-money call OI · C/P ratio ≥ 2:1 · call wall Vol/OI ≥ 1.5× · spot within 10% of the call wall · aggressive ask-side call flow today. A score of <strong>4–5</strong> flags a potential setup. Strikes with <strong>OI &gt; 1000</strong> get a chip; ΔOI day-over-day chips fire at <strong>+30%</strong> (new buying) and <strong>+100%</strong> (very aggressive). Twice-daily scan: pre-market (~08:30 ET) and EOD (~19:00 ET).</p>`)}
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
  // data/volume-flags.json, lazy-fetched on tab entry (populated by
  // scripts/scan-unusual.mjs's volume pass; the manifest carries only
  // volumeFlagsMeta). See lib/volume-flags.mjs for the classification rules.
  return `<section class="card vol-card" id="vol-section">
    <header class="card-header">
      <h2 class="card-title">Volume &amp; S/R breaks</h2>
      <span class="card-eyebrow" id="vol-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How the volume flags work', `<p>Hourly volume vs the U-shaped 25/14/11/11/14/25% intraday distribution: tickers trading at <strong>≥1.2×</strong> their expected hour-bucket volume are flagged. At/after 16:00 ET, full-day volume <strong>≥1.3×</strong> the 20D average flags as EOD. When spot crosses the 20D support or resistance line, the break is confirmed against the same hour's vol ratio — Strong Alert (≥1.3×), Watch (0.8–1.3×), or Likely Fakeout (&lt;0.8×).</p>
    <p>Each row reads <em>Vol actual / expected · ratio</em> — shares traded in that bucket vs. the bucket's share of the 20-day average, and the multiple between them. The trailing % is the price change across the bucket. A flag leans <span class="vol-key-up">bullish</span> when price is up on heavy volume (real demand) and <span class="vol-key-dn">bearish</span> when price is down on heavy volume (real selling pressure).</p>
    <p>Each card also carries a <strong>follow-the-case verdict</strong> — whether the volume evidence says to <em>follow</em> the bull or bear case (heavy volume confirmed the move), <em>wait for confirmation</em> (heavy participation but no decisive direction yet), or <em>not follow</em> it (a weak move or a likely fakeout, prone to fading). Expand a ticker to read the verdict's reasoning in full.</p>
    <p>The build's current <strong>★ Top Picks</strong> are pinned in their own group at the top so you can track flow on just those names; the rest are grouped by sector and <strong>collapsed by default</strong> — click a sector header to open it, then a ticker to expand its hour-by-hour breakdown with the reasoning. Each row's one-line summary shows its strongest flag, bullish/bearish lean, peak hour ratio, and EOD move, and a six-bar <strong>intraday volume profile</strong> — one bar per session hour (open → close), taller where volume ran hotter and tinted <span class="vol-key-up">green</span>/<span class="vol-key-dn">red</span> by that hour's price direction — so you can see <em>when</em> the heavy tape hit (the open, midday, or into the close) without expanding. <em>Group by sector</em> and <em>Expand all</em> toggle the layout.</p>`)}
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
      <div class="vol-filter vol-lean-filter" role="radiogroup" aria-label="Filter by bullish or bearish lean">
        <button type="button" class="vol-pill is-on" data-vol-lean="all" role="radio" aria-checked="true">Any lean</button>
        <button type="button" class="vol-pill" data-vol-lean="bull" role="radio" aria-checked="false" title="Only tickers whose flagged volume leans bullish (price up on the heavy tape)">Bullish</button>
        <button type="button" class="vol-pill" data-vol-lean="bear" role="radio" aria-checked="false" title="Only tickers whose flagged volume leans bearish (price down on the heavy tape)">Bearish</button>
      </div>
      <div class="vol-toggles">
        <button type="button" id="vol-group-btn" class="vol-pill vol-toggle-pill is-on" aria-pressed="true" title="Group tickers under collapsible sector sections">Group by sector</button>
        <button type="button" id="vol-expand-btn" class="vol-pill vol-toggle-pill" aria-pressed="false" title="Expand or collapse every ticker's hour-by-hour detail">Expand all</button>
      </div>
      <label class="vol-sort">
        <span class="vol-sort-label">Sort</span>
        <select id="vol-sort-select" aria-label="Sort volume flags">
          <option value="ratio">Hottest hour ratio</option>
          <option value="verdict">Verdict (follow first)</option>
          <option value="eod">EOD day ratio</option>
          <option value="dayvol">Day volume</option>
          <option value="move">Largest day move</option>
          <option value="sr">S/R break conviction</option>
          <option value="alpha">A → Z</option>
        </select>
      </label>
    </div>
    <div id="vol-summary" aria-live="polite"></div>
    <div id="vol-list" class="vol-list" role="list"></div>
    <div id="vol-empty" class="vol-empty" hidden>No volume or S/R-break flags in the latest scan.</div>
    <div id="vol-no-results" class="vol-empty" hidden>No tickers match these filters.</div>
  </section>`;
}

function compareCompaniesSection() {
  // Side-by-side fundamentals/grade comparator. Pure browser tool — adds
  // tickers as chips, lazy-fetches each data/<SYM>.json + grades.json (all FREE
  // keys), and renders a metric table with the per-row leader highlighted, a
  // %-vs-base delta on every other column, and a plain-language summary. Wired
  // in app.js (initCompare / renderCompare / cmpSearch). The ticker picker is
  // the same custom .combo listbox as the Grade/GEX/Strategy tabs (a native
  // <datalist> here rendered as an unstyled browser popup pinned to the
  // viewport edge).
  return `<section class="card" id="compare-section">
    <header class="card-header">
      <h2 class="card-title">Compare companies</h2>
    </header>
    <p class="hint">Put 2–4 companies side by side — price, valuation (P/E, PEG, P/S), growth, margins, the analyst read and our 4-pillar grade — with the leader on each row highlighted, the % difference vs the first name on every other column, and a plain-language summary of how they stack up. Reads the same free data as the Grade tab.</p>
    <div class="cmp-controls">
      <div class="combo" id="cmp-combo">
        <input type="text" id="cmp-input" role="combobox"
               aria-expanded="false" aria-controls="cmp-listbox"
               aria-autocomplete="list"
               aria-label="Add a ticker to compare"
               placeholder="Add ticker — type & press Enter…"
               autocomplete="off" spellcheck="false" maxlength="6">
        <ul id="cmp-listbox" role="listbox" hidden></ul>
      </div>
      <button type="button" class="cmp-btn" id="cmp-add" aria-label="Add ticker">Add</button>
      <button type="button" class="cmp-btn cmp-btn-quick" id="cmp-quick-mag7" title="Compare the Magnificent 7">Mag 7</button>
      <button type="button" class="cmp-btn cmp-btn-ghost" id="cmp-clear">Clear</button>
    </div>
    <div id="cmp-chips" class="cmp-chips" aria-label="Selected companies"></div>
    <div id="cmp-status" class="opt-status" role="status"></div>
    <div id="cmp-summary" class="cmp-summary" hidden aria-live="polite"></div>
    <div id="cmp-table-wrap" class="cmp-table-wrap" hidden></div>
  </section>`;
}

function optionEvalSection() {
  // The ticker combobox + segmented call/put control + chain selects all
  // bind live in app.js — picking a ticker auto-loads its chain and any
  // change to type/expiry/strike re-grades immediately. No Evaluate button.
  return `<section class="card" id="opt-eval-section">
    <header class="card-header">
      <h2 class="card-title">Grade a ticker</h2>
    </header>
    <p class="hint">Search a curated ticker to jump straight into its chart — the AI chart-pattern read leads, with the full technicals, fundamentals, implied vol, news, and a live contract grader a tab away. The whole page regrades as the tape moves.</p>
    <div class="opt-controls">
      <div class="combo" id="symbol-combo">
        <input type="text" id="symbol-input" role="combobox"
               aria-expanded="false" aria-controls="symbol-listbox"
               aria-autocomplete="list"
               aria-label="Search any tracked ticker to grade it"
               placeholder="Search ticker or sector…"
               autocomplete="off" spellcheck="false">
        <button type="button" class="combo-clear" id="symbol-clear" aria-label="Clear" tabindex="-1">&times;</button>
        <ul id="symbol-listbox" role="listbox" hidden></ul>
      </div>
    </div>
    <div id="opt-eval-status" class="opt-status" role="status"></div>
    <div id="opt-live-quote" class="opt-live" hidden aria-live="polite"></div>
    <div id="opt-live-refresh" class="opt-live-refresh" hidden aria-live="polite"></div>
    <div id="opt-narr-chips" class="opt-narr-chips" hidden aria-label="Narratives this ticker rides"></div>
    <div id="opt-analysis" class="opt-analysis" hidden>
      <div class="opt-tabs" role="tablist" aria-label="Ticker analysis">
        <button type="button" class="opt-tab" role="tab" aria-selected="true" aria-controls="opt-tab-pane-tech" id="opt-tab-btn-tech" data-tab="tech">Technicals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-contract" id="opt-tab-btn-contract" data-tab="contract">Contract grade</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-fund" id="opt-tab-btn-fund" data-tab="fund">Fundamentals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-iv" id="opt-tab-btn-iv" data-tab="iv">Implied vol</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-news" id="opt-tab-btn-news" data-tab="news">News</button>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-tech" aria-labelledby="opt-tab-btn-tech">
        <section id="opt-technicals" class="opt-tech" hidden aria-label="Technical signals for this ticker">
          <header class="opt-tech-head">
            <h3 class="opt-tech-title">Technical signals</h3>
            <span class="opt-tech-sub">Momentum &amp; recent price structure on the daily chart</span>
          </header>
          <div class="opt-tech-grid" id="opt-tech-grid"></div>
          <p class="opt-tech-foot">Indicators are computed at build time from ~1 year of Yahoo daily closes. Use them as context for your option strike pick — they describe the stock, not the contract itself.</p>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-contract" aria-labelledby="opt-tab-btn-contract" hidden>
        <section id="opt-contract-grade" class="opt-contract-grade" aria-label="Grade a specific contract on this ticker">
          <p class="hint">Pick a call or put, then dial in expiry and strike — the verdict regrades as you go. Or paste one straight from your broker in the card below.</p>
          <div id="opt-pinned-strip" class="opt-pinned-strip" hidden aria-label="Pinned contracts for comparison"></div>
          <div class="opt-controls opt-controls-contract">
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
          <div id="opt-max-pain" class="opt-max-pain" hidden aria-live="polite"></div>
          <div id="opt-toppick" class="opt-toppick" hidden aria-live="polite" aria-label="Top Picks grade for this ticker"></div>
          <div class="opt-result-wrap">
            <div id="opt-result-sticky" class="opt-result-sticky" hidden></div>
            <div id="opt-eval-result" class="opt-result"></div>
          </div>
        </section>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-fund" aria-labelledby="opt-tab-btn-fund" hidden>
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
          <div id="opt-fund-earnings-hx" class="opt-fund-ehx" hidden></div>
          <p class="opt-fund-foot">Verdict + bullets are AI-generated from Yahoo's last-reported fundamentals and earnings. For information only — cross-check before trading.</p>
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
      <summary>How is the contract grade computed?</summary>
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
      <p class="strat-legs-foot">Each leg prices off the live chain <b>mid</b>. Type a <b>Price</b> on any leg to use your own fill instead — the cost, breakeven and P/L update to match. Leave it blank to track the market mid.</p>
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

export function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], sectorOverviews = {}, recentlyEnded = [], macroHeadlines = [], unusual = null, spots = {}, fearGreed = null, macro = null, volumeFlags = null, marketBackdrop = null, nextFomcDates = [], oi = null, assetVersion = null, dataDir = null }) {
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
  // --- Manifest split (private-data migration / Path B + freemium tiering) ---
  // The manifest's heavy fields are externalized to sidecars so the committed
  // (public-repo) index.html carries only a non-sensitive SHELL (ticker list,
  // sector taxonomy, freshness-stub meta) plus a `deferred` flag. app.js then
  // fetches the sidecars and merges them before first paint. Two sidecars, by
  // tier (see lib/premium-keys.mjs):
  //   \u2022 data/manifest.json (PREMIUM, gated) \u2014 the value-carrying half: AI
  //     narratives, sector overviews, recently-ended picks, the unusual-flow
  //     snapshot. Served only to a valid session.
  //   \u2022 data/manifest-free.json (FREE, public) \u2014 the open-tab half: macro
  //     headlines, last spots, fear-greed, macro backdrop, market backdrop.
  //     Powers the free Bonds & USD / Fear & Greed / Grade / Heatmap surfaces
  //     for everyone, member or not.
  // Without dataDir, inline the full manifest (legacy/standalone render).
  const premiumManifest = {
    narratives: narrativesTagged,
    sectorOverviews: sectorOverviews || {},
    recentlyEnded,
    unusual: unusual || null,
  };
  const freeManifest = {
    macroHeadlines,
    spots,
    fearGreed: fearGreed || null,
    macro: macro || null,
    marketBackdrop: marketBackdrop || null,
  };
  const shellManifest = {
    builtAt,
    builtAtIso,
    symbols,
    sectors: SECTORS,
    industries: INDUSTRY_OF_TICKER,
    sectorOrder: SECTOR_ORDER,
    industriesBySector: INDUSTRIES_BY_SECTOR,
    // Manifest diet: the full volume-flags + OI-tracker payloads are lazy-fetched
    // on tab entry; only these tiny freshness-stub metas stay inline.
    volumeFlagsMeta: volumeFlags
      ? { scannedAt: volumeFlags.scannedAt || null, etDate: volumeFlags.etDate || null, marketState: volumeFlags.marketState || null }
      : null,
    nextFomcDates: Array.isArray(nextFomcDates) ? nextFomcDates : [],
    oiMeta: oi
      ? { scannedAt: oi.scannedAt || null, scanType: oi.scanType || null }
      : null,
  };
  let inlineManifest;
  if (dataDir) {
    try {
      writeFileSync(resolve(dataDir, "manifest.json"), JSON.stringify(premiumManifest), "utf8");
      writeFileSync(resolve(dataDir, "manifest-free.json"), JSON.stringify(freeManifest), "utf8");
      inlineManifest = { ...shellManifest, deferred: true };
    } catch (_err) {
      // Couldn't write the sidecars \u2014 fail SAFE to a full inline manifest so the
      // page still works (a transient leak beats a blank app).
      inlineManifest = { ...shellManifest, ...freeManifest, ...premiumManifest };
    }
  } else {
    inlineManifest = { ...shellManifest, ...freeManifest, ...premiumManifest };
  }
  const manifestPayload = JSON.stringify(inlineManifest)
    .replace(/</g, "\\u003C").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  // app.js/styles.css are served with 1-year immutable caching keyed solely on
  // this ?v= token. The full bake mints a fresh builtAtIso every run, but
  // regen-static.mjs reuses the PRIOR bake's builtAtIso (it's the data's bake
  // time, shown in the header) — so render-only deploys must pass a fresh
  // assetVersion or cached clients keep the old script under the same URL.
  const cacheBust = encodeURIComponent(assetVersion || builtAtIso);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>stonks · Option Contract Rater</title>
<meta name="description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital." />
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="apple-touch-icon" href="favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="stonks · Option Contract Rater">
<meta property="og:description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="stonks · Option Contract Rater">
<meta name="twitter:description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css?v=${cacheBust}">
</head>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <div class="site-header-lead">
    <button id="side-nav-toggle" class="icon-btn side-nav-toggle" type="button" aria-label="Toggle navigation menu" aria-expanded="true" aria-controls="side-nav">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <a class="brand" href="/" aria-label="stonks home">
      <svg class="brand-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="3.3" fill="currentColor"/>
        <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="1.4 2.6" opacity="0.55"/>
      </svg>
      <span class="brand-word">stonks</span>
      <span class="brand-tag">Option Rater</span>
    </a>
    </div>
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
      <!-- Auth chip — content (member name + Log out, or a "Log in" CTA) is
           rendered at runtime by renderAuthChip() from /api/auth/me; hidden by
           default so nothing flashes before membership resolves. -->
      <div id="auth-chip" class="auth-chip" hidden></div>
    </nav>
  </div>
</header>
<p class="page-sub">Grade any ticker — conviction score, technicals, fundamentals, and a contract grader. ${tickerCount} curated tickers, refreshed daily.</p>
<div id="freshness-banner" class="freshness" data-built-at="${builtAtIso}" role="status" aria-live="polite">
  <span class="freshness-dot" aria-hidden="true"></span>
  <span id="freshness-text">Refreshed ${builtAt} (NY)</span>
  <span id="market-status" class="market-status" aria-live="off" hidden></span>
</div>
<!-- Collapsible sidebar navigation. Every destination is a flat, always-
     visible item (grouped under Flow / Macro / Tools / Legal section labels)
     instead of the old horizontal strip + dropdown menus. Items keep the
     same ids / data-page-tab / aria-controls wiring, so cmd-K targeting,
     the premium lock marker, and the role-hidden tab removal all work
     unchanged. Desktop: pushes content, defaults open, collapse persisted.
     Mobile: overlay drawer over a backdrop, auto-closes on navigation. -->
<div class="side-nav-backdrop" id="side-nav-backdrop" hidden></div>
<aside class="side-nav" id="side-nav">
<nav class="page-tabs" role="tablist" aria-orientation="vertical" aria-label="Page sections">
  <div class="side-nav-group">
    ${sideNavItem('home', 'Home', { selected: true })}
    ${sideNavItem('brief', 'Brief')}
    ${sideNavItem('tickers', 'Tickers')}
    ${sideNavItem('narratives', 'Narratives')}
    ${sideNavItem('market', 'Market analysis')}
    ${sideNavItem('picks', 'Top picks')}
    ${sideNavItem('stocks', 'Stock picks')}
    ${sideNavItem('calendar', 'Calendar')}
    ${sideNavItem('index-cal', 'Index calendar')}
    ${sideNavItem('track', 'Track record')}
  </div>
  <div class="side-nav-group">
    <div class="side-nav-group-label" aria-hidden="true">Flow</div>
    ${sideNavItem('heatmap', 'Heatmap')}
    ${sideNavItem('flow', 'Unusual flow')}
    ${sideNavItem('volume', 'Volume')}
    ${sideNavItem('oi', 'Gamma exposure')}
    ${sideNavItem('iv-trend', 'Trending IV')}
    ${sideNavItem('streaks', 'Streaks')}
  </div>
  <div class="side-nav-group">
    <div class="side-nav-group-label" aria-hidden="true">Macro</div>
    ${sideNavItem('overnight', 'Overnight markets')}
    ${sideNavItem('fear-greed', 'Fear &amp; Greed')}
    ${sideNavItem('bonds-usd', 'Bonds &amp; USD')}
    ${sideNavItem('ai-capex', 'AI CapEx')}
    ${sideNavItem('ram-prices', 'RAM prices')}
    ${sideNavItem('capital-raises', 'Capital raises')}
    ${sideNavItem('f13', '13F filings')}
  </div>
  <div class="side-nav-group">
    <div class="side-nav-group-label" aria-hidden="true">Tools</div>
    ${sideNavItem('grade', 'Grade a ticker')}
    ${sideNavItem('compare', 'Compare companies')}
    ${sideNavItem('strategies', 'Strategies')}
    ${sideNavItem('cheatsheet', "Buyer's manual")}
    ${sideNavItem('chart-patterns', 'Chart patterns')}
    ${sideNavItem('features', "What's included")}
  </div>
  <div class="side-nav-group">
    <div class="side-nav-group-label" aria-hidden="true">Legal</div>
    ${sideNavItem('privacy', 'Privacy Policy')}
    ${sideNavItem('terms', 'Terms of Use')}
  </div>
</nav>
</aside>
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
        <button type="button" class="landing-card" data-go="brief" aria-label="Read the market brief">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Market brief</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-brief">Hourly</div>
          <div class="landing-card-sub" id="land-sub-brief">market digest</div>
          <p class="landing-card-desc">An hourly read on what's interesting — the overnight setup, the session's movers, notable flow, what's next.</p>
        </button>
        <button type="button" class="landing-card" data-go="picks" aria-label="View top picks">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Top picks</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-picks">Today</div>
          <div class="landing-card-sub" id="land-sub-picks">highest conviction</div>
          <p class="landing-card-desc">Standout contracts the model pulled from today's chain — what we'd buy if we had to pick.</p>
        </button>
        <button type="button" class="landing-card" data-go="stocks" aria-label="View stock picks">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Stock picks</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-stocks">Shares</div>
          <div class="landing-card-sub" id="land-sub-stocks">buy-the-dip screen</div>
          <p class="landing-card-desc">Stocks, not options — good businesses currently beaten down, with yellow flags when the dip looks like something breaking.</p>
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
        <button type="button" class="landing-card" data-go="iv-trend" aria-label="View trending implied volatility">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Trending IV</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-ivt">IV ↑</div>
          <div class="landing-card-sub" id="land-sub-ivt">big moves brewing</div>
          <p class="landing-card-desc">Names whose implied vol is running above their own history and still climbing — options pricing in a bigger-than-usual move.</p>
        </button>
        <button type="button" class="landing-card" data-go="narratives" aria-label="Browse narratives">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Narratives</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-narratives">—</div>
          <div class="landing-card-sub">sectors covered</div>
          <p class="landing-card-desc">AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About AI-built theses" data-tip="Theses built by Google Gemini (default: gemini-2.5-flash-lite; override via NARRATIVES_MODEL env). Inputs: sector + industry news filtered to reputable publishers. Refreshed each daily build.">i</span>-built theses on what's driving capital today — longs, shorts, and the triggers to watch.</p>
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
        <button type="button" class="landing-card" data-go="market" aria-label="View market analysis">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Market analysis</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-market">Live</div>
          <div class="landing-card-sub" id="land-sub-market">risk-on / risk-off tape</div>
          <p class="landing-card-desc">The cross-asset market tape — VIX, dollar, yields, commodities, Fed path — plus the risk barometer and regime history.</p>
        </button>
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
        <p class="landing-section-sub">Grade any ticker top to bottom — then grade the exact contract you're eyeing.</p>
      </header>
      <div class="landing-grid">
        <button type="button" class="landing-card" data-go="grade" aria-label="Grade a ticker">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Grade a ticker</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat">Grade it</div>
          <div class="landing-card-sub">any ticker</div>
          <p class="landing-card-desc">The full 4-pillar conviction grade + AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About AI conviction" data-tip="Conviction blends news sentiment (Gemini, gemini-2.5-flash-lite), fundamentals verdict (Gemini, gemini-2.5-flash-lite), technicals (RSI/MACD/volume — deterministic, no AI), and macro tilt. Recomputed each daily build.">i</span> take, technicals, fundamentals, implied vol, news, and a contract grader for any tracked ticker.</p>
        </button>
      </div>
    </section>
    <p class="landing-foot">Or jump anywhere with the tab strip above · press <kbd>⌘K</kbd> for the command palette.</p>
  </div>
  <div class="page-pane" id="page-pane-brief" role="tabpanel" aria-labelledby="page-tab-brief" hidden>
  ${briefSection()}
  </div>
  <div class="page-pane" id="page-pane-tickers" role="tabpanel" aria-labelledby="page-tab-tickers" hidden>
  ${tickersSection({ symbols, sectors: SECTORS, industries: INDUSTRY_OF_TICKER })}
  </div>
  <div class="page-pane" id="page-pane-narratives" role="tabpanel" aria-labelledby="page-tab-narratives" hidden>
  ${narrativesSection()}
  </div>
  <div class="page-pane" id="page-pane-market" role="tabpanel" aria-labelledby="page-tab-market" hidden>
  ${marketAnalysisSection()}
  </div>
  <div class="page-pane" id="page-pane-picks" role="tabpanel" aria-labelledby="page-tab-picks" hidden>
  ${topPicksSection()}
  </div>
  <div class="page-pane" id="page-pane-stocks" role="tabpanel" aria-labelledby="page-tab-stocks" hidden>
  ${stockPicksSection()}
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
      <p class="hint">A Finviz-style market map of our curated tickers. Each tile is sized by market cap and colored either by today's % change (deeper green for bigger gainers, deeper red for bigger losers) or by relative volume (saturation tracks how heavy the volume is, hue still shows direction). Grouped by sector. Type in the search box to highlight a name, scroll to zoom (or use the zoom controls), drag to pan when zoomed in, and click a tile to jump to that ticker. ETFs are surfaced on the Bonds &amp; USD tab.</p>
      <div class="heatmap-controls" role="toolbar" aria-label="Heatmap controls">
        <label class="heatmap-control">
          <span class="heatmap-control-label">Group by</span>
          <select id="heatmap-group-select" aria-label="Group heatmap by">
            <option value="sector">Sector</option>
            <option value="industry">Industry</option>
          </select>
        </label>
        <label class="heatmap-control">
          <span class="heatmap-control-label">Color by</span>
          <select id="heatmap-color-select" aria-label="Color heatmap by">
            <option value="perf">Performance</option>
            <option value="rvol">Rel. volume</option>
          </select>
        </label>
        <div class="heatmap-control heatmap-search-control">
          <span class="heatmap-control-label">Find</span>
          <input type="search" id="heatmap-search" class="heatmap-search-input" placeholder="Ticker…" aria-label="Find a ticker on the heatmap" autocomplete="off" spellcheck="false" />
        </div>
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
      <div id="heatmap-rotation" class="heatmap-rotation" role="status" aria-live="polite" hidden></div>
      <div id="heatmap-breadth" class="heatmap-breadth" aria-live="polite"></div>
      <div id="heatmap-root" class="heatmap-root">Loading heatmap…</div>
      <div class="heatmap-legend" id="heatmap-legend" aria-hidden="true">
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
  <div class="page-pane" id="page-pane-index-cal" role="tabpanel" aria-labelledby="page-tab-index-cal" hidden>
  ${indexCalSection()}
  </div>
  <div class="page-pane" id="page-pane-overnight" role="tabpanel" aria-labelledby="page-tab-overnight" hidden>
  ${overnightSection()}
  </div>
  <div class="page-pane" id="page-pane-flow" role="tabpanel" aria-labelledby="page-tab-flow" hidden>
  ${unusualFlowSection()}
  </div>
  <div class="page-pane" id="page-pane-volume" role="tabpanel" aria-labelledby="page-tab-volume" hidden>
  ${volumeFlagsSection()}
  </div>
  <div class="page-pane" id="page-pane-oi" role="tabpanel" aria-labelledby="page-tab-oi" hidden>
  ${gexSection()}
  ${oiTrackerSection()}
  </div>
  <div class="page-pane" id="page-pane-grade" role="tabpanel" aria-labelledby="page-tab-grade" hidden>
  ${optionEvalSection()}
  </div>
  <div class="page-pane" id="page-pane-compare" role="tabpanel" aria-labelledby="page-tab-compare" hidden>
  ${compareCompaniesSection()}
  </div>
  <div class="page-pane" id="page-pane-strategies" role="tabpanel" aria-labelledby="page-tab-strategies" hidden>
  ${strategiesSection()}
  </div>
  <div class="page-pane" id="page-pane-iv-trend" role="tabpanel" aria-labelledby="page-tab-iv-trend" hidden>
  ${ivTrendSection()}
  </div>
  <div class="page-pane" id="page-pane-streaks" role="tabpanel" aria-labelledby="page-tab-streaks" hidden>
    <section class="card" id="streaks-section">
      <header class="card-header">
        <h2 class="card-title">Daily green / red streaks</h2>
        <span class="card-eyebrow" id="streaks-eyebrow" aria-live="polite"></span>
      </header>
      ${infoNote('How streaks are counted', `<p>Each ticker's current run of green or red daily closes. Streaks of 2+ days survive small counter days (a "tolerance bank" up to 1.5% cumulative, or up to 3 counter days in a row); a single counter day greater than 1.2%, hitting the 1.5% bank, or 4 counter days in a row breaks the run. Same-direction days heal the bank back to zero.</p>`)}
      <div class="streaks-controls" role="toolbar" aria-label="Filter and sort streaks">
        <label class="streaks-field streaks-field-search">
          <span class="streaks-field-label">Find</span>
          <input id="streaks-search" type="search" inputmode="latin" autocomplete="off" spellcheck="false" placeholder="Ticker…" aria-label="Filter streaks by ticker" />
        </label>
        <label class="streaks-field">
          <span class="streaks-field-label">Min run</span>
          <select id="streaks-min-select" aria-label="Minimum streak length">
            <option value="2">2+ days</option>
            <option value="3">3+ days</option>
            <option value="4">4+ days</option>
            <option value="5">5+ days</option>
          </select>
        </label>
        <label class="streaks-field">
          <span class="streaks-field-label">Sector</span>
          <select id="streaks-sector-select" aria-label="Filter by sector">
            <option value="">All sectors</option>
          </select>
        </label>
        <label class="streaks-sort">
          <span class="streaks-sort-label">Sort</span>
          <select id="streaks-sort-select" aria-label="Sort streaks">
            <option value="streak">Longest streak</option>
            <option value="cum">Biggest cumulative move</option>
            <option value="vol">Volume trend</option>
            <option value="last">Last close</option>
            <option value="tol">Closest to breaking</option>
            <option value="alpha">A → Z</option>
          </select>
        </label>
      </div>
      <div id="streaks-snapped" class="streaks-snapped" hidden></div>
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
      ${infoNote('About the Fear &amp; Greed index', `<p>A 0–100 sentiment gauge built by CNN from seven equally-weighted indicators of US equity-market psychology. Low readings (extreme fear) have historically preceded rebounds; high readings (extreme greed) often mark overheated conditions. Refreshed each build from <a href="https://www.cnn.com/markets/fear-and-greed" target="_blank" rel="noopener noreferrer">cnn.com/markets/fear-and-greed</a>.</p>`)}
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
      <div class="bonds-curve" id="bonds-curve" hidden>
        <!-- Treasury yield-curve chart injected client-side from the 2Y/10Y/30Y legs -->
      </div>
      <p class="hint">Yields and DXY are taken from the last daily build. Each tile shows the 1-day move (basis points for yields, % for DXY) classified against the movement scale below, plus the 5-day trend. A <span class="bonds-live-alert" aria-hidden="true">!</span> chip flags moves that hit the alert thresholds (DXY ±0.6% or 10Y ±10 bps on a daily close).</p>
      <p class="hint"><strong>CPI inflation &amp; unemployment</strong> are monthly BLS prints (the tile shows the reference month) rather than live quotes. Hot or re-accelerating inflation and a deteriorating labor market (the unemployment tile's <em>Sahm</em> read — the 3-month average vs. its low over the prior year; ≥0.5pp is the classic recession-onset signal) feed the cross-asset macro regime that tilts Top Picks risk-off, alongside the VIX, dollar, yields, Fed path, commodity-shock and news axes.</p>
    </section>

    <section class="card" id="bonds-context-card">
      <header class="card-header">
        <h2 class="card-title">What&rsquo;s moving &mdash; and why it matters</h2>
        <span class="card-eyebrow" id="bonds-context-eyebrow">Move drivers</span>
      </header>
      <div id="bonds-context" class="bonds-context">Reading today&rsquo;s drivers&hellip;</div>
      <p class="hint">A best-effort read of <em>why</em> today&rsquo;s move matters (or doesn&rsquo;t), beyond its size &mdash; correlated with the FedWatch hike/cut odds on the Calendar tab. It looks for the likely catalyst (a dated economic print, a day-over-day shift in rate-cut/hike odds, an imminent FOMC decision, a risk-off VIX spike) and names it. Deterministic and best-effort: it flags the suspected driver, not a certainty &mdash; pair with the news.</p>
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
    <details class="bonds-primer">
      <summary class="bonds-primer-summary">
        <span class="bonds-primer-summary-title">Learn: how bonds &amp; the dollar move stocks</span>
        <span class="bonds-primer-summary-hint">Primer &mdash; Treasury types, the 2Y/10Y/30Y, DXY, gold &amp; the dollar-stocks relationship</span>
      </summary>
      <div class="bonds-primer-body">
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
    </details>
  </div>
  <div class="page-pane" id="page-pane-ai-capex" role="tabpanel" aria-labelledby="page-tab-ai-capex" hidden>
  ${aiCapexSection()}
  </div>
  <div class="page-pane" id="page-pane-ram-prices" role="tabpanel" aria-labelledby="page-tab-ram-prices" hidden>
  ${ramPricesSection()}
  </div>
  <div class="page-pane" id="page-pane-capital-raises" role="tabpanel" aria-labelledby="page-tab-capital-raises" hidden>
  ${capitalRaisesSection()}
  </div>
  <div class="page-pane" id="page-pane-f13" role="tabpanel" aria-labelledby="page-tab-f13" hidden>
  ${f13Section()}
  </div>
  ${docPanesHtml()}
</main>
<footer class="site-footer">
  <div>Built <span class="muted">${builtAt} (NY)</span></div>
  <div class="muted">Greeks computed locally with Black-Scholes. Data: Yahoo Finance. For information only — not investment advice.</div>
  <div><a class="foot-discord" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener">Join our Discord to unlock premium</a></div>
  <div><a href="/?tab=features">What's included</a> · <a href="/?tab=privacy">Privacy Policy</a> · <a href="/?tab=terms">Terms of Use</a></div>
</footer>
<button id="back-to-top" class="back-to-top" type="button" aria-label="Back to top" title="Back to top">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
</button>
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
