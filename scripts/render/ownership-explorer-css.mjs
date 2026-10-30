export function renderOwnershipExplorerCss() {
  return `/* Ownership explorer */
.own-explorer { border:1px solid var(--border-strong); border-radius:12px; padding:20px; margin:0 0 24px; min-width:0; }
.own-heading { display:flex; justify-content:space-between; gap:16px; align-items:start; }
.own-heading h3 { margin:6px 0; font-size:24px; color:var(--text-strong); }
.own-heading p,.own-fund-head p { margin:6px 0 12px; color:var(--muted-strong); }
.own-coverage { color:var(--accent); white-space:nowrap; font-size:13px; }
.own-modes { display:flex; gap:6px; margin:16px 0; }
.own-modes button,.own-controls input,.own-controls select,.own-position-controls select { font:inherit; color:var(--text); background:var(--surface-2); border:1px solid var(--border-strong); border-radius:7px; padding:9px 12px; min-height:42px; }
.own-modes button { cursor:pointer; }
.own-modes button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); background:var(--accent-soft); }
.own-controls { display:flex; flex-wrap:wrap; align-items:end; gap:12px; margin:14px 0; }
.own-controls label,.own-position-controls label { display:flex; flex-direction:column; gap:6px; min-width:0; font-size:13px; }
.own-controls label span,.own-position-controls label span { color:var(--muted-strong); }
.own-controls .own-search { flex:1 1 260px; }
.own-controls input { width:100%; box-sizing:border-box; }
.own-position-controls { display:flex; gap:12px; flex-wrap:wrap; margin:12px 0; }
.own-position-controls[hidden] { display:none; }
.own-explorer button:focus-visible,.own-explorer input:focus-visible,.own-explorer select:focus-visible,.own-explorer summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.own-period { color:var(--muted-strong); font-size:13px; }
.own-method { margin:12px 0; }
.own-method summary { cursor:pointer; color:var(--muted-strong); font-size:12px; }
.own-method p { padding-left:12px; border-left:2px solid var(--border-strong); }
#own-summary { font-size:13px; color:var(--muted-strong); margin:16px 0; line-height:1.6; }
.own-explorer .f13-table-scroll { max-width:100%; }
.own-table { min-width:980px; }
.own-table td { vertical-align:top; }
.own-table small { display:block; font-size:11px; color:var(--muted-strong); margin-top:5px; white-space:normal; max-width:230px; }
.own-link { border:0; padding:0; font:inherit; font-weight:600; color:var(--accent); background:none; cursor:pointer; text-align:left; }
.own-row-details { margin-top:10px; min-width:160px; max-width:300px; }
.own-row-details summary,.own-insiders summary { cursor:pointer; font-size:12px; color:var(--accent); }
.own-disclosure { margin:10px 0; padding:10px; background:var(--surface-2); font-size:11px; white-space:normal; }
.own-disclosure div { margin:0 0 6px; }
.own-disclosure dt { color:var(--muted-strong); }
.own-disclosure dd { margin:2px 0 0; overflow-wrap:anywhere; }
.own-disclosure a,.own-table a { color:var(--accent); }
.own-empty { padding:24px 12px; color:var(--muted-strong); border:1px dashed var(--border); border-radius:8px; }
.own-fund-head { margin:16px 0; }
.own-fund-head h4 { font-size:21px; margin:16px 0 4px; }
.own-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:14px 0; }
.own-metrics div { padding:12px; background:var(--surface-2); border-radius:7px; }
.own-metrics small,.own-metrics b { display:block; overflow-wrap:anywhere; }
.own-metrics small { font-size:11px; color:var(--muted-strong); margin-bottom:8px; }
.own-pagination { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:16px; }
.own-pagination span { font-size:12px; color:var(--muted-strong); }
.own-explorer button:disabled { opacity:.45; cursor:default; }
.own-insiders { margin:20px 0; }
@media(max-width:600px) {
  .own-explorer { padding:12px; }
  .own-heading { flex-direction:column; gap:4px; }
  .own-heading h3 { font-size:21px; }
  .own-controls label,.own-controls .own-search { flex:1 1 100%; }
  .own-controls select,.own-position-controls select { width:100%; box-sizing:border-box; }
  .own-position-controls label { flex:1 1 100%; }
  .own-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
/* End ownership explorer */
`;
}
