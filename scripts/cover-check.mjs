// Covered-data check for the browser tests (2026-11-20). Finds a control,
// badge or bar that is painted over page content (text, table cells, charts,
// images, heat map tiles) where the reader cannot move it out of the way:
//
//   - an absolute element over content, at any scroll position (the old heat
//     map zoom bar sat on the map's corner tiles);
//   - a fixed element in the lower part of the screen over content that is
//     still under it with the page scrolled to the end (a tab bar over the
//     footer's last lines).
//
// Sticky headers are left alone (scrolling moves content clear of them), and
// so are things the reader opened on purpose: dialogs, menus, lists and
// tooltips. A see-through tint is not reported. pageProblems() in
// browser-harness.mjs runs this on every page it checks.

// Runs inside the page. Returns [{ floater, covered, area, mode }].
export function findCoveredContent() {
  const out = [];
  const startX = scrollX, startY = scrollY;
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (c.length) s += '.' + c.join('.');
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    return t ? s + ' "' + t + '"' : s;
  };
  const shown = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true);
  const OPENED = '[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [aria-modal="true"], [class*="tooltip"], [id*="tooltip"], .ch-tip, .ch-line, .ch-dot';
  const pinned = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const v = getComputedStyle(p).position; if (v === 'fixed' || v === 'sticky') return p; } return null; };
  const srOnly = (el) => { for (let p = el, k = 0; p && k < 3; p = p.parentElement, k++) { const c = getComputedStyle(p); if (c.clip && c.clip !== 'auto') return true; const b = p.getBoundingClientRect(); if (b.width <= 2 || b.height <= 2) return true; } return false; };
  // The test harness's own "Synthetic test data" strip is not part of the site.
  const harness = [...document.body.children].filter((el) => /Synthetic test data/.test(el.textContent || '') && getComputedStyle(el).position === 'fixed');
  const harnessDisplay = harness.map((el) => el.style.display);
  harness.forEach((el) => { el.style.display = 'none'; });
  const floaters = [], content = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') continue;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'BR', 'OPTION'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if ((cs.position === 'absolute' || cs.position === 'fixed') && r.width >= 8 && r.height >= 8 && el.tagName !== 'CANVAS' && !el.closest(OPENED) && shown(el)) floaters.push(el);
    let isContent = ['TD', 'TH', 'CANVAS', 'IMG'].includes(el.tagName) || (el.tagName.toLowerCase() === 'svg' && r.width >= 24 && r.height >= 24) || el.classList.contains('heatmap-tile');
    let textRect = null;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (texts.length) {
      const range = document.createRange();
      let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
      for (const n of texts) { range.selectNodeContents(n); for (const q of range.getClientRects()) { if (q.width < 1) continue; L = Math.min(L, q.left); T = Math.min(T, q.top); R = Math.max(R, q.right); B = Math.max(B, q.bottom); } }
      if (R > L) { textRect = { left: L, top: T, right: R, bottom: B }; isContent = true; }
    }
    if (!isContent || !shown(el) || pinned(el) || srOnly(el)) continue;
    const q = textRect || r;
    if (q.right - q.left < 3 || q.bottom - q.top < 3) continue;
    content.push({ el, text: !!textRect, rect: { left: q.left + scrollX, top: q.top + scrollY, right: q.right + scrollX, bottom: q.bottom + scrollY } });
  }
  // The part of a box left visible by every clipping ancestor (page coordinates).
  const visiblePart = (el, rect, fromSelf) => {
    let c = { ...rect };
    for (let p = fromSelf ? el : el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.contain.includes('paint')) {
        const b = p.getBoundingClientRect();
        const fixed = pinned(p) && getComputedStyle(pinned(p)).position === 'fixed';
        const ox = fixed ? 0 : scrollX, oy = fixed ? 0 : scrollY;
        c = { left: Math.max(c.left, b.left + ox), top: Math.max(c.top, b.top + oy), right: Math.min(c.right, b.right + ox), bottom: Math.min(c.bottom, b.bottom + oy) };
      }
      if (c.right <= c.left || c.bottom <= c.top) return null;
    }
    return c;
  };
  // Is the floater's paint at this point something you can see (not a faint tint)?
  const solid = (hit, F) => {
    for (let e = hit; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(Number); if ((p.length < 4 ? 1 : p[3]) >= 0.35) return true; }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
      if (['IMG', 'CANVAS', 'BUTTON', 'INPUT', 'SELECT'].includes(e.tagName) || e instanceof SVGElement) return true;
      if (e === F) break;
    }
    return hit !== F && (hit.textContent || '').trim().length > 0;
  };
  const seen = new Set();
  const test = (F, C, I, atEnd) => {
    const cx = (I.left + I.right) / 2, cy = (I.top + I.bottom) / 2;
    if (!atEnd) window.scrollTo(Math.max(0, cx - innerWidth / 2), Math.max(0, cy - innerHeight / 2));
    const x = cx - scrollX, y = cy - scrollY;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
    const was = [F.style.getPropertyValue('pointer-events'), F.style.getPropertyPriority('pointer-events')];
    F.style.setProperty('pointer-events', 'auto', 'important');
    const stack = document.elementsFromPoint(x, y);
    F.style.setProperty('pointer-events', was[0], was[1]);
    const iF = stack.findIndex((e) => e === F || F.contains(e));
    const iC = stack.findIndex((e) => e === C.el || C.el.contains(e));
    if (iF < 0 || iC < 0 || iF > iC || !solid(stack[iF], F)) return;
    const key = name(F) + ' | ' + name(C.el);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ floater: name(F), covered: name(C.el), area: Math.round((I.right - I.left) * (I.bottom - I.top)), mode: atEnd ? 'fixed bar at the end of the page' : 'always' });
  };
  const overlap = (A, B) => ({ left: Math.max(A.left, B.left), top: Math.max(A.top, B.top), right: Math.min(A.right, B.right), bottom: Math.min(A.bottom, B.bottom) });
  const big = (I, CR) => { const w = I.right - I.left, h = I.bottom - I.top; if (w < 3 || h < 3) return false; return w * h >= 40 || w * h >= 0.3 * (CR.right - CR.left) * (CR.bottom - CR.top); };
  try {
    // Every box is measured once, before anything scrolls.
    content.forEach((C) => { C.vis = visiblePart(C.el, C.rect, C.text); });
    const shownContent = content.filter((C) => C.vis);
    const absolute = floaters.filter((F) => getComputedStyle(F).position === 'absolute' && !pinned(F)).map((F) => {
      const r = F.getBoundingClientRect();
      return { F, FR: visiblePart(F, { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY }, false) };
    }).filter((x) => x.FR);
    for (const { F, FR } of absolute) {
      for (const C of shownContent) {
        const I = overlap(FR, C.vis);
        if (!big(I, C.vis) || C.el === F || F.contains(C.el) || C.el.contains(F)) continue;
        test(F, C, I, false);
        if (out.length >= 40) break;
      }
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const F of floaters) {
      if (getComputedStyle(F).position !== 'fixed') continue;
      const r = F.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight || r.top < innerHeight * 0.4) continue;
      const FR = { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY };
      for (const C of shownContent) {
        const I = overlap(FR, C.vis);
        if (big(I, C.vis) && !F.contains(C.el)) test(F, C, I, true);
      }
    }
  } finally {
    harness.forEach((el, i) => { el.style.display = harnessDisplay[i]; });
    window.scrollTo(startX, startY);
  }
  return out;
}

const SOURCE = '(' + findCoveredContent.toString() + ')()';

// Problems for pageProblems(): one line per covering element.
export async function coverProblems(page) {
  const found = await page.evaluate(SOURCE);
  return found.map((f) => 'covers data: ' + f.floater + ' sits over ' + f.covered + ' (' + f.area + ' px², ' + f.mode + ')');
}
