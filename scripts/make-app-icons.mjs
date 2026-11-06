// Draws the home-screen app icons in icons/ from the favicon's mark (PWA,
// 2026-11-06). Run once after changing the logo:
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node scripts/make-app-icons.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = new URL("../icons", import.meta.url).pathname;
// The favicon's mark (rising line on dark), drawn full-bleed for app icons.
// "any": rounded tile; "maskable": the mark inside the 80% safe zone on a full square.
const svg = (size, maskable) => {
  const pad = maskable ? 0.2 : 0.12;
  const s = size * (1 - 2 * pad), o = size * pad, k = s / 32;
  const pts = [[5, 25.5], [11, 16.5], [17, 21.5], [27, 8.5]].map(([x, y]) => `${(o + x * k).toFixed(2)} ${(o + y * k).toFixed(2)}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.19}" fill="#0a0c0f"/>
  <path d="M${pts[0]} L${pts[1]} L${pts[2]} L${pts[3]}" fill="none" stroke="#16e08a" stroke-width="${(3 * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${(o + 27 * k).toFixed(2)}" cy="${(o + 8.5 * k).toFixed(2)}" r="${(2.2 * k).toFixed(2)}" fill="#16e08a"/></svg>`;
};
const b = await chromium.launch();
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, maskable)}</body></html>`);
  await page.locator('svg').screenshot({ path: `${out}/${name}`, omitBackground: !maskable });
  await page.close();
}
await b.close();
