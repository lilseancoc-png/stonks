export function renderRecoveryCss() { return `
.ers-view-tabs { display:flex; gap:8px; flex-wrap:wrap; margin: 4px 0 22px; }
.ers-view-tabs button, .recovery-screen button, .recovery-filters input, .recovery-filters select { font:inherit; color:var(--text); background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:10px 12px; }
.ers-view-tabs button, .recovery-screen button { cursor:pointer; }
.ers-view-tabs button[aria-pressed="true"] { color:var(--accent); border-color:var(--accent); background:var(--accent-soft); }
.recovery-head { max-width:800px; margin-bottom:22px; }
.recovery-kicker { color:var(--accent); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; }
.recovery-head h3 { font-size:clamp(22px,3vw,30px); line-height:1.2; margin:8px 0 12px; }
.recovery-head p, .recovery-policy, .recovery-count, .recovery-event, .recovery-plan p, .recovery-checks p { color:var(--muted); font-size:13px; line-height:1.6; }
.recovery-filters { display:flex; flex-wrap:wrap; align-items:end; gap:12px; padding:16px; border:1px solid var(--border); border-radius:12px; }
.recovery-filters label { display:flex; flex-direction:column; gap:6px; flex:1 1 145px; font-size:12px; font-weight:650; min-width:0; }
.recovery-filters input, .recovery-filters select { width:100%; min-width:0; box-sizing:border-box; }
.recovery-policy { padding:4px 0 12px; max-width:1000px; }
.recovery-count { margin:4px 0 12px; }
.recovery-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; align-items:start; }
.recovery-card { border:1px solid var(--border); border-radius:12px; padding:20px; min-width:0; overflow-wrap:anywhere; background:var(--bg); }
.recovery-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.recovery-card header > div { display:flex; flex-direction:column; gap:4px; min-width:0; }
.recovery-symbol { font-size:22px; font-weight:750; color:var(--text); text-decoration:none; }
.recovery-card header span, .recovery-card header small { color:var(--muted); font-size:11px; font-weight:400; }
.recovery-card header strong { text-align:right; font-size:23px; flex-shrink:0; }
.recovery-card header small { display:block; margin-top:4px; }
.recovery-status { display:inline-block; font-size:12px; font-weight:650; padding:5px 9px; border:1px solid currentColor; border-radius:6px; }
.recovery-supported, .recovery-pass { color:var(--pos); }
.recovery-blocked, .recovery-fail { color:var(--neg); }
.recovery-incomplete, .recovery-waiting, .recovery-missing, .recovery-wait { color:var(--accent); }
.recovery-reason { font-size:13px; line-height:1.6; margin-bottom:14px; }
.recovery-card details { margin-top:18px; border-top:1px solid var(--border); }
.recovery-card summary { padding:14px 0 4px; cursor:pointer; font-size:13px; font-weight:650; line-height:1.5; }
.recovery-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:18px 0; }
.recovery-metrics > div { display:flex; flex-direction:column; gap:5px; }
.recovery-metrics span { font-size:11px; color:var(--muted); }
.recovery-metrics b { font-size:17px; }
.recovery-plan { padding:14px; border:1px solid var(--border); border-radius:8px; margin:16px 0; }
.recovery-plan h4 { margin:0; font-size:14px; }
.recovery-plan dl { margin:12px 0; }
.recovery-plan dl > div { display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:12px; padding:6px 0; }
.recovery-plan dt { color:var(--muted); }
.recovery-plan dd { margin:0; text-align:right; font-weight:650; }
.recovery-checks { list-style:none; margin:16px 0; padding:0; }
.recovery-checks li { display:flex; gap:10px; align-items:baseline; padding:12px 0; border-top:1px solid var(--border); }
.recovery-check-state { flex:0 0 48px; font-size:11px; font-weight:700; }
.recovery-checks b { font-size:13px; }
.recovery-checks p { margin:5px 0 0; font-size:12px; }
.recovery-links { display:flex; flex-wrap:wrap; gap:12px; font-size:12px; line-height:1.7; }
.recovery-links a { color:var(--accent); }
.recovery-empty { padding:25px; border:1px dashed var(--border); border-radius:12px; }
.recovery-empty h4 { margin:0 0 8px; }
.recovery-empty p { margin:0; color:var(--muted); font-size:13px; line-height:1.6; }
.recovery-more { margin-top:16px; }
.recovery-screen :is(button,input,select,summary,a):focus-visible, .ers-view-tabs button:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
@media(max-width:800px) { .recovery-cards { grid-template-columns:1fr; } }
@media(max-width:480px) { .recovery-card { padding:15px; } .recovery-filters { padding:12px; } .recovery-filters label { flex-basis:100%; } .ers-view-tabs { display:grid; grid-template-columns:1fr; } .recovery-plan dl > div { flex-wrap:wrap; } }
`; }
