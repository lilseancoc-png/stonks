// Styles for valuation-lab-client.mjs (2026-11-17): the Owner Valuation lab
// page. Reuses mm-kpi / acc-qtable / slp-h4 / ql-lines; colors come from the
// shared tokens so dark mode follows.
export function renderValuationLabCss() {
  return `
/* ---- Owner: valuation lab ------------------------------------------------- */
.vl-root { min-width: 0; }
.vl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin: 6px 0 14px; }
.vl-pick { display: inline-flex; align-items: center; gap: 8px; font: 600 13px/1.3 var(--font-sans); color: var(--text-strong); }
.vl-pick select { min-width: 220px; max-width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text-strong); font: 500 13px/1.3 var(--font-sans); }
.vl-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.vl-preset { padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 550 12px/1.2 var(--font-sans); cursor: pointer; }
.vl-preset:hover { border-color: var(--accent); color: var(--text-strong); }
.vl-preset:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.vl-layout { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
@media (max-width: 1100px) { .vl-layout { grid-template-columns: minmax(0, 1fr); } .vl-side { order: -1; } }
.vl-main { min-width: 0; }
.vl-sticky { display: none; }
@media (max-width: 1100px) { .vl-sticky { display: flex; flex-wrap: wrap; gap: 6px 16px; position: sticky; top: 64px; z-index: 5; margin: 0 0 10px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--r-2, 12px); background: var(--surface); box-shadow: 0 2px 8px color-mix(in srgb, var(--text-strong) 10%, transparent); font: 500 12.5px/1.3 var(--font-sans); color: var(--muted-strong); } .vl-sticky b { font: 700 13.5px var(--font-mono); color: var(--text-strong); } .vl-sticky b.vl-up { color: var(--pos); } .vl-sticky b.vl-down { color: var(--neg); } }
.vl-side { position: sticky; top: 72px; max-height: calc(100vh - 90px); overflow: auto; padding: 4px 10px 10px; border: 1px solid var(--border); border-radius: var(--r-2, 12px); background: var(--surface); }
@media (max-width: 1100px) { .vl-side { position: static; max-height: none; } }
.vl-side h4 { display: flex; justify-content: space-between; align-items: baseline; }
.vl-inbox > summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; margin: 8px 0 4px; }
.vl-inbox > summary::after { content: "▾"; margin-left: auto; color: var(--muted); transition: transform .15s; }
.vl-inbox:not([open]) > summary::after { transform: rotate(-90deg); }
.vl-inbox > summary::-webkit-details-marker { display: none; }
.vl-inbox > summary { list-style: none; }
.vl-inbox-n { font: 500 11.5px/1.3 var(--font-sans); color: var(--muted); text-transform: none; letter-spacing: 0; }
.vl-inbox-bar { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0 0 4px; font: 500 11.5px/1.35 var(--font-sans); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .vl-inbox > summary::after { transition: none; } }
.vl-group { border: 0; margin: 0 0 8px; padding: 0; min-width: 0; }
.vl-group legend { padding: 8px 0 2px; font: 650 11px/1.3 var(--font-sans); letter-spacing: .05em; text-transform: uppercase; color: var(--muted-strong); }
.vl-in { display: block; padding: 6px 0 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
.vl-in-l { display: flex; justify-content: space-between; gap: 8px; font: 550 12.5px/1.35 var(--font-sans); color: var(--text); }
.vl-in-l b { font: 650 12.5px/1.35 var(--font-mono); color: var(--text-strong); white-space: nowrap; }
.vl-changed .vl-in-l b { color: var(--accent); }
.vl-in input[type=range] { width: 100%; margin: 4px 0 2px; accent-color: var(--accent); }
.vl-in small { display: block; font: 450 11px/1.4 var(--font-sans); color: var(--muted); }
.vl-kpis { margin-bottom: 12px; }
.vl-kpis .mm-kpi b small { display: block; margin-top: 2px; font: 500 11px/1.3 var(--font-sans); color: var(--muted); }
.vl-up { color: var(--pos); }
.vl-down { color: var(--neg); }
.vl-flat { color: var(--muted-strong); }
.vl-card { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-2, 12px); background: var(--surface); min-width: 0; }
.vl-field { width: 100%; height: auto; display: block; }
.vl-field .vl-grid { stroke: var(--border); stroke-width: 1; }
.vl-field .vl-tick { font: 500 10.5px var(--font-sans); fill: var(--muted); }
.vl-field .vl-lbl { font: 550 11.5px var(--font-sans); fill: var(--text); }
.vl-field .vl-mkt { stroke: var(--text-strong); stroke-width: 2; stroke-dasharray: 4 3; }
.vl-field .vl-mkt-t { font: 650 11px var(--font-sans); fill: var(--text-strong); }
.vl-field .vl-blend { stroke: var(--accent); stroke-width: 2; }
.vl-field .vl-blend-t { font: 650 11px var(--font-sans); fill: var(--accent); }
.vl-cap { margin: 4px 0 10px; font: 450 11.5px/1.45 var(--font-sans); color: var(--muted); max-width: 90ch; }
.vl-headline { margin: 2px 0 8px; font: 650 14px/1.5 var(--font-sans); color: var(--text-strong); }
.vl-read { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; }
@media (max-width: 760px) { .vl-read { grid-template-columns: minmax(0, 1fr); } }
.vl-read .ql-lines { margin-left: 16px; }
.vl-table td { vertical-align: top; }
.vl-table td:first-child { min-width: 220px; }
.vl-detail { margin-top: 2px; font: 450 11.5px/1.4 var(--font-sans); color: var(--muted); max-width: 52ch; white-space: normal; }
.vl-sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.vl-wcell { white-space: nowrap; }
.vl-wcell input[type=range] { width: 110px; vertical-align: middle; accent-color: var(--accent); }
.vl-wv { display: inline-block; min-width: 2.4em; text-align: right; font: 600 12px var(--font-mono); color: var(--text-strong); }
.vl-tornado { display: grid; gap: 6px; max-width: 820px; }
.vl-tr { display: grid; grid-template-columns: minmax(150px, 230px) minmax(0, 1fr) 150px; gap: 10px; align-items: center; font: 500 12px/1.3 var(--font-sans); color: var(--text); }
.vl-tr-l small { color: var(--muted); }
.vl-tr-bar { position: relative; height: 14px; border-radius: 4px; background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
.vl-tr-bar i { position: absolute; top: 0; bottom: 0; border-radius: 4px; background: color-mix(in srgb, var(--accent) 55%, transparent); }
.vl-tr-bar em { position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; background: var(--text-strong); }
.vl-tr-v { font: 550 11.5px var(--font-mono); color: var(--muted-strong); text-align: right; }
@media (max-width: 640px) { .vl-tr { grid-template-columns: minmax(0, 1fr); gap: 2px; } .vl-tr-v { text-align: left; } }
.vl-grid-t td small { color: var(--muted); }
.vl-grid-t td.vl-here { outline: 2px solid var(--accent); outline-offset: -2px; font-weight: 700; }
.vl-grid-t tr.vl-base td:first-child { font-weight: 650; }
.vl-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 4px 0 12px; }
@media (max-width: 640px) { .vl-facts { grid-template-columns: minmax(0, 1fr); } }
.vl-facts div { min-width: 0; }
.vl-facts dt { font: 600 11px/1.3 var(--font-sans); color: var(--muted-strong); text-transform: uppercase; letter-spacing: .04em; }
.vl-facts dd { margin: 1px 0 0; font: 500 12.5px/1.45 var(--font-sans); color: var(--text); overflow-wrap: anywhere; }
.vl-preset.vl-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--text-strong); }
.vl-env { margin: -6px 0 8px; }
.vl-env summary { cursor: pointer; font: 600 12.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.vl-env-g { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 0; }
.vl-env-l { min-width: 150px; font: 650 11px/1.3 var(--font-sans); letter-spacing: .05em; text-transform: uppercase; color: var(--muted-strong); }
@media (max-width: 640px) { .vl-env-l { min-width: 0; width: 100%; } }
.vl-scn-note { margin: 0 0 10px; font: 450 12.5px/1.45 var(--font-sans); color: var(--text); max-width: 100ch; }
.vl-scn-note:empty { display: none; }
.vl-h3 { margin: 2px 0 8px; font: 700 15px/1.35 var(--font-sans); color: var(--text-strong); }
.vl-field .vl-opt { fill: var(--muted); opacity: .28; }
.vl-hist { width: 100%; height: auto; display: block; margin: 4px 0; }
.vl-hist .vl-hb-up { fill: color-mix(in srgb, var(--pos) 60%, transparent); }
.vl-hist .vl-hb-dn { fill: color-mix(in srgb, var(--neg) 50%, transparent); }
.vl-hist .vl-mkt { stroke: var(--text-strong); stroke-width: 2; stroke-dasharray: 4 3; }
.vl-hist .vl-mkt-t { font: 650 11px var(--font-sans); fill: var(--text-strong); }
.vl-hist .vl-q { stroke: var(--text-strong); stroke-width: 2; }
.vl-range-k { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 2px 0 6px; }
.vl-range-k span { display: flex; flex-direction: column; font: 550 11px/1.3 var(--font-sans); color: var(--muted-strong); }
.vl-range-k b { font: 700 15px/1.3 var(--font-mono); color: var(--text-strong); }
.vl-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; }
@media (max-width: 860px) { .vl-two { grid-template-columns: minmax(0, 1fr); } }
.vl-two > div { min-width: 0; }
.vl-views td small, .vl-then td small { display: block; font: 450 10.5px/1.3 var(--font-sans); color: var(--muted); white-space: normal; }
.vl-views td:first-child { min-width: 120px; font-weight: 600; }
.vl-qs { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 8px; font: 500 11.5px/1.4 var(--font-sans); color: var(--muted-strong); }
.vl-chip { display: inline-block; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface-2) 60%, transparent); font: 500 11.5px/1.35 var(--font-sans); color: var(--text); }
.vl-chip b { font: 650 11.5px var(--font-mono); }
.vl-story [data-vl-apply] { margin: 2px 0 8px; }
.vl-screen { margin: 16px 0 8px; }
.vl-screen summary { cursor: pointer; font: 650 13px/1.4 var(--font-sans); color: var(--text-strong); }
`;
}
