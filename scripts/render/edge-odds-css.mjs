// Styles for edge-odds-client.mjs (2026-11-07): the "Do we have an edge
// yet?" Scorecard panel, the similar-setup odds lines on Top Picks cards and
// open trades, and the Top Picks run health note. Loaded last in
// styles-css.mjs.
export function renderEdgeOddsCss() {
  return `
/* ---- Track Record: Do we have an edge yet? ------------------------------- */
.acc-edge {
  margin: 0 0 18px; padding: 14px 16px 12px; border: 1px solid var(--border);
  border-left: 4px solid var(--muted); border-radius: var(--r-2, 10px); background: var(--surface);
}
.acc-edge-edge { border-left-color: var(--pos); }
.acc-edge-losing { border-left-color: var(--neg); }
.acc-edge-unclear { border-left-color: var(--warn); }
.acc-edge-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.acc-edge-head h3 { margin: 0; font: 650 16px/1.3 var(--font-sans); color: var(--text-strong); }
.acc-edge-verdict {
  display: inline-block; padding: 2px 9px; border-radius: var(--r-pill, 999px);
  font: 650 11.5px/1.5 var(--font-sans); letter-spacing: .02em;
  color: var(--muted-strong); background: color-mix(in srgb, var(--muted) 16%, transparent);
}
.acc-edge-edge .acc-edge-verdict { color: var(--pos); background: var(--pos-soft, color-mix(in srgb, var(--pos) 14%, transparent)); }
.acc-edge-losing .acc-edge-verdict { color: var(--neg); background: var(--neg-soft, color-mix(in srgb, var(--neg) 14%, transparent)); }
.acc-edge-unclear .acc-edge-verdict { color: var(--warn); background: var(--warn-soft, color-mix(in srgb, var(--warn) 14%, transparent)); }
.acc-edge-lead { margin: 8px 0 4px; max-width: 80ch; color: var(--text); font: 500 13.5px/1.55 var(--font-sans); }
.acc-edge-table { margin: 6px 0 8px; }
.acc-edge-table td { font-variant-numeric: tabular-nums; white-space: nowrap; }
.acc-edge-table td:first-child { white-space: normal; min-width: 190px; }
.acc-edge-table td small { color: var(--muted); font-size: 12px; }
.edge-chart { margin: 6px 0 0; }
.edge-plot { display: grid; grid-template-columns: 58px minmax(0, 1fr); }
.edge-y { position: relative; }
.edge-y span {
  position: absolute; right: 8px; transform: translateY(-50%); white-space: nowrap;
  color: var(--muted); font: 500 11px/1 var(--font-mono); font-variant-numeric: tabular-nums;
}
.edge-plot svg { display: block; width: 100%; height: 150px; overflow: visible; }
.edge-x { display: flex; justify-content: space-between; margin: 4px 0 0 58px; color: var(--muted); font: 500 11px/1 var(--font-mono); }
.edge-chart figcaption { margin-top: 6px; color: var(--muted); font: 500 12px/1.45 var(--font-sans); }
.edge-band { fill: color-mix(in srgb, var(--accent) 16%, transparent); stroke: none; }
.edge-line { stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.edge-zero { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.acc-edge-note { margin: 8px 0 0; font-size: 12px; max-width: 90ch; }

/* ---- Similar-setup odds -------------------------------------------------- */
.odds-line {
  margin: 8px 0; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-2, var(--surface)); color: var(--text);
  font: 500 13px/1.5 var(--font-sans); font-variant-numeric: tabular-nums; overflow-wrap: anywhere;
}
.odds-line .odds-lbl { color: var(--muted-strong); font-weight: 600; margin-right: 2px; }
.odds-line small { color: var(--muted); font-size: 12px; }
.odds-line .odds-what { display: inline-block; margin-left: 4px; }
.odds-line.is-few { border-style: dashed; }
.odds-line.odds-none { color: var(--muted); }
.acc-row > .odds-line { margin: 6px 0; max-width: 620px; }
.ptc-meta .ptc-odds {
  display: block; margin-top: 3px; color: var(--muted-strong);
  font: 500 12px/1.4 var(--font-sans); font-variant-numeric: tabular-nums;
}
.ptc-odds.is-few { color: var(--muted); }
.odds-cell { white-space: nowrap; font-variant-numeric: tabular-nums; }
.odds-cell.is-few { color: var(--muted); }

/* ---- Top Picks run health ------------------------------------------------ */
.run-health {
  margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border);
  font: 500 13px/1.5 var(--font-sans); max-width: 90ch;
}
.run-health-missed { border-color: color-mix(in srgb, var(--neg) 45%, var(--border)); background: var(--neg-soft, color-mix(in srgb, var(--neg) 10%, transparent)); color: var(--text); }
.run-health-missed b { color: var(--neg); }
.run-health-late { border-color: color-mix(in srgb, var(--warn) 45%, var(--border)); background: var(--warn-soft, color-mix(in srgb, var(--warn) 10%, transparent)); color: var(--text); }

@media (max-width: 560px) {
  .acc-edge { padding: 12px 12px 10px; }
  .acc-edge-table th, .acc-edge-table td { padding: 7px 5px; }
  .acc-edge-table td:first-child { min-width: 0; width: 42%; }
  .acc-edge-table td:nth-child(3) { white-space: normal; }
  .edge-plot { grid-template-columns: 50px minmax(0, 1fr); }
  .edge-x { margin-left: 50px; }
  .edge-plot svg { height: 130px; }
  .odds-line .odds-what { display: block; margin-left: 0; }
}
`;
}
