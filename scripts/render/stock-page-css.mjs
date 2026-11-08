// Styles for the shared chart kit (chart-kit-js.mjs) and the public stock page
// (stock-page-js.mjs). Sizes are written in px; the design-system pass maps
// them onto the shared type scale like the rest of the stylesheet.
export function renderStockPageCss() {
  return `
/* === Chart kit (scripts/render/chart-kit-js.mjs) === */
.ck-host { position: relative; width: 100%; }
.ck-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; min-height: 30px; }
.ck-legend { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ck-leg-time { color: var(--muted); }
.ck-leg-item { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); }
.ck-leg-item i { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.ck-leg-item b { color: var(--text-strong); font-weight: 600; }
.ck-ranges { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.ck-range { appearance: none; border: 0; background: transparent; color: var(--muted); font: 600 12px/1 var(--font-sans); padding: 6px 9px; border-radius: 4px; cursor: pointer; }
.ck-range:hover { color: var(--text-strong); }
.ck-range[aria-pressed="true"] { background: var(--surface-2); color: var(--text-strong); box-shadow: inset 0 0 0 1px var(--border); }
.ck-range:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.ck-canvas { position: relative; width: 100%; }
.ck-source { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.ck-empty { margin: 0; padding: 40px 16px; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: 8px; }
.ck-skeleton { width: 100%; border-radius: 8px; background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface) 50%, var(--surface-2) 100%); background-size: 200% 100%; animation: ck-shimmer 1.4s ease-in-out infinite; }
@keyframes ck-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .ck-skeleton { animation: none; } }

/* === Public stock page (scripts/render/stock-page-js.mjs) === */
.stp-page { display: grid; gap: 20px; min-width: 0; }
.stp-loading, .stp-empty { color: var(--muted); margin: 8px 0; }
.stp-missing { padding: 24px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.stp-head { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "id actions" "price actions"; gap: 4px 16px; align-items: center; }
.stp-id { grid-area: id; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stp-ticker { font: 700 13px/1 var(--font-code); padding: 4px 8px; border-radius: 4px; background: var(--surface-2); color: var(--text-strong); border: 1px solid var(--border); }
.stp-sector { color: var(--muted); font-size: 13px; }
.stp-price-slot { grid-area: price; }
.stp-price-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.stp-price { font: 650 40px/1.1 var(--font-sans); color: var(--text-strong); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.stp-change { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stp-chg-abs.is-up { color: var(--pos); }
.stp-chg-abs.is-down { color: var(--neg); }
.stp-chg { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.stp-chg.is-up { color: var(--pos); }
.stp-chg.is-down { color: var(--neg); }
.stp-chg.is-flat { color: var(--muted); }
.stp-session { font-size: 13px; color: var(--muted); }
.stp-session.is-live::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 999px; background: var(--pos); margin-right: 6px; vertical-align: 1px; }
.stp-actions { grid-area: actions; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.stp-btn, .stp-actions .cmp-toggle { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: 600 13px/1 var(--font-sans); cursor: pointer; white-space: nowrap; }
.stp-btn:hover, .stp-actions .cmp-toggle:hover { border-color: var(--border-strong); color: var(--text-strong); }
.stp-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.stp-watch.is-on, .stp-actions .cmp-toggle.is-on { border-color: var(--accent-line, var(--accent)); color: var(--accent); }
.stp-chart-card { position: relative; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.stp-chart-tools { position: absolute; top: 16px; right: 16px; z-index: 2; }
.stp-chart-card .ck-top { padding-right: 150px; }
.stp-kind { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.stp-chart-card .ck-ranges { margin-right: 0; }
.stp-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
@media (max-width: 1180px) { .stp-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } .stp-stats .stp-stat-range { grid-column: 1 / -1; } }
.stp-stats.stp-stats-3 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 4px; }
.stp-stat { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: var(--surface); min-width: 0; box-shadow: inset -1px -1px 0 var(--border); }
.stp-stat-k { font-size: 12px; color: var(--muted); }
.stp-stat b { font-size: 16px; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.stp-stat-sub { font-size: 12px; color: var(--muted); }
.stp-stat-range { grid-column: span 2; }
.stp-range { display: grid; gap: 6px; }
.stp-range-track { position: relative; height: 6px; border-radius: 999px; background: linear-gradient(90deg, var(--neg-soft, rgba(220,38,38,.3)), var(--surface-2) 50%, var(--pos-soft, rgba(22,163,74,.3))); }
.stp-range-dot { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 999px; background: var(--text-strong); border: 2px solid var(--surface); transform: translate(-50%, -50%); }
.stp-range-ends { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.stp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); overflow-x: auto; scrollbar-width: none; }
.stp-tabs::-webkit-scrollbar { display: none; }
.stp-tab { appearance: none; border: 0; background: transparent; color: var(--muted); font: 600 14px/1 var(--font-sans); padding: 12px 12px 11px; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
.stp-tab:hover { color: var(--text-strong); }
.stp-tab.is-on { color: var(--text-strong); border-bottom-color: var(--accent); }
.stp-tab:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.stp-tab-body { display: grid; gap: 20px; min-width: 0; margin-top: -4px; }
.stp-sec { display: grid; gap: 10px; min-width: 0; }
.stp-h3 { margin: 0; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.stp-lede { margin: 0; max-width: 72ch; color: var(--text); line-height: 1.6; }
.stp-about { margin: 0; max-width: 72ch; color: var(--text); line-height: 1.6; }
.stp-more { display: inline; }
.stp-more summary { display: inline; color: var(--accent); cursor: pointer; }
.stp-more p { margin: 8px 0 0; }
.stp-src { margin: 0; font-size: 12px; color: var(--muted); }
.stp-src a, .stp-news a, .stp-sym-link { color: var(--text-strong); text-decoration: none; border-bottom: 1px solid var(--border); }
.stp-src a:hover, .stp-news a:hover, .stp-sym-link:hover { color: var(--accent); border-bottom-color: var(--accent); }
.stp-returns { display: flex; gap: 8px; flex-wrap: wrap; }
.stp-ret { display: inline-flex; align-items: baseline; gap: 8px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-variant-numeric: tabular-nums; }
.stp-ret span:first-child { color: var(--muted); font-size: 13px; }
.stp-ret b { color: var(--text-strong); }
.stp-band { padding: 8px 0 4px; }
.stp-band-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--muted); }
.stp-band-head b { color: var(--text-strong); font-variant-numeric: tabular-nums; }
.stp-band-track { position: relative; height: 12px; margin: 6px 0 4px; border-radius: 6px; background: var(--surface-2); overflow: visible; }
.stp-band-track i { position: absolute; display: block; }
.stp-band-peers { top: 0; bottom: 0; border-radius: 6px; background: color-mix(in srgb, var(--accent) 28%, transparent); }
.stp-band-own { top: 3px; bottom: 3px; border-radius: 3px; background: color-mix(in srgb, var(--muted) 45%, transparent); }
.stp-band-median { top: -2px; bottom: -2px; width: 2px; margin-left: -1px; background: var(--accent); }
.stp-band-now { top: -3px; width: 4px; height: 18px; margin-left: -2px; border-radius: 2px; background: var(--text-strong); box-shadow: 0 0 0 1px var(--surface); }
.stp-band small { display: block; font-size: 12px; line-height: 1.4; }
.stp-band-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 4px; color: var(--muted); font-size: 12px; }
.stp-band-legend span { display: inline-flex; align-items: center; gap: 6px; }
.stp-band-legend i { position: static; display: inline-block; width: 18px; height: 8px; border-radius: 4px; }
.stp-band-legend .stp-band-median { width: 2px; height: 12px; }
.stp-band-legend .stp-band-now { width: 4px; height: 12px; margin: 0; }
.stp-cluster-line { margin: 0 0 6px; font-size: 14px; line-height: 1.5; }
.stp-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.stp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.stp-sec > .stp-table { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.stp-table th { text-align: left; font-weight: 600; font-size: 12px; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.stp-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: top; }
.stp-table tr:last-child td { border-bottom: 0; }
.stp-table tbody tr:hover td { background: var(--surface-2); }
.stp-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.stp-dim { color: var(--muted); }
.stp-news { list-style: none; margin: 0; padding: 0; display: grid; }
.stp-news li { display: grid; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.stp-news li:last-child { border-bottom: 0; }
.stp-news-meta { font-size: 12px; color: var(--muted); }
.stp-bullets { margin: 0; padding-left: 18px; display: grid; gap: 6px; max-width: 80ch; }
.stp-callout { padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; background: var(--surface); }
.stp-walls { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.stp-wall { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.stp-wall span { font-size: 12px; color: var(--muted); }
.stp-wall b { font-size: 18px; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.stp-wall small { font-size: 12px; color: var(--muted); }
.stp-wall.is-call { border-top: 3px solid var(--pos); }
.stp-wall.is-put { border-top: 3px solid var(--neg); }
.stp-side { font-weight: 700; }
.stp-side.is-call { color: var(--pos); }
.stp-side.is-put { color: var(--neg); }
.stp-move { font-weight: 600; }
.stp-move.is-up { color: var(--pos); }
.stp-move.is-down { color: var(--neg); }
.stp-search { display: flex; gap: 8px; max-width: 560px; }
.stp-search input { flex: 1 1 auto; min-width: 0; height: 38px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font: 400 14px/1 var(--font-sans); }
.stp-search input:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }
.stp-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.stp-pick { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "sym chg" "name name"; gap: 4px 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); text-decoration: none; color: var(--text); min-width: 0; }
.stp-pick:hover { border-color: var(--border-strong); background: var(--surface-2); }
.stp-pick-sym { grid-area: sym; font: 700 14px/1.2 var(--font-sans); color: var(--text-strong); }
.stp-pick .stp-chg { grid-area: chg; font-size: 13px; }
.stp-pick-name { grid-area: name; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* === Search: grouped results === */
.cmd-palette-group { list-style: none; padding: 10px 10px 4px; font: 600 12px/1.2 var(--font-sans); color: var(--muted); }
.cmd-palette-group:first-child { padding-top: 4px; }
.cmd-palette-row-type { font-family: var(--font-sans); letter-spacing: 0; min-width: 46px; text-align: center; }
.cmd-type-grade { background: var(--surface-3); color: var(--text-strong); }

/* === All stocks: names, one label, compare on hover === */
.ticker-name { display: block; min-width: 0; font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ticker-name:empty { display: none; }
.ticker-card .ticker-sector { text-transform: none; letter-spacing: 0; font-weight: 500; }
.ticker-chg.is-flat { color: var(--muted); }
.vt-table .vt-sym { font-weight: 700; color: var(--text-strong); text-decoration: none; }
.vt-table .vt-sym:hover { color: var(--accent); }
.vt-table .vt-name { display: block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
@media (hover: hover) and (min-width: 761px) {
  .ticker-card .ticker-cmp:not(.is-on) { opacity: 0; transition: opacity .12s ease; }
  .ticker-card:hover .ticker-cmp, .ticker-card:focus-within .ticker-cmp { opacity: 1; }
}
@media (max-width: 760px) {
  .stp-head { grid-template-columns: 1fr; grid-template-areas: "id" "price" "actions"; }
  .stp-actions { justify-content: flex-start; }
  .stp-price { font-size: 32px; }
  .stp-chart-card { padding: 12px; }
  .stp-chart-tools { position: static; margin-bottom: 8px; }
  .stp-chart-card .ck-top { padding-right: 0; }
  .stp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stp-stat-range { grid-column: 1 / -1; }
}

/* Owner Grade tab: the grade tool moves in from its old page. The stock page
   already shows the name, price, chart and Compare button, so the tool's own
   title, ticker search and price chart are hidden here. */
.stp-tab-body.is-grade { display: block; margin-top: 0; }
.stp-tab-body.is-grade > #opt-eval-section { border: 0; background: none; box-shadow: none; padding: 0; margin: 0; }
.stp-tab-body.is-grade > #opt-eval-section > .card-header,
.stp-tab-body.is-grade > #opt-eval-section > .hint,
.stp-tab-body.is-grade > #opt-eval-section > .opt-controls,
.stp-tab-body.is-grade #opt-price-host { display: none !important; }
`;
}
