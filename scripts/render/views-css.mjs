// Styles for the shared sort / view / compare helpers (views-client.mjs)
// and the new chart + comparison panels built on them.
export function renderViewsCss() {
  return `
/* ---- Sort flip button + remembered views -------------------------------- */
.sort-with-flip { display: flex; align-items: center; gap: 6px; min-width: 0; }
.sort-with-flip > select { flex: 1 1 auto; min-width: 0; }
.sort-flip {
  flex: 0 0 auto; display: inline-grid; place-items: center;
  width: 34px; height: 34px; padding: 0;
  border: 1px solid var(--border); border-radius: var(--r-2, 8px);
  background: var(--surface); color: var(--muted-strong); cursor: pointer;
}
.sort-flip:hover { color: var(--text-strong); border-color: var(--border-strong); }
.sort-flip.is-on { color: var(--accent); border-color: var(--accent-line, var(--accent)); background: var(--accent-soft); }
.sort-flip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sort-flip.is-on svg { transform: scaleY(-1); }
.views-reset {
  display: block; width: calc(100% - 28px); margin: 14px; padding: 8px 10px; min-height: 36px;
  border: 1px solid var(--border); border-radius: var(--r-2, 8px);
  background: var(--surface); color: var(--muted-strong);
  font: 600 12px/1.3 var(--font-sans); cursor: pointer; text-align: left;
}
.views-reset:hover { color: var(--text-strong); border-color: var(--border-strong); }

/* ---- Click-a-header table sorting ---------------------------------------- */
th.ts-th { cursor: pointer; user-select: none; white-space: nowrap; }
th.ts-th:hover { color: var(--text-strong); }
th.ts-th:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
th.ts-th::after { content: "↕"; display: inline-block; margin-left: 4px; font-size: .85em; opacity: .28; }
th.ts-th[aria-sort="descending"]::after { content: "▼"; opacity: 1; color: var(--accent); }
th.ts-th[aria-sort="ascending"]::after { content: "▲"; opacity: 1; color: var(--accent); }
th.ts-th[aria-sort="descending"], th.ts-th[aria-sort="ascending"] { color: var(--accent); }

/* ---- Cards / Table switch + generic view table --------------------------- */
.view-toggle { display: inline-flex; border: 1px solid var(--border); border-radius: var(--r-2, 8px); overflow: hidden; flex: 0 0 auto; }
.view-toggle button {
  min-height: 34px; padding: 0 12px; border: 0; background: var(--surface);
  color: var(--muted-strong); font: 600 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; cursor: pointer;
}
.view-toggle button + button { border-left: 1px solid var(--border); }
.view-toggle button.is-on { background: var(--accent-soft); color: var(--accent); }
.view-toggle button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.view-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; margin: 10px 0; }
.view-bar label { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font: 600 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.view-bar select { min-height: 34px; padding: 0 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-2, 8px); font: 500 13px/1.2 var(--font-sans); text-transform: none; letter-spacing: 0; }
.vt-wrap { grid-column: 1 / -1; min-width: 0; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); margin: 8px 0 14px; }
.vt-table { width: 100%; border-collapse: collapse; font: 500 12.5px/1.4 var(--font-sans); font-variant-numeric: tabular-nums; }
.vt-table th, .vt-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--hairline, var(--border)); white-space: nowrap; }
.vt-table th { position: sticky; top: 0; background: var(--surface-2); color: var(--muted); font: 600 10.5px/1.2 var(--font-mono); letter-spacing: .05em; text-transform: uppercase; }
.vt-table td.num, .vt-table th.num { text-align: right; }
.vt-table tbody tr:hover td { background: var(--accent-tint-1, var(--surface-2)); }
.vt-table tbody tr:last-child td { border-bottom: 0; }
.vt-table a, .vt-table button.vt-link { color: var(--text-strong); font-weight: 700; text-decoration: none; background: none; border: 0; padding: 0; cursor: pointer; font: inherit; }
.vt-table a:hover, .vt-table button.vt-link:hover { color: var(--accent); }
.vt-table .pos, .vt-pos { color: var(--pos); }
.vt-table .neg, .vt-neg { color: var(--neg); }
.vt-na { color: var(--muted); }
.vt-tag { display: inline-block; padding: 2px 6px; border-radius: 5px; font: 600 10.5px/1.2 var(--font-mono); background: var(--surface-2); color: var(--muted-strong); }
.vt-tag.call { color: var(--pos); background: var(--pos-soft); }
.vt-tag.put { color: var(--neg); background: var(--neg-soft); }
.vt-empty { grid-column: 1 / -1; color: var(--muted); font-size: 13px; margin: 8px 2px; }

/* ---- Track Record extra views -------------------------------------------- */
.acc-cal { display: flex; gap: 6px; margin: 6px 0 14px; min-width: 0; }
.acc-cal-days { display: grid; grid-template-rows: 14px repeat(5, 14px); row-gap: 3px; font: 500 10px/14px var(--font-mono); color: var(--muted); }
.acc-cal-days::before { content: ""; }
.acc-cal-scroll { overflow-x: auto; min-width: 0; }
.acc-cal-months { display: grid; grid-auto-flow: column; grid-auto-columns: 14px; column-gap: 3px; height: 14px; font: 500 10px/14px var(--font-mono); color: var(--muted); white-space: nowrap; margin-bottom: 3px; }
.acc-cal-grid { display: grid; grid-auto-flow: column; grid-auto-columns: 14px; column-gap: 3px; }
.acc-cal-week { display: grid; grid-template-rows: repeat(5, 14px); row-gap: 3px; }
.acc-cal-cell { width: 14px; height: 14px; border-radius: 3px; background: var(--surface-3, var(--surface-2)); }
.acc-cal-cell.is-pos { background: var(--pos); }
.acc-cal-cell.is-neg { background: var(--neg); }
.acc-split-line { fill: none; stroke-width: 2; }
.acc-split-0 { stroke: var(--accent); background: var(--accent); }
.acc-split-1 { stroke: #2dd4bf; background: #2dd4bf; }
.acc-split-2 { stroke: #fb923c; background: #fb923c; }
.acc-split-3 { stroke: #a78bfa; background: #a78bfa; }
.acc-split-4 { stroke: #fbbf24; background: #fbbf24; }
.acc-split-5 { stroke: #94a3b8; background: #94a3b8; }
:root[data-theme="light"] .acc-split-1 { stroke: #0f766e; background: #0f766e; }
:root[data-theme="light"] .acc-split-2 { stroke: #c2410c; background: #c2410c; }
:root[data-theme="light"] .acc-split-3 { stroke: #7c3aed; background: #7c3aed; }
:root[data-theme="light"] .acc-split-4 { stroke: #b45309; background: #b45309; }
:root[data-theme="light"] .acc-split-5 { stroke: #64748b; background: #64748b; }
.acc-split-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 6px 0 14px; font: 500 12px/1.4 var(--font-sans); color: var(--text); }
.acc-split-legend small { color: var(--muted); }
.acc-split-key { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.acc-cmp-table { width: 100%; max-width: 560px; border-collapse: collapse; margin: 8px 0 10px; font: 500 13px/1.4 var(--font-sans); }
.acc-cmp-table th, .acc-cmp-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; }
.acc-cmp-table thead th { font: 600 11px/1.2 var(--font-mono); letter-spacing: .05em; text-transform: uppercase; color: var(--muted-strong); }
.acc-cmp-table tbody th { font-weight: 500; color: var(--muted-strong); }
.acc-cmp-table td.num { text-align: right; font-family: var(--font-mono); }
.acc-cmp-table small { color: var(--muted); }
.acc-cmp-warn { margin: 6px 0; padding: 8px 10px; border-radius: var(--r-2, 8px); background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--text); font-size: 12.5px; }

/* ---- Shared scatter chart ------------------------------------------------ */
.sc-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin: 10px 0 6px; }
.sc-controls label { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font: 600 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; }
.sc-controls select { min-height: 34px; padding: 0 8px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--r-2, 8px); font: 500 13px/1.2 var(--font-sans); text-transform: none; letter-spacing: 0; }
.sc-legend { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; color: var(--muted-strong); font: 500 12px/1.3 var(--font-sans); }
.sc-key { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: -1px; background: var(--muted); }
.sc-key.call, .sc-dot.call { background: var(--pos); fill: var(--pos); }
.sc-key.put, .sc-dot.put { background: var(--neg); fill: var(--neg); }
.sc-key.neutral, .sc-dot.neutral { background: var(--muted); fill: var(--muted); }
.sc-key.warn, .sc-dot.warn { background: var(--warn, #d9a441); fill: var(--warn, #d9a441); }
.sc-host { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 6px; min-width: 0; }
.sc-svg { display: block; width: 100%; height: auto; overflow: visible; }
.sc-grid { stroke: var(--hairline, var(--border)); stroke-width: 1; }
.sc-zero { stroke: var(--border-strong, var(--muted)); stroke-width: 1.2; }
.sc-diag { stroke: var(--accent); stroke-width: 1.2; stroke-dasharray: 4 4; opacity: .7; }
.sc-tick { fill: var(--muted); font: 500 10.5px var(--font-mono); }
.sc-axis { fill: var(--muted-strong); font: 600 11px var(--font-sans); }
.sc-dot { fill: var(--accent); fill-opacity: .82; stroke: var(--surface); stroke-width: 1; }
.sc-svg a:hover .sc-dot, .sc-svg a:focus .sc-dot { fill-opacity: 1; stroke: var(--text-strong); stroke-width: 1.5; }
.sc-lbl { fill: var(--muted-strong); font: 600 9.5px var(--font-mono); pointer-events: none; }
.sc-empty, .sc-note { color: var(--muted); font: 500 12.5px/1.4 var(--font-sans); margin: 8px 4px; }
.sc-hint { margin-top: 6px; }

/* ---- "+ Compare" toggles + tray ----------------------------------------- */
.cmp-toggle {
  display: inline-flex; align-items: center; justify-content: center; min-height: 26px; padding: 0 9px;
  border: 1px solid var(--border); border-radius: 999px; background: var(--surface);
  color: var(--muted-strong); font: 600 11px/1 var(--font-mono); letter-spacing: .03em; cursor: pointer; white-space: nowrap; user-select: none;
}
.cmp-toggle:hover { color: var(--accent); border-color: var(--accent); }
.cmp-toggle.is-on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.cmp-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ticker-card .ticker-cmp { align-self: flex-start; margin-top: 6px; }
.opt-controls .opt-cmp-slot:empty { display: none; }
.opt-controls .opt-cmp-slot { display: inline-flex; align-items: center; margin-left: 8px; }
.opt-controls .opt-cmp { min-height: 34px; padding: 0 12px; }
.cmp-tray {
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 60;
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; max-width: calc(100vw - 32px);
  padding: 8px 10px 8px 14px; border: 1px solid var(--border-strong, var(--border)); border-radius: 12px;
  background: var(--surface); box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
}
.cmp-tray[hidden] { display: none; }
body { padding-bottom: var(--cmp-tray-space, 0px); }
.cmp-tray-label { color: var(--muted); font: 600 10.5px/1 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.cmp-tray-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.cmp-tray-chip { display: inline-flex; align-items: center; gap: 2px; padding: 3px 4px 3px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 700 12px/1 var(--font-mono); }
.cmp-tray-chip button { width: 22px; height: 22px; border: 0; background: none; color: inherit; font-size: 15px; line-height: 1; cursor: pointer; border-radius: 50%; }
.cmp-tray-chip button:hover { background: var(--surface); }
.cmp-tray-note { color: var(--warn, #d9a441); font: 500 12px/1.3 var(--font-sans); }
.cmp-tray-actions { display: inline-flex; gap: 6px; margin-left: auto; }
.cmp-tray-actions button { min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--muted-strong); font: 600 12px/1 var(--font-sans); cursor: pointer; }
.cmp-tray-actions .cmp-tray-open { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #fff); }
.cmp-tray-actions .cmp-tray-open:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 560px) {
  .cmp-tray { left: 16px; right: 16px; transform: none; bottom: 72px; max-width: none; padding: 8px 10px; }
  .cmp-tray-label { flex: 0 0 auto; }
  .cmp-tray-chips { flex: 1 1 0; min-width: 0; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
  .cmp-tray-chip { flex: 0 0 auto; }
  .cmp-tray-actions { width: 100%; justify-content: flex-end; }
}

/* ---- Heatmap ranked bars + two-period view ------------------------------- */
#heatmap-section .heatmap-control[hidden], #heatmap-section .heatmap-zoom[hidden] { display: none !important; }
.heatmap-alt { margin: 10px 0 12px; min-width: 0; }
#heatmap-section .heatmap-layout-control, #heatmap-section .heatmap-periodb-control { grid-column: span 2; }
.heatmap-alt .vt-wrap { max-height: 620px; overflow: auto; }
.heatmap-alt[hidden] { display: none; }
.hm-alt-head { margin: 0 0 10px; color: var(--muted-strong); font: 500 13px/1.4 var(--font-sans); }
.hm-alt-head b { color: var(--text-strong); }
.hm-alt-empty { color: var(--muted); font: 500 13px/1.4 var(--font-sans); padding: 18px 4px; }
.hm-alt-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 14px; }
.hm-alt-col { min-width: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 10px 12px; }
.hm-alt-col h4 { margin: 0 0 8px; font: 700 12px/1.3 var(--font-sans); color: var(--text-strong); }
.hm-alt-col h4 small { color: var(--muted); font-weight: 500; margin-left: 4px; }
.hm-rank { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.hm-rank-tickers { max-height: 620px; overflow-y: auto; padding-right: 4px; }
.hm-rank li { display: grid; grid-template-columns: minmax(64px, 9.5em) minmax(40px, 1fr) 6.2em; align-items: center; gap: 8px; min-height: 20px; }
.hm-rank-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font: 500 12px/1.2 var(--font-sans); text-decoration: none; }
a.hm-rank-name b { font: 700 12px/1.2 var(--font-mono); color: var(--text-strong); }
a.hm-rank-name:hover b { color: var(--accent); }
.hm-rank-val { text-align: right; font: 600 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--muted-strong); white-space: nowrap; }
.hm-bar { position: relative; display: block; height: 12px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.hm-bar:not(.is-unsigned)::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--border-strong, var(--border)); }
.hm-bar-fill { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: var(--muted); }
.hm-bar-fill.hm-pos { background: var(--pos); }
.hm-bar-fill.hm-neg { background: var(--neg); }
.hm-bar.is-unsigned .hm-bar-fill { background: var(--accent); opacity: .7; }
.hm-bar.is-unsigned .hm-bar-fill.is-hot { opacity: 1; }
.hm-pair-head, .hm-pair li { display: grid; grid-template-columns: minmax(80px, 11em) minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: center; }
.hm-pair-head { color: var(--muted); font: 600 10.5px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; margin: 0 0 6px; }
.hm-pair-cell { display: grid; grid-template-columns: minmax(30px, 1fr) 5.4em; gap: 6px; align-items: center; }
.hm-pair { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
@media (max-width: 720px) {
  .hm-alt-grid { grid-template-columns: 1fr; }
  .hm-rank li { grid-template-columns: minmax(56px, 7em) minmax(30px, 1fr) 5.6em; }
  .hm-pair-head, .hm-pair li { grid-template-columns: minmax(64px, 7em) minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
  .hm-pair-cell { grid-template-columns: 1fr; gap: 2px; }
  .hm-pair-cell .hm-rank-val { text-align: left; }
}

/* ---- Top Picks risk map --------------------------------------------------- */
.picks-riskmap { grid-column: 1 / -1; min-width: 0; }
.picks-riskmap .sc-host + .hint { margin-top: 12px; }
.sc-dot.is-ready { stroke: var(--text-strong); stroke-width: 1.5; }
.sc-hit { cursor: pointer; outline: none; }
.sc-hit:hover .sc-dot, .sc-hit:focus .sc-dot { fill-opacity: 1; stroke: var(--text-strong); stroke-width: 2; }
.pr-ready-key { display: inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid var(--text-strong); margin: 0 4px 0 6px; vertical-align: -2px; }

/* ---- By-sector split bars (Flow, Volume) ---------------------------------- */
.ssb { margin: 10px 0 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 2px 12px; }
.ssb > summary { cursor: pointer; padding: 9px 0; font: 700 12.5px/1.3 var(--font-sans); color: var(--text-strong); }
.ssb > summary small { margin-left: 8px; color: var(--muted); font-weight: 500; }
.ssb-key { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 3px 0 6px; vertical-align: -1px; }
.ssb-key.a, .ssb-a { background: var(--pos); }
.ssb-key.b, .ssb-b { background: var(--neg); }
.ssb-list { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 4px; }
.ssb-list li { display: grid; grid-template-columns: minmax(80px, 12em) minmax(40px, 1fr) auto; gap: 10px; align-items: center; }
.ssb-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 12px/1.2 var(--font-sans); color: var(--text); }
.ssb-bar { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--surface-2); }
.ssb-bar i { display: block; height: 100%; }
.ssb-val { font: 600 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--muted-strong); }
.ssb-val .pos { color: var(--pos); } .ssb-val .neg { color: var(--neg); }
.ssb-note { margin: 4px 0 10px; color: var(--muted); font: 500 11.5px/1.4 var(--font-sans); }
@media (max-width: 560px) { .ssb-list li { grid-template-columns: minmax(64px, 7.5em) minmax(30px, 1fr) auto; gap: 6px; } }

/* ---- Grade a ticker: grade score over time -------------------------------- */
.opt-grade-hist { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 0; }
.opt-grade-hist[hidden] { display: none; }
.ogh-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-bottom: 4px; font: 500 12.5px/1.3 var(--font-sans); color: var(--muted-strong); }
.ogh-head b { color: var(--text-strong); font-size: 13px; }
.ogh-now { font: 700 12px/1 var(--font-mono); }
.ogh-now.pos, .ogh-chip.pos { color: var(--pos); }
.ogh-now.neg, .ogh-chip.neg { color: var(--neg); }
.ogh-chip { padding: 3px 7px; border-radius: 999px; background: var(--surface-2); font: 600 11px/1 var(--font-mono); }
.ogh-svg { display: block; width: 100%; max-width: 640px; height: auto; }
.ogh-line { stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
.ogh-zone.call { fill: var(--pos); opacity: .07; }
.ogh-zone.put { fill: var(--neg); opacity: .07; }
.ogh-note, .ogh-empty { margin: 4px 0 0; color: var(--muted); font: 500 11.5px/1.4 var(--font-sans); }

/* ---- Compare: grade pillars + sectors ------------------------------------- */
.cmp-pillars { margin: 14px 0; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); min-width: 0; }
.cmp-pillars[hidden] { display: none; }
.cmp-pl-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 8px 16px; margin-bottom: 10px; }
.cmp-pl-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font: 700 12px/1 var(--font-mono); }
.cmp-pl-legend span { display: inline-flex; align-items: center; gap: 5px; color: var(--text-strong); }
.cmp-pl-legend i { width: 10px; height: 10px; border-radius: 2px; background: var(--cmp-series, var(--accent)); }
.cmp-pl-rows { display: grid; gap: 10px; }
.cmp-pl-row { display: grid; grid-template-columns: minmax(120px, 13em) minmax(0, 1fr); gap: 12px; align-items: center; padding-top: 8px; border-top: 1px solid var(--hairline, var(--border)); }
.cmp-pl-row.is-total { border-top-color: var(--border-strong, var(--border)); }
.cmp-pl-name b { display: block; color: var(--text-strong); font: 700 12.5px/1.25 var(--font-sans); }
.cmp-pl-name small { color: var(--muted); font: 500 11px/1.3 var(--font-sans); }
.cmp-pl-bars { display: grid; gap: 3px; min-width: 0; }
.cmp-pl-bar { display: grid; grid-template-columns: minmax(0, 1fr) 3.4em; gap: 8px; align-items: center; }
.cmp-pl-ticker { display: none; color: var(--text-strong); font: 600 10px/1 var(--font-mono); }
.cmp-pl-track { position: relative; display: block; height: 10px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.cmp-pl-track::after { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--border-strong, var(--border)); }
.cmp-pl-track i { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: var(--cmp-series, var(--accent)); }
.cmp-pl-val { text-align: right; font: 600 11.5px/1 var(--font-mono); font-variant-numeric: tabular-nums; color: var(--muted-strong); }
.cmp-pl-bar.is-na .cmp-pl-val { grid-column: 2; color: var(--muted); }
.cmp-sectors { margin: 16px 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 0 14px; }
.cmp-sectors > summary { cursor: pointer; padding: 12px 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.cmp-sectors > summary b { color: var(--text-strong); font: 700 14px/1.3 var(--font-sans); }
.cmp-sectors > summary small { color: var(--muted); font: 500 12px/1.3 var(--font-sans); }
.cmp-sectors-body { padding-bottom: 12px; }
.cmp-sec-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 10px; }
.cmp-sec-chip { min-height: 32px; padding: 0 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-strong); font: 600 12px/1 var(--font-sans); cursor: pointer; }
.cmp-sec-chip small { color: var(--muted); font-weight: 500; margin-left: 2px; }
.cmp-sec-chip.is-on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.cmp-sec-chip:disabled { opacity: .45; cursor: not-allowed; }
.cmp-sec-chart { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.cmp-sec-empty { color: var(--muted); font: 500 13px/1.4 var(--font-sans); }
@media (max-width: 560px) {
  .cmp-pl-row { grid-template-columns: 1fr; gap: 6px; }
  .cmp-pl-bar { grid-template-columns: 4.2em minmax(0, 1fr) 3.4em; }
  .cmp-pl-ticker { display: block; }
  .cmp-pl-bar.is-na .cmp-pl-val { grid-column: 3; }
}
`;
}
