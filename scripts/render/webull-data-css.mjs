// Styles for webull-data-client.mjs (W3, 2026-11-19): the Owner Webull
// breadth block on Market analysis and the order-flow block on the stock
// page's Owner tab. Reuses the vt-* tables (views-css.mjs).
export function renderWebullDataCss() {
  return `
/* ---- Webull data (Owner) -------------------------------------------------- */
[data-wb][hidden] { display: none !important; }
.wbd-card { display: grid; gap: 10px; margin: 14px 0; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.wbd-head h3 { margin: 2px 0 0; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.wbd-kicker { display: block; font: 600 11px/1.4 var(--font-sans); color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.wbd-lede, .wbd-line { margin: 0; font: 450 13px/1.55 var(--font-sans); color: var(--muted-strong); max-width: 84ch; }
.wbd-line { color: var(--text); }
.wbd-src { margin: 0; font: 450 12px/1.5 var(--font-sans); color: var(--muted); max-width: 84ch; }
.wbd-empty { margin: 0; font: 450 13px/1.5 var(--font-sans); color: var(--muted); }
.wbd-warn { color: var(--warn); font-weight: 550; }
.wbd-dim { color: var(--muted); font-weight: 450; }
.wbd-table small.wbd-dim { display: block; max-width: 18ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbd-card .pos, .wbd-flow .pos { color: var(--pos); }
.wbd-card .neg, .wbd-flow .neg { color: var(--neg); }
.wbd-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; }
.wbd-kpi { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2, var(--surface)); min-width: 0; }
.wbd-kpi span { font: 600 12px/1.35 var(--font-sans); color: var(--muted-strong); }
.wbd-kpi b { font: 700 18px/1.2 var(--font-sans); font-variant-numeric: tabular-nums; color: var(--text-strong); }
.wbd-kpi small { font: 450 11.5px/1.4 var(--font-sans); color: var(--muted); }
.wbd-sub { display: grid; gap: 6px; min-width: 0; }
.wbd-sub h4, .wbd-col h4 { margin: 0; font: 650 13.5px/1.35 var(--font-sans); color: var(--text-strong); }
.wbd-sub > summary { cursor: pointer; font: 600 13px/1.5 var(--font-sans); color: var(--muted-strong); }
.wbd-hist-wrap { width: 100%; overflow-x: auto; }
.wbd-hist { width: 100%; max-width: 640px; min-width: 340px; height: auto; display: block; }
.wbd-bar-neg { fill: var(--neg); opacity: .85; }
.wbd-bar-pos { fill: var(--pos); opacity: .85; }
.wbd-bar-flat { fill: var(--muted); opacity: .6; }
.wbd-bar-n { font: 600 11px var(--font-sans); fill: var(--text); font-variant-numeric: tabular-nums; }
.wbd-bar-l { font: 500 10.5px var(--font-sans); fill: var(--muted); }
.wbd-line-chart, .wbd-flow-chart { width: 100%; height: 110px; display: block; }
.wbd-flow-chart { height: 150px; }
.wbd-mid { stroke: var(--border); stroke-dasharray: 3 3; }
.wbd-path { fill: none; stroke: var(--accent, var(--pos)); stroke-width: 1.8; vector-effect: non-scaling-stroke; }
.wbd-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 10px; min-width: 0; }
.wbd-col { display: grid; gap: 6px; align-content: start; min-width: 0; }
.wbd-list { margin: 4px 0; padding-left: 18px; display: grid; gap: 4px; font: 450 12.5px/1.5 var(--font-sans); color: var(--text); }
.wbd-f-large { fill: #4f7cff; background: #4f7cff; }
.wbd-f-medium { fill: #d98a1c; background: #d98a1c; }
.wbd-f-small { fill: #8c96a6; background: #8c96a6; }
.wbd-legend { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font: 450 12px/1.5 var(--font-sans); color: var(--muted); }
.wbd-li { white-space: nowrap; }
.wbd-key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
@media (max-width: 600px) { .wbd-card { padding: 10px; } .wbd-kpi b { font-size: 16px; } .wbd-bar-n, .wbd-bar-l { font-size: 16px; } }
`;
}
