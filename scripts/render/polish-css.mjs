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
@media (max-width: 760px) {
  .landing-pulse .pulse-item { min-width: 168px; }
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
`;
}
