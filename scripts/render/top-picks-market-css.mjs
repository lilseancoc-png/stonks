export function topPicksMarketCss(){return `
/* Top Picks market scores and paired measurement */
.tpm-scores { display:flex; flex-wrap:wrap; gap:6px 16px; width:100%; margin:10px 0; padding:10px 0; border-block:1px solid var(--border); font-size:12px; line-height:1.6; text-align:left; }
.tpm-scores > span { display:inline-block; }
#picks-section .pick-tab-card:has(> .tpm-scores) { grid-template-areas:"rank head score" "tier tier tier" "market market market" "thesis thesis thesis" "entry entry entry" "con con con" "meta meta meta" "cta cta cta"; }
.pick-tab-card > .tpm-scores { grid-area:market; min-width:0; }
.tpm-scores strong { color:var(--warn); width:100%; }
.tpm-scores .tpm-time { width:100%; color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
.tpm-evidence { margin:16px 0; padding:14px 16px; border:1px solid var(--border); border-radius:8px; font-size:13px; line-height:1.65; }
.tpm-evidence summary { cursor:pointer; font-weight:600; }
.tpm-evidence p,.tpm-evidence ul { margin:12px 0; }
.tpm-evidence ul { padding-left:20px; }
.tpm-evidence li { margin:6px 0; overflow-wrap:anywhere; }
.tpm-controls,.tpm-metrics { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; }
.tpm-controls button { background:var(--surface); border:1px solid var(--border); color:var(--text); border-radius:6px; padding:8px 12px; cursor:pointer; }
.tpm-controls button[aria-pressed="true"] { font-weight:700; outline:2px solid var(--accent); }
.tpm-metrics span { padding:8px 16px 8px 0; font-size:12px; }
.tpm-metrics b { display:block; font-size:20px; }
.tpm-table { max-width:100%; overflow-x:auto; margin:16px 0; }
.tpm-table table { border-collapse:collapse; width:100%; font-size:12px; }
.tpm-table caption { text-align:left; font-weight:600; margin-bottom:12px; }
.tpm-table th,.tpm-table td { text-align:left; padding:10px; border-bottom:1px solid var(--border); min-width:90px; }
#an-market-policy p { line-height:1.65; margin:12px 0; }
#an-market-policy details { margin-top:16px; }
`;}
