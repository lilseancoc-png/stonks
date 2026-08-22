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
import { DISCORD_INVITE_URL, KO_FI_URL } from '../../lib/links.mjs';

// Reference / legal / info pages (Buyer's manual, Chart patterns, Privacy, and
// Terms) — formerly standalone .html files, now in-app tabs.
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
  news: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  tickers: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  narratives: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  market: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  picks: '<path d="m12 2.5 2.9 5.9 6.5 1-4.7 4.5 1.1 6.4L12 17.3l-5.8 3 1.1-6.4-4.7-4.5 6.5-1z"/>',
  stocks: '<path d="M3.5 20.5v-17"/><path d="M3.5 20.5h17"/><path d="m6.5 15.5 4-4.5 3 2.5 4.5-6"/><path d="M14.5 7.5H18V11"/>',
  rotation: '<path d="M20 7h-5V2"/><path d="M4 17h5v5"/><path d="M19 12a7 7 0 0 0-12-4.9L5 9"/><path d="M5 12a7 7 0 0 0 12 4.9L19 15"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18"/>',
  'index-cal': '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18M8 15h.01M12 15h.01M16 15h.01"/>',
  earnings: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18"/><path d="m6.5 17.5 3-3.5 2.5 2 4-4.5"/><path d="M13.5 11.5H16V14"/>',
  calls: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 20l1-4.9a8.4 8.4 0 0 1-1-4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/><path d="M8 10.5h8M8 14h5"/>',
  track: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14.5 2 2 4-4.5"/>',
  heatmap: '<rect x="3" y="3" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1"/>',
  flow: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  volume: '<path d="M6 20v-5M12 20V9M18 20V4"/>',
  oi: '<path d="m12 3 10 5.5L12 14 2 8.5Z"/><path d="m2 14.5 10 5.5 10-5.5"/>',
  streaks: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'iv-trend': '<path d="m3 17.5 6-6 4 4 8-8.5"/><path d="M14.5 7h6.5v6.5"/>',
  'ma-tracker': '<path d="M3.5 19.5h17"/><path d="M3.5 4.5v15"/><path d="m6 15 4-4 3 2 5-6"/><path d="M6 9.5h12"/>',
  spillover: '<circle cx="12" cy="12" r="2.5"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/><path d="M12 2a10 10 0 0 1 10 10"/>',
  quant: '<path d="M18 6.5V4H6l6.5 8L6 20h12v-2.5"/>',
  daytrade: '<path d="M3 12h4l2.2-5 4.2 10 2.1-5H21"/><circle cx="12" cy="12" r="9.5"/>',
  daytrack: '<path d="M4 19.5V10m5 9.5V5m5 14.5v-7m5 7V3"/><path d="M3 21h18"/>',
  levetf: '<path d="M3.5 20.5v-17"/><path d="M3.5 20.5h17"/><path d="m6 16.5 3.5-4 2.5 2 4-5.5"/><path d="m11.5 6.5 3-3 3 3"/><path d="M14.5 3.5v7"/>',
  overnight: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'fear-greed': '<path d="m12 14.5 3.5-3.5"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  'bonds-usd': '<path d="M12 2.5v19M16.5 5.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7"/>',
  'ai-capex': '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
  'ram-prices': '<rect x="2.5" y="6.5" width="19" height="9" rx="1.5"/><path d="M6 15.5v3M10 15.5v3M14 15.5v3M18 15.5v3"/><path d="M6.5 10v2M12 10v2M17.5 10v2"/>',
  'accelerator-prices': '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/><path d="m10.5 13 1.3-3 1.2 2 1.5-1"/>',
  'central-bank-gold': '<circle cx="12" cy="12" r="8.5"/><path d="M9 8.5h6M8.5 12h7M10 15.5h4"/><path d="M12 3.5v17"/>',
  'search-interest': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="M7.5 12.5 10 10l2 1.8 3-4"/>',
  'capital-raises': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  'ipo-credit': '<path d="M12 2.5c2.5 2 3.5 5 3.5 8l-1.5 3h-4L8.5 10.5c0-3 1-6 3.5-8z"/><path d="M10 13.5 8 18l2.5-1.5L12 19l1.5-2.5L16 18l-2-4.5"/><circle cx="12" cy="8.5" r="1.5"/>',
  commodities: '<path d="M3 20.5c0-6 3.5-9.5 9-9.5s9 3.5 9 9.5"/><path d="M12 11V3.5"/><path d="M12 3.5c2.5 0 4.5 1.5 5 3.5-2.5.5-4.5-.5-5-3.5zM12 3.5c-2.5 0-4.5 1.5-5 3.5 2.5.5 4.5-.5 5-3.5z"/>',
  f13: '<path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z"/><path d="M14 2.5v5h5"/><path d="M9 13h6M9 17h6"/>',
  grade: '<circle cx="12" cy="8.5" r="5.5"/><path d="m8.8 13.2-1.3 8 4.5-2.7 4.5 2.7-1.3-8"/>',
  compare: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M12 3.5v17"/>',
  strategies: '<circle cx="12" cy="12" r="9.5"/><path d="m15.8 8.2-2 5.6-5.6 2 2-5.6z"/>',
  cheatsheet: '<path d="M2.5 4.5H8a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2.5zM21.5 4.5H16a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h6.5z"/>',
  'chart-patterns': '<path d="M3.5 3.5v17h17"/><path d="m7.5 14 3.5-4 3 3 5-6.5"/>',
  timeline: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
  privacy: '<path d="M12 21.5s7.5-3.7 7.5-9.5V5.5L12 2.5l-7.5 3V12c0 5.8 7.5 9.5 7.5 9.5z"/>',
  terms: '<path d="M12 3v18M7 21h10"/><path d="M4 7h2.5c1.8 0 3.8-.7 5.5-1.7C13.7 6.3 15.7 7 17.5 7H20"/><path d="m6.5 7-2.8 6.7c.8.6 1.8.9 2.8.9s2-.3 2.8-.9zM17.5 7l-2.8 6.7c.8.6 1.8.9 2.8.9s2-.3 2.8-.9z"/>',
};

// One sidebar destination. Keeps the exact id / data-page-tab / aria-controls
// wiring the app JS, cmd-K palette, premium lock marker and role-hidden tab
// removal all key off — only the inner structure (icon + label span) is new.
// `label` is trusted static HTML (entities like &amp; allowed).
// `navHidden` keeps the button in the DOM (selectTab, cmd-K targeting, and
// every "open X in the Grade tab" link work through [data-page-tab] buttons)
// but hides it from the visible sidebar — used for destination-only panes
// like Grade a ticker, reached by clicking a ticker anywhere on the site.
function sideNavItem(id, label, { selected = false, navHidden = false } = {}) {
  const icon = SIDE_NAV_ICONS[id] || '';
  return `<button type="button" class="page-tab" role="tab" data-page-tab="${id}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="page-pane-${id}" id="page-tab-${id}"${navHidden ? ' data-nav-hidden="1"' : ''}><svg class="pt-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg><span class="pt-label">${label}</span></button>`;
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
  const optionCards = sorted.map((sym) => {
    const sec = sectors[sym] || "";
    const ind = industries[sym] || "";
    const subtitle = [sec, ind].filter(Boolean).join(" · ");
    return `<a class="ticker-card" href="?s=${encodeURIComponent(sym)}" data-ticker="${htmlEscape(sym)}" data-sector="${htmlEscape(sec)}" data-industry="${htmlEscape(ind)}">
      <span class="ticker-card-head">
        <span class="ticker-sym">${htmlEscape(sym)}</span>
        <span class="ticker-grade" data-grade-for="${htmlEscape(sym)}" hidden></span>
      </span>
      <span class="ticker-card-row">
        <span class="ticker-spot" data-spot-for="${htmlEscape(sym)}"></span>
        <span class="ticker-chg" data-chg-for="${htmlEscape(sym)}" hidden></span>
      </span>
      ${subtitle ? `<span class="ticker-sector">${htmlEscape(subtitle)}</span>` : ""}
    </a>`;
  }).join("");
  // VIX is a tracked market gauge, not an option-chain symbol. Keep it out of
  // the grader manifest/build loop, but give it a first-class directory card
  // whose live value comes from the fixed-symbol /api/macro-live endpoint.
  const trackerCards = `<button type="button" class="ticker-card ticker-card-tracker" data-ticker="^VIX" data-sector="Market gauge" data-industry="Volatility" data-tracker-only="vix" aria-label="Open VIX in Market analysis">
      <span class="ticker-card-head">
        <span class="ticker-sym">VIX</span>
        <span class="ticker-tracker-badge">market gauge</span>
      </span>
      <span class="ticker-card-row">
        <span class="ticker-spot" data-spot-for="^VIX"></span>
        <span class="ticker-chg" data-chg-for="^VIX" hidden></span>
      </span>
      <span class="ticker-sector">Market gauge · Volatility</span>
    </button>`;
  const cards = trackerCards + optionCards;
  const totalSymbols = sorted.length + 1;
  // Unique sectors for the filter chips. Sort by occurrence count so the
  // densest sectors come first — matches how the user is likely to scan.
  const sectorCounts = {};
  sorted.forEach((sym) => { const sec = sectors[sym] || ""; if (sec) sectorCounts[sec] = (sectorCounts[sec] || 0) + 1; });
  const sectorOptions = Object.keys(sectorCounts)
    .sort((a, b) => sectorCounts[b] - sectorCounts[a])
    .map((sec) => `<option value="${htmlEscape(sec)}">${htmlEscape(sec)} (${sectorCounts[sec]})</option>`)
    .join("");
  return `<section class="card" id="tickers-section">
    <header class="card-header">
      <h2 class="card-title">Ticker tracker</h2>
      <span class="card-eyebrow"><span id="tickers-visible-count">${totalSymbols}</span> / ${totalSymbols} symbols</span>
      <span class="tab-live-state" id="tickers-live-state" aria-live="polite"></span>
    </header>
    <p class="hint">Search the universe, rank its strongest directional grades, then separate thesis strength from entry timing. Stocks and ETFs open the full contract grader; market gauges such as VIX open the market-tape view.</p>
    <div class="tickers-model-summary" id="tickers-model-summary" hidden aria-live="polite"></div>
    <div class="tickers-controls">
      <label class="tickers-field tickers-search-wrap">
        <span class="tickers-field-label">Find</span>
        <input type="search" id="tickers-search" class="tickers-search" placeholder="Ticker, sector, industry…" autocomplete="off" aria-label="Search tickers, sectors, or industries" />
      </label>
      <label class="tickers-field">
        <span class="tickers-field-label">Sector</span>
        <select id="tickers-sector" class="tickers-select" aria-label="Filter tickers by sector">
          <option value="">All sectors (${totalSymbols})</option>
          <option value="Market gauge">Market gauge (1)</option>
          ${sectorOptions}
        </select>
      </label>
      <label class="tickers-field">
        <span class="tickers-field-label">Sort</span>
        <select id="tickers-sort" class="tickers-select" aria-label="Sort ticker directory">
          <option value="conviction">Strongest conviction</option>
          <option value="ready">Entry-ready first</option>
          <option value="alpha">Ticker A → Z</option>
        </select>
      </label>
      <button type="button" class="tickers-ready" id="tickers-ready" aria-pressed="false" disabled>Entry ready only</button>
    </div>
    <p class="tickers-model-note" id="tickers-model-note">Loading model grades…</p>
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
    ${infoNote('How to use a market narrative', `<p>A narrative tells you <em>where to look</em>, not when to enter. Start with the trade posture and its first invalidation check, then confirm the individual ticker in the Grade tab before risking capital. Sector and story cards keep lifecycle, fundamentals-vs-hype, bull/base/bear scenarios, industry grades, and source evidence under expandable detail so the decision state stays visible first.</p>`)}
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
    <p class="hint">The cross-asset risk read that sets the engine&rsquo;s posture &mdash; the live market tape, a conditional 5&ndash;10-session scenario and sensitivity layer, a frozen premarket leader/laggard follow-through check, the risk-on / risk-off barometer, and daily regime history &mdash; plus a grade lookup for any tracked ticker. Position-specific guidance lives in Owner Lab.</p>
    <div id="market-regime-strip" class="picks-summary"><span id="picks-regime-chip" class="picks-regime-slot"></span></div>
    <div id="market-action" class="market-action" hidden aria-live="polite"></div>
    <div id="market-scenario-engine" class="market-scenario-engine" hidden aria-live="polite"></div>
    <div id="market-premarket-movers" class="market-movers" hidden aria-live="polite"></div>
    <div id="picks-regime-drift" class="picks-regime-drift" hidden aria-live="polite"></div>
    <div id="picks-tape" class="picks-tape" hidden></div>
    <div id="picks-barometer" class="picks-barometer" hidden></div>
    <div id="picks-regime-hist" class="picks-regime-hist" hidden></div>
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
        <p>A <b>fixed, auditable</b> grading system. Every tracked name receives a directional asset read from four pillars (<b>Fundamentals</b>, <b>Technicals</b>, <b>Mechanicals</b>, <b>Narrative</b>), followed by a bounded IV-cost adjustment and a continuous, direction-aware market-regime overlay. <b>Entry timing is a separate execution decision, not part of conviction</b>: a strong thesis can stay strong while the correct action is Wait or Avoid. Normal candidates must clear the conviction floor both before and after the regime overlay, plus the thesis-quality review and every execution gate, to become actionable; the existing risk-off tactical-put path remains a reduced-size, watch-only defensive exception. The list is deliberately allowed to be <b>short, or empty</b>, on a poor day &mdash; the engine would rather hold cash than pad it. Each card has a <b>Recommendation&nbsp;&#8644;&nbsp;Grade</b> toggle &mdash; flip to Grade to audit every signal behind the score &mdash; plus a named entry strategy, a layered exit ladder, and a same-sector peer comparison. The <b>Track record</b> tab marks past picks to market (modeled option P&amp;L).</p>
        <p><b>The grade and execution read.</b> The four asset pillars are each clamped to &plusmn;5. IV Cost is bounded to &minus;2&hellip;+1 and changes conviction symmetrically for calls and puts without changing the side. The regime overlay is applied after pillars + IV and before ranking; Entry Timing stays separate at &minus;8&hellip;+2 and decides whether to Go, Wait for a named trigger, or Avoid. Grade tiers retain fixed absolute bars even though the IV-cost input is deliberately standardized across the current eligible universe.</p>
        <p><b>Fundamentals.</b> Earnings surprise, EPS/revenue growth, analyst targets and rating changes, valuation versus sector, guidance, major contracts, capital raises/dilution, free cash flow, margin trend and forward trajectory answer: <i>is the business getting better or worse?</i> A bounded <b>CapEx quality</b> read (&minus;2&hellip;+1) compares sequential and year-over-year CapEx/Sales &mdash; or CapEx/Operating Cash Flow only when OCF is positive &mdash; with the company&rsquo;s own history and eligible sector peers. Scoring needs at least five aligned quarters and a latest quarter no more than 200 days old; thin or stale history is unavailable and neutral. Unsupported acceleration is a warning; a modest positive requires sourced growth confirmation plus improving capital efficiency. Missing backlog or true ROIC evidence stays explicitly unavailable rather than being inferred from headlines, generic guidance, ROA or ROE.</p>
        <p><b>Technicals.</b> RSI movement and reversal-confirmed extremes, MACD, the moving-average stack, streaks, confirmed support/resistance breaks, 52-week position and a current confirmed chart pattern describe the chart. Price/volume dislocation is <b>one capped standardized-move family</b>: 5-, 10- and 20-session return z-scores plus volume z, interpreted with ATR distance and Bollinger location. Trend-aligned expansion may confirm continuation only when the latest confirmed bar and its volume agree; conflicting extreme horizons fail neutral. An unsupported upside extreme feeds exhaustion; a downside extreme earns mean-reversion credit only after support holds on drying volume. <b>Unsigned raw relative volume never earns or loses a Technicals point.</b></p>
        <p><b>Mechanicals.</b> Unusual options flow, open-interest call/put skew, current FINRA short interest and <b>direction-signed</b> unusual underlying volume ask what positioning and participation are doing. A volume spike can support the move&rsquo;s actual direction here; raw volume by itself is never automatically bullish.</p>
        <p><b>Narrative.</b> AI-read recent-news catalysts (good +2 / bad -3), an active sector tailwind/headwind (&plusmn;2, faded by lifecycle), and current social sentiment (&plusmn;1) describe the story driving the name. Systemic tape inputs are handled by the regime overlay instead of being restacked as ticker-level Narrative points.</p>
        <p><b>IV Cost (&minus;2&hellip;+1).</b> The current ATM ~30-day IV percentile/z versus the name&rsquo;s own history remains visible interpretation and option-structure context. Grade points come from the fresh eligible cohort&rsquo;s universe-relative standardization; if the cohort has fewer than 10 usable names or no meaningful dispersion, the IV contribution is neutral. Relatively expensive premium reduces call and put conviction equally, cheap premium adds less, and the adjustment cannot flip the side. A materially inverted front end adds only a small &minus;0.5 penalty when unexplained; an earnings or scheduled-macro event that explains the inversion owns that risk, so it is not counted twice.</p>
        <p><b>Entry timing (execution-only, &minus;8 &hellip; +2).</b> Asset quality aside, <i>is now a good moment?</i> One aligned confirmed-daily OHLCV series feeds five component groups: extension/exhaustion, pullback/setup quality, momentum confirmation, event proximity, and structure/payoff. A deterministic Go requires a score of at least +2, positive directional confirmation, at least two independent evidence families, a call invalidation below entry or put invalidation above entry within 2 ATR, estimated reward/risk of at least 1.5:1, and the full crowded/counter-regime proof, including a reclaim when required. Earnings or a major macro event inside the <b>next two trading sessions</b> is a hard Wait. AI and the live quote overlay cannot promote a negative, incomplete, hard-Wait or Avoid setup or waive a prerequisite; a live trigger with incomplete baked readiness only arms an alert.</p>
        <p><b>How the market tape moves the picks.</b> The cross-asset gauge combines the current tape &mdash; indexes, VIX, yields, dollar, commodities, Fed path, breadth, put/call, HY credit, MOVE and rotation &mdash; with the forward Scenario Engine&rsquo;s continuation, exhaustion, risk-off, warning and gross-cap reads. That produces one continuous Regime Bias (approximately &minus;2&hellip;+2), applied only after the four pillars + IV Cost and before roster ranking. Positive bias supports calls and dampens puts; negative bias does the reverse. The side is frozen before the overlay, so regime can demote or re-rank but cannot flip a call into a put, rescue a below-bar name, or promote a Moderate grade into Strong. Entry Timing remains separate and hard vetoes still bind.</p>
        <p><b>&bull; Regime-conditioned proof.</b> Alignment is side-correct: a put can align with a bearish primary scenario just as a call can align with a bullish one. In dominant high-gross continuation, an against-primary name must already be Strong / Very High before the overlay and cannot receive a regime boost; aligned names receive only a small bounded ranking preference. Counter-regime trades also need a reclaim, full momentum confirmation and clean structure. A clean pullback aligned with the tape is not penalized merely because the regime agrees.</p>
        <p><b>Tiers &amp; sizing.</b> Tiers use fixed absolute bars: |grade| &ge;7 is Strong, 4&ndash;6 is Call/Put, and below 4 is No&nbsp;Trade. A normal name must clear its pre-regime bar, and the overlay cannot promote it across a bar or tier; the labeled tactical-put exception never becomes Actionable. Clearing the grade bar still does not guarantee an actionable pick &mdash; thesis quality and every execution gate bind, so the list can remain short or empty, and an empty current build never republishes prior picks as current. Size is risk-based, not flat: each pick is weighted inverse to the premium it would lose to its stop and tilted by conviction. Scenario per-name reductions and the tactical 0.5&times; cap are enforced after normalization so released allocation stays cash; market gross and a negative recent <i>realized</i> track record may trim the book further.</p>
        <p><b>Suggested contract.</b> A near-the-money option &mdash; delta 0.45-0.65 (target ~0.55), which carries far less theta and IV-crush fragility than a cheap far-OTM lottery ticket &mdash; with IV &lt;200%, 30&ndash;90 days to expiry (ideal 45&ndash;75), standard monthly expirations, a tight spread, real open interest, and premium capped at the greater of $35/share or 12% of spot. The &ldquo;In plain English&rdquo; panel translates the bet into beginner terms.</p>
        <p><b>Entry &amp; exit plan.</b> Each pick matches one of six named strategies (Pullback to Confluence, Breakout + Retest, Moving-Average Pullback, Support + Confirmation, RSI + Divergence, Volume Breakout) with scale-in tranches at confluence prices, and a layered exit ladder &mdash; meaningful levels above and below spot, each with an action and its reasoning. The hard stop is volatility-aware (a multiple of ATR, so ordinary noise doesn&rsquo;t shake the trade out), and the track record additionally cuts in <b>premium</b> terms (a fixed % loss of the option), since a symmetric move on the stock is a very asymmetric move on the contract. Triggers also cover earnings-in-window IV-crush risk and stretched RSI. There is <b>no time stop and no pre-earnings exit</b>: a trade is held &mdash; through earnings prints included &mdash; for as long as its original thesis stays intact and the contract hasn&rsquo;t expired.</p>
        <p><b>How to read it &mdash; and what it isn&rsquo;t.</b> The fixed grade bars rank names consistently, while IV Cost contributes one explicitly universe-relative comparison; neither promises an absolute edge. The engine is candidly <b>research / unproven</b> &mdash; its directional signal has not yet shown a validated edge on forward data, and the track record&rsquo;s option P&amp;L is <i>modeled</i> (there is no live options-price feed). Buying a call or put risks the entire premium. None of this is financial advice; treat the picks as a starting watchlist, not a recommendation to trade.</p>
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
      <p>A pick <b>resolves</b> when the underlying reaches its take-profit (<span class="acc-ok">win</span>), hits its cut (<span class="acc-bad">loss</span>), <b>breaks its thesis</b> (the live grade flips to the opposite side, the stop level is breached, or every supporting driver goes quiet), or expires (graded vs. breakeven). There is no time stop, no pre-earnings exit, and no weekly force-close &mdash; a position is held, through earnings prints included, for as long as its original thesis stays intact and the contract has time left. The <b>Summary</b> tab is the rules-based engine report: an overall health verdict, why the losers lost (direction miss vs. theta bleed), why the winners won, which segments are working vs. lagging, and a specific "what to fix next" list — all computed from the resolved record, no AI. The <b>win rate by tier</b> asks whether higher-conviction scores actually win more. <b>Top&nbsp;10 — picks in &amp; out</b> shows the current 10-name roster, what changed in the 4 pillars since the last refresh, what dropped out and what replaced it, and a rules-based upgrade/downgrade read on each name (click a row for the full rubric); <b>Recent crossings</b> is the chronological log of names crossing the conviction bar on or off the actionable set; <b>Grade changes</b> logs every ticker whose grade moves up or down (and why); each pick&rsquo;s <b>Day&nbsp;0 / 2wk / 1mo</b> checkpoints show whether the price moved the way the score predicted. The <b>Equity</b>, <b>Breakdowns</b>, <b>Simulator</b>, and <b>Monte&nbsp;Carlo</b> tabs add a modeled-dollar profitability lens — an equity curve + drawdown, per-DTE / PoP / thesis / conviction tables and cross-tabs, a hypothetical $100k risk-managed book, and a bootstrap of the outcome distribution. The <b>Market-sized</b> lens and <b>Market environment</b> simulator mode use the daily Market Analysis history: defensive sizing is $5k instead of $10k, full size returns after 3 consecutive risk-on sessions, and 2 consecutive risk-off sessions cut it back in half; neutral stays defensive. Top Picks and its record refresh twice each market day, at 11:00 and 15:30 ET, not intraday.</p>
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
      <div id="accuracy-empty" class="accuracy-empty" hidden>No picks have been tracked yet — the record starts filling in on the next scheduled Top Picks run.</div>
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
      <button type="button" class="card-jump" id="calendar-idxcal-link" data-go="index-cal" title="Open the Owner index calendar">Index calendar &rarr;</button>
      <span class="card-eyebrow" id="calendar-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote("What's on this calendar?", `<p>A month-at-a-time view of every dated market event, opening on the <b>current month</b> — use <b>&lsaquo;</b> / <b>&rsaquo;</b> to step between months (or <b>Today</b> to jump back), and tap any day to see its full details below the grid. It tracks: confirmed earnings dates (with AM/PM session tagging) for every curated ticker, cross-checked against a rolling 21-day Nasdaq sweep; ticker-specific catalysts (FDA dates, contract decisions, product launches, court rulings, investor days — extracted from recent news); the complete official <b>BLS</b> and <b>BEA</b> release schedules; the Federal Reserve Board calendar (speeches, testimony, minutes, conferences, and statistical releases); the Kansas City Fed&rsquo;s Jackson Hole symposium; detailed market-moving reports with Actual / Previous / Consensus values; and upcoming FOMC decisions. Official source labels open the publisher&rsquo;s calendar. Effective Fed Funds, FedWatch probabilities, the official vote map, and the full rate path live together in <b>Bonds &amp; USD</b>. Ticker chips are clickable.</p>`)}
    <div id="calendar-briefing" class="cal-briefing" hidden aria-live="polite"></div>
    <div id="calendar-overview" class="cal-overview" hidden></div>
    <div class="calendar-controls" role="toolbar" aria-label="Filter calendar">
      <div class="calendar-type-filter" role="radiogroup" aria-label="Filter by event type">
        <button type="button" class="calendar-pill is-on" data-cal-type="all" role="radio" aria-checked="true">All<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="earnings" role="radio" aria-checked="false">Earnings<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="catalysts" role="radio" aria-checked="false">Catalysts<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="reports" role="radio" aria-checked="false">Reports<span class="calendar-pill-count" aria-hidden="true"></span></button>
        <button type="button" class="calendar-pill" data-cal-type="fomc" role="radio" aria-checked="false">Fed<span class="calendar-pill-count" aria-hidden="true"></span></button>
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
  // client-side from data/index-calendar.json (Owner; lazy-fetched on first
  // tab activation by loadIndexCal() in app.js).
  return `<section class="card" id="index-cal-section">
    <header class="card-header">
      <h2 class="card-title">Index calendar</h2>
      <span class="card-eyebrow" id="index-cal-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read the index calendar', `<p>Use the month grid as a <b>cross-asset participation record</b>: SPY, QQQ, IWM, SMH, DIA and VXUS show whether equity strength is broad or concentrated; TLT, GLD and VIX add rate, defensive and stress context. Click a day to compare all nine instruments. Beneath it, the <b>First &amp; last hour tracker</b> logs SPY / QQQ / IWM from regular-session 30-minute bars: previous close&rarr;open gap, 9:30&rarr;10:30&nbsp;ET return/range/volume, 10:30&rarr;close recovery or continuation, 3:00&rarr;4:00&nbsp;ET return, open&rarr;close result, and whether the day&rsquo;s high or low first printed in the opening hour, middle, or closing hour. Conditional cards answer what followed an opening move of at least your chosen threshold; gap and prior-close VIX filters add regime context. Green means up except for VIX, where green means volatility eased. Today begins populating after 10:30 and finalizes after the close. Not financial advice.</p>`)}
    <div id="index-cal-root" class="idx-cal-root">Loading index calendar&hellip;</div>
  </section>`;
}

function stockPicksSection() {
  // Card chrome only — the quality-dip candidate cards render client-side
  // from data/stock-picks.json (Owner; lazy-fetched on first tab activation
  // by loadStocks() in app.js). A separate product from Top Picks: shares,
  // not option contracts.
  return `<section class="card" id="stocks-section">
    <header class="card-header">
      <h2 class="card-title">Stock picks</h2>
      <span class="card-eyebrow" id="stocks-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read stock picks', `<p>Share ideas, <em>not</em> option contracts &mdash; the Top Picks tab times leveraged trades; this page runs one buy-the-dip playbook over the same ${'~'}138-name universe, built on <b>three separate questions answered independently</b> (never blended into one number). <b>1&nbsp;&middot;&nbsp;Is it a good business?</b> A hard quality gate: consistently profitable (positive net margin or free cash flow), a manageable debt load (more cash than debt, or debt/equity &le;&nbsp;2x), net margins holding vs a year ago, and revenue still growing on a trailing-twelve-month view. Names that fail are never shown, however far they&rsquo;ve fallen &mdash; that&rsquo;s how value traps get in. <b>2&nbsp;&middot;&nbsp;Is it beaten down right now?</b> Five reads of &ldquo;cheap vs its own recent self&rdquo;: RSI(14) under 35, 4%+ below the 50-day average, 15%+ off the 52-week high, stretched &minus;2&sigma; against its 20-day mean (&asymp; the lower Bollinger band), and lagging SPY by 4+ points over ten sessions (company-specific selling, not a market-wide selloff). Each read is z-scored <em>across the quality-passed universe</em> and averaged into the card&rsquo;s <b>dip score</b>, so the page surfaces the most unloved names relative to each other rather than leaning on fragile fixed thresholds; a name needs at least two reads fired to list at all. <b>3&nbsp;&middot;&nbsp;Is it down because something actually broke?</b> Yellow trap flags &mdash; a fresh earnings print inside the drop, heavy-volume selling, a long red streak, analysts cutting estimates, a bearish news tone, or a binary event just ahead. Flags never block a candidate; they ride the card so the final call stays with you. The execution read then separates <b>Start small</b> (clean dip plus a positive close and improving RSI), <b>Wait for turn</b> (clean but still deteriorating), and <b>Research first</b> (one or more trap flags). Every card names the current entry or confirmation trigger, the nearest structural level that forces a thesis review, the first mean-reversion objective, and the reference payoff between them. The review level is not an automatic stop &mdash; long-horizon owners must re-underwrite the business there. Every card also carries an expandable <b>investment thesis checklist</b> &mdash; the full owner&rsquo;s due-diligence list (management &amp; moat, financial health &amp; cash flow, unit economics, valuation &amp; growth, macro sensitivity, risks &amp; scenarios) with each question answered from the tracked data where possible and honestly labeled <em>unsure</em> (a heuristic or proxy read) or <em>unanswered</em> (not visible in our data) where it isn&rsquo;t. Fully deterministic, recomputed at 11:00 and 15:30 ET, and honest &mdash; a tape with no quality name on sale shows nothing. Not financial advice.</p>`)}
    <div id="stocks-root" class="stk-root">Loading stock picks&hellip;</div>
  </section>`;
}

function sectorRotationSection() {
  // Card chrome only — the sector-led rebound candidates render client-side
  // from data/sector-rotation.json (Owner; lazy-fetched on first tab
  // activation). The screen separates a shared group washout from company-
  // specific damage, then waits for the stock itself to prove it is turning.
  return `<section class="card" id="rotation-section">
    <header class="card-header">
      <h2 class="card-title">Sector rotation</h2>
      <span class="card-eyebrow" id="rotation-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use this fundamentals-first rebound desk', `<p><b>This tab is a long-only quality-recovery screen for peer washouts</b> &mdash; not a sector-ETF allocation model, the Market Tape offense/defense gauge, or the Heatmap breadth alert. Start with the <b>Quality Recovery Shortlist</b>, then use the detailed board to answer five questions in order: is the business intact, why was it beaten down, what evidence supports recovery, is valuation reasonable, and has price confirmed an entry with acceptable payoff? <b>Qualified recovery</b> means the profile&rsquo;s required evidence clears; <b>Verify first</b> remains non-actionable until incomplete or uncertain business and forward evidence is resolved; and <b>Rejected</b> profiles stay in the near-miss research section rather than the candidate board. Each card shows the underlying profitability, balance-sheet, revenue, margin and coverage evidence when supplied, separates a sourced positive recovery driver from a statistical mean-reversion case, labels missing valuation rather than assuming a lower price is cheap, and keeps thesis risks visible before the trade plan. The rotation model then tests whether a strong company fell with a broadly damaged peer group instead of because its own business broke. For each survivor it freezes the pre-drop trend mean and robust standard deviation at the episode peak, requires the trough close to reach at least <b>&minus;1.5&sigma;</b>, and measures how much of that dislocation has reverted without allowing the mean to drift down toward price. <b>Washed out</b> is extreme but unproven, <b>first thrust</b> waits for a controlled pullback, <b>confirmed</b> requires group and stock follow-through with runway left, and <b>late</b> means the edge is mostly spent. The plan uses the earlier of the frozen mean and structural resistance as its first target and invalidates below the actual trough; no score, z-score, or live quote can upgrade a Verify-first or Rejected recovery profile into an actionable trade. The accountability ledger enrolls only the first baked <b>ready</b> signal confirmed by a recent in-zone regular-session quote, then freezes entry, stop and target. Live quotes can update price, payoff and sizing between bakes, but not the baked business evidence or statistical classification. &sigma; is context, not a probability or a promise that price must revert. Not financial advice.</p>`)}
    <div id="rotation-root" class="rot-root">Loading sector rotation screen&hellip;</div>
  </section>`;
}

function leveragedEtfsSection() {
  // Card chrome only — the leveraged-ETF idea cards render client-side from
  // data/leveraged-etfs.json (Owner; lazy-fetched on first tab activation by
  // loadLevEtf() in app.js, then decorated with live quotes via /api/quotes).
  // Functions like Top Picks but the instrument is a leveraged ETF, not an
  // option contract.
  return `<section class="card" id="levetf-section">
    <header class="card-header">
      <h2 class="card-title">Leveraged ETFs</h2>
      <span class="card-eyebrow" id="levetf-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use this trade desk', `<p>Start with <b>Enter now</b> versus <b>Wait</b>, then read the card&rsquo;s <b>underlying entry, invalidation and first target</b> before looking at the leveraged ticker. The risk planner converts your account-level loss cap and the card&rsquo;s estimated ETF stop width into a maximum share count once the live quote arrives. Levels are deterministic and live on the underlying; the ETF percentages are only a same-day leverage translation, so gaps, daily resets, spreads and tracking error can make the actual exit worse. The screen maps the grade engine&rsquo;s trend / flow / fundamentals / narrative read onto verified listed products, requires breadth for sector trades, strips the options-only IV-cost pillar, and never invents a missing vehicle. Reset drag, carry, earnings risk, tape alignment and the simulated path remain on every card because a good direction with a bad vehicle or hold period is still a bad trade. Short-horizon trading tools only; not financial advice.</p>`)}
    <div id="levetf-root" class="lev-root">Loading leveraged ETF screen&hellip;</div>
  </section>`;
}

function briefSection() {
  // Card chrome only — the pre-market + scheduled decision brief renders client-side
  // from data/briefs.json (fetched lazily on first tab activation by
  // loadBrief() in app.js).
  return `<section class="card" id="brief-section">
    <header class="card-header">
      <h2 class="card-title">Market brief</h2>
      <span class="card-eyebrow" id="brief-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">An AI<span class="tip ai-info" tabindex="0" role="button" aria-label="About the market brief" data-tip="One rolling digest per trading day (default gemini-3.1-flash-lite; override AI_BRIEF_MODEL). A lightweight Brief-only job writes the morning setup at 8:30 a.m. ET from overnight and foreign moves, macro levels, Fear &amp; Greed, the day's calendar and the prior verified public market data; private Owner desks never feed this payload and no full pre-market bake runs. Session builds refresh it at 11:00 and 13:30, and the 16:10 close build writes the closing read. AI writes the headline and prose; standouts, chips and stats are computed.">i</span>-written market digest: a fresh overnight setup, focused 11:00 and 13:30 session updates, and a closing read after 4&nbsp;pm ET. Each update checks the site&rsquo;s live tools and surfaces only material standouts. Ticker chips are clickable. Not financial advice.</p>
    <div id="brief-root" class="brief-root">Loading brief&hellip;</div>
  </section>`;
}

function newsFeedSection() {
  // Compact, free triage queue from data/news-feed.json. The feed is built
  // from current raw per-ticker headlines, published economic prints, and the
  // market-wide press slate behind Briefs; it excludes premium prose/signals.
  return `<section class="card" id="news-feed-section">
    <header class="card-header">
      <h2 class="card-title">News desk</h2>
      <span class="card-eyebrow" id="news-feed-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Straight headlines for every covered stock plus a dedicated macro lane for Fed, inflation, labor, growth, policy and energy news. Published economic releases include actual, consensus and prior values. Stories are ranked by likely materiality and active tape, with evidence kept separate from market direction.</p>
    ${infoNote('How news priority works', `<p><b>High impact</b> surfaces hard company events plus major inflation, labor, Fed and policy catalysts. <b>Notable</b> catches analyst actions, launches, restructuring, growth data and fast-moving market context; everything else stays <b>Context</b>. Freshness, source quality and corroboration can move a story up. For articles, the green / red direction chip is read only from the headline wording. For a published economic print it stays <b>Unclear</b>, because hotter, cooler, stronger or weaker data is factual evidence &mdash; not a universal bullish or bearish verdict.</p><p><b>Active tape</b> means a related ticker or broad index is moving materially or trading unusually heavy at the same time; it does <em>not</em> prove the headline caused that move. Use it as a verification queue: open the source, confirm the event is new, then check whether price and volume agree. Carried-forward context is labeled, unconfirmed stories are labeled, and exact duplicate links are collapsed without removing distinct coverage of the same event.</p>`) }
    <div id="news-feed-summary" class="news-feed-summary" aria-live="polite"></div>
    <div class="news-feed-toolbar" role="search" aria-label="Filter news">
      <label class="news-feed-search-wrap">
        <span class="sr-only">Search headlines, tickers, or publishers</span>
        <input type="search" id="news-feed-search" class="news-feed-search" placeholder="Search ticker, macro topic, source&hellip;" autocomplete="off" />
      </label>
      <div class="news-impact-filter" role="group" aria-label="News triage view">
        <button type="button" class="news-filter-chip is-active" data-news-view="" aria-pressed="true">All</button>
        <button type="button" class="news-filter-chip" data-news-view="macro" aria-pressed="false">Macro</button>
        <button type="button" class="news-filter-chip" data-news-view="active" aria-pressed="false">Active tape</button>
        <button type="button" class="news-filter-chip" data-news-view="high" aria-pressed="false">High impact</button>
        <button type="button" class="news-filter-chip" data-news-view="notable" aria-pressed="false">Notable+</button>
      </div>
      <label class="news-feed-select-wrap"><span>Sort</span>
        <select id="news-feed-sort" aria-label="Sort news">
          <option value="impact">Impact first</option>
          <option value="latest">Latest</option>
        </select>
      </label>
    </div>
    <details class="news-more-filters" id="news-more-filters">
      <summary>More filters <span id="news-filter-count" class="news-filter-count" hidden></span></summary>
      <div class="news-more-grid">
        <label><span>Desk</span><select id="news-feed-scope"><option value="">Stocks + macro + market</option><option value="company">Covered stocks</option><option value="macro">Macro economy</option><option value="market">Market pulse</option></select></label>
        <label><span>Direction</span><select id="news-feed-direction"><option value="">Any direction</option><option value="positive">Favorable</option><option value="negative">Adverse</option><option value="mixed">Mixed</option><option value="unclear">Unclear</option></select></label>
        <label><span>Sector</span><select id="news-feed-sector"><option value="">All sectors</option></select></label>
        <label><span>Category</span><select id="news-feed-category"><option value="">All categories</option></select></label>
        <label><span>Age</span><select id="news-feed-age"><option value="168">Past 7 days</option><option value="72">Past 72 hours</option><option value="24">Past 24 hours</option><option value="6">Past 6 hours</option></select></label>
      </div>
    </details>
    <div id="news-feed-root" class="news-feed-root" aria-live="polite">Loading news&hellip;</div>
    <div id="news-feed-empty" class="news-feed-empty" hidden>No headlines match those filters.</div>
    <button type="button" id="news-feed-more" class="news-feed-more" hidden>Show more</button>
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
    ${infoNote('How to read overnight markets', `<p>Cross-market lead-lag signals. Asian cash markets and FX trade and close <em>before</em> the US opens, so an overnight move in a foreign peer is a leading read on its US counterpart — Samsung &amp; SK Hynix selling off in Seoul flags memory names like MU; a yen-carry unwind in Tokyo flags broad US risk. Use <b>24H / 5D / 20D</b> to separate a fresh overnight shock from a developing swing trend, then click any market card for its path, convention, source, and linked US names. The Japan-carry desk combines official Japan 2Y/10Y yields, the US-minus-Japan 10Y spread, AUD/JPY and EUR/JPY, and an effective-rate differential (EFFR minus the BOJ overnight call rate). Currency strength is a simple equal-weight relative comparison across USD, JPY, EUR, AUD and GBP. The USD/JPY volatility tile is a clearly labeled near-30-day FXY ATM-straddle proxy because the institutional OTC/CME benchmark requires licensed distribution.</p><p>Beyond tech, commodities and rates drive their own sectors: crude (energy &amp; fuel-heavy logistics), copper (industrials), gold/silver vs the dollar (metals), nat gas (power), long yields (banks, homebuilders, TLT) and bitcoin (crypto-levered names). Markets that close before the US open are genuine <b>leading</b> reads; <b>concurrent</b> (Europe, cash VIX/yields) and <b>24h</b> tiles are tagged as co-movement, not a lead. The latest completed sessions refresh from the fixed live market feed while this tab is open; longer histories and correlations remain tied to the verified build snapshot, so different market clocks can still carry different as-of dates.</p>`)}
    <div id="overnight-decision"></div>
    <div id="overnight-broad" class="overnight-broad" aria-label="Global backdrop"></div>
    <div id="overnight-root" class="overnight-root">Loading overnight markets&hellip;</div>
    <p class="hint">Correlation (r) and sensitivity (&beta;) are computed from up to 150 trading days of daily-return overlap (sample size <em>n</em> is shown &mdash; faint / asterisked low-n fits are noisier); &beta; &times; the peer&rsquo;s move is a rough implied read, not a forecast. Yield moves are shown in basis points. Foreign closes can lag the US session by up to a day. Not financial advice.</p>
  </section>`;
}

function earningsTrackerSection() {
  // Card chrome only — content renders client-side from data/earnings-tracker.json,
  // lazy-fetched on first tab activation by loadEarningsTracker() in app.js.
  // Universe-wide season scoreboard: beat/miss/guidance splits, expected-move
  // hit rate, post-print breadth, biggest gaps, AI season read.
  return `<section class="card" id="earnings-section">
    <header class="card-header">
      <h2 class="card-title">Earnings tracker</h2>
      <span class="card-eyebrow" id="earnings-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use earnings season', `<p>Start with the <b>Event posture</b>, which translates the current season into exposure risk: how many tracked names report next, how many already carry a double-digit pre-print move, whether positive reaction breadth is holding, and whether realized gaps are exceeding what options priced. The <b>Event desk</b> pairs each report session with its decision deadline and the straddle-implied move when a real final-week snapshot exists; it is a gap-risk screen, not a directional call. A <b>crowded run-up</b> can raise sell-the-news risk; a <b>heavy selloff</b> can mean either washed-out positioning or expectations that are still deteriorating. Neither label is an automatic fade. Use the report session to decide whether a position carries overnight event risk, then define the maximum loss before holding through it.</p><p>Below that, each <b>season</b> groups prints announced in one calendar quarter (Jan&ndash;Mar reports cover fiscal Q4, Apr&ndash;Jun cover Q1, and so on). The scoreboard separates EPS results, guidance, pre-print drift, the first regular-session reaction, the options market&rsquo;s expected move and one-week follow-through. The implied move is the straddle-implied &plusmn;% snapshotted in the final week before a print; it estimates magnitude, not direction. Guidance and implied-move coverage accumulate going forward, so older seasons can be incomplete.</p>`)}
    <div id="earnings-root" class="earnings-root">Loading earnings tracker&hellip;</div>
    <div id="earnings-empty" class="earnings-empty" hidden>Earnings tracker data will appear after the next daily build refresh.</div>
    <p class="hint">Coverage is the curated tracked-ticker universe, not the full market; implied-move and guidance columns accumulate from live snapshots, so older quarters can show &ldquo;&mdash;&rdquo;. Not financial advice.</p>
  </section>`;
}

function earningsCallsSection() {
  // Card chrome only — content renders client-side from data/earnings-calls.json
  // (the covered-name index), lazy-fetched on first tab activation by
  // loadEarningsCalls() in app.js; opening a card fetches that name's full
  // brief from data/transcript-<SYM>.json. The tab and both payloads are free.
  return `<section class="card" id="calls-section">
    <header class="card-header">
      <h2 class="card-title">Earnings calls</h2>
      <span class="card-eyebrow" id="calls-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use this call desk', `<p>Start with the <b>decision queue</b>: it prioritizes explicit outlook changes, misses, management caution and disputed Q&amp;A instead of asking you to scan every transcript equally. Open a company to separate <b>what changed</b> from <b>what must be watched next</b>, then use the research disclosures for the reported numbers, full guidance table, management wording, analyst questions, operating detail and source transcript. A constructive call is not an entry signal and a cautious call is not automatically a short &mdash; confirm the Grade view, price reaction and valuation before acting. Every brief is AI-generated from the full transcript and can contain errors.</p>`)}
    <div id="calls-root" class="calls-root">Loading earnings calls&hellip;</div>
    <div id="calls-empty" class="calls-empty" hidden>Earnings-call summaries appear here as transcripts are published.</div>
    <p class="hint">Summaries are AI-generated from third-party transcripts and can contain errors &mdash; always verify against the linked transcript. Not financial advice.</p>
  </section>`;
}

function aiCapexSection() {
  // Card chrome only — content renders client-side from data/ai-capex.json,
  // lazy-fetched on first tab activation by loadAiCapex() in app.js. SEC XBRL
  // CapEx for major AI infrastructure buyers: aggregate this-FY-vs-last-FY + per-company comparison.
  return `<section class="card" id="ai-capex-section">
    <header class="card-header">
      <h2 class="card-title">AI buildout spending</h2>
      <span class="card-eyebrow" id="ai-capex-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use the AI CapEx signal', `<p>Separate <b>infrastructure demand</b> from <b>investment quality</b>. Rising aggregate CapEx can support chip, networking, power, and data-center suppliers, but it can also pressure the buyers&rsquo; margins and free cash flow when spending outruns revenue. Start with management&rsquo;s latest full-year outlook, then compare SEC-reported CapEx growth with revenue growth and the current run-rate before checking supplier backlog/guidance and each ticker&rsquo;s Grade. Guidance definitions differ by company and remain separate from reported cash CapEx; fiscal years also differ.</p>`)}
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
      <h2 class="card-title">Memory pricing cycle</h2>
      <span class="card-eyebrow" id="ram-prices-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use the memory-cycle signal', `<p>Start with the <b>trade posture</b>, then require upstream and downstream confirmation. Wholesale DRAM spot usually moves first; US retail shows whether the pressure is passing through to finished DDR5 kits. Retail confirmation uses the median move and breadth across reasonably stocked categories because a scarce configuration can distort the all-kit composite. Tightening favors memory-supplier pricing-power research; easing can relieve system-builder input costs. Verify the move against supplier guidance, relative strength, earnings risk, and each ticker&rsquo;s Grade before acting. Spot data: TrendForce / DRAMeXchange; retail data: WhereIsMyRam.</p>`)}
    <div id="ram-prices-root" class="ram-prices-root">Loading RAM prices&hellip;</div>
    <div id="ram-prices-empty" class="ram-prices-empty" hidden>RAM price data will appear after the next Friday 11:30 ET refresh.</div>
    <p class="hint">Spot prices are per chip/module in USD (session average); retail prices are per kit in USD (lowest in-stock offer / category average). Sources are scraped best-effort and can go stale. Not financial advice.</p>
  </section>`;
}

function acceleratorPricesSection() {
  // Public GPU-cloud marketplace and provider prices, normalized to one GPU
  // hour and tracked daily in data/accelerator-prices.json.
  return `<section class="card" id="accelerator-prices-section">
    <header class="card-header">
      <h2 class="card-title">GPU cloud prices</h2>
      <span class="card-eyebrow" id="accelerator-prices-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read the compute-cost chart', `<p>First choose one accelerator so every number on the desk refers to the <b>same GPU model</b>. The chart is daily rental-price history in USD per GPU-hour: the thicker line is the cross-provider median and the thinner colored lines are individual provider / market lanes. A <b>falling line means compute is getting cheaper</b>; a rising line means it is getting more expensive. Use Spot to inspect interruptible capacity, On-demand for standard rentals, or All for the broad blended read. The 7-day and 30-day cards compare like-for-like daily snapshots; “Building” means not enough calendar history exists yet. These are rental list prices, not chip selling prices or provider revenue, and a posted rate does not prove capacity was available. Vast.ai rows are medians of verified rentable offers; CoreWeave, Runpod and Lambda rows are provider-published prices.</p>`) }
    <div id="accelerator-prices-root" class="ap-root">Loading GPU cloud prices&hellip;</div>
    <div id="accelerator-prices-empty" class="ap-empty" hidden>Accelerator price data will appear after the next Friday 11:30 ET refresh.</div>
    <p class="hint">Public list and marketplace prices only. Taxes, storage, networking, commitments, negotiated discounts, interruption risk and actual capacity can change the effective cost. Not financial advice.</p>
  </section>`;
}

function centralBankGoldSection() {
  return `<section class="card" id="central-bank-gold-section">
    <header class="card-header">
      <h2 class="card-title">Central-bank gold</h2>
      <span class="card-eyebrow" id="central-bank-gold-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to read official-sector gold demand', `<p>Use the two series for different questions. <b>Global net demand</b> is the World Gold Council / Metals Focus quarterly estimate of purchases minus sales, including activity that may not yet be publicly reported. <b>Country holdings</b> are official reported reserves compiled from IMF IFS and central-bank sources; reporting dates vary and can lag. The country table shows each bank&rsquo;s latest known tonnes, gold&rsquo;s share of its reserves, and changes over roughly three and twelve months. A rising total supports the structural gold-demand backdrop, but it is not a short-term entry signal for gold or miners &mdash; confirm price, real yields, the dollar, valuation and each ticker&rsquo;s Grade.</p>`)}
    <div id="central-bank-gold-root" class="cbg-root">Loading central-bank gold data&hellip;</div>
    <div id="central-bank-gold-empty" class="cbg-empty" hidden>Central-bank gold data will appear after the next daily build refresh.</div>
    <p class="hint">Holdings are latest reported by country and may have different as-of dates. Global demand is an estimate and can be revised; it will not equal the sum of disclosed country changes. Sources: World Gold Council, IMF IFS, central banks and Metals Focus. Not financial advice.</p>
  </section>`;
}

function searchInterestSection() {
  // Google Trends relative interest, collected once weekly on the free API
  // tier by refresh-search-interest.mjs and lazy-loaded on first tab entry.
  return `<section class="card" id="search-interest-section">
    <header class="card-header">
      <h2 class="card-title">Search interest</h2>
      <span class="card-eyebrow" id="search-interest-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use search interest', `<p>Search attention is a <b>participation signal</b>, not a buy signal. Start with the 7-day change to find themes entering public attention, then check whether price, volume, catalysts and fundamentals confirm the move in related assets. A surge without market confirmation can be curiosity, controversy or late-cycle crowding. Interest is Google Trends&rsquo; relative 0&ndash;100 index, normalized here against the same <em>stock market</em> anchor so themes can be compared; it is not absolute search volume.</p>`)}
    <div id="search-interest-root" class="si-root">Loading search interest&hellip;</div>
    <div id="search-interest-empty" class="si-empty" hidden>Search-interest data will appear after the next weekly refresh.</div>
    <p class="hint">US Google Search interest over the trailing 90 days, refreshed weekly on the free API tier. Source: Google Trends via SerpApi. Not financial advice.</p>
  </section>`;
}

function commoditiesSection() {
  // Card chrome only — content renders client-side from data/commodities.json,
  // lazy-fetched on first tab activation by loadCommodities() in app.js.
  // Thirteen equity-relevant commodity, input-cost and demand signals:
  // precious metals (gold, silver), softs (cocoa, cotton, coffee, sugar, palm
  // oil), industrial inputs (lumber, potash, lithium), freight (container
  // rates, Baltic Dry) and used-vehicle values.
  return `<section class="card" id="commodities-section">
    <header class="card-header">
      <h2 class="card-title">Commodities &amp; equity impact</h2>
      <span class="card-eyebrow" id="commodities-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use commodity signals', `<p>Start with the <b>trade posture</b>, then separate input-cost pressure from demand. Gold and silver can reflect the dollar, real yields, safe-haven demand and, for silver, industrial demand; rising cocoa or coffee can hurt exposed buyers, while rising Baltic Dry can signal firmer industrial demand. The desk compares market series over 30 days and monthly series month over month so a noisy one-day move does not outrank a persistent trend. Aged observations are excluded from the decision desk but remain visible in detail. Use the impact label and linked tickers to confirm whether the move is transmitting through relative strength, volume, pricing actions, miner economics, and margin guidance before acting. Items marked <b>proxy</b> track an ETF rather than the native spot benchmark.</p>`)}
    <div id="commodities-root" class="commodities-root">Loading commodities&hellip;</div>
    <div id="commodities-empty" class="commodities-empty" hidden>Commodity data will appear after the next daily build refresh.</div>
    <p class="hint">Futures are front-month continuous contracts (daily settles); FRED series are monthly and publish on a lag. Proxy ETFs track direction, not the spot level. Scraped overlays are best-effort and can go stale. Not financial advice.</p>
  </section>`;
}

function ipoCreditSection() {
  // Card chrome only — content renders client-side from data/ipo-credit.json,
  // lazy-fetched on first tab activation by loadIpoCredit() in app.js.
  // Quarterly IPO counts, market-wide SEC raise-filing counts + tracked-
  // universe issuance totals, and the national credit backdrop (FRED G.19
  // revolving credit, H.8 bank deposits, NY Fed household debt & credit).
  return `<section class="card" id="ipo-credit-section">
    <header class="card-header">
      <h2 class="card-title">IPOs &amp; credit</h2>
      <span class="card-eyebrow" id="ipo-credit-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use capital availability', `<p>Start with the <b>upcoming IPO calendar</b> for the scheduled date, expected raise, proposed share-price range, and sector, then use the <b>trade posture</b> to judge the broader funding window. Dates and terms can change until pricing. Bond issuance shows whether companies can borrow, but an investment-grade-led month is not the same as broad access for riskier issuers. IPO counts are adjusted to a quarter run-rate before comparison with the completed prior quarter, and SPAC share is shown because a SPAC-heavy calendar can overstate conventional equity appetite. Bank deposits indicate funding stability; revolving and NY Fed balances describe household leverage, not immediate default stress. Confirm an open window with high-yield participation, improving ex-SPAC IPO pace, and stable deposits. Treat filing counts as activity rather than unique companies, and inspect the underlying sleeve before changing exposure.</p>`)}
    <div id="ipo-credit-root" class="ipo-credit-root">Loading IPOs &amp; credit&hellip;</div>
    <div id="ipo-credit-empty" class="ipo-credit-empty" hidden>IPO &amp; credit data will appear after the next daily build refresh.</div>
    <p class="hint">Upcoming IPO dates and terms are estimates until priced and may be postponed or withdrawn. IPO counts include SPACs and small-caps. Filing counts are filings, not companies. FRED series publish on a lag (G.19 ~2 months, H.8 ~1 week); the NY Fed report is quarterly. Not financial advice.</p>
  </section>`;
}

function pendingBuyoutsSection() {
  return `<section class="card" id="pending-buyouts-section">
    <header class="card-header">
      <h2 class="card-title">Pending buyouts</h2>
      <span class="card-eyebrow" id="pending-buyouts-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use the buyout tracker', `<p>The evidence ladder is <b>Rumor &rarr; Reported talks &rarr; Definitive agreement &rarr; Regulatory / vote pending &rarr; Expected close</b>. These are public-source labels, not hard completion probabilities. For cash deals, consideration per share is the stated offer; stock and mixed consideration can move with the buyer&rsquo;s shares. Premium to the unaffected price is shown only when a cited source states it. <b>Estimated equity value</b> is consideration per share multiplied by current implied shares outstanding&mdash;an estimate, not enterprise value. Rumors keep undisclosed price, premium, spread, and close fields blank. A wide deal spread can reflect regulatory, financing, timing, or break risk&mdash;never assume it is free money.</p>`)}
    <div class="pb-summary" id="pending-buyouts-summary" aria-live="polite"></div>
    <div class="pb-controls" role="toolbar" aria-label="Filter pending buyouts">
      <label class="pb-search"><span class="sr-only">Search buyouts</span><input id="pending-buyouts-search" type="search" placeholder="Target, ticker, or buyer&hellip;" autocomplete="off" spellcheck="false" /></label>
      <div class="pb-status-filter" role="radiogroup" aria-label="Filter by deal status">
        <button type="button" class="pb-pill is-on" data-pb-status="all" role="radio" aria-checked="true">All</button>
        <button type="button" class="pb-pill" data-pb-status="rumor" role="radio" aria-checked="false">Rumor</button>
        <button type="button" class="pb-pill" data-pb-status="active_talks" role="radio" aria-checked="false">Talks</button>
        <button type="button" class="pb-pill" data-pb-status="announced" role="radio" aria-checked="false">Definitive</button>
        <button type="button" class="pb-pill" data-pb-status="regulatory_vote" role="radio" aria-checked="false">Reg / vote</button>
        <button type="button" class="pb-pill" data-pb-status="expected_close" role="radio" aria-checked="false">Close</button>
      </div>
      <label class="pb-field"><span>Type</span><select id="pending-buyouts-type" aria-label="Filter buyouts by consideration type"><option value="all">All types</option><option value="cash">Cash</option><option value="stock">Stock</option><option value="mixed">Mixed</option><option value="special">Special</option><option value="rumor">Rumor</option></select></label>
      <label class="pb-field"><span>Sort</span><select id="pending-buyouts-sort" aria-label="Sort pending buyouts"><option value="close">Expected close</option><option value="spread">Largest spread</option><option value="value">Largest equity value</option><option value="latest">Latest public update</option><option value="alpha">Target A&ndash;Z</option></select></label>
    </div>
    <div id="pending-buyouts-root" class="pb-root">Loading pending buyouts&hellip;</div>
    <div id="pending-buyouts-empty" class="pb-empty" hidden>No deals match these filters.</div>
    <p class="hint">Definitive terms come from an active merger-arbitrage feed with a cited source per deal; recent linked coverage supplies stage evidence and corroboration counts. A site count measures distinct publishers found, not deal probability. Verify filings, announcements, regulatory dockets, and vote materials before trading. Refreshed by the scheduled full build. Not financial advice.</p>
  </section>`;
}

function spilloverSection() {
  // Card chrome only — content renders client-side from data/spillover-pairs.json,
  // lazy-fetched on first tab activation by loadSpillover() in app.js. The Event
  // Spillover Matrix (docs/event-spillover.md): same-sector earnings read-through
  // across the FULL tracked universe (sector groups derived from SECTORS; the
  // 2026-07-19 banks pilot proved the method). ANALYTICAL ONLY — it maps
  // correlation, it never suggests trades.
  return `<section class="card" id="spillover-section">
    <header class="card-header">
      <h2 class="card-title">Event spillover</h2>
      <span class="card-eyebrow" id="spillover-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>When a company reports earnings, its <b>same-sector peers</b> move too &mdash; this matrix measures that <b>read-through</b> across the whole tracked universe, grouped into sector complexes (semis &amp; memory, software, banks, payments, consumer, healthcare, space, &hellip;), each with its sector ETF. For every driver&rarr;follower pair inside a group it estimates the <b>event-window beta</b> (how much of the driver's print-day move the follower echoes, Newey-West significance, shrunk toward the pooled sector beta on small samples), the <b>direction hit rate</b>, and whether the follower's <b>options already price</b> the echo (its ATM implied move vs its realized average). Pairs must clear fixed statistical gates (R&sup2;, significance after a false-discovery correction run across every sector's pairs, &ge;60% direction consistency) to count as qualified. Upcoming driver events show both engines' expected follower moves &mdash; sector-routed (via the ETF) and direct-pair &mdash; with the running forward accuracy of each. <b>This is a correlation map, not a trade signal</b>: nothing here is a recommendation to buy or sell anything.</p>`)}
    <div id="spillover-root" class="spill-root">Loading event spillover&hellip;</div>
    <div id="spillover-empty" class="spill-empty" hidden>Spillover data will appear after the next daily build refresh.</div>
    <p class="hint">Event betas re-estimate once per trading day; event depth accumulates from the earnings-history store. Sector prints cluster (bank mornings especially), so many windows carry shared-print/CPI-week flags &mdash; shown, not hidden. Names with no same-sector peer tracked are listed rather than dropped. Analytical only. Not financial advice.</p>
  </section>`;
}

function quantSection() {
  // Card chrome only — content renders client-side from data/quant.json plus
  // lazy-fetched on first tab activation by loadQuant() in app.js. The Quant
  // Lab (docs/quant-lab.md): deterministic sigma-deviation, vol-risk-premium,
  // pair relative-value, vol-surface, dispersion and post-earnings-drift
  // screens. ANALYTICAL ONLY — screens and z-scores, never trade signals; the
  // playbook table below is educational. The playbook + coverage blocks are
  // static (they never change per build), so they live here in the shell.
  return `<section class="card" id="quant-section">
    <header class="card-header">
      <h2 class="card-title">Owner Lab</h2>
      <span class="card-eyebrow" id="quant-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('What is this?', `<p>Statistical screens quants actually run, over the same data the rest of the site already collects. <b>Regime conditioning</b> &mdash; every build first classifies the tape on four axes (volatility: VIX + term structure + SPY realized vol; trend vs range: SPY efficiency ratio + higher-highs/lower-lows; risk-on/off: the Market Analysis tape; earnings-heavy vs quiet: share of the universe reporting inside ~2 weeks). The single-name sigma screen keeps a fixed 3&sigma; bar in every regime; VRP &ldquo;rich&rdquo; needs a bigger z when high vol makes fat premium normal, pair-spread &ldquo;stretched&rdquo; widens in high vol and tightens in calm tape, and term-structure inversions are down-weighted through earnings-heavy stretches. Rows are never hidden by regime &mdash; only badged and re-ordered &mdash; and the strip at the top shows the bars in force. <b>Aggregate ideas</b> &mdash; a confluence table cross-referencing four <em>independent</em> flow screens the site already runs (the session&rsquo;s largest unusual-options prints, the top intraday volume / S&ndash;R-break flags, fresh &le;3-session price streaks, and 5-day rising / surging IV): a name showing on two-plus screens ships as a candidate, three-plus is badged <b>qualified</b>, and a lean is reported only when the directional screens agree. <b>Sigma deviations</b> &mdash; names at or past their 3&sigma; Bollinger band (20-day price z-score) or printing a 3&sigma; daily move vs their own trailing volatility, with the option market&rsquo;s <b>expected move</b> (1&sigma;/2&sigma; = S &times; IV &times; &radic;(days/365)) beside the realized one. <b>Vol risk premium</b> &mdash; each name&rsquo;s ATM ~30-day implied vol minus its 30-day realized vol, z-scored against the name&rsquo;s own derived history: persistently positive is the premium option sellers harvest; an extreme z flags premium unusually rich (or cheap) vs that name&rsquo;s norm. <b>Pairs</b> &mdash; within-industry pairs whose daily returns correlate &ge;0.60, watched on two spreads: the <em>hedged</em> price spread lnA &minus; &beta;&middot;lnB, with &beta; from a <b>one-year Engle-Granger regression</b> whose residual ADF test (vs the MacKinnon 5% bar) supplies a <b>cointegrated</b> badge &mdash; read on both a 60-day and a ~1-year horizon (some pairs only mean-revert on one), with a rolling hedge-ratio drift check, a corr-stability-across-lookbacks badge, and a factor match grade (SPY-beta / size / momentum gaps + a liquidity floor) &mdash; and the implied-vol spread vs its 120-day norm (relative options mispricing between peers). <b>Vol surface</b> &mdash; term-structure slope (~90d vs ~30d ATM; inverted = near-term stress, badged when the name&rsquo;s own print is inside ~5 weeks &mdash; event vol loading the front is expected) and 25&Delta; put&minus;call skew per name; their z-scores activate automatically once enough surface history accumulates. <b>Dispersion</b> &mdash; an implied-correlation proxy from SPY&rsquo;s IV vs the cap-weighted basket of tracked large-caps: high = index options rich relative to single names. <b>Post-earnings drift</b> &mdash; names inside two weeks of a print, their reaction and drift so far, against their own historical beat/miss drift tendency. Everything is deterministic &mdash; fixed formulas, documented windows and threshold tables, no AI and no cross-sectional curve-fitting.</p>`)}
    <section class="owner-suite" aria-labelledby="owner-tools-title">
      <header class="owner-suite-head">
        <div><span>Private workspace</span><h3 id="owner-tools-title">Owner tools</h3></div>
        <p>Personalized controls are isolated here because they use an actual holding, account value, or dollar-risk budget. Access requires both the Top Picks and Track Record roles.</p>
      </header>
      <details class="picks-position owner-position" id="picks-position">
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
      <div id="owner-dca-root" class="owner-tool-root">Loading personalized DCA sizing&hellip;</div>
      <div id="owner-rotation-root" class="owner-tool-root">Loading Sector Rotation sizing&hellip;</div>
      <div id="owner-lev-root" class="owner-tool-root">Loading leveraged-ETF sizing&hellip;</div>
    </section>
    <div id="quant-root" class="quant-root">Loading Quant Lab&hellip;</div>
    <div id="quant-empty" class="quant-empty" hidden>Quant Lab data will appear after the next daily build refresh.</div>
    <div class="quant-playbook">
      <div class="quant-sub">The classical playbook (educational &mdash; not signals, not advice)</div>
      <div class="quant-tbl-wrap"><table class="quant-tbl quant-play-tbl">
        <thead><tr><th>Situation</th><th>What quants typically do</th><th>Why it works (and when it doesn't)</th></tr></thead>
        <tbody>
          <tr><td>Price z &ge; +3&sigma; (overbought)</td><td>Mean-reversion fade / sell call premium</td><td>Statistically stretched; fades work best range-bound &mdash; and fail in strong trends</td></tr>
          <tr><td>Price z &le; &minus;3&sigma; (oversold)</td><td>Mean-reversion long / sell put premium</td><td>Same logic inverted; falling knives trend too</td></tr>
          <tr><td>Pair spread z &ge; &plusmn;2&sigma;</td><td>Long the cheap leg, short the rich leg</td><td>Classic stat-arb entry &mdash; only if the spread actually mean-reverts (see the cointegration + half-life badges)</td></tr>
          <tr><td>Regime shifts (calm&rarr;crisis, range&rarr;trend)</td><td>Re-check the tape before trusting a fade</td><td>Even a 3&sigma; deviation can keep stretching in a strong trend; the strip at the top shows the current regime</td></tr>
          <tr><td>Fresh 3&sigma; daily move, IV still low</td><td>Buy volatility (straddles/strangles)</td><td>Realized-vol spikes often lead IV expansion</td></tr>
          <tr><td>Inside 1&sigma; expected move, IV rich</td><td>Sell premium outside the 3&sigma; band</td><td>High theoretical win rate &mdash; with severe tail risk when it breaks</td></tr>
          <tr><td>Position sizing</td><td>Size so a 3&sigma; adverse move risks ~0.5&ndash;1% of capital</td><td>Volatility-aware sizing; stops beyond 3&sigma; of recent range avoid noise shakeouts</td></tr>
        </tbody>
      </table></div>
    </div>
    ${infoNote('What this tab deliberately does NOT do', `<p><b>Not feasible with current data</b> (listed honestly rather than faked): M&amp;A / spin-off screens (no deal data source), index add/delete prediction (no committee or flow data), gamma-scalping simulation (needs intraday delta-hedging data), Johansen / multi-year cointegration (the price history carries ~1 year of bars, so the Engle-Granger test runs on a single 1-year window and is labeled as such; Johansen adds nothing for 2-asset pairs), stock-borrow availability / borrow-fee screens (no borrow data source), and alt-data earnings nowcasts (no satellite / card-spend / web-traffic feeds). <b>Already covered elsewhere</b>: earnings read-through pair betas live in <b>Event spillover</b>, season-wide earnings stats in <b>Earnings tracker</b>, IV momentum in <b>Trending IV</b>, and the quality-dip shares screen in <b>Stock Picks</b> &mdash; this tab links to them instead of duplicating them.</p>`)}
    <p class="hint">All screens are deterministic and rebuilt every bake; z-scores use each name's own history, never a cross-sectional curve. Surface z-scores and the dispersion percentile activate automatically once ~60 sessions of history accumulate. Analytical screens only &mdash; nothing here is a recommendation to buy or sell anything. Not financial advice.</p>
  </section>`;
}

function dayTradingSection() {
  return `<section class="card dt-lab" id="day-trading-section" aria-labelledby="dt-lab-title">
    <div class="dt-lab-head">
      <div><span>Owner paper engine</span><h2 id="dt-lab-title" class="card-title">Day Trading</h2></div>
      <span id="dt-engine-stamp" class="dt-stamp" aria-live="polite">Loading&hellip;</span>
    </div>
    ${infoNote('How the Day Trading Engine works', `<p>A deterministic <b>stock-only paper-trading</b> engine requested every 15 minutes on a staggered schedule. Market bias, the SPY/QQQ 9:30&ndash;10:00 opening range, dealer gamma, recent index closes, volatility regime, scheduled events, volume and technical structure determine whether a long or short setup clears the score. <b>No entry is allowed before 10:00&nbsp;ET; after 10:00 it may enter through the rest of the regular session until the mandatory 16:00 close flatten.</b> Delayed workflow runs remain eligible through 18:05&nbsp;ET only to guarantee marking and close recovery; they cannot open a post-close trade. Risk authority remains in force: at most eight trades per session, no position above 25% of equity, correlated-exposure caps, fixed invalidation and 120-minute time stops. This is a simulation, not an order router or financial advice.</p>`)}
    <div id="day-trading-root" class="dt-root">Loading owner Day Trading Engine&hellip;</div>
    <div id="day-trading-empty" class="quant-empty" hidden>The engine has not published its first intraday snapshot yet.</div>
  </section>`;
}

function dayTradingTrackSection() {
  return `<section class="card dt-lab" id="day-trading-track-section" aria-labelledby="dt-track-title">
    <div class="dt-lab-head">
      <div><span>Durable paper ledger</span><h2 id="dt-track-title" class="card-title">Day Trading Track Record</h2></div>
      <span id="dt-track-stamp" class="dt-stamp" aria-live="polite">Loading&hellip;</span>
    </div>
    ${infoNote('What this record includes', `<p>The stock long/short simulation starts with a $10,000 paper book. This tab reports every closed stock trade after modeled costs, win rate, profit factor, average win/loss, daily distribution, MAE, true maximum drawdown, reset events and performance by entry period. The reset curve jumps back to $10,000 below $2,000; the never-reset curve does not, so losses cannot be hidden by a reset. Retired 1DTE option results are no longer carried in this tracker.</p>`)}
    <div id="day-trading-track-root" class="dt-root">Loading Day Trading Track Record&hellip;</div>
    <div id="day-trading-track-empty" class="quant-empty" hidden>No paper trades have closed yet.</div>
  </section>`;
}

function buildTimelineSection() {
  return `<section class="card refresh-schedule" id="refresh-schedule-section">
    <header class="card-header">
      <div><span class="card-eyebrow">Market schedule · ET (America/New_York)</span><h2 class="card-title">Build &amp; refresh timeline</h2></div>
      <span class="card-eyebrow">Weekdays unless noted</span>
    </header>
    <p class="hint">A scheduled start is not a guaranteed publish minute: GitHub runner queues, source latency and validation time vary. A service is live only when its own tab shows the new timestamp. Failed or incomplete runs publish nothing, so the prior coherent snapshot remains visible. The header&rsquo;s time-zone setting converts actual build, scan and headline timestamps; market-session rules stay labeled in ET.</p>
    <div class="refresh-schedule-grid">
      <article class="refresh-schedule-card is-lead"><span>08:30 ET</span><h3>Premarket Brief</h3><p>The lightweight Brief run starts one hour before the bell and refreshes overnight markets, Fear &amp; Greed, macro releases and headlines, then checks every current public evidence desk for material standouts. It becomes live immediately after freshness verification and the private-store push; confirm the timestamp in Brief.</p><em>Brief only &middot; no full chain build</em></article>
      <article class="refresh-schedule-card"><span>10:00, 11:00, 13:30, 15:30 &amp; 16:10 ET</span><h3>Full market build</h3><p>Refreshes ticker chains and daily/intraday bars, grades, technicals, narratives, calendars, Pending Buyouts, MA Tracker, earnings, Market Analysis and Quant Lab. The 16:10 run captures the completed close.</p><em>Five evidence windows &middot; no unreliable 09:30 auction build</em></article>
      <article class="refresh-schedule-card"><span>11:00 &amp; 15:30 ET</span><h3>Swing decision desks</h3><p>Runs Top Picks, chart vision, Stock Picks, Sector Rotation and Leveraged ETFs. Other full builds carry the last coherent decisions and ledgers unchanged.</p><em>Twice per market day &middot; aligned evidence</em></article>
      <article class="refresh-schedule-card"><span>Hourly 09:00&ndash;16:00 ET</span><h3>Flow, Volume &amp; Heatmap</h3><p>Re-scans unusual options flow and intraday volume/S&amp;R breaks, then refreshes heatmap price/change fields. The post-close pass may also publish the sector EOD recap.</p><em>One serialized scan &middot; no partial publish</em></article>
      <article class="refresh-schedule-card"><span>Every 15 minutes requested, 09:25&ndash;18:05 recovery guard</span><h3>Owner Day Trading</h3><p>Marks open stock paper positions and evaluates new long/short setups. Entries run from 10:00 until 16:00; delayed post-close passes enforce the mandatory flatten.</p><em>Private snapshot + durable ledger</em></article>
      <article class="refresh-schedule-card"><span>~08:30 and ~17:00 ET</span><h3>Near-term OI</h3><p>The morning pass publishes settled T+1 OI and day-over-day changes. The evening pass adds completed-session volume and Vol/OI positioning; today&rsquo;s net OI does not publish until the next morning.</p><em>Two different evidence windows</em></article>
      <article class="refresh-schedule-card"><span>Checked on each full build</span><h3>Central-bank gold</h3><p>Checks the World Gold Council for a new quarterly global-demand estimate and refreshed official country holdings. Source reporting normally lags the current date.</p><em>Quarterly source cadence &middot; last-good carry-forward</em></article>
      <article class="refresh-schedule-card"><span>Friday 11:30 ET</span><h3>Weekly Alt Data</h3><p>Refreshes Search Interest theme timelines, wholesale and retail RAM prices, and public GPU-cloud rental prices in one DST-safe weekly job.</p><em>One scan each &middot; Search Interest capped at 40 requests</em></article>
      <article class="refresh-schedule-card"><span>About every 30 seconds while open</span><h3>Live browser overlays</h3><p>Relevant tabs poll live quotes/chains only while visible and the market is regular. These overlays do not replace the stamped build or scanner snapshot and pause outside the session.</p><em>Best-effort request-time data</em></article>
    </div>
    <div class="refresh-schedule-rule"><b>How to verify freshness:</b> use the timestamp inside the service you are reading, not the footer alone. The footer describes the generated shell; scanner-owned data can be newer.</div>
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
    ${infoNote('What is this?', `<p>Each name's <b>constant-maturity ATM ~30-day IV</b> is interpolated between surrounding expirations in total-variance space, which reduces false jumps when the nearest contract rolls. The current read is compared with that name's own daily history using both classical and median/MAD z-scores; the more conservative agreeing magnitude is used, plus percentile, a 5-session ramp, lighter 20-session context, and a short rising streak. Tiers require both statistical elevation and a real percentage expansion in premium. Histories under 60 comparable sessions are labeled <b>provisional</b> and must clear stricter score and z bars. Rising IV says <b>magnitude</b>, not direction, and overlapping momentum inputs are deliberately down-weighted so one climb is not counted three times. Names already rich but no longer climbing remain marked <b>Elevated</b>.</p>`)}
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
    ${infoNote('How to use financing events', `<p>Start with the <b>verified event mix</b>, then review the newest financing terms before changing exposure. Share issuance expands the float; convertibles can add both leverage and future dilution; straight debt raises interest and refinancing risk without automatically diluting shareholders. Buyback authorizations are only intent until the company actually purchases shares. Only headlines that explicitly name the issuer and transaction enter the risk totals. Ambiguous ticker associations and insider-sale wording remain in the review ledger. Amounts shown from SEC filings are context and may describe a different reporting period, so confirm the offering price, coupon, maturity, conversion terms, share count, and use of proceeds at the linked source.</p>`)}
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
      <h2 class="card-title">SEC ownership filings</h2>
      <span class="card-eyebrow" id="f13-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How to use SEC ownership signals', `<p><b>13F:</b> start with share-direction breadth. A stock added by many managers is stronger evidence than a large dollar change from one manager; dollar value also includes price drift, and filings can arrive 45 days after quarter-end. <b>Form 4:</b> code P open-market purchases are separated from code S sales and from grants, option exercises, gifts and tax withholding. Insider sales can reflect diversification or taxes, so no filing supplies an entry by itself. Open the ticker in Grade and confirm the current trend, catalyst, valuation and risk.</p>`)}
    <div id="f13-root" class="f13-root">Loading SEC ownership filings…</div>
    <div id="f13-empty" class="f13-empty" hidden>SEC ownership filings will appear after the next daily build refresh.</div>
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
      ${infoNote('What counts as unusual flow?', `<p>Discovery stays broad: 5–50% OTM contracts that picked up at least 2,000 contracts of volume this hour (4,000 if expiring within 2 weeks) with vol &gt; OI remain visible as block/sweep candidates. The <strong>decision queue</strong> is stricter: it credits only ask/above-ask execution, requires material premium (normally $100k, or $50k when repeated, or $25k when aggressive demand spans multiple strikes), rejects quoted spreads wider than 35% of midpoint, and demands extra support for far-OTM or penny contracts. Midpoint prints remain evidence but are not called directional, and an old or closed-session scan is never called executable. Each chip shows <strong>volume-to-OI</strong> and hourly premium; 🔥 ×N marks repeats over five trading days. FINRA ATS volume is shown as a <strong>secondary, delayed context signal</strong> with dark-pool share of matching weekly consolidated volume and week-over-week change; it never changes the live flow direction or actionability call. Flow is a watchlist input, not an entry: calls can be sold, puts can be hedges, and every read still needs confirmation from the underlying price, volume, and structure. Hourly scan, front 2 expirations.</p>`)}
      <div id="flow-decision" class="flow-decision" aria-live="polite"></div>
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

function movingAverageTrackerSection() {
  return `<section class="card ma-track-card" id="ma-tracker-section">
    <header class="card-header">
      <h2 class="card-title">Moving-average crossover tracker</h2>
      <span class="card-eyebrow" id="ma-tracker-eyebrow" aria-live="polite"></span>
    </header>
    ${infoNote('How crossover priority is ranked', `<p>The desk watches every tracked stock against its <b>20, 50, 100 and 200-day simple moving averages</b> and surfaces only levels within 5% of the latest regular-session price. The 0&ndash;100 priority score is deterministic, not a probability: proximity contributes up to 50 points, a contracting gap 25, aligned 1-day/5-day momentum 20, relative volume 5, and nearby-average confluence 5 (the total is capped at 100). &ldquo;Likely&rdquo; requires a high score, a contracting gap and aligned five-session momentum. A cross is a watch trigger, not a trade by itself; confirm the close, volume, broader trend and event risk.</p>`)}
    <div id="ma-tracker-root" class="ma-track-root">Loading moving-average tracker&hellip;</div>
    <div id="ma-tracker-empty" class="quant-empty" hidden>No tracked stock is currently within 5% of a monitored moving average.</div>
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
    ${infoNote('What is gamma exposure (GEX)?', `<p>This is an open-interest-based <strong>GEX proxy</strong> per strike and expiration: <code>Γ × OI × 100 × spot² × 1%</code>, with Black-Scholes gamma computed from each contract's implied vol. The display applies the conventional call-positive / put-negative convention, so a cell is call GEX minus put GEX. That convention is useful for locating concentrations, walls, and a model-implied flip, but <strong>open interest does not reveal whether dealers are actually long or short each contract</strong>. The sign is therefore a scenario proxy, not observed dealer inventory.</p>
      <p>Rows are strikes centered on spot; columns are expirations, near-term first, and <strong>Net&nbsp;Σ proxy</strong> sums the shown expirations. The largest call- and put-side concentrations form the <strong>call wall</strong> (<span class="gex-key-pos">CW</span>) and <strong>put wall</strong> (<span class="gex-key-neg">PW</span>). A <span class="gex-key-pos">positive proxy</span> carries a stabilizing/pinning bias under the conventional sign assumption; a <span class="gex-key-neg">negative proxy</span> carries an amplifying bias. Confirm those scenarios with actual price and share volume rather than treating the sign as fact. OI is end-of-session data published the next morning; only spot refreshes intraday.</p>`)}
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
      ${infoNote('How the OI ladder & squeeze score work', `<p>Start with the <strong>positioning desk</strong>: it identifies the strongest current squeeze candidate, distinguishes a 4–5/5 setup from a watch-only concentration, and states the price/flow evidence that must confirm or invalidate it. The ladder shows the top 12 highest-OI strikes across this week's and next week's expirations. The <strong>Gamma Squeeze Score</strong> (0–5) awards heavy calls within 10% of spot · C/P ratio ≥ 2:1 · call-wall Vol/OI ≥ 1.5× · an overhead call wall within 7.5% · material ask-side call flow aligned to that wall's strike and expiration. FINRA short interest (% float, days-to-cover, and change vs prior cycle) appears beside the setup as <strong>secondary squeeze fuel</strong> but does not alter the five-point gamma score. A score of <strong>4–5</strong> is a potential setup, not an entry. Strikes with <strong>OI &gt; 1000</strong> get a chip; ΔOI chips fire at <strong>+30%</strong> and <strong>+100%</strong>. The 08:30 ET pass refreshes settled T+1 OI and ΔOI; the 17:00 ET pass refreshes completed-session volume and Vol/OI while carrying that settled OI observation until the next morning. OI and short interest are lagged: price must still break and hold the wall with live share volume. Twice-monthly FINRA short interest.</p>`)}
      <div id="oi-decision" class="flow-decision oi-decision flow-decision-empty" aria-live="polite"></div>
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
    ${infoNote('How the volume flags work', `<p>Hourly volume is compared with the U-shaped 25/14/11/11/14/25% intraday distribution. <strong>≥1.2×</strong> expected pace is a participation watch; <strong>≥1.5×</strong> is the stronger action threshold. The required price move adapts to each ticker's ATR (roughly half an ATR, bounded at 0.6–2.0%) so a quiet utility and a volatile semiconductor are not judged by the same fixed move. At/after 16:00 ET, full-day volume <strong>≥1.3×</strong> the 20D average flags as EOD. Support/resistance uses the prior completed sessions only plus an ATR-scaled crossing buffer; Strong Alert requires ≥1.5×, Watch is 0.8–1.5×, and &lt;0.8× is Likely Fakeout.</p>
    <p>Each row reads <em>Vol actual / expected · ratio</em> — shares traded in that bucket vs. the bucket's share of the 20-day average, and the multiple between them. The trailing % is the price change across the bucket. A flag leans <span class="vol-key-up">bullish</span> when price is up on heavy volume (real demand) and <span class="vol-key-dn">bearish</span> when price is down on heavy volume (real selling pressure).</p>
    <p>Each card also carries a <strong>follow-the-case verdict</strong> — whether the volume evidence says to <em>follow</em> the bull or bear case (heavy volume confirmed the move), <em>wait for confirmation</em> (heavy participation but no decisive direction yet), or <em>not follow</em> it (a weak move or a likely fakeout, prone to fading). Expand a ticker to read the verdict's reasoning in full.</p>
    <p>Names are grouped by sector and <strong>collapsed by default</strong> — click a sector header to open it, then a ticker to expand its hour-by-hour breakdown with the reasoning. Each row's one-line summary shows its strongest flag, bullish/bearish lean, peak hour ratio, and EOD move, and a six-bar <strong>intraday volume profile</strong> — one bar per session hour (open → close), taller where volume ran hotter and tinted <span class="vol-key-up">green</span>/<span class="vol-key-dn">red</span> by that hour's price direction — so you can see <em>when</em> the heavy tape hit (the open, midday, or into the close) without expanding. <em>Group by sector</em> and <em>Expand all</em> toggle the layout.</p>`)}
    <div id="vol-decision" class="flow-decision vol-decision flow-decision-empty" aria-live="polite"></div>
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

function volumeCalendarSection() {
  // Historical daily-volume tracker. The client joins each ticker's persisted
  // priceSeries {t,c,v} with index-calendar.json so the calendar can distinguish
  // stock-specific leadership/laggard behavior from a broad tape move.
  return `<section class="card vol-cal-card" id="vol-cal-section">
    <header class="card-header">
      <div>
        <span class="card-kicker">Daily participation</span>
        <h2 class="card-title">Stock volume calendar</h2>
      </div>
      <span class="card-eyebrow" id="vol-cal-eyebrow" aria-live="polite"></span>
    </header>
    <p class="hint">Search for a stock, then select a session. Every completed day is compared with the prior 20-session average: green marks above-average participation and blue marks below-average participation. The detail card cross-checks SPY, QQQ, IWM and SMH to show whether the stock led or lagged the tape.</p>
    ${infoNote('How to read the volume calendar', `<p>The comparison uses the <b>prior 20 completed sessions</b>, excluding the day being judged, so a volume shock cannot inflate its own baseline. Every eligible session is marked above or below average; stronger deviations at <b>&ge;1.30&times;</b> or <b>&le;0.70&times;</b> receive extra emphasis. An in-progress session shows its shares traded but is not classified against a full-day average.</p><p><b>Leader / laggard</b> compares the stock&rsquo;s close-to-close move with the median move of the available SPY, QQQ and IWM benchmarks. A gap of at least 0.50 percentage points is leadership; minus 0.50 points is lagging; smaller gaps are in line. Same-day reputable headlines are shown as a <em>likely catalyst</em>, never asserted as proven cause. If the tracked feed has no dated headline, the summary stays honest and describes only the observable price, volume and index context. Not financial advice.</p>`)}
    <div class="vol-cal-controls" role="toolbar" aria-label="Stock volume calendar controls">
      <label class="vol-cal-symbol-field">
        <span>Ticker</span>
        <span class="vol-cal-symbol-search">
          <input id="vol-cal-symbol" type="search" list="vol-cal-symbol-list" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Search ticker" aria-label="Search ticker for the volume calendar" aria-describedby="vol-cal-symbol-status">
          <datalist id="vol-cal-symbol-list"></datalist>
          <button type="button" id="vol-cal-symbol-go">View</button>
        </span>
        <small id="vol-cal-symbol-status" class="vol-cal-symbol-status" aria-live="polite"></small>
      </label>
      <div class="vol-cal-legend" aria-label="Volume comparison legend">
        <span><i class="is-above"></i>Above 20D avg</span>
        <span><i class="is-below"></i>Below 20D avg</span>
        <span><i class="is-strong"></i>Strong deviation</span>
      </div>
    </div>
    <div id="vol-cal-root" class="vol-cal-root" aria-live="polite">Choose a stock to load its volume calendar&hellip;</div>
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
    <p class="hint">Put 2–4 companies side by side. The price overlay rebases every name to 0% on the first shared close, making relative strength easy to compare across 1 month to 1 year; the table then lines up valuation (P/E, PEG, P/S), growth, margins, the analyst read and our 4-pillar grade. Reads the same free data as the Grade tab.</p>
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
      <button type="button" class="cmp-btn cmp-btn-quick" id="cmp-quick-mega4" title="Compare AAPL, MSFT, GOOGL and AMZN">Mega 4</button>
      <button type="button" class="cmp-btn cmp-btn-ghost" id="cmp-clear">Clear</button>
    </div>
    <div id="cmp-chips" class="cmp-chips" aria-label="Selected companies"></div>
    <div id="cmp-status" class="opt-status" role="status"></div>
    <div id="cmp-chart-card" class="cmp-chart-card" hidden>
      <div class="cmp-chart-head">
        <div>
          <div class="cmp-chart-eyebrow">Price overlay</div>
          <h3 class="cmp-chart-title">Relative performance</h3>
          <p class="cmp-chart-sub" id="cmp-chart-sub">Daily closes, rebased to 0% on the first shared session.</p>
        </div>
        <div id="cmp-range" class="cmp-range" role="group" aria-label="Comparison chart range">
          <button type="button" class="cmp-range-btn" data-cmp-range="1m" aria-pressed="false">1M</button>
          <button type="button" class="cmp-range-btn is-active" data-cmp-range="3m" aria-pressed="true">3M</button>
          <button type="button" class="cmp-range-btn" data-cmp-range="6m" aria-pressed="false">6M</button>
          <button type="button" class="cmp-range-btn" data-cmp-range="1y" aria-pressed="false">1Y</button>
        </div>
      </div>
      <div id="cmp-chart-legend" class="cmp-chart-legend" aria-label="Chart legend"></div>
      <div id="cmp-chart" class="cmp-chart"></div>
      <div id="cmp-chart-read" class="cmp-chart-read" aria-live="polite"></div>
    </div>
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
    <p class="hint">Choose a ticker, check whether the entry is ready, then grade the exact call or put. The setup and contract both regrade as fresh quotes arrive.</p>
    <div class="opt-workflow" role="list" aria-label="Three-step grading workflow">
      <div class="opt-workflow-step" role="listitem"><span>1</span><b>Pick the ticker</b><small>Load price and context.</small></div>
      <div class="opt-workflow-step" role="listitem"><span>2</span><b>Check timing</b><small>Execute, wait, or avoid.</small></div>
      <div class="opt-workflow-step" role="listitem"><span>3</span><b>Grade contract</b><small>Choose side, expiry, strike.</small></div>
    </div>
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
      <div class="opt-direction" aria-label="Directional thesis">
        <div class="opt-direction-copy"><span>Thesis side</span><small>Drives both entry timing and the contract grade.</small></div>
        <div class="segmented" role="radiogroup" aria-label="Option type">
          <input type="radio" name="opt-type" id="opt-type-call" value="call" checked>
          <label for="opt-type-call">Calls</label>
          <input type="radio" name="opt-type" id="opt-type-put" value="put">
          <label for="opt-type-put">Puts</label>
        </div>
      </div>
      <div class="opt-tabs" role="tablist" aria-label="Ticker decision workflow">
        <button type="button" class="opt-tab" role="tab" aria-label="Setup and timing" aria-selected="true" aria-controls="opt-tab-pane-tech" id="opt-tab-btn-tech" data-tab="tech">Setup</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-contract" id="opt-tab-btn-contract" data-tab="contract">Contract grade</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-fund" id="opt-tab-btn-fund" data-tab="fund">Fundamentals</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-iv" id="opt-tab-btn-iv" data-tab="iv">Implied vol</button>
        <button type="button" class="opt-tab" role="tab" aria-selected="false" aria-controls="opt-tab-pane-news" id="opt-tab-btn-news" data-tab="news">News</button>
      </div>
      <div class="opt-tab-pane" role="tabpanel" id="opt-tab-pane-tech" aria-labelledby="opt-tab-btn-tech">
        <div id="opt-exec-host" aria-live="polite"></div>
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
            <div id="opt-fund-operating-costs-history" class="opt-fund-eh" hidden></div>
            <div id="opt-fund-net-income-history"   class="opt-fund-eh" hidden></div>
            <div id="opt-fund-fcf-history"          class="opt-fund-eh" hidden></div>
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
    <p class="hint">Choose a ticker and the desk will match its directional tape, volatility regime and event risk to a defined-risk starting structure. You can then edit every leg, price your actual fill, and inspect the expiration payoff.</p>
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
    <section id="strat-starter" class="strat-starter" aria-labelledby="strat-starter-title">
      <div class="strat-starter-head">
        <div>
          <span class="strat-starter-kicker">Start with the thesis</span>
          <h3 id="strat-starter-title">What do you expect the stock to do?</h3>
          <p>Pick the market view first. After you choose a ticker, the desk will load a defined-risk starting structure and test it against tape, volatility, events, liquidity and payoff.</p>
        </div>
        <span class="strat-starter-step">1 view &rarr; 2 ticker &rarr; 3 verify</span>
      </div>
      <div class="strat-start-grid">
        <button type="button" class="strat-start-card strat-start-bull" data-strat-intent="bull-call-spread" aria-pressed="false">
          <span>Upside</span><b>Bullish, defined risk</b><small>Start with a bull call spread</small>
        </button>
        <button type="button" class="strat-start-card strat-start-bear" data-strat-intent="bear-put-spread" aria-pressed="false">
          <span>Downside</span><b>Bearish, defined risk</b><small>Start with a bear put spread</small>
        </button>
        <button type="button" class="strat-start-card strat-start-move" data-strat-intent="long-straddle" aria-pressed="false">
          <span>Volatility</span><b>Big move, direction unclear</b><small>Start with a long straddle</small>
        </button>
        <button type="button" class="strat-start-card strat-start-range" data-strat-intent="iron-condor" aria-pressed="false">
          <span>Range</span><b>Price stays contained</b><small>Start with an iron condor</small>
        </button>
      </div>
      <div class="strat-start-next">
        <div>
          <span>Quick ticker</span>
          <div class="strat-quick-symbols" aria-label="Popular strategy tickers">
            <button type="button" data-strat-symbol="SPY">SPY</button>
            <button type="button" data-strat-symbol="QQQ">QQQ</button>
            <button type="button" data-strat-symbol="NVDA">NVDA</button>
            <button type="button" data-strat-symbol="TSLA">TSLA</button>
          </div>
        </div>
        <p id="strat-start-read" aria-live="polite">Choose a view, then search any ticker above.</p>
      </div>
      <p class="strat-start-rule"><b>No auto-trade:</b> this only builds the first draft. The live verdict, invalidation, event window, liquidity and reward-to-risk checks decide whether it is actionable.</p>
    </section>
    <div id="strat-status" class="opt-status" role="status"></div>
    <div id="strat-ticker-meta" class="strat-ticker-meta" hidden aria-live="polite"></div>
    <div id="strat-guidance" class="strat-guidance" hidden aria-live="polite"></div>
    <details id="strat-templates" class="strat-templates strat-disclosure" hidden>
      <summary class="strat-disclosure-summary">
        <span><b>All strategy templates</b><small>Directional, volatility, neutral and income structures</small></span>
        <em id="strat-template-summary-meta">12 structures</em>
        <i class="strat-chevron" aria-hidden="true"></i>
      </summary>
      <div class="strat-disclosure-body">
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
        <p class="strat-tpl-foot">Templates use the nearest expiration and strikes around spot. Treat them as a starting structure, then verify liquidity and edit the legs to match your actual entry.</p>
      </div>
    </details>
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
      <div id="strat-verdict" class="strat-verdict"></div>
      <div id="strat-summary" class="strat-summary"></div>
      <details class="strat-analysis strat-disclosure">
        <summary class="strat-disclosure-summary">
          <span><b>Payoff, Greeks &amp; score anatomy</b><small>Stress the expiration shape and sensitivity</small></span>
          <em>Full analysis</em>
          <i class="strat-chevron" aria-hidden="true"></i>
        </summary>
        <div class="strat-disclosure-body">
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
          <p class="strat-foot">Payoff is plotted at the nearest leg's expiration. For calendar spreads the far leg is repriced with Black-Scholes at that instant using its chain IV. Max gain / loss is labelled "unlimited" when a naked leg leaves one side open.</p>
        </div>
      </details>
    </div>
    <details id="strat-legs" class="strat-legs strat-disclosure" hidden>
      <summary class="strat-disclosure-summary">
        <span><b>Edit contract legs</b><small>Expiry, strike, quantity and your fill</small></span>
        <em class="strat-leg-counter" id="strat-leg-count">0 legs</em>
        <i class="strat-chevron" aria-hidden="true"></i>
      </summary>
      <div class="strat-disclosure-body strat-legs-body">
        <div class="strat-legs-actions">
          <button type="button" class="strat-btn-ghost" id="strat-add-leg">+ Add leg</button>
        </div>
        <div id="strat-legs-list" class="strat-legs-list" role="list"></div>
        <p class="strat-legs-foot">Each leg prices off the live chain <b>mid</b>. Type a <b>Price</b> to use your own fill; cost, breakeven and P/L then update from that entry.</p>
      </div>
    </details>
  </section>`;
}

export function renderHtml({ symbols, builtAt, builtAtIso, narratives = [], sectorOverviews = {}, recentlyEnded = [], macroHeadlines = [], unusual = null, spots = {}, fearGreed = null, macro = null, volumeFlags = null, marketBackdrop = null, nextFomcDates = [], oi = null, assetVersion = null, assetVersions = null, renderedAtIso = null, dataDir = null }) {
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
  // --- Manifest split (private-data migration / Path B) ----------------------
  // The manifest's heavy fields are externalized to sidecars so the committed
  // (public-repo) index.html carries only a non-sensitive SHELL (ticker list,
  // sector taxonomy, freshness-stub meta) plus a `deferred` flag. app.js then
  // fetches two public sidecars and merges them before first paint:
  //   \u2022 data/manifest.json \u2014 unusual-flow snapshot.
  //   \u2022 data/manifest-free.json \u2014 macro
  //     narratives, sector overviews, recently-ended narratives, headlines,
  //     last spots, fear-greed, macro backdrop, market backdrop. Powers the
  //     Narratives / Bonds & USD / Fear & Greed / Grade / Heatmap surfaces.
  // Without dataDir, inline the full manifest (legacy/standalone render).
  // Both sidecars carry provenance that is deliberately separate from the
  // shell's display timestamp. The publish-time freshness gate uses this to
  // prove the sidecars were regenerated from the same bake before the private
  // store is flushed; the browser ignores unknown `_meta` fields.
  const sidecarMeta = {
    dataBuiltAtIso: builtAtIso,
    renderedAtIso: renderedAtIso || assetVersion || builtAtIso,
  };
  const flowManifest = {
    _meta: sidecarMeta,
    unusual: unusual || null,
  };
  const freeManifest = {
    _meta: sidecarMeta,
    narratives: narrativesTagged,
    sectorOverviews: sectorOverviews || {},
    recentlyEnded,
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
      writeFileSync(resolve(dataDir, "manifest.json"), JSON.stringify(flowManifest), "utf8");
      writeFileSync(resolve(dataDir, "manifest-free.json"), JSON.stringify(freeManifest), "utf8");
      inlineManifest = { ...shellManifest, deferred: true };
    } catch (err) {
      // Abort rather than shipping a partial manifest split.
      throw new Error(`manifest sidecar write failed: ${err?.message || err}`, { cause: err });
    }
  } else {
    inlineManifest = { ...shellManifest, ...freeManifest, ...flowManifest };
  }
  const manifestPayload = JSON.stringify(inlineManifest)
    .replace(/</g, "\\u003C").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  // Static assets are served with 1-year immutable caching. Prefer independent
  // content-derived versions so an unchanged multi-megabyte asset keeps its URL
  // across scanner deploys; assetVersion remains a compatibility fallback.
  const legacyAssetVersion = assetVersion || builtAtIso;
  const cacheBustFor = (key) => encodeURIComponent(assetVersions?.[key] || legacyAssetVersion);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>stonks</title>
<meta name="description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital." />
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="apple-touch-icon" href="favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="stonks">
<meta property="og:description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="stonks">
<meta name="twitter:description" content="Grade any stock ticker: a 4-pillar conviction score, technicals, fundamentals, implied vol, news, and an options contract grader. Track the market narratives currently driving capital.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..600;1,9..144,400..600&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="styles.css?v=${cacheBustFor("styles")}">
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
    </a>
    </div>
    <nav class="site-nav">
      <button id="cmd-palette-trigger" class="cmd-palette-trigger" type="button" aria-label="Search ticker, narrative, or tab" title="Jump to ticker, narrative, or tab (⌘K / Ctrl+K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <span class="cmd-palette-trigger-label">Search ticker, narrative, tab…</span>
        <kbd class="cmd-palette-trigger-kbd">⌘K</kbd>
      </button>
      <a class="discord-btn" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener" aria-label="Join the Ming Street Discord to discuss market research" title="Join the Discord to discuss market research">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5c1.6.4 2.9 1 4.1 1.8a13.5 13.5 0 0 0-11.5 0c1.2-.8 2.6-1.4 4.1-1.8L11.6 3A19.8 19.8 0 0 0 6.7 4.4 20.6 20.6 0 0 0 3 18.6 19.9 19.9 0 0 0 8 21l.6-.9c-.9-.3-1.7-.7-2.4-1.2.2-.1.4-.3.6-.4a14.2 14.2 0 0 0 12.4 0c.2.1.4.3.6.4-.7.5-1.5.9-2.4 1.2l.6.9a19.9 19.9 0 0 0 5-2.4 20.6 20.6 0 0 0-3.7-14.2ZM9 15.3c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>
        <span>Join Discord</span>
      </a>
      <a class="donate-btn" href="${KO_FI_URL}" target="_blank" rel="noopener" aria-label="Support stonks on Ko-fi" title="Support stonks on Ko-fi">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h14v7a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z"/><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7.5 11.5c1-1.4 3-1.4 4 0 1-1.4 3-1.4 4 0 0 2.2-2 3.5-4 4.7-2-1.2-4-2.5-4-4.7Z"/></svg>
        <span>Support</span>
      </a>
      <label class="time-zone-control" title="Display timestamped data in your local zone or a selected U.S. market zone. Trading schedules stay in ET.">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <span class="sr-only">Display time zone</span>
        <select id="time-zone-select" aria-label="Display time zone">
          <option value="local">Local</option>
          <option value="et">ET</option>
          <option value="ct">CT</option>
          <option value="mt">MT</option>
          <option value="pt">PT</option>
          <option value="utc">UTC</option>
        </select>
      </label>
      <button id="theme-toggle" class="icon-btn" aria-label="Toggle theme" type="button">
        <svg class="i-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        <svg class="i-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <!-- Owner session chip. Public visitors never see a login CTA. -->
      <div id="auth-chip" class="auth-chip" hidden></div>
    </nav>
  </div>
</header>
<p class="page-sub">General market news, events, breadth, macro data, and source-backed company research. Refreshed throughout the trading day.</p>
<div id="freshness-banner" class="freshness" data-built-at="${builtAtIso}" role="status" aria-live="polite">
  <span class="freshness-dot" aria-hidden="true"></span>
  <span id="freshness-text">Checking data freshness&hellip;</span>
  <span id="market-status" class="market-status" aria-live="off" hidden></span>
</div>
<!-- Collapsible sidebar navigation. Destinations are grouped by the decision
     a trader is making; Desk + Ideas start open while deeper reference groups
     stay compact until needed. Items keep the same ids / data-page-tab /
     aria-controls wiring, so cmd-K targeting, premium locks and role-hidden
     removal continue to work unchanged. Desktop: pushes content, defaults
     open, collapse persisted. Mobile: overlay drawer, closes on navigation. -->
<div class="side-nav-backdrop" id="side-nav-backdrop" hidden></div>
<aside class="side-nav" id="side-nav">
<nav class="page-tabs" role="tablist" aria-orientation="vertical" aria-label="Page sections">
  <details class="side-nav-group" data-nav-group="desk" open>
    <summary class="side-nav-group-label">Desk</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('home', 'Home', { selected: true })}
      ${sideNavItem('brief', 'Brief')}
      ${sideNavItem('news', 'News')}
      ${sideNavItem('heatmap', 'Heatmap')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="research" open>
    <summary class="side-nav-group-label">Research</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('narratives', 'Narratives')}
      ${sideNavItem('tickers', 'Tickers')}
      ${sideNavItem('grade', 'Grade a ticker')}
      ${sideNavItem('compare', 'Compare companies')}
      ${sideNavItem('strategies', 'Strategies')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="ideas" open>
    <summary class="side-nav-group-label">Ideas &amp; flow</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('ma-tracker', 'MA tracker')}
      ${sideNavItem('flow', 'Unusual flow')}
      ${sideNavItem('volume', 'Volume')}
      ${sideNavItem('oi', 'Gamma exposure')}
      ${sideNavItem('iv-trend', 'Trending IV')}
      ${sideNavItem('streaks', 'Streaks')}
      ${sideNavItem('spillover', 'Event spillover')}
      ${sideNavItem('index-cal', 'Index calendar')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="events" open>
    <summary class="side-nav-group-label">Events</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('calendar', 'Calendar')}
      ${sideNavItem('pending-buyouts', 'Pending buyouts')}
      ${sideNavItem('earnings', 'Earnings tracker')}
      ${sideNavItem('calls', 'Earnings calls')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="macro" open>
    <summary class="side-nav-group-label">Macro</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('overnight', 'Overnight markets')}
      ${sideNavItem('fear-greed', 'Fear &amp; Greed')}
      ${sideNavItem('bonds-usd', 'Bonds &amp; USD')}
      ${sideNavItem('commodities', 'Commodities')}
      ${sideNavItem('capital-raises', 'Capital raises')}
      ${sideNavItem('ipo-credit', 'IPOs &amp; credit')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="alt-data" open>
    <summary class="side-nav-group-label">Alt data</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('ai-capex', 'AI CapEx')}
      ${sideNavItem('ram-prices', 'RAM prices')}
      ${sideNavItem('accelerator-prices', 'GPU cloud prices')}
      ${sideNavItem('central-bank-gold', 'Central-bank gold')}
      ${sideNavItem('search-interest', 'Search interest')}
      ${sideNavItem('f13', 'SEC ownership')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="owner" data-role-group="owner" open hidden>
    <!-- Private research; hidden until the Top Picks owner session resolves. -->
    <summary class="side-nav-group-label">Owner</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('market', 'Market analysis')}
      ${sideNavItem('picks', 'Top picks')}
      ${sideNavItem('stocks', 'Stock picks')}
      ${sideNavItem('rotation', 'Sector rotation')}
      ${sideNavItem('levetf', 'Leveraged ETFs')}
      ${sideNavItem('track', 'Top Picks track record')}
      ${sideNavItem('daytrade', 'Day Trading')}
      ${sideNavItem('daytrack', 'Day Trading track record')}
      ${sideNavItem('quant', 'Owner Lab')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="tools" open>
    <summary class="side-nav-group-label">Tools</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('cheatsheet', "Buyer's manual")}
      ${sideNavItem('chart-patterns', 'Chart patterns')}
      ${sideNavItem('timeline', 'Refresh schedule')}
    </div>
  </details>
  <details class="side-nav-group" data-nav-group="legal" open>
    <summary class="side-nav-group-label">Legal</summary>
    <div class="side-nav-group-items">
      ${sideNavItem('privacy', 'Privacy Policy')}
      ${sideNavItem('terms', 'Terms of Use')}
    </div>
  </details>
</nav>
</aside>
<main>
  <div class="page-pane" id="page-pane-home" role="tabpanel" aria-labelledby="page-tab-home">
    <section class="landing-hero">
      <div class="landing-hero-main">
        <div class="landing-hero-copy">
          <span class="landing-hero-eyebrow">Today's market</span>
          <h1 class="landing-hero-title">Start with the context.</h1>
          <p class="landing-hero-sub">Review news, scheduled events, breadth, macro conditions, and source-backed company research across ${tickerCount} tracked names.</p>
        </div>
        <div class="landing-quick" role="group" aria-label="Trader shortcuts">
          <button type="button" class="landing-quick-card" data-go="brief" aria-label="Read today's market brief">
            <span>Read the tape</span><b>Market brief</b><small>What changed and what matters now.</small><em aria-hidden="true">&rarr;</em>
          </button>
          <button type="button" class="landing-quick-card" data-go="picks" aria-label="Open today's highest-conviction top picks">
            <span>Find a trade</span><b>Top picks</b><small>Contracts ranked with an explicit entry state.</small><em aria-hidden="true">&rarr;</em>
          </button>
          <button type="button" class="landing-quick-card" data-go="grade" aria-label="Grade a ticker and option contract">
            <span>Validate it</span><b>Grade a ticker</b><small>Check the name, levels and exact contract.</small><em aria-hidden="true">&rarr;</em>
          </button>
          <button type="button" class="landing-quick-card" data-go="calendar" aria-label="Check upcoming market and earnings risk">
            <span>Check the risk</span><b>Calendar</b><small>Earnings, macro releases and FOMC timing.</small><em aria-hidden="true">&rarr;</em>
          </button>
        </div>
      </div>
      <div id="landing-pulse" class="landing-pulse" role="list" aria-label="Market pulse — major index ETFs, last close" hidden></div>
    </section>
    <section class="landing-section">
      <header class="landing-section-head">
        <h2 class="landing-section-title">Follow the market</h2>
        <p class="landing-section-sub">What changed, what is moving, and what is scheduled next.</p>
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
        <button type="button" class="landing-card" data-go="news" aria-label="Open the stock and macro news desk">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">News desk</span>
            <span class="landing-card-arrow" aria-hidden="true">&rarr;</span>
          </header>
          <div class="landing-card-stat" id="land-stat-news">Ranked</div>
          <div class="landing-card-sub" id="land-sub-news">market-moving headlines</div>
          <p class="landing-card-desc">Straight stock and macro news, ranked by likely impact with published economic prints and the active tape alongside it.</p>
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
        <button type="button" class="landing-card" data-go="rotation" aria-label="View sector rotation rebounds">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">Sector rotation</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-rotation">Rebounds</div>
          <div class="landing-card-sub" id="land-sub-rotation">quality names turning</div>
          <p class="landing-card-desc">Strong companies sold with their sector — not on broken company news — then reclaiming the tape, from washout to confirmation.</p>
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
          <p class="landing-card-desc">Earnings AM/PM sessions, macro releases (CPI, NFP, JOLTS), ticker catalysts, and dated FOMC meetings.</p>
        </button>
      </div>
    </section>
    <section class="landing-section">
      <header class="landing-section-head">
        <h2 class="landing-section-title">Research</h2>
        <p class="landing-section-sub">Ownership, sentiment, rates, currencies, and the broader market backdrop.</p>
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
        <button type="button" class="landing-card" data-go="f13" aria-label="View SEC ownership filings">
          <header class="landing-card-head">
            <span class="landing-card-eyebrow">SEC ownership</span>
            <span class="landing-card-arrow" aria-hidden="true">→</span>
          </header>
          <div class="landing-card-stat" id="land-stat-f13">Q</div>
          <div class="landing-card-sub" id="land-sub-f13">institutional holdings</div>
          <p class="landing-card-desc">Quarterly 13F manager rotation plus recent Form 4 insider purchases, sales, and non-market transactions.</p>
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
          <p class="landing-card-desc">Treasury yields, the dollar, Effective Fed Funds, meeting odds, official votes, and the full Fed rate path.</p>
        </button>
      </div>
    </section>
    <section class="landing-section landing-section-act" hidden>
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
    <p class="landing-foot">Use the navigation menu or press <kbd>⌘K</kbd> to jump to available research.</p>
  </div>
  <div class="page-pane" id="page-pane-brief" role="tabpanel" aria-labelledby="page-tab-brief" hidden>
  ${briefSection()}
  </div>
  <div class="page-pane" id="page-pane-news" role="tabpanel" aria-labelledby="page-tab-news" hidden>
  ${newsFeedSection()}
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
  <div class="page-pane" id="page-pane-rotation" role="tabpanel" aria-labelledby="page-tab-rotation" hidden>
  ${sectorRotationSection()}
  </div>
  <div class="page-pane" id="page-pane-levetf" role="tabpanel" aria-labelledby="page-tab-levetf" hidden>
  ${leveragedEtfsSection()}
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
      <p class="hint">Read the tape at a glance: tile size shows market cap and color shows the selected 1D, 1W, 1M, 3M, YTD, or 1Y return. Find a ticker, switch to relative volume, or tap any tile to open its Grade.</p>
      ${infoNote('How to read this map', `<p>Choose a <b>Period</b> to compare session, weekly, monthly, quarterly, year-to-date, or one-year performance. Deeper green and red mark larger moves on a scale adjusted to that horizon. In <b>Relative volume</b> mode, saturation shows current cumulative volume versus the fraction of a normal 20-day session expected by that clock time, using the same U-shaped intraday pace curve as the Volume desk; hue still shows the selected period&rsquo;s direction. That keeps the morning comparable with the close instead of labeling every incomplete session quiet. Pre-market keeps the last completed-session read rather than treating prior-session volume as live. Group by sector or industry, press Enter after searching to center the first match, and use the zoom controls or wheel/pinch to inspect the small-cap tail.</p><p>The <b>Sector breadth streak</b> flags a group only after at least 70% of its tracked names have closed in the same direction for two or more consecutive sessions. That proves participation is broad and persistent; it does <em>not</em> measure ETF inflows/outflows, relative strength versus SPY, or the Owner Sector Rotation desk&rsquo;s quality-washout rebound setup. Use a green streak as a leadership candidate and a red streak as a group-risk flag, then confirm with relative performance and volume. Not financial advice.</p>`)}
      <div id="heatmap-decision" class="heatmap-decision" aria-live="polite"></div>
      <div class="heatmap-controls" role="toolbar" aria-label="Heatmap controls">
        <label class="heatmap-control heatmap-group-control">
          <span class="heatmap-control-label">Group by</span>
          <select id="heatmap-group-select" aria-label="Group heatmap by">
            <option value="sector">Sector</option>
            <option value="industry">Industry</option>
          </select>
        </label>
        <label class="heatmap-control heatmap-color-control">
          <span class="heatmap-control-label">Color by</span>
          <select id="heatmap-color-select" aria-label="Color heatmap by">
            <option value="perf">Performance</option>
            <option value="rvol">Rel. volume</option>
          </select>
        </label>
        <label class="heatmap-control heatmap-period-control">
          <span class="heatmap-control-label">Period</span>
          <select id="heatmap-period-select" aria-label="Heatmap performance period">
            <option value="1d">1D</option>
            <option value="1w">1W</option>
            <option value="1m">1M</option>
            <option value="3m">3M</option>
            <option value="ytd">YTD</option>
            <option value="1y">1Y</option>
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
      <div id="heatmap-streaks" class="heatmap-streaks" role="status" aria-live="polite" hidden></div>
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
  <div class="page-pane" id="page-pane-pending-buyouts" role="tabpanel" aria-labelledby="page-tab-pending-buyouts" hidden>
  ${pendingBuyoutsSection()}
  </div>
  <div class="page-pane" id="page-pane-earnings" role="tabpanel" aria-labelledby="page-tab-earnings" hidden>
  ${earningsTrackerSection()}
  </div>
  <div class="page-pane" id="page-pane-calls" role="tabpanel" aria-labelledby="page-tab-calls" hidden>
  ${earningsCallsSection()}
  </div>
  <div class="page-pane" id="page-pane-spillover" role="tabpanel" aria-labelledby="page-tab-spillover" hidden>
  ${spilloverSection()}
  </div>
  <div class="page-pane" id="page-pane-quant" role="tabpanel" aria-labelledby="page-tab-quant" hidden>
  ${quantSection()}
  </div>
  <div class="page-pane" id="page-pane-daytrade" role="tabpanel" aria-labelledby="page-tab-daytrade" hidden>
  ${dayTradingSection()}
  </div>
  <div class="page-pane" id="page-pane-daytrack" role="tabpanel" aria-labelledby="page-tab-daytrack" hidden>
  ${dayTradingTrackSection()}
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
  <div class="page-pane" id="page-pane-ma-tracker" role="tabpanel" aria-labelledby="page-tab-ma-tracker" hidden>
  ${movingAverageTrackerSection()}
  </div>
  <div class="page-pane" id="page-pane-volume" role="tabpanel" aria-labelledby="page-tab-volume" hidden>
  ${volumeCalendarSection()}
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
      ${infoNote('How streaks are counted', `<p>Daily moves first pass an adaptive noise floor based on the ticker's own recent median absolute move (bounded at 0.08–0.35%), so microscopic closes do not create streaks. Counter-day and cumulative-tolerance break bars also scale with that volatility, within conservative bounds. A same-direction close partially heals the tolerance bank and one counter day rather than erasing all prior damage. The displayed streak count is the number of same-direction days; when tolerated counter/flat days occur, the sparkline may span a longer session window. Cumulative return is compounded, not summed. “Just snapped” only includes a material prior run (3+ same-direction days plus length or move significance) with a meaningful reversal, which keeps ordinary two-day noise out of the mean-reversion queue.</p>`)}
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
    <section class="card bonds-context-card" id="bonds-context-card">
      <header class="card-header">
        <h2 class="card-title">Rates decision desk</h2>
        <span class="card-eyebrow" id="bonds-context-eyebrow">Freshness · confirmation · equity lens</span>
      </header>
      <div id="bonds-context" class="bonds-context">Reading today&rsquo;s drivers&hellip;</div>
      <p class="hint">This is a deterministic cross-asset read, not a claim of causation. A catalyst that points against the observed move is shown as conflict, not confirmation.</p>
    </section>

    <section class="card" id="bonds-live-card">
      <header class="card-header">
        <h2 class="card-title">Rates &amp; dollar monitor</h2>
        <span class="card-eyebrow" id="bonds-live-eyebrow">as of last build</span>
      </header>
      <div class="bonds-live-status" id="bonds-live-status" role="status" aria-live="polite">
        <span class="bonds-live-status-dot" aria-hidden="true"></span>
        <span>Live overlay starts when this tab is open.</span>
      </div>
      <div class="bonds-live-grid" id="bonds-live-grid">
        <!-- Populated client-side from window.STONKS_MANIFEST.macro -->
      </div>
      <details class="bonds-monitor-notes">
        <summary>
          <span>Curve &amp; data notes</span>
          <span class="bonds-monitor-notes-hint">Yield shape, alert thresholds and source cadence</span>
        </summary>
        <div class="bonds-monitor-notes-body">
          <div class="bonds-curve" id="bonds-curve" hidden>
            <!-- Treasury yield-curve chart injected client-side from the 2Y/10Y/30Y legs -->
          </div>
          <p class="hint">The 10Y, 30Y and DXY come from the latest build with a best-effort live quote overlay. The 2Y uses the latest official U.S. Treasury daily par-yield close because there is no reliable free cash-2Y intraday index; a 2Y yield future is not substituted. On an FOMC decision day the open tab refreshes the rates monitor every five minutes so available meeting-day moves stay current. Tiles show the 1-day move (basis points for yields, % for DXY), movement band, and 5-day trend. A <span class="bonds-live-alert" aria-hidden="true">!</span> chip marks DXY ±0.6% or the 10Y ±10 bps on a daily close.</p>
          <p class="hint"><strong>CPI and unemployment</strong> are monthly BLS prints, not live quotes. The unemployment tile&rsquo;s Sahm read compares the 3-month average with its prior-year low; ≥0.5pp is the classic recession-onset threshold.</p>
        </div>
      </details>
    </section>

    <section class="card" id="bonds-fed-policy-card">
      <header class="card-header">
        <h2 class="card-title">Fed policy &amp; rate path</h2>
        <span class="card-eyebrow">Effective rate &middot; meeting odds &middot; official votes</span>
      </header>
      <div id="fomc-widget" class="fomc-widget" hidden></div>
    </section>

    <section class="card fomc-day-card" id="fomc-day-card">
      <header class="card-header">
        <div>
          <span class="card-eyebrow">Decision-day event study</span>
          <h2 class="card-title">FOMC day history</h2>
        </div>
        <span class="card-eyebrow">SPY &middot; QQQ &middot; IWM &middot; TLT</span>
      </header>
      <p class="hint">Compare what rate move was priced before each decision with the actual action, the equity close, the bond reaction, and the official dissenters.</p>
      <div class="fomc-day-root" id="fomc-day-root" aria-live="polite">
        <p class="bonds-live-empty">Loading meeting history&hellip;</p>
      </div>
    </section>

    <details class="card bonds-scale-card" id="bonds-scale-card">
      <summary class="bonds-card-summary">
        <span>
          <span class="bonds-card-summary-title">Movement scale</span>
          <span class="bonds-card-summary-copy">What counts as a notable, big or very large daily move</span>
        </span>
        <span class="bonds-card-summary-action">View thresholds</span>
      </summary>
      <div class="bonds-scale-body">
        <p class="hint">Reference bands for sizing a daily change. Small moves are normal noise; larger moves deserve a catalyst and volume check before treating them as regime information.</p>
        <div class="bonds-scale-scroll">
          <table class="bonds-usd-table bonds-scale-table">
            <thead><tr><th>Asset</th><th><span class="bonds-live-band band-normal">Normal</span></th><th><span class="bonds-live-band band-notable">Notable</span></th><th><span class="bonds-live-band band-big">Big</span></th><th><span class="bonds-live-band band-very-large">Very large</span></th></tr></thead>
            <tbody>
              <tr><td>DXY</td><td>0.2–0.4%</td><td>0.5%</td><td>0.7–1.0%</td><td>&gt;1.0%</td></tr>
              <tr><td>10Y yield</td><td>&lt; 8 bps</td><td>8–10 bps</td><td>10–15 bps</td><td>15+ bps</td></tr>
              <tr><td>2Y yield</td><td>&lt; 8 bps</td><td>8–12 bps</td><td>12–20 bps</td><td>20+ bps</td></tr>
              <tr><td>30Y yield</td><td>&lt; 8 bps</td><td>8–10 bps</td><td>10–15 bps</td><td>15+ bps</td></tr>
            </tbody>
          </table>
        </div>
        <p class="hint"><em>Weekly context.</em> DXY moves of 0.5–1.0% are meaningful and 1.5%+ is a strong trend signal. For the 10Y, 20–30 bps is significant and 40+ bps signals a clear regime shift.</p>
      </div>
    </details>
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
  <div class="page-pane" id="page-pane-accelerator-prices" role="tabpanel" aria-labelledby="page-tab-accelerator-prices" hidden>
  ${acceleratorPricesSection()}
  </div>
  <div class="page-pane" id="page-pane-central-bank-gold" role="tabpanel" aria-labelledby="page-tab-central-bank-gold" hidden>
  ${centralBankGoldSection()}
  </div>
  <div class="page-pane" id="page-pane-search-interest" role="tabpanel" aria-labelledby="page-tab-search-interest" hidden>
  ${searchInterestSection()}
  </div>
  <div class="page-pane" id="page-pane-commodities" role="tabpanel" aria-labelledby="page-tab-commodities" hidden>
  ${commoditiesSection()}
  </div>
  <div class="page-pane" id="page-pane-capital-raises" role="tabpanel" aria-labelledby="page-tab-capital-raises" hidden>
  ${capitalRaisesSection()}
  </div>
  <div class="page-pane" id="page-pane-ipo-credit" role="tabpanel" aria-labelledby="page-tab-ipo-credit" hidden>
  ${ipoCreditSection()}
  </div>
  <div class="page-pane" id="page-pane-f13" role="tabpanel" aria-labelledby="page-tab-f13" hidden>
  ${f13Section()}
  </div>
  <div class="page-pane" id="page-pane-timeline" role="tabpanel" aria-labelledby="page-tab-timeline" hidden>
  ${buildTimelineSection()}
  </div>
  ${docPanesHtml()}
</main>
<footer class="site-footer">
  <div>Built <span id="footer-built-time" class="muted" data-built-at="${builtAtIso}">checking&hellip;</span></div>
  <div class="muted">All analytical and editorial content is AI-generated or algorithmically produced and may be wrong. Verify independently. Data: third-party sources. For information only — not investment advice.</div>
  <div><a class="foot-discord" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener">Discuss the research in our Discord</a></div>
  <div><a class="foot-support" href="${KO_FI_URL}" target="_blank" rel="noopener">Support stonks on Ko-fi</a></div>
  <div><a href="/?tab=privacy">Privacy Policy</a> · <a href="/?tab=terms">Terms of Use</a></div>
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
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};<\/script>
<script defer data-disable-auto-track="1" src="/_vercel/insights/script.js"></script>
<script src="app.js?v=${cacheBustFor("app")}" defer></script>
<script type="module" src="js/streaks.js?v=${cacheBustFor("streaks")}"></script>
</body>
</html>`;
}
