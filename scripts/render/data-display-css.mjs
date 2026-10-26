// One shared look for charts and numbers. Feature stylesheets keep their own
// layout; this layer only standardises how values read: soft fills under
// sparklines, a larger hover readout, up/down arrows next to colour, even-width
// digits, and easier-to-scan tables.
export function renderDataDisplayCss() {
  return `
/* Sparklines: a faint area under the line in the line's own colour. */
.spark-area { stroke: none; fill: currentColor; opacity: .13; pointer-events: none; }
.si-spark .spark-area, .ivt-spark .spark-area, .btm-spark .spark-area, .ovn-detail-spark .spark-area { fill: var(--accent); }
.cmd-spark-up .spark-area, .stk-spark-up .spark-area, .ic-spark-up .spark-area, .rot-spark-up .spark-area { fill: var(--pos); }
.cmd-spark-down .spark-area, .stk-spark-down .spark-area, .ic-spark-down .spark-area, .rot-spark-down .spark-area { fill: var(--neg); }
.rot-spark .spark-area { fill: var(--muted-strong); }
.rot-spark-up .spark-area { fill: var(--pos); }
.rot-spark-down .spark-area { fill: var(--neg); }
.ivt-mini .spark-area { fill: var(--muted-strong); }
.ivt-mini.is-up .spark-area { fill: var(--warn); }
.ivt-mini.is-down .spark-area { fill: var(--info, var(--accent)); }
.opt-pc-area { fill: var(--text-strong); opacity: .06; }

/* Hover readout: a little larger and easier to read at a glance. */
.ch-tip { padding: 8px 11px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; box-shadow: 0 8px 22px rgb(0 0 0 / .22); }
.ch-dot { width: 10px; height: 10px; margin: -5px 0 0 -5px; box-shadow: 0 0 0 2.5px var(--surface); }

/* Up and down are never colour alone. */
.move-arrow { display: inline-block; margin-right: 3px; font-size: .72em; vertical-align: .12em; }
.ticker-chg.is-up::before { content: "▲"; margin-right: 3px; font-size: .72em; vertical-align: .1em; }
.ticker-chg.is-dn::before { content: "▼"; margin-right: 3px; font-size: .72em; vertical-align: .1em; }
.ticker-card-row { display: flex; align-items: baseline; gap: 8px; }
.ticker-spot { font-variant-numeric: tabular-nums; }

/* Numbers line up in every column. */
td, th, .mono, .pulse-move, .landing-card-stat, .ticker-spot, .ticker-chg, .ch-tip, [class*="-stat"], [class*="-num"], [class*="-val"] { font-variant-numeric: tabular-nums; }

/* Scatter charts stop growing on wide screens, so axis text stays ~11-14px. */
.sc-svg { max-width: 880px; margin-inline: auto; }

/* Tables built by the shared table helper: banded rows and a clearer header. */
.vt-table tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--text-strong) 2.5%, transparent); }
.vt-table tbody tr:hover td { background: var(--accent-tint-1, var(--surface-2)); }
.vt-table th { border-bottom: 1px solid var(--border); }
th.ts-th[aria-sort="descending"], th.ts-th[aria-sort="ascending"] { background: var(--accent-tint-1, var(--surface-2)); }
`.trimEnd();
}
