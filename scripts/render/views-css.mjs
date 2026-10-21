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
`;
}
