// Styles for wayfinding-js.mjs: sidebar group descriptions, the page section
// header and previous / next links, Home's "Explore by topic" tiles, Recently
// viewed, and the phone tab bar.
export function renderWayfindingCss() {
  return `
/* Sidebar: each group says what it is for. */
.side-nav-group-label { font-size: 10.5px; color: var(--muted-strong); }
.side-nav-group.is-flash > .side-nav-group-label { animation: wf-flash 1.1s ease-out; }
@keyframes wf-flash { 0% { background: var(--accent-tint-2); color: var(--accent); } 100% { background: transparent; } }

/* Only Home keeps the site-wide subtitle; every other page has its own summary. */
body:not([data-active-tab="home"]) .page-sub { display: none; }

/* One page header everywhere: crumb, title with status and About, summary, siblings. */
.wf-head { display: grid; gap: 8px; margin: 2px 0 16px; }
.wf-crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font: 500 12px/1.4 var(--font-sans); color: var(--muted); }
.wf-crumb > span[aria-hidden] { opacity: .55; }
.wf-crumb-link { padding: 2px 0; border: 0; background: none; color: var(--muted-strong); font: inherit; cursor: pointer; }
.wf-crumb-link:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.wf-titlebar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; min-width: 0; }
.wf-title { margin: 0; font: 650 28px/1.15 var(--font-sans); letter-spacing: -0.015em; color: var(--text-strong); }
.wf-about-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--muted-strong); font: 500 12px/1 var(--font-sans); cursor: pointer; }
.wf-about-btn:hover, .wf-about-btn[aria-expanded="true"] { border-color: var(--accent-line); color: var(--text-strong); }
.wf-about-btn[hidden] { display: none; }
.wf-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-left: auto; min-width: 0; font: 500 12px/1.4 var(--font-sans); color: var(--muted); }
.wf-meta:empty { display: none; }
.wf-meta .card-eyebrow { margin: 0; font: 500 12px/1.4 var(--font-sans); color: var(--muted); text-transform: none; letter-spacing: 0; }
/* The freshness line, folded into the header as one quiet status chip. */
.wf-meta .freshness, #page-pane-home > .freshness { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; font: 500 12px/1.4 var(--font-sans); color: var(--muted); }
#page-pane-home > .freshness { margin: 0 0 10px; }
.wf-meta .freshness .freshness-detail { display: none; }
.wf-meta .market-status, #page-pane-home > .freshness .market-status { margin: 0; padding: 2px 8px; font-size: 12px; }
.wf-blurb { margin: 0; max-width: 78ch; font: 400 15px/1.5 var(--font-sans); color: var(--muted-strong); }
.wf-about { display: grid; gap: 8px; max-width: 92ch; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.wf-about[hidden] { display: none; }
.wf-about .hint, .wf-about p { margin: 0; padding: 0; border: 0; font: 400 14px/1.55 var(--font-sans); font-style: normal; color: var(--text); background: none; }
.wf-about .wf-about-h { margin: 4px 0 0; font: 600 13px/1.3 var(--font-sans); color: var(--text-strong); }
.wf-about .info-note-body { display: grid; gap: 8px; padding: 0; border: 0; }
.wf-sibs { display: flex; flex-wrap: wrap; gap: 6px; }
.wf-sibs[hidden] { display: none; }
.wf-sib { min-height: 30px; padding: 4px 11px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted-strong); font: 500 13px/1.2 var(--font-sans); cursor: pointer; white-space: nowrap; }
.wf-sib:hover { border-color: var(--accent-line); color: var(--text-strong); }
.wf-sib.is-here { background: var(--accent-tint-2); border-color: var(--accent-line); color: var(--text-strong); cursor: default; }
.wf-crumb-link:focus-visible, .wf-sib:focus-visible, .wf-step:focus-visible, .wf-about-btn:focus-visible, .topic-title:focus-visible, .topic-link:focus-visible, .recent-chip:focus-visible, .phone-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* A one-card page: the header names the page, so the card drops its own title. */
.page-pane.wf-merged > .card > .card-header .card-title,
.page-pane.wf-merged > .card > header > .card-title { display: none; }
.page-pane.wf-merged > .card > .card-header:not(:has(> :not(.card-title):not([hidden]))),
.page-pane.wf-merged > .card > header:not(:has(> :not(.card-title):not([hidden]))) { display: none; }

/* Previous / next at the bottom of each page. */
.wf-foot { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 22px 0 8px; padding-top: 14px; border-top: 1px solid var(--hairline); }
.wf-step { display: grid; gap: 2px; min-width: 0; padding: 4px 0; border: 0; border-radius: 0; background: none; color: var(--text-strong); text-align: left; cursor: pointer; }
.wf-step-next { text-align: right; grid-column: 2; }
.wf-step small { font: 500 11.5px/1.3 var(--font-sans); color: var(--muted); }
.wf-step b { font: 600 14.5px/1.3 var(--font-sans); overflow-wrap: anywhere; }
.wf-step:hover b { color: var(--accent); }

/* Home: Explore by topic. */
.landing-topics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.topic-tile { display: grid; gap: 8px; align-content: start; padding: 16px 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.topic-tile > header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.topic-title { padding: 0; border: 0; background: none; color: var(--text-strong); font: 600 15.5px/1.3 var(--font-sans); cursor: pointer; text-align: left; }
.topic-title span { color: var(--accent); }
.topic-title:hover { color: var(--accent); }
.topic-count { flex: 0 0 auto; font: 500 11px/1 var(--font-sans); color: var(--muted); }
.topic-tile > p { margin: 0; font: 400 13px/1.45 var(--font-sans); color: var(--muted-strong); }
.topic-links { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 4px; }
.topic-link { min-height: 28px; padding: 3px 9px; border: 1px solid var(--hairline, var(--border)); border-radius: 6px; background: var(--bg); color: var(--text); font: 500 12.5px/1.2 var(--font-sans); cursor: pointer; }
.topic-link:hover { border-color: var(--accent-line); color: var(--accent); }

/* Home: At a glance (live readings, one tile per page). */
.landing-glance { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.landing-glance-tile { display: grid; gap: 3px; align-content: start; min-width: 0; padding: 11px 13px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); text-align: left; font: inherit; cursor: pointer; transition: border-color .15s var(--ease-out), background .15s var(--ease-out); }
.landing-glance-tile:hover { border-color: var(--accent-line); background: var(--surface-2); }
.landing-glance-tile:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--elev-focus); }
.landing-glance-label { font: 600 11.5px/1.25 var(--font-sans); color: var(--muted); }
.landing-glance-stat { font: 700 17px/1.2 var(--font-mono); color: var(--text-strong); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.landing-glance-sub { font: 400 11.5px/1.3 var(--font-sans); color: var(--muted); overflow-wrap: anywhere; }

/* Sidebar: Recently viewed. */
.workspace-recent { padding: 12px 0 0; }
.workspace-recent[hidden] { display: none; }
.workspace-recent h2 { margin: 0 0 8px; font: 600 11px var(--font-sans); color: var(--muted); }
.workspace-recent-list { display: flex; flex-wrap: wrap; gap: 5px; }
.recent-chip { min-height: 28px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text); font: 500 12px/1.2 var(--font-sans); cursor: pointer; }
.recent-chip.is-sym { font-family: var(--font-mono); font-weight: 600; letter-spacing: .02em; }
.recent-chip:hover { border-color: var(--accent-line); color: var(--accent); }

/* Phone tab bar. */
.phone-tabbar { display: none; }
@media (max-width: 1279px) {
  .landing-topics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-glance { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .phone-tabbar {
    display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 950;
    padding: 4px max(6px, env(safe-area-inset-right, 0px)) calc(4px + env(safe-area-inset-bottom, 0px)) max(6px, env(safe-area-inset-left, 0px));
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
    border-top: 1px solid var(--border);
  }
  .phone-tab { display: grid; justify-items: center; gap: 2px; min-height: 50px; padding: 6px 2px 4px; border: 0; border-radius: 8px; background: none; color: var(--muted); font: 600 10.5px/1.1 var(--font-sans); cursor: pointer; min-width: 0; }
  .phone-tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .phone-tab.is-on { color: var(--accent); }
  .phone-tab.is-on svg { stroke-width: 2.2; }
  .site-footer { margin-bottom: calc(62px + env(safe-area-inset-bottom, 0px)); }
  .back-to-top { bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }
  .cmp-tray { bottom: calc(70px + env(safe-area-inset-bottom, 0px)) !important; }
  body.sidenav-open .phone-tabbar { z-index: 1200; }
  .side-nav { padding-bottom: calc(66px + env(safe-area-inset-bottom, 0px)); }
  .wf-head { margin-top: 0; }
  .wf-title { font-size: 24px; }
  .wf-meta { margin-left: 0; width: 100%; }
  .wf-blurb { font-size: 14px; }
  .wf-step { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
  .wf-sibs { flex-wrap: nowrap; overflow-x: auto; margin: 0 -2px; padding: 0 2px 4px; scrollbar-width: none; }
  .wf-sibs::-webkit-scrollbar { display: none; }
  .wf-foot { gap: 8px; border-top: 0; padding-top: 0; }
  .wf-step b { font-size: 13.5px; }
}
@media (max-width: 560px) {
  .landing-topics { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .side-nav-group.is-flash > .side-nav-group-label { animation: none; }
}
`.trimEnd();
}
