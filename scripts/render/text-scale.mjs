// Bigger reading text on the feature pages. Every small font size in the
// stylesheet (18px / 1.15rem and under, plus small px line heights) is
// rewritten as calc(size * var(--ts, 1)). --ts is 1 everywhere except inside
// .page-pane, so the header, sidebar, tab bar and footer keep their sizes and
// only page content grows. Headlines are left as they are, and so are SVG
// chart labels, whose px sizes are viewBox units and would crowd the axes.
export const PAGE_TEXT_SCALE = 1.1;

const SMALL_PX = 18;
const SMALL_REM = 1.15;
const SMALL_LINE_PX = 26;
const SVG_SELECTOR = /(^|[\s>+~,(])(svg|text|tspan|textPath)(?=[\s.:#\[>+~,)]|$)/;

function scaled(num, unit, max) {
  const n = Number(num);
  if (!(n > 0) || n > max) return null;
  return `calc(${num}${unit} * var(--ts, 1))`;
}

function scaleSize(m, num, unit) {
  return scaled(num, unit, unit === 'px' ? SMALL_PX : SMALL_REM) || m;
}

function scaleLine(m, num) {
  return scaled(num, 'px', SMALL_LINE_PX) || m;
}

function scaleDecls(body) {
  return body
    .replace(/(font-size\s*:\s*)(\d*\.?\d+)(px|rem)\b/g, (m, pre, num, unit) => {
      const out = scaleSize(m, num, unit);
      return out === m ? m : pre + out;
    })
    .replace(/(line-height\s*:\s*)(\d*\.?\d+)px\b/g, (m, pre, num) => {
      const out = scaleLine(m, num);
      return out === m ? m : pre + out;
    })
    // font shorthand: the first length is the size, an optional /length the line height.
    .replace(/((?:^|[;{\s])font\s*:\s*)([^;}]*)/g, (m, pre, value) => {
      const v = value.replace(/(^|\s)(\d*\.?\d+)(px|rem)(\/(\d*\.?\d+)px\b)?/, (s, lead, num, unit, slash, lh) => {
        const size = scaleSize(`${num}${unit}`, num, unit);
        const line = slash ? '/' + scaleLine(`${lh}px`, lh) : '';
        return lead + size + line;
      });
      return pre + v;
    });
}

export function applyPageTextScale(css) {
  // Innermost rule blocks only: "selector { declarations }" with no braces inside.
  const out = css.replace(/([^{}]*)\{([^{}]*)\}/g, (m, selector, body) => {
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    if (sel.startsWith('@') || sel === ':root' || SVG_SELECTOR.test(sel)) return m;
    if (!/font|line-height/.test(body)) return m;
    return `${selector}{${scaleDecls(body)}}`;
  });
  return out + `
/* Feature pages read one step larger (see scripts/render/text-scale.mjs). */
.page-pane {
  --ts: ${PAGE_TEXT_SCALE};
  font-size: calc(1em * var(--ts));
  --fs-2xs: calc(10px * var(--ts)); --fs-xs: calc(11px * var(--ts)); --fs-sm: calc(13px * var(--ts));
  --fs-md: calc(15px * var(--ts)); --fs-lg: calc(16px * var(--ts));
}
/* Fixed-size tiles and badges keep their sizes so their labels still fit. */
.page-pane :is(.ticker-grade, .vol-cal-cell, .heatmap-tile, .heatmap-sector-label) { --ts: 1; }
`;
}
