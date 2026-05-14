// Regenerates index.html, app.js, and styles.css from the existing
// data/trends.json + data/*.json without re-running the Yahoo + Gemini
// pipeline in build.mjs. Useful when only the page renderers changed.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtml, renderAppJs, renderStylesCss } from "./build.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data");

const trendsRaw = await readFile(resolve(DATA_DIR, "trends.json"), "utf8");
const trends = JSON.parse(trendsRaw);

let unusual = null;
try {
  const unusualRaw = await readFile(resolve(DATA_DIR, "unusual.json"), "utf8");
  unusual = JSON.parse(unusualRaw);
} catch {}

const files = await readdir(DATA_DIR);
const symbols = files
  .filter((f) => /^[A-Z]+\.json$/.test(f))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const spots = {};
for (const sym of symbols) {
  try {
    const raw = await readFile(resolve(DATA_DIR, sym + ".json"), "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j.spot === "number") spots[sym] = j.spot;
  } catch {}
}

const builtAtIso = trends.builtAtIso || new Date().toISOString();
const builtAt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
}).format(new Date(builtAtIso));

const html = renderHtml({
  symbols,
  builtAt,
  builtAtIso,
  narratives: trends.narratives || [],
  recentlyEnded: trends.recentlyEnded || [],
  macroHeadlines: trends.macroHeadlines || [],
  unusual,
  spots,
});
const css = renderStylesCss();
const js = renderAppJs();

await writeFile(resolve(ROOT, "index.html"), html, "utf8");
await writeFile(resolve(ROOT, "styles.css"), css, "utf8");
await writeFile(resolve(ROOT, "app.js"), js, "utf8");

console.log(
  `Regenerated index.html (${(html.length / 1024).toFixed(1)} KB), ` +
    `styles.css (${(css.length / 1024).toFixed(1)} KB), ` +
    `app.js (${(js.length / 1024).toFixed(1)} KB).`,
);
