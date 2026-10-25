export function renderHistoricalDataCss() {
  return `
/* Owner Historical Data, using the site's shared Ledger tokens. */
.h-toolbar { display:flex; flex-wrap:wrap; align-items:end; gap:12px; margin:20px 0; }
.h-toolbar label { display:grid; grid-template-columns:minmax(0,1fr); gap:6px; min-width:0; color:var(--muted-strong); font:600 11px/1.4 var(--font-sans); }
.h-toolbar select { width:100%; min-width:0; max-width:100%; box-sizing:border-box; background:var(--surface-2); color:var(--text); border:1px solid var(--border-strong); border-radius:6px; padding:9px 28px 9px 10px; font:500 12px var(--font-sans); }
.h-toolbar button { margin-left:auto; }
.h-view-tabs { display:flex; flex-wrap:wrap; gap:8px; border-bottom:1px solid var(--border); padding:16px 0; }
.h-view-tabs button { background:transparent; border:1px solid var(--border-strong); color:var(--muted-strong); padding:9px 12px; border-radius:5px; font:550 12px var(--font-sans); cursor:pointer; }
.h-view-tabs button.is-selected { background:var(--accent-soft); color:var(--accent); }
.h-source-intro { padding:18px 0 4px; }
.h-source-intro h3, .h-paid h3 { font:650 18px/1.4 var(--font-sans); color:var(--text-strong); margin:6px 0; }
.h-source-intro p, .h-paid p { color:var(--muted-strong); font:400 12px/1.7 var(--font-sans); }
.h-source-heading { margin:24px 0 8px; font:650 13px var(--font-sans); }
.h-source-table { white-space:normal; min-width:700px; }
.h-source-table th { min-width:100px; }
.h-source-table td { vertical-align:top; overflow-wrap:anywhere; }
.h-source-table small { display:block; color:var(--muted-strong); font:400 10px/1.6 var(--font-sans); margin-top:5px; }
.h-paid { margin-top:28px; padding:18px; background:var(--surface-2); border:1px solid var(--border); border-radius:6px; }
.h-paid article { border-top:1px solid var(--border); margin-top:14px; padding-top:6px; }
.h-paid h4 { font:600 13px/1.6 var(--font-sans); }
.h-context { border-block:1px solid var(--border-strong); padding:18px 0; margin-bottom:24px; }
.h-context h3 { margin:5px 0; font:650 17px/1.4 var(--font-sans); color:var(--text-strong); }
.h-context small, .h-caption { color:var(--muted-strong); font:400 11px/1.65 var(--font-sans); }
.h-kicker { color:var(--muted-strong); font:600 10px/1.5 var(--font-mono); letter-spacing:.05em; text-transform:uppercase; }
.h-layout { display:grid; grid-template-columns:minmax(180px,235px) minmax(0,1fr); gap:26px; }
.h-library { min-width:0; border-right:1px solid var(--border); padding-right:18px; }
.h-library h3 { margin:0; font:650 14px/1.5 var(--font-sans); }
.h-library p { color:var(--muted); font:400 11px/1.5 var(--font-sans); margin:4px 0 16px; }
.h-library h4 { margin:18px 0 8px; color:var(--muted); font:600 10px/1.4 var(--font-mono); text-transform:uppercase; letter-spacing:.06em; }
.h-study-button { display:grid; gap:4px; width:100%; text-align:left; border:1px solid transparent; border-radius:5px; background:transparent; color:var(--text); padding:10px; cursor:pointer; }
.h-study-button span { font:550 12px/1.4 var(--font-sans); }
.h-study-button small { font:400 10px/1.4 var(--font-sans); color:var(--muted); }
.h-study-button:hover { background:var(--surface-2); }
.h-study-button.is-selected { background:var(--accent-soft); border-color:var(--border-strong); }
.h-study-button.is-selected span { color:var(--accent); }
.h-detail { min-width:0; }
.h-study-head { display:flex; gap:12px; align-items:center; justify-content:space-between; flex-wrap:wrap; }
.h-study-head h3 { color:var(--text-strong); font:650 22px/1.3 var(--font-sans); margin:5px 0; }
.h-claim { font:500 13px/1.6 var(--font-sans); color:var(--text); margin:10px 0 6px; }
.h-definition { font:400 12px/1.7 var(--font-sans); color:var(--muted-strong); margin:0 0 20px; }
.h-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:16px 0; }
.h-context-metrics { margin-bottom:0; }
.h-metric { display:grid; gap:6px; align-content:start; min-width:0; }
.h-metric span { color:var(--muted); font:500 11px/1.4 var(--font-sans); }
.h-metric b { font:600 17px/1.4 var(--font-mono); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; color:var(--text-strong); }
.h-metric small { font:400 10px/1.4 var(--font-sans); color:var(--muted); }
.h-pos, .h-metric .h-pos { color:var(--pos); }
.h-neg, .h-metric .h-neg { color:var(--neg); }
.h-notice { border-left:2px solid var(--warn); padding:10px 12px; color:var(--muted-strong); font:400 12px/1.7 var(--font-sans); background:var(--surface-2); }
.h-comparison { margin:20px 0 10px; padding:14px; background:var(--surface-2); border:1px solid var(--border); border-radius:6px; }
.h-comparison p { margin:7px 0 0; color:var(--text); font:400 12px/1.7 var(--font-sans); }
.h-figure { margin:18px 0 8px; min-width:0; }
.h-figure svg { display:block; width:100%; height:auto; overflow:visible; }
.h-figure svg text { fill:var(--muted-strong); font:11px var(--font-mono); }
.h-grid { stroke:var(--border); stroke-width:1; }
.h-zero { stroke:var(--muted); stroke-width:1; stroke-dasharray:3 4; }
.h-band { fill:var(--accent-soft); }
.h-median { stroke:var(--muted-strong); fill:none; stroke-width:2; }
.h-current { stroke:var(--accent); fill:none; stroke-width:2.5; }
.h-bar-pos { fill:var(--pos); opacity:.8; }
.h-bar-neg { fill:var(--neg); opacity:.8; }
.h-figure figcaption { display:flex; gap:16px; flex-wrap:wrap; color:var(--muted-strong); font:400 11px/1.6 var(--font-sans); }
.h-figure figcaption span::before { content:''; display:inline-block; width:12px; height:3px; background:var(--muted-strong); margin:0 5px 3px 0; }
.h-figure figcaption .h-legend-current::before { background:var(--accent); }
.h-figure figcaption .h-legend-band::before { background:var(--accent-soft); height:8px; border:1px solid var(--border-strong); margin-bottom:0; }
.h-disclosure { border-top:1px solid var(--border); margin-top:22px; padding-top:16px; min-width:0; }
.h-disclosure summary { cursor:pointer; color:var(--text-strong); font:600 13px/1.5 var(--font-sans); }
.h-disclosure p, .h-disclosure li { font:400 12px/1.7 var(--font-sans); color:var(--muted-strong); overflow-wrap:anywhere; }
.h-disclosure li { margin-top:8px; }
.h-table-wrap { overflow-x:auto; max-width:100%; margin-top:12px; }
.h-table { width:100%; border-collapse:collapse; white-space:nowrap; font:400 11px/1.5 var(--font-mono); }
.h-table th, .h-table td { padding:9px 10px; border-bottom:1px solid var(--border); text-align:left; }
.h-table thead th { color:var(--muted); font:550 10px/1.5 var(--font-sans); }
.h-table tbody th { font-weight:550; }
.h-empty { padding:24px 10px; color:var(--muted-strong); font:400 13px/1.6 var(--font-sans); }
.h-toolbar select:focus-visible, .h-study-button:focus-visible, .h-disclosure summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media(max-width:1100px) { .h-layout { grid-template-columns:minmax(170px,200px) minmax(0,1fr); gap:18px; } .h-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); row-gap:18px; } }
@media(max-width:700px) { .h-layout { grid-template-columns:1fr; } .h-library { border-right:0; border-bottom:1px solid var(--border); padding:0 0 12px; max-height:235px; overflow-y:auto; } .h-study-button { padding:9px 10px; } .h-toolbar { align-items:stretch; } .h-toolbar label { flex:1 1 140px; min-width:0; } .h-toolbar button { margin-left:0; } .h-study-head h3 { font-size:20px; } .h-metric b { font-size:15px; } .h-comparison { padding:12px; } .h-figure svg text { font-size:20px; } }
`;
}
