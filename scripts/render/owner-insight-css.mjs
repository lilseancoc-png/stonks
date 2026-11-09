// Styles for owner-insight-client.mjs (2026-11-08): the closed-trade
// post-mortem card, the replay chart, the Scorecard loss-cause tally, the
// rolling win-rate chart, the Top Picks sizing what-if and the Book risk
// exposure bars. Loaded last in styles-css.mjs; colors come from the shared
// tokens so dark mode follows.
export function renderOwnerInsightCss() {
  return `
/* ---- Track Record: post-mortem + replay ---------------------------------- */
.acc-postmortem, .acc-replay { margin-top: 6px; }
.acc-postmortem > .acc-cp-summary b { text-transform: none; letter-spacing: 0; font: 600 11.5px/1 var(--font-sans); }
.acc-postmortem.is-win > .acc-cp-summary b { color: var(--pos); }
.acc-postmortem.is-loss > .acc-cp-summary b { color: var(--neg); }
.acc-pm-body { margin: 6px 0 2px; padding: 8px 10px; border-left: 3px solid var(--border); background: color-mix(in srgb, var(--muted) 7%, transparent); border-radius: 0 var(--r-1, 6px) var(--r-1, 6px) 0; }
.acc-postmortem.is-win .acc-pm-body { border-left-color: var(--pos); }
.acc-postmortem.is-loss .acc-pm-body { border-left-color: var(--neg); }
.acc-pm-head { margin: 0 0 4px; color: var(--text-strong); font: 600 13px/1.45 var(--font-sans); }
.acc-pm-tag { display: inline-block; margin-left: 4px; padding: 1px 7px; border-radius: var(--r-pill, 999px); background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); font: 650 10.5px/1.5 var(--font-sans); letter-spacing: .02em; vertical-align: 1px; }
.acc-pm-facts { margin: 0 0 6px; padding-left: 18px; color: var(--text); font: 450 12.5px/1.5 var(--font-sans); }
.acc-pm-facts li { margin: 1px 0; }
.acc-pm-lesson { margin: 0; color: var(--muted-strong); font: 450 12.5px/1.5 var(--font-sans); }
.acc-pm-lesson b { color: var(--text-strong); }
.acc-replay-body { margin-top: 4px; }
.acc-rp-svg { display: block; width: 100%; max-width: 620px; height: auto; margin: 4px 0 0; }
.acc-rp-hold { fill: color-mix(in srgb, var(--accent, var(--muted)) 10%, transparent); }
.acc-rp-line { fill: none; stroke: var(--text-strong); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
.acc-rp-level { stroke-width: 1; vector-effect: non-scaling-stroke; }
.acc-rp-level.is-target { stroke: var(--pos); stroke-dasharray: 5 4; }
.acc-rp-level.is-stop { stroke: var(--neg); stroke-dasharray: 5 4; }
.acc-rp-level.is-strike { stroke: var(--muted); stroke-dasharray: 2 3; }
.acc-rp-label { font: 500 10.5px var(--font-sans); fill: var(--muted); }
.acc-rp-label.is-target { fill: var(--pos); }
.acc-rp-label.is-stop { fill: var(--neg); }
.acc-rp-dot.is-entry { fill: var(--surface); stroke: var(--text-strong); stroke-width: 1.6; }
.acc-rp-dot.is-exit { fill: var(--text-strong); }
.acc-rp-x { font: 500 10.5px var(--font-sans); fill: var(--muted); text-anchor: start; }
.acc-rp-x.is-end { text-anchor: end; }
.acc-causes .acc-causes-sub { margin: 6px 0 2px; color: var(--muted-strong); font: 600 11px/1.3 var(--font-mono); text-transform: uppercase; letter-spacing: .04em; }
.acc-roll-chart { min-height: 200px; }

/* ---- Top Picks: sizing what-if ------------------------------------------- */
.picks-whatif { margin: 6px 0 10px; padding: 6px 12px; border: 1px dashed var(--border); border-radius: var(--r-2, 10px); background: var(--surface); }
.picks-whatif > summary { cursor: pointer; color: var(--text-strong); font: 600 13px/1.4 var(--font-sans); }
.picks-whatif > summary small { margin-left: 6px; color: var(--muted); font-weight: 500; }
.picks-whatif-body { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 14px; padding: 6px 0 4px; }
.picks-whatif-body label { display: flex; flex-direction: column; gap: 3px; color: var(--muted-strong); font: 500 12px/1.3 var(--font-sans); }
.picks-whatif-body input { width: 9.5em; padding: 5px 8px; border: 1px solid var(--border); border-radius: var(--r-1, 6px); background: var(--bg, var(--surface)); color: var(--text-strong); font: 500 13px/1.3 var(--font-mono); }
.picks-whatif-body .hint { flex-basis: 100%; margin: 2px 0 0; }
.pick-tier-yours { display: block; color: var(--accent, var(--text-strong)); }
@media (max-width: 640px) {
  .acc-pm-body { padding: 6px 8px; }
  .picks-whatif-body input { width: 8em; }
}
`;
}
