// Page-by-page polish from the UI overhaul (Home, Heatmap, Calendar,
// Overnight, Streaks, Open picks and others). Loaded after the base sheet so
// these rules win without !important.
export function renderPolishCss() {
  return `
/* ---- Home: index tiles with price and a small line ------------------------ */
.landing-pulse .pulse-item {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: "name sym" "price spark" "move spark";
  gap: 4px 10px; align-items: center; color: inherit; text-decoration: none;
}
.landing-pulse a.pulse-item:hover { background: var(--surface-2); }
.landing-pulse a.pulse-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.landing-pulse .pulse-name { grid-area: name; }
.landing-pulse .pulse-sym { grid-area: sym; justify-self: end; }
.landing-pulse .pulse-price { grid-area: price; font: 600 18px/1.15 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.landing-pulse .pulse-move { grid-area: move; grid-column: auto; font: 600 13px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; }
.landing-pulse .pulse-spark { grid-area: spark; align-self: end; line-height: 0; }
.landing-pulse .pulse-spark svg { display: block; width: 88px; height: 26px; overflow: visible; }
.landing-pulse .pulse-item:not(:has(.pulse-spark)) .pulse-price { grid-column: 1 / -1; }
@media (max-width: 1279px) { .landing-pulse .pulse-spark svg { width: 64px; } }
/* Phones and small tablets: two tiles per row (the last one spans both when
   the count is odd), so the price and its line never overlap the next tile. */
@media (max-width: 760px) {
  .landing-pulse { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-pulse .pulse-item { grid-column: auto; min-width: 0; border-left: 0; border-top: 1px solid var(--border); }
  .landing-pulse .pulse-item:nth-child(-n+2) { border-top: 0; }
  .landing-pulse .pulse-item:nth-child(even) { border-left: 1px solid var(--border); }
  .landing-pulse .pulse-item:last-child:nth-child(odd) { grid-column: 1 / -1; }
}

/* ---- Home: "At a glance" fills its rows ----------------------------------- */
.landing-glance[data-count="6"], .landing-glance[data-count="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.landing-glance[data-count="5"] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@media (max-width: 1023px) {
  .landing-glance[data-count] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.landing-glance-stat.is-headline {
  font-size: 15px; line-height: 1.35; font-weight: 600;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* ---- Home: Explore by topic folds away on desktop ------------------------- */
.landing-topics-fold > summary { list-style: none; cursor: pointer; }
.landing-topics-fold > summary::-webkit-details-marker { display: none; }
.landing-topics-fold > summary .landing-section-title::after { content: "▸"; display: inline-block; margin-left: 8px; font-size: .8em; color: var(--muted); transition: transform .15s ease; }
.landing-topics-fold[open] > summary .landing-section-title::after { transform: rotate(90deg); }

/* ---- Heatmap: sans numbers, stepped legend -------------------------------- */
.heatmap-tile-sym { font-family: var(--font-sans); font-weight: 700; letter-spacing: 0; }
.heatmap-tile-pct { font-family: var(--font-sans); font-weight: 600; }
.heatmap-legend-steps { display: inline-flex; flex: 0 0 auto; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.heatmap-legend-steps i { width: 26px; height: 10px; }
.heatmap-legend-steps i.neg { background: color-mix(in srgb, var(--neg) calc(var(--hm-intensity, 0) * 100%), var(--surface-3)); }
.heatmap-legend-steps i.pos { background: color-mix(in srgb, var(--pos) calc(var(--hm-intensity, 0) * 100%), var(--surface-3)); }
.heatmap-legend-steps i.zero { background: var(--surface-3); }
@media (max-width: 760px) { .heatmap-legend-steps i { width: 16px; } }
/* Pale tiles (flat or a small move) take dark text in the light theme. */
:root[data-theme="light"] .heatmap-tile[data-faint] { --hm-fg: var(--text); }

/* ---- Market brief: ticker mentions in the prose are chips ----------------- */
.brief-summary .brief-tk, .brief-hl-text .brief-tk {
  display: inline; padding: 0 6px; margin: 0 1px; font-size: .88em; line-height: 1.5;
  font-weight: 700; color: var(--accent-strong, var(--accent)); text-decoration: none; white-space: nowrap;
}
.brief-summary .brief-tk:hover, .brief-hl-text .brief-tk:hover { border-color: var(--accent); }
.brief-card > .brief-stats { margin: 2px 0 4px; }

/* ---- Calendar: agenda (next 14 days) is the default layout ---------------- */
.cal-layout-toggle { margin-right: 6px; }
.cal-agendabar { justify-content: space-between; }
.cal-agenda { display: flex; flex-direction: column; margin-top: var(--s-2, 8px); }
.cal-agenda .cal-day:first-child { border-top: none; }
.cal-agenda .cal-day.is-jump { box-shadow: inset 3px 0 0 var(--accent); background: var(--accent-tint-2); border-radius: var(--r-2); padding-left: 9px; margin-left: -9px; }
@media (max-width: 640px) { .cal-agendabar { flex-wrap: wrap; gap: 6px; } }

/* ---- Overnight: all markets in one table with region chips ---------------- */
.ovn-markets { margin-top: var(--s-4, 16px); }
.ovn-markets-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.ovn-markets-head h3 { margin: 0 auto 0 0; font: 600 var(--fs-16, 1rem)/1.3 var(--font-sans); color: var(--text-strong); }
.ovn-region-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ovn-region-chip { appearance: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: var(--r-pill, 999px); padding: 3px 10px; font: 500 12px/1.4 var(--font-sans); cursor: pointer; }
.ovn-region-chip.is-on { background: var(--accent-tint-2); border-color: var(--accent); color: var(--accent-strong); }
.ovn-markets-table tbody tr[data-ovn-market] { cursor: pointer; }
.ovn-markets-table tbody tr.is-selected td { background: var(--accent-tint-2); }
.ovn-markets-table .ovn-flag { margin: 0 3px 0 0; }
.ovn-markets-table td .ovn-up { color: var(--pos); font-weight: 600; }
.ovn-markets-table td .ovn-dn { color: var(--neg); font-weight: 600; }
.ovn-footnote { margin-top: var(--s-3, 12px); }
@media (max-width: 640px) { .ovn-markets-head h3 { flex-basis: 100%; } .ovn-region-chips { order: 3; flex-basis: 100%; overflow-x: auto; flex-wrap: nowrap; } }

/* ---- Shared underlined tabs (Who owns what research, Owner sub-tabs) ------ */
.ui-tabs-block { margin-top: var(--s-4, 16px); min-width: 0; }
.ui-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.ui-tabs::-webkit-scrollbar { display: none; }
.ui-tab { appearance: none; border: 0; background: transparent; color: var(--muted); font: 600 14px/1 var(--font-sans); padding: 12px 12px 11px; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
.ui-tab:hover { color: var(--text-strong); }
.ui-tab.is-on { color: var(--text-strong); border-bottom-color: var(--accent); }
.ui-tab:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ui-tab-count { margin-left: 4px; padding: 1px 6px; border-radius: var(--r-pill, 999px); background: var(--surface-2); color: var(--muted); font-size: 11px; font-weight: 600; }
.ui-tab-panel { padding-top: var(--s-3, 12px); min-width: 0; }
.ui-tab-sub { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.ui-tab-panel > .f13-disclosure-body { padding: 0; border: 0; }

/* ---- Rates: quieter tiles, the next meetings as stacked bars -------------- */
.bonds-live-tile[title] { cursor: help; }
.bonds-live-tile .bonds-spark { display: block; width: 100%; height: 28px; margin-top: 6px; }
.fomc-path { display: grid; gap: 6px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.fomc-path-row { display: grid; grid-template-columns: minmax(96px, 150px) minmax(0, 1fr) 84px; align-items: center; gap: 10px; font-size: 13px; }
.fomc-path-label { color: var(--muted-strong, var(--muted)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fomc-path-bar { height: 8px; }
.fomc-path-lead { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.fomc-path-lead.cut { color: var(--pos); }
.fomc-path-lead.hike { color: var(--neg); }
.fomc-path-lead.hold { color: var(--muted-strong, var(--muted)); }

/* ---- Up/down streaks: card stat labels stay on one line ------------------- */
.streaks-stat-lbl { white-space: nowrap; letter-spacing: .04em; }
.streaks-stat-block + .streaks-stat-block { margin-left: 12px; }

/* ---- Open picks: stop / entry / now / target range bar -------------------- */
.acc-range { display: block; margin: 10px 0 4px; max-width: 520px; }
.pick-tab-card .acc-range { width: 100%; margin: 4px 0 2px; }
.pick-tab-card > .acc-range { grid-area: range; }
.pick-tab-card:has(> .acc-range) { grid-template-areas: "rank head score" "rank tier tier" "rank thesis thesis" "rank entry entry" "rank con con" "rank range range" "rank meta meta" "rank cta cta"; }
#picks-section .pick-tab-card:has(> .acc-range) { grid-template-areas: "rank head score" "tier tier tier" "thesis thesis thesis" "entry entry entry" "con con con" "range range range" "meta meta meta" "cta cta cta"; }
#picks-section .pick-tab-card:has(> .tpm-scores):has(> .acc-range) { grid-template-areas: "rank head score" "tier tier tier" "market market market" "thesis thesis thesis" "entry entry entry" "con con con" "range range range" "meta meta meta" "cta cta cta"; }
.acc-range-track { display: block; position: relative; height: 8px; border-radius: var(--r-pill, 999px); background: linear-gradient(90deg, color-mix(in srgb, var(--neg) 22%, var(--surface-3)), var(--surface-3) 45%, var(--surface-3) 55%, color-mix(in srgb, var(--pos) 22%, var(--surface-3))); }
.acc-range-fill { position: absolute; top: 0; bottom: 0; border-radius: var(--r-pill, 999px); opacity: .55; }
.acc-range-fill.is-gain { background: var(--pos); }
.acc-range-fill.is-loss { background: var(--neg); }
.acc-range-mark { position: absolute; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; }
.acc-range-mark.is-entry { width: 2px; height: 14px; border-radius: 1px; background: var(--text-strong); }
.acc-range-mark.is-now { width: 12px; height: 12px; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); }
.acc-range-mark.is-now.is-gain { background: var(--pos); }
.acc-range-mark.is-now.is-loss { background: var(--neg); }
.acc-range-labels { display: flex; justify-content: space-between; gap: 8px; margin-top: 5px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.acc-range-stop { color: var(--neg); }
.acc-range-tp { color: var(--pos); }
.acc-range-now { color: var(--text-strong); font-weight: 600; }
.acc-range.is-past-target .acc-range-tp, .acc-range.is-past-stop .acc-range-stop { font-weight: 700; }
.acc-range-mini { display: block; width: 120px; margin: 0; }
.acc-range-mini .acc-range-track { display: block; height: 6px; }
.acc-range-mini .acc-range-mark.is-now { width: 10px; height: 10px; }
.acc-range-mini .acc-range-mark.is-entry { height: 11px; }

/* ---- Top picks: the "Watching" list on a day with no picks ---------------- */
.picks-turned-away { grid-column: 1 / -1; border: 1px solid var(--border); border-radius: var(--r-3, 12px); background: var(--surface); padding: 14px 16px; display: grid; gap: 10px; }
.picks-turned-away header h3 { margin: 0; font: 600 16px/1.3 var(--font-sans); color: var(--text-strong); }
.picks-turned-away header p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
.picks-ta-row { display: grid; grid-template-columns: minmax(150px, 240px) minmax(0, 1fr); gap: 10px; align-items: start; padding-top: 8px; border-top: 1px solid var(--border); }
.picks-ta-gate { font-size: 13px; color: var(--muted-strong, var(--muted)); }
.picks-ta-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.picks-ta-chip { display: inline-flex; align-items: baseline; gap: 4px; padding: 2px 9px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); color: var(--text-strong); font-weight: 600; font-size: 13px; text-decoration: none; }
.picks-ta-chip small { font-size: 11px; font-weight: 600; color: var(--muted); }
.picks-ta-chip.is-call small { color: var(--pos); }
.picks-ta-chip.is-put small { color: var(--neg); }
.picks-ta-chip:hover { border-color: var(--accent); }
@media (max-width: 640px) { .picks-ta-row { grid-template-columns: 1fr; gap: 6px; } }

/* ---- Market themes: compact cards in a grid ------------------------------ */
.narr-name, .narr-industry-name, .narr-sector-overview-title { font-family: var(--font-sans); letter-spacing: -0.01em; }
.narr-name { font-size: var(--t-6, 18px); }
.narr-industries { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); column-gap: var(--s-4); row-gap: var(--s-4); align-items: start; }
.narr-industries > * { min-width: 0; margin-top: 0; }
.narr-industries > .narr-industry.is-multi, .narr-industries > .narr-watchlists, .narr-industries > .narr-empties { grid-column: 1 / -1; }
.narr-industry.is-multi .narr-industry-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: var(--s-4); align-items: start; }
.narr .narr-thesis { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin-bottom: 8px; }
.narr:has(> .narr-more[open]) .narr-thesis { display: block; -webkit-line-clamp: unset; }
.narr-lead-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.narr-lead-more { font-size: var(--t-2, 12px); color: var(--muted); margin-left: 2px; }
.narr:has(> .narr-more[open]) > .narr-lead-chips { display: none; }
.narr-more { margin-top: 8px; }
.narr-more > summary { list-style: none; cursor: pointer; font-size: var(--t-3, 13px); font-weight: 600; color: var(--accent-text, var(--accent)); padding: 4px 0; }
.narr-more > summary::-webkit-details-marker { display: none; }
.narr-more > summary::after { content: " \\25BE"; }
.narr-more[open] > summary::after { content: " \\25B4"; }
.narr-more .narr-more-close { display: none; }
.narr-more[open] .narr-more-open { display: none; }
.narr-more[open] .narr-more-close { display: inline; }
.narr-more[open] > summary { margin-bottom: 8px; }
.narr-more .narr-side-row { margin-top: 6px; }

/* ---- Shared small line for table cells ----------------------------------- */
.row-spark { display: block; width: 96px; height: 26px; }
.row-spark polyline { stroke-width: 1.6; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.row-spark.is-up polyline { stroke: var(--pos); }
.row-spark.is-down polyline { stroke: var(--neg); }

/* ---- Commodities: one table ---------------------------------------------- */
.cmd-view-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0 8px; flex-wrap: wrap; }
.cmd-view-head h3 { margin: 0; font-size: var(--t-5, 16px); }
.cmd-table td { vertical-align: middle; }
.cmd-table .cmd-t-group, .cmd-table .cmd-t-unit { display: block; font-size: var(--t-1, 11px); color: var(--muted); font-weight: 400; }
.cmd-table .cmd-watch { display: inline-block; margin: 2px 4px 2px 0; padding: 1px 7px; border: 1px solid var(--border); border-radius: var(--r-pill, 999px); font-size: var(--t-2, 12px); font-weight: 600; color: var(--text); text-decoration: none; }
.cmd-table .cmd-watch:hover { border-color: var(--accent); color: var(--accent-text, var(--accent)); }
.cmd-table td.cmd-t-spark { width: 110px; }

/* ---- Pending buyouts: deal-spread table ---------------------------------- */
.pb-view { margin-left: auto; }
.pb-root.is-table { display: block; }
.pb-table .pb-t-sym { font-weight: 700; color: var(--text); text-decoration: none; margin-left: 4px; }
.pb-table .pb-t-sym:hover { color: var(--accent-text, var(--accent)); }
.pb-table .pb-t-name { display: block; margin-left: 26px; max-width: 190px; color: var(--muted); font-size: var(--t-1, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pb-table .pb-t-buyer { display: inline-block; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.pb-table .pb-t-days, .pb-table .pb-stage-mini-label, .pb-table .pb-t-type { display: block; font-size: var(--t-1, 11px); color: var(--muted); font-weight: 400; white-space: nowrap; }
.pb-stage-mini { display: inline-flex; gap: 2px; }
.pb-stage-mini i { display: block; width: 14px; height: 6px; border-radius: 2px; background: var(--surface-3, var(--border)); }
.pb-stage-mini i.is-done { background: color-mix(in srgb, var(--accent) 45%, var(--surface-3, var(--border))); }
.pb-stage-mini i.is-current { background: var(--accent); }
.pb-table tr.vt-detail > td { padding: 10px 12px 14px; }
.pb-table tr.vt-detail .pb-card { margin: 0; }

/* ---- When data updates: one-day timeline --------------------------------- */
.rdt { margin: 4px 0 20px; padding: 14px 16px 10px; border: 1px solid var(--border); border-radius: var(--r-3, 12px); background: var(--surface-2); }
.rdt-row { display: grid; grid-template-columns: 220px minmax(0, 1fr); align-items: center; gap: 12px; min-height: 26px; }
.rdt-label { font-size: var(--t-3, 13px); color: var(--text); }
.rdt-track { position: relative; display: block; height: 22px; border-bottom: 1px dashed color-mix(in srgb, var(--border) 70%, transparent); }
.rdt-axis .rdt-track { border-bottom: 0; height: 20px; }
.rdt-session { position: absolute; top: 20px; height: calc(26px * 7 + 4px); background: color-mix(in srgb, var(--accent) 8%, transparent); border-left: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-right: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); pointer-events: none; }
.rdt-tick { position: absolute; top: 0; transform: translateX(-50%); font-size: var(--t-1, 11px); color: var(--muted); font-variant-numeric: tabular-nums; }
.rdt-dot { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px var(--surface-2); }
.rdt figcaption { margin-top: 10px; font-size: var(--t-2, 12px); color: var(--muted); }
@media (max-width: 760px) {
  .rdt { padding: 12px 10px 8px; }
  .rdt-row { grid-template-columns: minmax(0, 1fr); gap: 2px; margin-bottom: 4px; }
  .rdt-axis .rdt-label { display: none; }
  .rdt-label { font-size: var(--t-2, 12px); }
  .rdt-session { height: calc(48px * 7 + 4px); }
}

/* ---- Owner sub-tabs: one underlined style --------------------------------- */
.ef-tabs, .h-view-tabs, .rl-tabs { display: flex; flex-wrap: nowrap; gap: 4px; padding: 0; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.ef-tabs::-webkit-scrollbar, .h-view-tabs::-webkit-scrollbar, .rl-tabs::-webkit-scrollbar { display: none; }
.ef-tabs button, .h-view-tabs button, .rl-tabs button, .fl-tabs button, .pty-tabs button { appearance: none; flex: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--muted); font: 600 14px/1 var(--font-sans); padding: 12px 12px 11px; white-space: nowrap; cursor: pointer; }
.ef-tabs button:hover, .h-view-tabs button:hover, .rl-tabs button:hover, .fl-tabs button:hover, .pty-tabs button:hover { color: var(--text-strong); }
.ef-tabs button[aria-pressed="true"], .h-view-tabs button.is-selected, .h-view-tabs button[aria-pressed="true"], .rl-tabs button[aria-selected="true"], .fl-tabs button[aria-selected="true"], .pty-tabs button[aria-selected="true"] { color: var(--text-strong); background: transparent; border-color: transparent; border-bottom-color: var(--accent); }
.fl-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
@media (max-width: 760px) { .ef-tabs button, .h-view-tabs button, .rl-tabs button, .fl-tabs button, .pty-tabs button { font-size: 13px; padding: 11px 9px 10px; } }

/* ---- Earnings Forecast: company names in the list ------------------------- */
.ef-companies .ef-co-id { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.ef-companies .ef-co-name { font-style: normal; font-size: var(--t-1, 11px); color: var(--muted); max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ef-companies button > span:first-child { min-width: 0; }
@media (max-width: 1000px) { .ef-companies .ef-co-name { max-width: 110px; } }
@media (max-width: 600px) { .ef-companies .ef-co-name { display: none; } }

/* Flow / OI / volume decision boxes: let the metric text wrap instead of
   cutting it off. */
.flow-decision-metrics b, .flow-decision-metrics small { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
.flow-decision-metrics span { font-family: inherit; font-size: 10px; letter-spacing: .04em; }
.flow-sectors .ssb[open] { margin-bottom: var(--s-3); }

/* Strategy builder: payoff chart leads the results. */
.strat-payoff-lead { margin: 0 0 var(--s-3); }
.strat-payoff-lead .strat-payoff-title small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.strat-results-body { grid-template-columns: minmax(0, 1fr); }
.strat-payoff-be { opacity: .85; stroke-width: 1.25; }

/* News: group headings, "New" badges and the last-visit divider. */
.news-group-head { display: flex; align-items: baseline; gap: 8px; margin: var(--s-4) 0 var(--s-2); font-size: 13px; font-weight: 650; color: var(--text); letter-spacing: 0; text-transform: none; }
.news-group-head:first-child { margin-top: 0; }
.news-group-head span { color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.news-new-badge { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 999px; background: var(--accent); color: var(--surface); font-size: 10px; font-weight: 700; letter-spacing: .02em; }
.news-seen-divider { display: flex; align-items: center; gap: 10px; margin: var(--s-3) 0; color: var(--muted); font-size: 11px; }
.news-seen-divider::before, .news-seen-divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }

/* Heatmap: one compact toolbar row; zoom sits in the map corner. */
#heatmap-section .heatmap-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 12px; }
#heatmap-section .heatmap-control { flex-direction: row; align-items: center; gap: 6px; height: 36px; padding: 0 0 0 10px; border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface-2); }
#heatmap-section .heatmap-control[hidden] { display: none; }
#heatmap-section .heatmap-control-label { font: 500 11px/1 var(--font-sans, inherit); letter-spacing: 0; text-transform: none; color: var(--muted); white-space: nowrap; }
#heatmap-section .heatmap-control select { width: auto; min-height: 34px; height: 34px; border: 0; background: transparent; padding: 0 22px 0 2px; font-size: 13px; font-weight: 600; }
#heatmap-section .heatmap-search-control { flex: 1 1 160px; max-width: 260px; padding-right: 4px; }
#heatmap-section .heatmap-search-control .heatmap-search-input { flex: 1; min-width: 0; height: 30px; min-height: 30px; border: 0; background: transparent; padding: 0 4px; }
#heatmap-section .heatmap-live-toggle { padding: 0 10px; gap: 6px; }
#heatmap-section .heatmap-live-state { margin-left: auto; }
.heatmap-stage { position: relative; }
#heatmap-section .heatmap-stage > .heatmap-zoom { position: absolute; right: 8px; bottom: 8px; z-index: 4; display: flex; align-items: center; gap: 4px; height: auto; padding: 3px; min-height: 0; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--surface) 88%, transparent); box-shadow: 0 4px 14px rgba(0,0,0,.18); }
#heatmap-section .heatmap-stage > .heatmap-zoom[hidden] { display: none; }
#heatmap-section .heatmap-stage > .heatmap-zoom .heatmap-control-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.heatmap-tooltip-hint { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--hairline, var(--border)); color: var(--muted); font-size: 11px; }
@media (max-width: 640px) {
  #heatmap-section .heatmap-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #heatmap-section .heatmap-control { grid-column: auto; height: 40px; min-width: 0; }
  #heatmap-section .heatmap-control select { flex: 1; min-width: 0; height: 38px; min-height: 38px; }
  #heatmap-section .heatmap-search-control { grid-column: 1 / -1; max-width: none; }
  #heatmap-section .heatmap-live-toggle { justify-content: flex-start; }
  #heatmap-section .heatmap-live-state { margin-left: 0; grid-column: 1 / -1; justify-self: start; }
}

/* Calendar earnings rows: last four earnings-day moves as tiny bars. */
.cal-chip-hist { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px; margin-left: 6px; vertical-align: middle; }
.cal-chip-hist i { display: block; width: 4px; border-radius: 1px; background: var(--muted); }
.cal-chip-hist i.is-up { background: var(--pos); }
.cal-chip-hist i.is-down { background: var(--neg); }
.cal-chip-hist small.cal-chip-hist-lbl { margin: 0 4px 0 0; }
.cal-chip-hist small { align-self: center; margin-left: 4px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (max-width: 600px) { .cal-chip-hist small.cal-chip-hist-lbl { display: none; } }

/* Market analysis, Risk analysis and Bottom tracker share one top strip:
   regime pill, three numbers, one small chart. */
.desk-strip { --desk-tone: var(--muted); display: grid; grid-template-columns: minmax(180px, 1.1fr) minmax(0, 2.4fr) minmax(150px, 1fr); gap: var(--s-3); align-items: stretch; margin: 0 0 var(--s-4); padding: var(--s-3); border: 1px solid var(--border); border-left: 3px solid var(--desk-tone); border-radius: var(--r-3); background: var(--surface-2); }
.desk-strip-on { --desk-tone: var(--pos); }
.desk-strip-off { --desk-tone: var(--neg); }
.desk-strip-warn { --desk-tone: var(--warn); }
.desk-strip-lead { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.desk-strip-kicker { color: var(--muted); font-size: 11px; }
.desk-strip-pill { align-self: flex-start; padding: 3px 12px; border-radius: 999px; font-size: 15px; font-weight: 650; color: var(--desk-tone); background: color-mix(in srgb, var(--desk-tone) 12%, transparent); border: 1px solid color-mix(in srgb, var(--desk-tone) 40%, transparent); }
.desk-strip-neutral .desk-strip-pill { color: var(--text); }
.desk-strip-lead small { color: var(--muted-strong); font-size: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.desk-strip-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-2); min-width: 0; }
.desk-strip-kpi { min-width: 0; padding: 6px 10px; border-left: 1px solid var(--border); }
.desk-strip-kpi span { display: block; color: var(--muted); font-size: 11px; }
.desk-strip-kpi b { display: block; margin: 2px 0; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); overflow-wrap: anywhere; }
.desk-strip-kpi b.is-pos { color: var(--pos); } .desk-strip-kpi b.is-neg { color: var(--neg); }
.desk-strip-kpi small { display: block; color: var(--muted-strong); font-size: 11px; line-height: 1.35; }
.desk-strip-chart { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; }
.desk-strip-chart .row-spark { width: 100%; height: 48px; }
.desk-strip-chart .row-spark polyline { vector-effect: non-scaling-stroke; stroke-width: 1.6; }
.desk-strip-chart small { color: var(--muted); font-size: 11px; }
@media (max-width: 860px) {
  .desk-strip { grid-template-columns: minmax(0, 1fr); }
  .desk-strip-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .desk-strip-kpi:first-child { border-left: 0; padding-left: 0; }
}
@media (max-width: 480px) {
  .desk-strip-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .desk-strip-kpi { border-left: 0; padding-left: 0; }
  .desk-strip-kpi b { font-size: 17px; }
}

/* Sector rotation map. */
.rot-map { position: relative; margin: 0 0 var(--s-4); padding: var(--s-3); border: 1px solid var(--border); border-radius: var(--r-3); background: var(--surface-2); }
.rot-map-head h3 { margin: 0 0 4px; font-size: 15px; }
.rot-map-head p { margin: 0 0 var(--s-2); color: var(--muted-strong); font-size: 12px; line-height: 1.5; max-width: 72ch; }
.rot-map .sc-svg { display: block; width: 100%; margin: 0 auto; }
.rot-map .sc-dot.is-up { fill: var(--pos); } .rot-map .sc-dot.is-down { fill: var(--neg); } .rot-map .sc-dot.is-lead { fill: var(--accent); } .rot-map .sc-dot.is-fade { fill: var(--muted); }
.rot-map-quads { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 6px; color: var(--muted); font-size: 11px; }
.rot-map-quads span::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 5px; border-radius: 2px; background: var(--muted); vertical-align: middle; }
.rot-map-quads .q-tl::before { background: var(--pos); } .rot-map-quads .q-bl::before { background: var(--neg); } .rot-map-quads .q-tr::before { background: var(--accent); }

/* Pattern lab: month x year seasonality heatmap (the lead view). */
.pat-heat { margin: 12px 0 4px; }
.pat-heat figcaption { font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.pat-heat-scroll { margin-top: 8px; max-height: 460px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.pat-heat-table { width: 100%; border-collapse: separate; border-spacing: 2px; font: 500 12px/1 var(--font-sans); font-variant-numeric: tabular-nums; min-width: 640px; }
.pat-heat-table th { font-weight: 600; color: var(--muted); padding: 6px 4px; text-align: center; background: var(--surface); }
.pat-heat-table thead th { position: sticky; top: 0; z-index: 1; }
.pat-heat-table tbody th, .pat-heat-table tfoot th { text-align: left; position: sticky; left: 0; z-index: 1; padding-left: 8px; }
.pat-heat-table td { text-align: center; padding: 6px 2px; border-radius: 3px; color: var(--text-strong); }
.pat-heat-table td.is-pos { background: color-mix(in srgb, var(--pos) var(--heat), transparent); }
.pat-heat-table td.is-neg { background: color-mix(in srgb, var(--neg) var(--heat), transparent); }
.pat-heat-table td.pat-heat-empty { color: var(--muted); }
.pat-heat-table td.pat-heat-year { font-weight: 650; border-left: 2px solid var(--surface); }
.pat-heat-table th.is-now { color: var(--text-strong); box-shadow: inset 0 -2px 0 var(--accent); }
.pat-heat-table .pat-heat-foot th, .pat-heat-table .pat-heat-foot td { position: sticky; z-index: 1; }
.pat-heat-table tfoot tr:first-child th, .pat-heat-table tfoot tr:first-child td { bottom: 26px; border-top: 1px solid var(--border-strong); font-weight: 650; }
.pat-heat-table tfoot tr:last-child th, .pat-heat-table tfoot tr:last-child td { bottom: 0; }
.pat-heat-table tfoot td { background-color: var(--surface); }
.pat-heat-table tfoot td.is-pos { background: linear-gradient(color-mix(in srgb, var(--pos) var(--heat), transparent), color-mix(in srgb, var(--pos) var(--heat), transparent)), var(--surface); }
.pat-heat-table tfoot td.is-neg { background: linear-gradient(color-mix(in srgb, var(--neg) var(--heat), transparent), color-mix(in srgb, var(--neg) var(--heat), transparent)), var(--surface); }
.pat-heat-table td.pat-heat-rate { color: var(--muted); font-size: 11px; }

/* Index calendar: last-12-months strip (weeks across, Mon-Fri down). */
.idx-yr { margin: 12px 0 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.idx-yr-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; }
.idx-yr-head h3 { margin: 0; font: 650 15px/1.3 var(--font-sans); color: var(--text-strong); }
.idx-yr-stats { display: flex; flex-wrap: wrap; gap: 4px 14px; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.idx-yr-stats b { font-weight: 650; }
.idx-yr-scroll { overflow-x: auto; margin-top: 10px; padding-bottom: 2px; }
.idx-yr-wrap { min-width: 680px; }
.idx-yr-months { display: grid; grid-template-columns: repeat(53, minmax(0, 1fr)); margin-left: 30px; gap: 3px; font: 500 11px/1 var(--font-sans); color: var(--muted); height: 14px; }
.idx-yr-months span { white-space: nowrap; overflow: visible; }
.idx-yr-body { display: flex; gap: 6px; margin-top: 4px; }
.idx-yr-wd { display: grid; grid-template-rows: repeat(5, minmax(0, 1fr)); gap: 3px; width: 24px; flex: 0 0 24px; font: 500 10px/1 var(--font-sans); color: var(--muted); }
.idx-yr-wd i { font-style: normal; display: flex; align-items: center; }
.idx-yr-grid { flex: 1 1 auto; display: grid; grid-template-columns: repeat(53, minmax(0, 1fr)); gap: 3px; }
.idx-yr-col { display: grid; grid-template-rows: repeat(5, auto); gap: 3px; }
.idx-yr-cell { display: block; aspect-ratio: 1; min-height: 10px; padding: 0; border: 0; border-radius: 2px; background: var(--surface-2); cursor: default; }
button.idx-yr-cell { cursor: pointer; }
.idx-yr-cell.is-out { background: transparent; }
.idx-yr-cell.is-empty { background: color-mix(in srgb, var(--surface-2) 50%, transparent); }
.idx-yr-cell.is-pos, .idx-yr-legend i.is-pos { background: color-mix(in srgb, var(--pos) var(--heat), var(--surface-2)); }
.idx-yr-cell.is-neg, .idx-yr-legend i.is-neg { background: color-mix(in srgb, var(--neg) var(--heat), var(--surface-2)); }
.idx-yr-cell.is-flat, .idx-yr-legend i.is-flat { background: var(--surface-2); }
button.idx-yr-cell:hover, button.idx-yr-cell:focus-visible { outline: 2px solid var(--text-strong); outline-offset: 0; }
.idx-yr-cell.is-selected { outline: 2px solid var(--accent); outline-offset: 0; }
.idx-yr-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin-top: 10px; font: 500 12.5px/1.4 var(--font-sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.idx-yr-readout { color: var(--text); min-height: 1.4em; }
.idx-yr-legend { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.idx-yr-legend i { display: inline-block; width: 11px; height: 11px; border-radius: 2px; }
@media (max-width: 600px) { .idx-yr { padding: 12px; } .idx-yr-legend { white-space: normal; } }

/* Earnings ripple effects: reporter table sorted by average peer move. */
.spill-ripple { margin: 14px 0 18px; }
.spill-rip-table td.num { white-space: nowrap; }
.spill-rip-bar { display: inline-block; vertical-align: middle; width: 64px; height: 8px; margin-right: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
.spill-rip-bar i { display: block; height: 100%; border-radius: 4px; }
.spill-rip-bar i.is-pos { background: var(--pos); }
.spill-rip-bar i.is-neg { background: var(--neg); }
.spill-rip-peers { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.vt-table a.spill-rip-chip, .spill-rip-chip { display: inline-flex; gap: 4px; align-items: baseline; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; font: 600 12px/1.5 var(--font-sans); color: var(--text-strong); text-decoration: none; font-variant-numeric: tabular-nums; }
.spill-rip-chip b { font-weight: 500; color: var(--muted); }
.vt-table a.spill-rip-chip.is-q { border-color: color-mix(in srgb, var(--pos) 55%, var(--border)); background: var(--pos-tint); }
.vt-table a.spill-rip-chip:hover { border-color: var(--text-strong); }
.spill-rip-more { font: 500 12px/1.5 var(--font-sans); color: var(--muted); }
@media (max-width: 600px) { .spill-rip-bar { display: none; } .spill-rip-table .spill-rip-chip:nth-child(n+3) { display: none; } }

/* Earnings calls: two columns on wide screens (tickers left, brief right). */
.ecl-split { display: grid; grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 16px; align-items: start; margin-top: 12px; }
.ecl-rail { position: sticky; top: 72px; max-height: calc(100vh - 96px); overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ecl-rail-item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 9px 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; font: inherit; }
.ecl-rail-item:hover { background: var(--surface-2); }
.ecl-rail-item.is-on { background: var(--surface-2); border-color: var(--border-strong); box-shadow: inset 3px 0 0 var(--accent); }
.ecl-rail-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ecl-rail-top b { font: 700 14px/1.2 var(--font-sans); color: var(--text-strong); }
.ecl-rail-top small { font: 500 11.5px/1.2 var(--font-sans); color: var(--muted); white-space: nowrap; }
.ecl-rail-co { font: 500 12.5px/1.3 var(--font-sans); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ecl-rail-sig { display: flex; align-items: center; gap: 6px; font: 600 12px/1.3 var(--font-sans); color: var(--text); }
.ecl-rail-sig i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: 0 0 8px; }
.ecl-tone-positive .ecl-rail-sig i { background: var(--pos); }
.ecl-tone-caution .ecl-rail-sig i { background: var(--neg); }
.ecl-rail .ecl-more { margin: 6px 4px 4px; }
.ecl-pane { min-width: 0; }
.ecl-pane .ecl-back { display: none; }
.ecl-vs { margin: 14px 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.ecl-vs h4 { margin: 0 0 8px; font: 650 14px/1.3 var(--font-sans); color: var(--text-strong); }
.ecl-vs h4 .ecl-dim { font-weight: 500; font-size: 12.5px; margin-left: 6px; }
.ecl-vs-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.ecl-vs-list li { display: flex; gap: 8px; padding: 5px 8px; border-radius: 6px; font: 500 13px/1.45 var(--font-sans); color: var(--text); }
.ecl-vs-list li span { font-weight: 700; width: 12px; flex: 0 0 12px; text-align: center; }
.ecl-vs-add { background: var(--pos-tint); }
.ecl-vs-add span { color: var(--pos); }
.ecl-vs-drop { background: var(--neg-tint); }
.ecl-vs-drop span { color: var(--neg); }
.ecl-vs-chg { background: var(--surface-2); }
.ecl-vs-chg span { color: var(--muted); }
.ecl-vs-empty p { margin: 0; }

/* Shared strip: "Stocks this affects" row + Industry trends spacing. */
.desk-strip-stocks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.desk-strip-stocks > span { font: 600 11px/1.2 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-right: 4px; }
.desk-strip-stock { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; font: 650 12.5px/1.4 var(--font-sans); color: var(--text-strong); text-decoration: none; background: var(--surface); }
.desk-strip-stock:hover { border-color: var(--text-strong); }
.trend-strip { margin: 0 0 16px; }
.trend-strip .desk-strip-pill { padding: 0; border: 0; background: none; font-size: 26px; line-height: 1.15; color: var(--text-strong); font-variant-numeric: tabular-nums; }

/* ---- Capital markets timeline ------------------------------------------- */
.cap-timeline-root { display: grid; gap: 12px; }
.cap-tl-filter { display: flex; flex-wrap: wrap; gap: 6px; }
.cap-tl-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font: 600 12.5px/1.2 var(--font-sans); cursor: pointer; }
.cap-tl-chip small { font: 500 11.5px/1 var(--font-sans); color: var(--muted); font-variant-numeric: tabular-nums; }
.cap-tl-chip:hover { border-color: var(--accent-line); }
.cap-tl-chip.is-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--text-strong); }
.cap-tl-dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: currentColor; }
.cap-tl-kpis { display: flex; flex-wrap: wrap; gap: 8px 22px; }
.cap-tl-kpis span { display: grid; gap: 2px; min-width: 120px; }
.cap-tl-kpis small { font: 600 11.5px/1.2 var(--font-sans); color: var(--muted); }
.cap-tl-kpis b { font: 700 19px/1.15 var(--font-sans); color: var(--text-strong); font-variant-numeric: tabular-nums; }
.cap-tl-kpis em { font: 400 11.5px/1.2 var(--font-sans); color: var(--muted); font-style: normal; }
.cap-tl-chart { margin: 0; }
.cap-tl-chart svg { display: block; width: 100%; height: auto; max-height: 280px; }
.cap-tl-grid { stroke: var(--border); stroke-width: 1; }
.cap-tl-grid.is-zero { stroke: var(--muted); stroke-opacity: .6; }
.cap-tl-axis { fill: var(--muted); font: 500 10.5px var(--font-sans); font-variant-numeric: tabular-nums; }
.cap-tl-debt { color: var(--neg); fill: var(--neg); }
.cap-tl-convertible { color: var(--warn); fill: var(--warn); }
.cap-tl-equity { color: var(--info); fill: var(--info); }
.cap-tl-ipo { color: #7c5cd6; fill: #7c5cd6; }
.cap-tl-spac { color: #a993e6; fill: #a993e6; }
.cap-tl-buyback { color: var(--pos); fill: var(--pos); }
.cap-tl-bar { fill-opacity: .82; }
.cap-tl-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font: 500 12px/1.3 var(--font-sans); color: var(--muted); }
.cap-tl-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cap-tl-type { display: inline-block; padding: 2px 8px; border-radius: 999px; font: 600 11.5px/1.3 var(--font-sans); background: color-mix(in srgb, currentColor 13%, transparent); white-space: nowrap; }
.cap-tl-check { display: inline-block; padding: 1px 6px; border: 1px dashed var(--border-strong, var(--border)); border-radius: 999px; font: 600 10.5px/1.3 var(--font-sans); color: var(--muted); }
.vt-table a.cap-tl-sym, .cap-tl-sym { font: 700 12.5px/1.2 var(--font-mono); }
.cap-tl-dupe { color: var(--muted); font-size: 11.5px; }
.cap-tl-table td:nth-child(3) { white-space: normal; min-width: 260px; line-height: 1.4; }
.cap-tl-table td:last-child { white-space: nowrap; }
.cap-tl-type { margin-right: 6px; }
.cap-tl-check { margin-right: 6px; }
.cap-tl-more { justify-self: start; padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: 600 12.5px/1.2 var(--font-sans); cursor: pointer; }
.cap-tl-more:hover { border-color: var(--accent-line); }
.cap-tl-empty, .cap-tl-note { margin: 0; font: 400 12.5px/1.45 var(--font-sans); color: var(--muted); }
:root[data-theme="dark"] .cap-tl-ipo { color: #a18bf0; fill: #a18bf0; }
:root[data-theme="dark"] .cap-tl-spac { color: #c6b8f5; fill: #c6b8f5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .cap-tl-ipo { color: #a18bf0; fill: #a18bf0; } :root:not([data-theme="light"]) .cap-tl-spac { color: #c6b8f5; fill: #c6b8f5; } }
.cap-tl-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
.cap-tl-row { padding: 9px 2px; border-bottom: 1px solid var(--hairline, var(--border)); display: grid; gap: 4px; }
.cap-tl-row-top { display: flex; align-items: baseline; gap: 10px; font: 500 12.5px/1.3 var(--font-sans); color: var(--muted); }
.cap-tl-row-top b { margin-left: auto; font: 700 13px/1.3 var(--font-sans); color: var(--text-strong); font-variant-numeric: tabular-nums; }
.cap-tl-row-top .cap-tl-sym { color: var(--text-strong); }
.cap-tl-row-what { font: 400 13px/1.4 var(--font-sans); color: var(--text); }
.cap-tl-row-what a { color: inherit; }
@media (max-width: 640px) {
  .cap-tl-kpis { gap: 8px 16px; }
  .cap-tl-kpis span { min-width: 0; flex: 1 1 40%; }
  .cap-tl-kpis b { font-size: 17px; }
}

/* ---- Trading volume: legends in the headers, one type scale --------------- */
.vol-cal-card > .card-header, .vol-card > .card-header { flex-wrap: wrap; row-gap: 8px; }
.vol-head-legend { flex-basis: 100%; order: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding-top: 8px; border-top: 1px solid var(--hairline, var(--border)); color: var(--muted); font: 500 12px/1.3 var(--font-sans); }
.vol-head-legend span { display: inline-flex; align-items: center; gap: 6px; }
.vol-head-legend-title { color: var(--text); font-weight: 600; }
.vol-head-legend-note { color: var(--muted); }
.vol-cal-legend.vol-head-legend { font: 500 12px/1.3 var(--font-sans); gap: 6px 14px; }
.vol-cal-legend i.is-below, .vol-cal-cell.is-below { background: color-mix(in srgb, var(--info) 10%, var(--surface)); border-color: color-mix(in srgb, var(--info) 45%, var(--border)); }
.vol-cal-cell.is-below b { color: var(--info); }
.vol-lg-bar { display: inline-block; width: 8px; height: 13px; border-radius: 2px; background: var(--text-3); }
.vol-lg-bar.is-up { background: var(--pos); }
.vol-lg-bar.is-dn { background: var(--neg); }
.vol-lg-bar.is-flat { background: var(--text-3); }
.vol-lg-bar.is-quiet { background: var(--pos); opacity: .4; }
.vol-lg-sr { display: inline-block; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; }
.vol-lg-sr.is-up { border-bottom: 6px solid var(--pos); }
.vol-lg-sr.is-dn { border-top: 6px solid var(--neg); }
#page-pane-volume .vol-profile-axis, #page-pane-volume .vol-profile-axis span { font-size: 10px; }
#page-pane-volume .vol-cal-cell small { font-size: 10px; }
#page-pane-volume .vol-sector-caret, #page-pane-volume .vol-row-caret, #page-pane-volume .vol-sector-count,
#page-pane-volume .vol-sector-bias, #page-pane-volume .vol-pill-badge, #page-pane-volume summary small { font-size: 11px; }
#page-pane-volume .vol-summary-stat, #page-pane-volume .vol-summary-tickers, #page-pane-volume .vol-summary-sub,
#page-pane-volume .vol-row-stats, #page-pane-volume .vol-row-meta, #page-pane-volume .vol-avg20,
#page-pane-volume .vol-bucket-vol, #page-pane-volume .vol-bucket-move, #page-pane-volume .vol-verdict-label,
#page-pane-volume .vol-pill { font-size: 12px; }
#page-pane-volume .vol-sector-name { font-size: 13px; }
#page-pane-volume .vol-summary-tone, #page-pane-volume .vol-symbol { font-size: 15px; }
#page-pane-volume .vol-pill { padding: 5px 11px; }
#page-pane-volume .flow-decision-main h3 { font-size: 24px; }

/* ---- Idea desks: shared table columns and the record chip ---------------- */
.idea-record-slot:empty { display: none; }
.idea-record-chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text); font: 500 12px/1.3 var(--font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
button.idea-record-chip { cursor: pointer; }
button.idea-record-chip:hover { border-color: var(--accent-line); }
.idea-record-chip.is-pos { border-color: color-mix(in srgb, var(--pos) 40%, var(--border)); }
.idea-record-chip.is-neg { border-color: color-mix(in srgb, var(--neg) 40%, var(--border)); }
.idea-record-label { font-weight: 700; color: var(--text-strong); }
.idea-cell { display: inline-grid; gap: 1px; }
.idea-cell-main { display: inline-flex; align-items: center; gap: 6px; }
.idea-cell-sub { font: 400 11.5px/1.25 var(--font-sans); color: var(--muted); }
.idea-score { font-variant-numeric: tabular-nums; }
.idea-lev { color: var(--muted); font-weight: 600; }
.idea-table td.idea-why { white-space: normal; min-width: 220px; }
.idea-table thead th:nth-child(-n+5) { color: var(--text); }
@media (max-width: 640px) {
  .idea-record-chip { white-space: normal; }
}

/* ---- Market themes: the summary card fits a phone ------------------------- */
@media (max-width: 720px) {
  .narr-pulse { grid-template-columns: minmax(0, 1fr); }
  .narr-pulse > * { min-width: 0; }
  .narr-pulse-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .narr-pulse-leader { max-width: 100%; min-width: 0; }
}
@media (max-width: 480px) {
  .narr-pulse-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

`;
}
