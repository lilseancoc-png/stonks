// The data workflows already commit the rendered site. Vercel only needs to
// copy these browser assets; API functions and middleware are built separately.
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public");
const assets = [
  "index.html",
  "app.js",
  "styles.css",
  "welcome.html",
  "favicon.svg",
  "js/streaks.js",
  "js/book-views.js",
  "js/vendor/html-to-image-1.11.11.js",
];

await rm(output, { recursive: true, force: true });
for (const asset of assets) {
  const target = resolve(output, asset);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, asset), target);
}
console.log(`Staged ${assets.length} browser assets in public/.`);
