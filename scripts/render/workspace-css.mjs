// Shared workspace finish. Directional colors and feature-specific chart/table
// rules remain owned by their existing components.
export function renderWorkspaceCss() {
  return `
/* Workspace: clearer reading hierarchy, compact overview, searchable rail. */
:root:not([data-theme="light"]) {
  --muted: #a29886;
  --muted-strong: #c4bba9;
  --border: rgba(244,233,210,.13);
  --hairline: rgba(244,233,210,.085);
}
.site-header { box-shadow: 0 1px 0 var(--hairline); }
.site-nav .discord-btn, .site-nav .donate-btn { box-shadow: none; }
.site-nav .discord-btn { background: color-mix(in srgb, #7387e8 14%, var(--surface)); color: var(--text-strong); border-color: color-mix(in srgb, #7387e8 40%, var(--border)); }
.site-nav .donate-btn { background: var(--surface); color: var(--muted-strong); border-color: var(--border-strong); }
.site-header-inner { gap: 16px; }
.freshness { border-radius: 8px; box-shadow: none; font-size: 12px; }
.freshness #freshness-text { line-height: 1.5; }
.page-pane > .card { background-image: none; box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
.card > h2, .card-title { font-family: var(--font-sans); letter-spacing: -.025em; }
.card > .hint { font-size: 14px; line-height: 1.65; padding-left: 12px; }
.card-header { gap: 12px; }
main input:focus-visible, main select:focus-visible, main textarea:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
.site-footer { line-height: 1.6; }

/* The sidebar filter stays within reach while scanning a long tool list. */
.nav-tools {
  position: sticky; top: 0; z-index: 2;
  padding: 18px 14px 12px;
  background: color-mix(in srgb, var(--surface) 55%, var(--bg));
  border-bottom: 1px solid var(--hairline);
}
.nav-tools-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.nav-tools-heading > span { font: 600 11px/1 var(--font-sans); letter-spacing: .13em; text-transform: uppercase; color: var(--muted-strong); }
.nav-drawer-close { display: none; }
.nav-filter-box { display: flex; gap: 8px; align-items: center; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--muted); }
.nav-filter-box:focus-within { border-color: var(--accent); box-shadow: var(--focus-ring); }
.nav-filter-box > svg { flex: 0 0 auto; }
#nav-filter { min-width: 0; width: 100%; height: 38px; padding: 0; border: 0; border-radius: 0; outline: none; box-shadow: none; background: transparent; color: var(--text); font: 400 12px var(--font-sans); }
#nav-filter::placeholder { color: var(--muted); opacity: 1; }
#nav-filter::-webkit-search-cancel-button { display: none; }
#nav-filter-clear { flex: 0 0 28px; height: 30px; border: 0; border-radius: 4px; background: transparent; color: var(--muted-strong); cursor: pointer; font-size: 20px; }
#nav-filter-clear:hover { background: var(--surface-2); color: var(--text-strong); }
#nav-filter-clear[hidden], .nav-filter-status[hidden], .nav-filter-hidden { display: none !important; }
.nav-filter-status { margin: 10px 0 0; font: 400 12px/1.5 var(--font-sans); color: var(--muted-strong); }
.page-tabs { padding-top: 10px; }
.side-nav-group + .side-nav-group { margin-top: 14px; }
.side-nav-group-label { letter-spacing: .1em; font-size: 10px; color: var(--muted); }
.page-tab { min-height: 36px; font-size: 13px; border-radius: 6px; }
.page-tab[aria-selected="true"] { background: var(--accent-tint-2); box-shadow: inset 0 0 0 1px var(--accent-line); }
.page-tab .pt-ico { opacity: 1; }

/* Home works as an overview: the next actions first, then compact metrics. */
.landing-hero, :root[data-theme="light"] .landing-hero {
  padding: 28px 0 22px; border: 0; border-bottom: 1px solid var(--border);
  background: none; box-shadow: none;
}
.landing-hero-main { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); align-items: center; gap: 32px; }
.landing-hero-eyebrow { font-size: 10px; letter-spacing: .17em; margin-bottom: 16px; }
.landing-hero-title { font-size: clamp(36px, 3.6vw, 48px); line-height: 1.07; max-width: 16ch; }
.landing-hero-sub { max-width: 49ch; font-size: 14px; line-height: 1.65; letter-spacing: 0; }
.landing-quick { gap: 10px; }
.landing-quick-card:nth-child(3):last-child { grid-column: 1 / -1; }
.landing-quick-card { padding: 15px 28px 15px 15px; min-height: 100px; border-radius: 10px; gap: 6px; }
.landing-quick-card > span { font-size: 9px; letter-spacing: .09em; }
.landing-quick-card > b { font-size: 15px; }
.landing-quick-card > small { font-size: 12px; line-height: 1.45; }
.landing-quick-card:first-child { border-color: var(--accent-line); background: var(--accent-tint-1); }
.landing-pulse { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0; margin-top: 24px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); overflow: hidden; }
.landing-pulse[hidden] { display: none; }
.pulse-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px 6px; min-width: 0; padding: 14px 16px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.pulse-item + .pulse-item { border-left: 1px solid var(--border); }
.pulse-name { font-size: 10px; letter-spacing: .04em; }
.pulse-sym { font-size: 10px; opacity: 1; }
.pulse-move { grid-column: 1 / -1; font-size: 19px; font-weight: 600; }
.landing-section { margin-bottom: 26px; }
.landing-section-head { margin-bottom: 14px; padding: 0; }
.landing-section-title { font-size: 17px; letter-spacing: -.01em; text-transform: none; }
.landing-section-sub { font-size: 13px; line-height: 1.5; }
.landing-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.landing-card { padding: 20px; min-height: 0; gap: 9px; border-radius: 10px; background-image: none; box-shadow: none; }
.landing-card-head { gap: 10px; margin: 0 0 3px; }
.landing-card-eyebrow { font-size: 14px; line-height: 1.35; letter-spacing: 0; text-transform: none; }
.landing-card-arrow { display: grid; place-items: center; flex: 0 0 25px; height: 25px; border: 1px solid var(--hairline); border-radius: 50%; font-size: 14px; }
.landing-card-stat { font-family: var(--font-sans); font-size: clamp(23px, 2.3vw, 30px); font-weight: 600; line-height: 1.15; overflow-wrap: anywhere; }
.landing-card-sub { font-size: 10px; letter-spacing: .06em; margin: 0; line-height: 1.4; }
.landing-card-desc { font-size: 13px; line-height: 1.55; color: var(--muted-strong); padding-top: 12px; margin-top: 3px; }
.landing-card::after { content: none; }
.landing-card:hover { background: var(--surface-2); border-color: var(--accent-line); box-shadow: none; transform: translateY(-2px); }
.landing-card:hover .landing-card-stat { background: none; -webkit-text-fill-color: currentColor; color: var(--text-strong); }
.landing-foot { font-size: 12px; padding: 8px 0 18px; }

@media (min-width: 1024px) and (max-width: 1279px) {
  .landing-hero-main { grid-template-columns: 1fr; gap: 22px; }
  .landing-hero-title { max-width: none; }
  .landing-hero-sub { max-width: 68ch; }
  .landing-quick { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pulse-item { padding: 12px 8px; }
}
@media (max-width: 1023px) {
  .side-nav { width: min(310px, calc(100vw - 48px)); }
  .nav-tools { padding-top: max(14px, env(safe-area-inset-top)); }
  .nav-drawer-close { display: inline-flex; width: 36px; height: 36px; font-size: 24px; }
  .nav-tools-heading { margin-bottom: 8px; }
  .page-tab { min-height: 44px; font-size: 14px; }
  .side-nav-group-label { min-height: 36px; }
  #nav-filter { font-size: 16px; height: 42px; }
  #nav-filter-clear { height: 40px; }
  .landing-hero-main { gap: 24px; }
}
@media (max-width: 760px) {
  .landing-hero { padding-top: 20px; }
  .landing-hero-main { grid-template-columns: 1fr; gap: 22px; }
  .landing-hero-title { max-width: 20ch; font-size: 38px; }
  .landing-hero-sub { max-width: 60ch; }
  .landing-pulse { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .pulse-item { grid-column: span 2; padding: 12px; }
  .pulse-item:nth-child(4) { border-left: 0; }
  .pulse-item:nth-child(n+4) { grid-column: span 3; border-top: 1px solid var(--border); }
  .landing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .landing-card { padding: 16px; }
}
@media (max-width: 480px) {
  .site-header-inner { gap: 8px; }
  .landing-hero-title { font-size: 35px; }
  .landing-quick-card { padding: 13px 23px 13px 12px; }
  .landing-quick-card > b { font-size: 14px; }
  .landing-quick-card > em { right: 8px; }
  .pulse-item { padding: 12px 8px; gap: 8px 4px; }
  .pulse-name { font-size: 9px; }
  .pulse-sym { font-size: 9px; }
  .pulse-move { font-size: 17px; }
  .landing-grid { grid-template-columns: 1fr; gap: 10px; }
  .landing-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; }
  .landing-card-head { grid-column: 1 / -1; }
  .landing-card-stat { grid-column: 1 / -1; font-size: 27px; }
  .landing-card-sub, .landing-card-desc { grid-column: 1 / -1; }
  .landing-card-desc { margin-top: 3px; }
  .card > .hint { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .landing-card, .landing-quick-card { transition: none; }
  .landing-card:hover, .landing-quick-card:hover { transform: none; }
}
`.trimEnd();
}
