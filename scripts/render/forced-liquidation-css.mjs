export function renderForcedLiquidationCss(){return `
#forced-liquidation-section { min-width:0; }
#forced-liquidation-root { min-width:0; color:var(--text); }
.fl-coverage,.fl-toolbar,.fl-tabs,.fl-detail-head { display:flex; align-items:center; flex-wrap:wrap; gap:12px; }
.fl-coverage { padding:8px 0 20px; font-size:12px; color:var(--muted-strong); }
.fl-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; margin:10px 0 26px; }
.fl-metric { border-top:1px solid var(--border); padding:16px 0; min-width:0; }
.fl-metric span,.fl-metric small { display:block; color:var(--muted-strong); font-size:12px; line-height:1.5; }
.fl-metric b { display:block; margin:8px 0; font-size:26px; font-weight:500; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.fl-tabs { border-bottom:1px solid var(--border); gap:4px; margin-bottom:22px; }
.fl-tabs button { border:0; background:none; color:var(--muted-strong); padding:12px 14px; cursor:pointer; font:inherit; border-bottom:2px solid transparent; }
.fl-tabs button[aria-selected=true] { color:var(--text); border-bottom-color:var(--accent); }
.fl-toolbar { align-items:end; margin-bottom:16px; }
.fl-toolbar label,.fl-scenario label { display:flex; flex-direction:column; gap:6px; color:var(--muted-strong); font-size:12px; }
.fl-toolbar label:first-child { flex:1; min-width:190px; }
.fl-toolbar input,.fl-toolbar select,.fl-scenario select { color:var(--text); background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:10px 12px; font:inherit; min-height:40px; max-width:100%; }
.fl-scroll { width:100%; max-width:100%; overflow-x:auto; overscroll-behavior-x:contain; }
.fl-table { border-collapse:collapse; width:100%; font-size:13px; text-align:left; }
.fl-table th { text-transform:uppercase; letter-spacing:.055em; font-size:10px; color:var(--muted-strong); font-weight:600; white-space:nowrap; padding:12px; border-bottom:1px solid var(--border); }
.fl-table th button { color:inherit; font:inherit; letter-spacing:inherit; text-transform:inherit; background:none; border:0; padding:4px 0; cursor:pointer; }
.fl-table td { padding:16px 12px; vertical-align:top; border-bottom:1px solid var(--border); min-width:125px; font-variant-numeric:tabular-nums; }
.fl-table td:first-child { min-width:180px; }
.fl-table td small { display:block; font-size:11px; color:var(--muted-strong); line-height:1.6; margin-top:6px; }
.fl-open { padding:0; border:0; background:none; color:var(--accent); cursor:pointer; font:inherit; font-weight:600; text-decoration:underline; text-underline-offset:3px; }
.fl-status,.fl-signal { display:inline-block; border:1px solid var(--border); border-radius:4px; padding:4px 7px; font-size:10px; line-height:1.4; margin-top:6px; }
.fl-signal { margin:0 4px 6px 0; }
.fl-near-trigger,.fl-modeled-breach,.fl-negative { color:var(--red, #bd5959); }
.fl-notice,.fl-empty { padding:15px 18px; background:var(--surface-2); border-left:2px solid var(--border); color:var(--muted-strong); font-size:13px; line-height:1.7; }
.fl-caption { color:var(--muted-strong); font-size:12px; line-height:1.7; }
.fl-detail { padding:0 2px; }
.fl-detail-head { justify-content:space-between; align-items:start; }
.fl-detail h3,.fl-method h3 { font-size:22px; margin:6px 0; font-weight:500; }
.fl-detail h3 { scroll-margin-top:140px; }
.fl-detail h4,.fl-method h4 { font-size:15px; margin:22px 0 10px; }
.fl-kicker { color:var(--muted-strong); font-size:11px; text-transform:uppercase; letter-spacing:.07em; }
.fl-detail p,.fl-method p,.fl-method li { color:var(--muted-strong); font-size:13px; line-height:1.8; }
.fl-pressure dl { display:grid; grid-template-columns:minmax(140px,1fr) 2fr; gap:12px 20px; font-size:13px; }
.fl-pressure dt { color:var(--muted-strong); }
.fl-pressure dd { margin:0; font-variant-numeric:tabular-nums; }
.fl-excerpt { margin:14px 0; padding:16px 20px; border-left:2px solid var(--border); background:var(--surface-2); color:var(--text); font-size:13px; line-height:1.8; white-space:pre-wrap; overflow-wrap:anywhere; }
.fl-evidence { padding:16px 0 24px; border-bottom:1px solid var(--border); }
.fl-method { max-width:850px; }
.fl-formula { color:var(--text)!important; font-size:18px!important; padding:18px 0; }
.fl-scenario { margin:22px 0; border-top:1px solid var(--border); }
.fl-scenario .fl-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); max-width:600px; }
.fl-picks-watch { padding:16px 0; border-top:1px solid var(--border); margin:14px 0; font-size:13px; line-height:1.7; }
.fl-picks-watch a { color:var(--accent); }
@media(max-width:800px){.fl-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px}.fl-toolbar label{flex:1;min-width:145px}.fl-pressure dl{grid-template-columns:1fr}.fl-pressure dd{margin-bottom:8px}.fl-tabs button{padding:10px 8px;font-size:12px}.fl-metric b{font-size:22px}}
`;}
