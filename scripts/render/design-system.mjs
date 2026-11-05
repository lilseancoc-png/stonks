// One design system for the whole stylesheet. The page modules were written
// over many months, each with its own sizes, corners and fonts (131 font
// sizes, 55 corner radii and 99 monospace rules at last count). Rather than
// hand-edit thousands of rules, this pass runs once over the generated CSS and
// snaps every value onto a short, shared scale:
//
//  - Text sizes: every px / rem font size becomes one of TYPE_STEPS through a
//    --t-<n> token. Feature pages (.page-pane) read one step larger by
//    remapping the small tokens, so the page scale stays whole pixels instead
//    of 13.68px-style fractions.
//  - Corners: 2 / 4 / 8 / 12 px or a full pill.
//  - Shadows: plain drop shadows use the elevation tokens.
//  - Fonts: the interface, numbers included, is Hanken Grotesk (its digits are
//    already equal width, so columns still line up). JetBrains Mono is kept
//    for code, keyboard hints and the broker trade lines (--font-code).
//  - Upper-case labels lose the wide letter spacing that made them read like a
//    terminal.
//  - var(--token, #hex) fallbacks are dropped for tokens defined in :root, so
//    one colour lives in one place.
//
// SVG text keeps its px sizes (they are viewBox units), and @-rule and theme
// token blocks are left alone.

export const TYPE_STEPS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 64];
// Feature pages read one step larger for text 18px and under.
export const PAGE_STEP_UP = { 10: 11, 11: 12, 12: 13, 13: 14, 14: 15, 15: 16, 16: 18, 18: 20 };
export const RADIUS_STEPS = [2, 4, 8, 12];
const FS_TOKENS = { '2xs': 10, xs: 11, sm: 13, md: 15, lg: 16, xl: 20, '2xl': 24, '3xl': 32, hero: 48, mega: 64 };
const SVG_SELECTOR = /(^|[\s>+~,(])(svg|text|tspan|textPath)(?=[\s.:#\[>+~,)]|$)/;

export function snapType(px) {
  let best = TYPE_STEPS[0];
  for (const s of TYPE_STEPS) {
    if (Math.abs(s - px) < Math.abs(best - px) || (Math.abs(s - px) === Math.abs(best - px) && s > best)) best = s;
  }
  return best;
}

export function snapRadius(px) {
  if (px <= 0) return 0;
  if (px >= 40) return 999;
  let best = RADIUS_STEPS[0];
  for (const s of RADIUS_STEPS) {
    if (Math.abs(s - px) < Math.abs(best - px) || (Math.abs(s - px) === Math.abs(best - px) && s > best)) best = s;
  }
  return best;
}

function typeToken(num, unit) {
  const n = Number(num);
  if (!(n > 0)) return null;
  const px = unit === 'rem' ? n * 16 : n;
  if (px > 72) return null;
  return `var(--t-${snapType(px)})`;
}

function radiusValue(value) {
  return value.replace(/(^|[\s/])(\d*\.?\d+)px\b/g, (m, lead, num) => {
    const r = snapRadius(Number(num));
    return lead + (r === 999 ? '999px' : r + 'px');
  });
}

// A plain drop shadow (no inset, no spread ring) maps to an elevation token by
// blur size. Rings, insets and coloured glows carry meaning and stay.
function shadowValue(value) {
  const v = value.trim();
  if (/inset|var\(|color-mix|,/.test(v)) return value;
  const m = v.match(/^(-?\d*\.?\d+)(px)?\s+(-?\d*\.?\d+)(px)?\s+(\d*\.?\d+)(px)?(\s+-?\d*\.?\d+(px)?)?\s+(rgba?\(\s*0\s*,\s*0\s*,\s*0[^)]*\)|#000\w*)$/);
  if (!m) return value;
  const blur = Number(m[5]);
  return blur >= 40 ? ' var(--elev-3)' : blur >= 12 ? ' var(--elev-2)' : ' var(--elev-1)';
}

function rewriteDecls(body, definedTokens) {
  return body
    .replace(/(font-size\s*:\s*)(\d*\.?\d+)(px|rem)\b/g, (m, pre, num, unit) => {
      const t = typeToken(num, unit);
      return t ? pre + t : m;
    })
    .replace(/(font-size\s*:\s*)var\(--fs-([a-z0-9]+)\)/g, (m, pre, key) => (FS_TOKENS[key] ? `${pre}var(--t-${FS_TOKENS[key]})` : m))
    .replace(/((?:^|[;{\s])font\s*:\s*)([^;}]*)/g, (m, pre, value) => {
      const v = value
        .replace(/(^|\s)(\d*\.?\d+)(px|rem)(?=\/|\s)/, (s, lead, num, unit) => lead + (typeToken(num, unit) || `${num}${unit}`))
        .replace(/(^|\s)var\(--fs-([a-z0-9]+)\)(?=\/|\s)/, (s, lead, key) => lead + (FS_TOKENS[key] ? `var(--t-${FS_TOKENS[key]})` : `var(--fs-${key})`));
      return pre + v;
    })
    .replace(/(border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*)([^;}!]+)/g, (m, pre, value) => pre + radiusValue(value))
    .replace(/(box-shadow\s*:)([^;}!]+)/g, (m, pre, value) => pre + shadowValue(value))
    // Upper-case labels: keep the case, drop the terminal-wide tracking.
    .replace(/letter-spacing\s*:\s*(\d*\.?\d+)em/g, (m, num) => (Number(num) > 0.06 && /text-transform\s*:\s*uppercase/.test(body) ? 'letter-spacing: 0.04em' : m))
    .replace(/var\((--[a-z0-9-]+)\s*,\s*#[0-9a-fA-F]{3,8}\)/g, (m, name) => (definedTokens.has(name) ? `var(${name})` : m));
}

function definedRootTokens(css) {
  const out = new Set();
  for (const block of css.matchAll(/:root[^{]*\{([^{}]*)\}/g)) {
    for (const d of block[1].matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(d[1]);
  }
  return out;
}

export function applyDesignSystem(css) {
  const tokens = definedRootTokens(css);
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (m, selector, body) => {
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (sel.startsWith('@') || /^:root\b/.test(sel) || /^\[data-theme/.test(sel) || /^(from|to|\d+%)/.test(sel)) return m;
    if (SVG_SELECTOR.test(sel)) {
      // SVG text keeps its viewBox sizes; corners and fallbacks still snap.
      return `${selector}{${body.replace(/var\((--[a-z0-9-]+)\s*,\s*#[0-9a-fA-F]{3,8}\)/g, (x, name) => (tokens.has(name) ? `var(${name})` : x))}}`;
    }
    return `${selector}{${rewriteDecls(body, tokens)}}`;
  });
}

// The shared tokens. Appended last so they win over older definitions of the
// same names (the radius, size and font tokens below replace earlier values).
export function designSystemCss() {
  const base = TYPE_STEPS.map((s) => `--t-${s}:${s}px;`).join(' ');
  const up = Object.entries(PAGE_STEP_UP).map(([s, to]) => `--t-${s}:${to}px;`).join(' ');
  const reset = Object.keys(PAGE_STEP_UP).map((s) => `--t-${s}:${s}px;`).join(' ');
  return `
/* === Design system (scripts/render/design-system.mjs) === */
:root {
  ${base}
  --fs-2xs:10px; --fs-xs:11px; --fs-sm:13px; --fs-md:15px; --fs-lg:16px; --fs-xl:20px; --fs-2xl:24px; --fs-3xl:32px; --fs-hero:48px; --fs-mega:64px;
  --r-1:4px; --r-2:8px; --r-3:8px; --r-4:12px; --r-5:12px; --r-pill:999px;
  --font-code:"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* Numbers and data read in the interface face; its digits are equal width. */
  --font-mono:var(--font-sans);
}
/* Feature pages read one step larger, in whole pixels. */
.page-pane { ${up} }
/* Fixed-size tiles and badges keep their sizes so their labels still fit. */
.page-pane :is(.ticker-grade, .vol-cal-cell, .heatmap-tile, .heatmap-sector-label) { ${reset} }
/* Code, keyboard hints, broker trade lines and the wordmark keep a code face. */
code, kbd, samp, pre, .brand-word, .cmd-palette-trigger-kbd, .tl-id, .tl-line, .trade-line, .opt-manual-paste input, .acc-tl-line { font-family: var(--font-code); }
`;
}
