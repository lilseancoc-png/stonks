export function renderUnifiedSignalCss() {
  return `
/* Unified Signal Engine: a focused owner research list and ticker assessment. */
#unified-signal-section { min-width:0; }
.use-intro { max-width:850px; margin:4px 0 18px; color:var(--muted-strong); font:400 13px/1.7 var(--font-sans); }
.use-toolbar { display:flex; flex-wrap:wrap; align-items:end; gap:12px; padding:16px 0; border-block:1px solid var(--border); }
.use-toolbar label { display:grid; gap:6px; min-width:160px; color:var(--muted-strong); font:550 11px/1.4 var(--font-sans); }
.use-toolbar label:first-child { flex:1; max-width:350px; }
.use-toolbar input, .use-toolbar select { min-width:0; width:100%; box-sizing:border-box; color:var(--text); background:var(--surface-2); border:1px solid var(--border-strong); border-radius:5px; padding:9px 10px; font:500 13px var(--font-sans); }
.use-button { display:inline-block; background:var(--surface-2); border:1px solid var(--border-strong); border-radius:5px; padding:10px 13px; color:var(--text-strong); font:550 12px var(--font-sans); cursor:pointer; }
.use-button:disabled { opacity:.6; cursor:wait; }
.use-snapshot-meta { margin:12px 0 18px; color:var(--muted); font:400 11px/1.6 var(--font-sans); }
.use-layout { display:grid; grid-template-columns:minmax(180px,230px) minmax(0,1fr); gap:26px; align-items:start; }
.use-library { max-height:740px; overflow-y:auto; border-right:1px solid var(--border); padding-right:14px; min-width:0; scrollbar-width:thin; }
.use-candidate { width:100%; display:grid; gap:6px; background:transparent; border:1px solid transparent; border-radius:5px; padding:12px 10px; color:var(--text); text-align:left; cursor:pointer; }
.use-candidate > span { display:flex; justify-content:space-between; align-items:center; gap:10px; }
.use-candidate b { font:650 14px var(--font-mono); }
.use-candidate small { color:var(--muted-strong); font:450 10px/1.5 var(--font-sans); }
.use-candidate:hover { background:var(--surface-2); }
.use-candidate.is-selected { background:var(--accent-soft); border-color:var(--border-strong); }
.use-candidate.is-selected b { color:var(--accent); }
.use-detail { min-width:0; }
.use-decision-head { display:flex; justify-content:space-between; gap:16px; align-items:start; padding:2px 0 18px; }
.use-kicker { display:block; color:var(--muted); font:550 10px/1.5 var(--font-mono); letter-spacing:.04em; text-transform:uppercase; }
.use-decision-head h3 { margin:5px 0; color:var(--text-strong); font:650 24px/1.35 var(--font-sans); }
.use-decision-head h3 span { color:var(--muted-strong); font-size:15px; font-weight:450; }
.use-decision-head p { margin:5px 0 0; font:400 12px/1.6 var(--font-sans); color:var(--muted-strong); }
.use-decision-head .use-price { color:var(--text-strong); font:550 15px/1.7 var(--font-mono); text-align:right; }
.use-tag { display:inline-block; color:var(--muted-strong); background:var(--surface-2); border:1px solid var(--border); border-radius:4px; padding:4px 7px; font:550 10px/1.4 var(--font-sans); }
.use-tone-eligible, .use-tone-supports { color:var(--pos); }
.use-tone-avoid, .use-tone-opposes { color:var(--neg); }
.use-tone-wait { color:var(--warn); }
.use-view-tabs { display:flex; flex-wrap:wrap; gap:5px; border-block:1px solid var(--border); padding:10px 0; margin-bottom:20px; }
.use-view-tabs button, .use-text-button { border:1px solid transparent; color:var(--muted-strong); background:transparent; border-radius:5px; padding:8px 10px; font:550 12px var(--font-sans); cursor:pointer; }
.use-view-tabs button[aria-pressed=true] { color:var(--accent); background:var(--accent-soft); border-color:var(--border-strong); }
.use-text-button { color:var(--accent); border-color:var(--border); }
.use-view { min-width:0; }
.use-view h3 { color:var(--text-strong); font:600 15px/1.5 var(--font-sans); margin:0 0 9px; }
.use-view p { color:var(--text); font:400 12px/1.75 var(--font-sans); margin:6px 0 12px; overflow-wrap:anywhere; }
.use-view .use-muted, .use-muted { color:var(--muted-strong); }
.use-answer { padding:0 0 18px; margin:0 0 18px; border-bottom:1px solid var(--border); }
.use-evidence-pair { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px; margin-bottom:20px; }
.use-evidence-pair section { min-width:0; }
.use-observation { padding:12px 0; border-top:1px solid var(--border); min-width:0; overflow-wrap:anywhere; }
.use-observation-head { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:7px; }
.use-observation h4 { font:550 12px/1.6 var(--font-sans); color:var(--text-strong); margin:0 0 5px; }
.use-observation h4 a { color:var(--text-strong); text-decoration:underline; text-underline-offset:3px; }
.use-observation p { color:var(--muted-strong); font-size:11px; margin:0 0 5px; }
.use-observation small { color:var(--muted); font:400 10px/1.6 var(--font-sans); }
.use-notes { margin:8px 0; padding-left:18px; color:var(--text); font:400 12px/1.8 var(--font-sans); }
.use-notes li { margin:5px 0; overflow-wrap:anywhere; }
.use-notice { border-left:2px solid var(--warn); background:var(--surface-2); color:var(--text); padding:12px 14px; font:450 12px/1.7 var(--font-sans); margin:0 0 20px; }
.use-facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:15px; margin:14px 0; }
.use-facts div { min-width:0; }
.use-facts dt { color:var(--muted); font:450 11px/1.5 var(--font-sans); }
.use-facts dd { margin:5px 0 0; color:var(--text-strong); font:500 12px/1.6 var(--font-mono); overflow-wrap:anywhere; }
.use-table-wrap { max-width:100%; overflow-x:auto; margin:14px 0; }
.use-table { width:100%; border-collapse:collapse; font:400 11px/1.6 var(--font-sans); }
.use-table th, .use-table td { padding:10px 9px; border-bottom:1px solid var(--border); vertical-align:top; text-align:left; min-width:115px; color:var(--text); }
.use-table thead th { color:var(--muted); font-weight:500; }
.use-table tbody th { font-weight:550; color:var(--text-strong); }
.use-disclosure { border-bottom:1px solid var(--border); padding:14px 0; }
.use-disclosure summary { cursor:pointer; color:var(--text-strong); font:550 13px/1.6 var(--font-sans); }
.use-evidence-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 22px; margin-top:15px; }
.use-record { min-width:0; }
.use-record-part { padding:0 0 18px; margin:0 0 18px; border-bottom:1px solid var(--border); min-width:0; }
.use-record-part > h4 { margin:0 0 2px; color:var(--text-strong); font:600 15px/1.5 var(--font-sans); }
.use-record .book-evidence-name > h4 { display:none; }
.use-footer { border-top:1px solid var(--border); padding-top:18px; margin-top:22px; color:var(--muted-strong); font:400 11px/1.7 var(--font-sans); overflow-wrap:anywhere; }
.use-footer summary { cursor:pointer; font-weight:550; color:var(--text); }
.use-empty { padding:28px 12px; font:400 13px/1.7 var(--font-sans); color:var(--muted-strong); }
.use-empty h3 { font:600 17px/1.5 var(--font-sans); color:var(--text-strong); }
#unified-signal-root button:focus-visible, #unified-signal-root input:focus-visible, #unified-signal-root select:focus-visible, #unified-signal-root summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media(max-width:1100px) { .use-layout { grid-template-columns:190px minmax(0,1fr); gap:18px; } .use-evidence-pair { grid-template-columns:1fr; gap:16px; } }
@media(max-width:700px) { .use-layout { grid-template-columns:1fr; } .use-library { max-height:220px; border-right:0; border-bottom:1px solid var(--border); padding:0 0 10px; } .use-candidate { padding:9px; } .use-decision-head { flex-wrap:wrap; scroll-margin-top:80px; } .use-decision-head .use-price { text-align:left; } .use-evidence-grid { grid-template-columns:1fr; } .use-toolbar label { flex:1 1 140px; min-width:0; } .use-toolbar label:first-child { flex:1 1 100%; max-width:none; } .use-facts { grid-template-columns:1fr; gap:12px; } .use-view-tabs button { padding:8px; } }
`;
}
