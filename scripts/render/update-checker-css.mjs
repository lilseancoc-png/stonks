export const updateCheckerCss = `
.uc-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:20px 0}.uc-toolbar .book-more{margin:0}
.uc-muted,.uc-limitation{color:var(--muted);font-size:13px;line-height:1.6}.uc-lead{border-left:3px solid var(--accent);padding:2px 20px;margin:24px 0}.uc-lead h3{font-size:24px;margin:0 0 8px}
.uc-builds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.uc-builds section,.uc-feature,.uc-workflows article{border:1px solid var(--border);border-radius:10px;padding:18px;min-width:0;overflow-wrap:anywhere}
.uc-builds h3,.uc-features h3{font-size:17px;margin:0 0 12px}.uc-builds p,.uc-workflows p{font-size:13px;line-height:1.6}.uc-status{display:inline-block;border:1px solid currentColor;border-radius:20px;padding:2px 9px;font:600 11px/1.5 var(--font-sans);color:var(--muted)}
.uc-status[data-status="success"],.uc-status[data-status="available"]{color:#2da879}.uc-status[data-status="failure"],.uc-status[data-status="invalid"],.uc-status[data-status="missing"],.uc-failure{color:#df6b66}
.uc-deployment{border:1px solid var(--border);border-radius:10px;padding:16px;margin:16px 0}.uc-warning{border-left:3px solid #d29e49;padding:12px 16px;background:var(--surface-2)}.uc-workflows{margin:24px 0}.uc-workflows summary{cursor:pointer;font-weight:600;margin-bottom:12px}.uc-workflows article{margin-bottom:10px}.uc-workflows h4{margin:0}
.uc-features{border-top:1px solid var(--border);padding-top:24px;margin-top:24px}.uc-features label{display:flex;align-items:center;gap:10px;font-size:13px;margin:16px 0}.uc-features select{background:var(--surface-2);color:var(--text);border:1px solid var(--border);padding:8px;border-radius:6px}
.uc-feature-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.uc-feature>div{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.uc-feature h4{margin:0;font-size:14px}.uc-feature p{font-size:13px;line-height:1.6;margin:12px 0 0}.uc-feature[hidden],.uc-notice[hidden],.uc-all-clear[hidden]{display:none}
.uc-limitation{border-top:1px solid var(--border);padding-top:20px;margin-top:24px}.uc-notice{display:flex;align-items:center;gap:8px;width:100%;margin-top:8px;min-height:32px;padding:6px 10px;box-sizing:border-box;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--muted-strong);font:500 12px/1.3 var(--font-sans);text-decoration:none}.uc-notice::before{content:'';flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:var(--warn)}.uc-notice[data-status="unknown"]::before,.uc-notice[data-status="stale"]::before{background:var(--muted)}.uc-notice[data-status="failed"]::before,.uc-notice[data-status="stuck"]::before{background:var(--neg)}.uc-notice:hover{border-color:var(--accent-line);color:var(--text-strong)}body:not(.is-owner) .uc-notice{display:none!important}
@media(max-width:700px){.uc-builds,.uc-feature-list{grid-template-columns:1fr}.uc-feature>div{flex-wrap:wrap}}
.uc-source-wrap { overflow-x:auto; }
.uc-source-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.uc-source-table th, .uc-source-table td { padding:6px 8px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; }
.uc-source-table .num { text-align:right; white-space:nowrap; }
.uc-source-state { display:inline-flex; align-items:center; gap:6px; font-weight:600; }
.uc-source-state i { width:8px; height:8px; border-radius:50%; background:var(--muted); }
.uc-source-state[data-tone="ok"] i { background:var(--pos); }
.uc-source-state[data-tone="warn"] i { background:var(--warn); }
.uc-source-state[data-tone="bad"] i { background:var(--neg); }
.uc-pills { list-style:none; display:grid; grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); gap:8px; margin:0 0 16px; padding:0; }
.uc-pill { display:grid; grid-template-columns:auto minmax(0,1fr); column-gap:8px; align-items:center; padding:8px 10px; border:1px solid var(--border); border-radius:10px; min-width:0; }
.uc-pill i { grid-row:span 2; width:9px; height:9px; border-radius:50%; background:var(--muted); }
.uc-pill b { font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.uc-pill span { font-size:11px; color:var(--muted-strong); font-variant-numeric:tabular-nums; }
.uc-pill[data-tone=ok] i { background:var(--pos); }
.uc-pill[data-tone=bad] { border-color:color-mix(in srgb,var(--neg) 45%,var(--border)); }
.uc-pill[data-tone=bad] i { background:var(--neg); }
.uc-pill[data-tone=warn] i, .uc-pill[data-tone=running] i { background:var(--warn); }
`;
