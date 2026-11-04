// Site-wide polish from the November 2026 UI review: the sidebar search
// button, quieter header buttons, one footer link colour, and the removal of
// the repeated "Confirms when / Invalidates when / Required before acting /
// Do not infer" boxes that pushed real content down the page. The caution
// itself stays: each page keeps its status line and the footer disclaimer.
export function renderOverhaulCss() {
  return `
/* === UI overhaul: foundations (scripts/render/overhaul-css.mjs) === */
/* One site search: the sidebar button opens the same search as the header. */
.nav-search-btn { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--muted); font: 400 13px/1 var(--font-sans); text-align: left; cursor: pointer; }
.nav-search-btn > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-search-btn:hover { border-color: var(--border-strong); color: var(--text); }
.nav-search-btn:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }
.nav-filter-box[hidden] { display: none !important; }

/* Header: Discord and Support read as quiet links, so search leads. */
.site-nav .discord-btn, .site-nav .donate-btn { white-space: nowrap; height: 32px; padding: 0 10px; border: 1px solid transparent; background: transparent; box-shadow: none; color: var(--muted-strong); font-weight: 600; }
.site-nav .discord-btn svg { color: #5865f2; }
.site-nav .donate-btn svg { color: var(--neg); }
.site-nav .discord-btn:hover, .site-nav .donate-btn:hover { color: var(--text-strong); background: var(--surface-2); border-color: var(--border); filter: none; transform: none; }
/* The time-zone picker never truncates ("Loca"). */
.time-zone-control { flex: 0 0 auto; }
.time-zone-control select { width: 70px; flex: 0 0 auto; }
@media (max-width: 1240px) {
  .site-nav .discord-btn span, .site-nav .donate-btn span { display: none; }
  .site-nav .discord-btn, .site-nav .donate-btn { width: 34px; padding: 0; justify-content: center; }
}
/* Owners have more header controls; the two links drop their words sooner. */
@media (max-width: 1600px) {
  body.is-owner .site-nav .discord-btn span, body.is-owner .site-nav .donate-btn span { display: none; }
  body.is-owner .site-nav .discord-btn, body.is-owner .site-nav .donate-btn { width: 34px; padding: 0; justify-content: center; }
  .auth-chip .auth-name { max-width: 90px; }
  .auth-chip, .auth-chip .auth-logout { white-space: nowrap; }
}

/* Footer: one link colour. */
.site-footer a.foot-discord, .site-footer a.foot-support { color: var(--muted-strong); border-bottom-color: var(--border); }
.site-footer a.foot-discord:hover, .site-footer a.foot-support:hover { color: var(--accent); border-bottom-color: var(--accent); }

/* The repeated confirm / invalidate / "do not infer" boxes. */
.flow-decision-rules, .heatmap-decision-rules, .bonds-ctx-rules, .f13-rules, .tickers-decision-rules,
.rp-rules, .narr-decision-rules, .ic-rules, .cx-rules, .cr-rules, .cmd-rules { display: none !important; }

/* Table headers and layout switches read in sentence case, not as
   letter-spaced capitals. */
.vt-table th { font-family: var(--font-sans); text-transform: none; letter-spacing: 0; font-weight: 600; }
.view-toggle button { text-transform: none; letter-spacing: 0; font-family: var(--font-sans); }

/* Phone tab bar: the open section is easy to spot. */
@media (max-width: 760px) {
  .phone-tab.is-on { background: var(--accent-tint-2); }
  .phone-tab.is-on span { font-weight: 700; }
}
`;
}
