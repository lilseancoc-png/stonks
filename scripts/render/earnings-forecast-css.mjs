export function renderEarningsForecastCss(){return `
#earnings-forecast-root { min-width: 0; }
.ef-topline,.ef-section-head,.ef-company-head,.ef-foot { display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap; }
.ef-topline { margin:14px 0 20px;color:var(--muted);font-size:12px; }
.ef-layout { display:grid;grid-template-columns:170px minmax(0,1fr);gap:24px;align-items:start; }
.ef-companies { display:flex;flex-direction:column;gap:4px; }
.ef-companies button { display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 9px;background:transparent;border:1px solid transparent;border-radius:6px;color:var(--text);text-align:left; }
.ef-companies button > span:first-child { display:flex;gap:8px;align-items:center; }
.ef-companies small,.ef-companies button > span:last-child { color:var(--muted);font-size:11px; }
.ef-companies button[aria-pressed="true"] { border-color:var(--border);background:var(--surface-2); }
.ef-companies .ef-former { opacity:.72; }
.ef-divider { margin:10px 0 2px;padding-top:10px;border-top:1px dashed var(--border);color:var(--muted);font-size:11px;letter-spacing:.04em;text-transform:uppercase;flex-basis:100%;grid-column:1/-1; }
.ef-badge { display:inline-block;margin-left:6px;padding:1px 6px;border:1px solid var(--border);border-radius:999px;font-size:10px;font-style:normal;font-weight:600;color:var(--muted-strong);vertical-align:middle;white-space:nowrap; }
.ef-detail,.ef-columns > section { min-width:0; }
.ef-company-head { align-items:flex-start;margin-bottom:16px; }
.ef-company-head h3 { margin:2px 0 6px;font-size:21px;line-height:1.3; }
.ef-company-head p { margin:0;color:var(--muted-strong); }
.ef-kicker { font-size:11px;letter-spacing:.04em;text-transform:uppercase; }
.ef-status { border:1px solid var(--border);border-radius:5px;padding:5px 8px;font-size:11px;color:var(--muted-strong); }
.ef-tabs { display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:18px; }
.ef-tabs button,.ef-topline button,.ef-section-head button,.ef-foot button,#earnings-forecast-root > button { background:var(--surface);color:var(--text);border:1px solid var(--border);padding:7px 10px;border-radius:5px;font-size:12px;cursor:pointer; }
.ef-tabs button[aria-pressed="true"] { color:var(--text-strong);background:var(--surface-2);border-color:var(--muted); }
.ef-metrics { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0; }
.ef-metric { min-width:0;display:flex;flex-direction:column;gap:8px;padding:14px 0;border-top:1px solid var(--border); }
.ef-metric > span { color:var(--muted-strong);font-size:12px; }
.ef-metric strong { font-size:22px;line-height:1.2;color:var(--text-strong);font-variant-numeric:tabular-nums;overflow-wrap:anywhere; }
.ef-metric small,.ef-subtle { color:var(--muted);font-size:12px;line-height:1.6; }
.ef-columns { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;margin:24px 0; }
.ef-detail h3 { color:var(--text-strong);font-size:16px; }
.ef-detail p { line-height:1.65; }
.ef-table-scroll { max-width:100%;overflow-x:auto;margin:12px 0; }
.ef-table { width:100%;border-collapse:collapse;font-size:12px;line-height:1.5; }
.ef-table th,.ef-table td { padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top; }
.ef-table th { color:var(--muted-strong);font-weight:600; }
.ef-table td { color:var(--text);overflow-wrap:anywhere; }
.ef-table a,.ef-detail > a { color:var(--text-strong);text-decoration:underline;text-underline-offset:3px; }
.ef-notice { padding:10px 13px;border-left:3px solid var(--warn);background:var(--surface-2);color:var(--muted-strong);font-size:12px;line-height:1.6; }
.ef-scenario { border-top:1px solid var(--border);padding-top:16px;margin-top:24px; }
.ef-controls { display:flex;gap:18px;flex-wrap:wrap;margin:18px 0; }
.ef-controls label { display:flex;flex-direction:column;gap:8px;min-width:200px;max-width:100%;color:var(--muted-strong);font-size:12px; }
.ef-controls select,.ef-workbench input,.ef-workbench select { box-sizing:border-box;width:100%;min-width:0;background:var(--surface);color:var(--text);border:1px solid var(--border);padding:9px;border-radius:5px;font:inherit;font-size:13px; }
.ef-workbench input:focus-visible,.ef-workbench select:focus-visible,.ef-detail button:focus-visible { outline:2px solid var(--muted-strong);outline-offset:3px; }
.ef-workbench input,.ef-workbench select { scroll-margin-top:210px; }
.ef-workbench label { display:flex;flex-direction:column;gap:7px;min-width:0;color:var(--muted-strong);font-size:12px; }
.ef-workbench button,.ef-scenario > button { background:var(--surface);color:var(--text);border:1px solid var(--border);padding:9px 12px;border-radius:5px;font-size:12px;cursor:pointer; }
.ef-workbench button:disabled { opacity:.5;cursor:default; }
.ef-workbench .ef-controls { display:grid;grid-template-columns:repeat(3,minmax(0,1fr)); }
.ef-workbench .ef-controls label { min-width:0; }
.ef-mix-lines { display:grid;gap:12px;margin:18px 0; }
.ef-mix-lines article { border:1px solid var(--border);border-radius:7px;padding:16px;background:var(--surface); }
.ef-mix-lines h4 { margin:0;font-size:14px;overflow-wrap:anywhere; }
.ef-row-controls { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px; }
.ef-share-total { font-size:13px;font-variant-numeric:tabular-nums; }
.ef-live-summary { position:sticky;top:65px;z-index:5;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0 12px;margin:18px 0; }
.ef-live-summary .ef-metrics { grid-template-columns:repeat(3,minmax(0,1fr));margin:0;gap:12px; }
.ef-live-summary .ef-metric { border:0;padding:12px 0;gap:5px; }
.ef-live-summary .ef-metric strong { font-size:20px; }
.ef-summary-error { color:var(--muted-strong);border-top:1px solid var(--border);font-size:12px;margin:0;padding:8px 0; }
.ef-scenario-actions { display:flex;gap:14px;align-items:start;flex-wrap:wrap;margin:22px 0; }
.ef-import { max-width:100%; }
.ef-scenario-results { grid-template-columns:repeat(3,minmax(0,1fr)); }
.ef-drivers { display:grid;gap:18px;margin:20px 0; }
.ef-drivers article { border-top:1px solid var(--border);padding-top:14px; }
.ef-drivers small,.ef-drivers span { color:var(--muted);font-size:12px; }
.ef-drivers h4 { font-size:15px;margin:6px 0; }
.ef-foot { border-top:1px solid var(--border);padding-top:16px;margin-top:24px;font-size:11px;color:var(--muted);overflow-wrap:anywhere; }
.ef-method { margin-top:20px; }
.ef-method summary { cursor:pointer;color:var(--text-strong); }
@media(max-width:1000px) { .ef-layout { grid-template-columns:minmax(0,1fr);gap:16px; }.ef-companies { flex-direction:row;flex-wrap:wrap; }.ef-companies button { flex:0 0 auto; }.ef-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:700px) { .ef-workbench .ef-controls,.ef-row-controls { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:600px) { .ef-live-summary .ef-metric strong { font-size:16px; }.ef-live-summary .ef-metric > span,.ef-live-summary .ef-metric small { font-size:10px; }.ef-live-summary { padding:0 9px; } }
@media(max-width:600px) { .ef-columns { grid-template-columns:minmax(0,1fr); }.ef-companies { display:grid;grid-template-columns:repeat(2,minmax(0,1fr)); }.ef-companies button { min-width:0;padding:9px 7px; }.ef-company-head h3 { font-size:19px; }.ef-metric strong { font-size:20px; }.ef-controls label { width:100%;min-width:0; }.ef-table { font-size:11px; }.ef-table th,.ef-table td { padding:8px 6px; }.ef-foot { align-items:flex-start; }.ef-workbench .ef-controls { grid-template-columns:minmax(0,1fr); }.ef-mix-lines article { padding:12px; }.ef-scenario-results { grid-template-columns:minmax(0,1fr); } }
`;}
