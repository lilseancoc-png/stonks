// Offline regression check that private-data rendering fails closed when its
// manifest sidecars cannot be written.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { renderHtml } from "./render/html.mjs";
import { renderAppJs } from "./render/app-js.mjs";

const temp = await mkdtemp(resolve(tmpdir(), "stonks-render-"));
try {
  const dataDir = resolve(temp, "data");
  await mkdir(dataDir);
  const html = renderHtml({
    symbols: [],
    builtAt: "test",
    builtAtIso: "2026-08-02T00:00:00.000Z",
    unusual: { premiumSentinel: "must-not-inline" },
    dataDir,
  });
  assert.match(html, /"deferred":true/);
  assert.doesNotMatch(html, /must-not-inline/);
  assert.match(await readFile(resolve(dataDir, "manifest.json"), "utf8"), /must-not-inline/);
  assert.equal((html.match(/id="picks-position"/g) || []).length, 1);
  assert.ok(html.indexOf('id="picks-position"') > html.indexOf('id="quant-section"'));
  assert.match(html, /data-nav-group="quant"[\s\S]*?side-nav-group-label">Owner</);

  const appJs = renderAppJs({});
  assert.match(appJs, /function loadOwnerTools\(\)[\s\S]*?loadStocks\(\);[\s\S]*?loadSectorRotation\(\);[\s\S]*?loadLevEtf\(\);/);
  assert.match(appJs, /stkDcaBlock\(d, false\)/);
  assert.equal((appJs.match(/data-rot-account><\/label>/g) || []).length, 1);
  assert.equal((appJs.match(/data-lev-account><\/label>/g) || []).length, 1);

  const blocker = resolve(temp, "not-a-directory");
  await writeFile(blocker, "block", "utf8");
  assert.throws(
    () => renderHtml({
      symbols: [],
      builtAt: "test",
      builtAtIso: "2026-08-02T00:00:00.000Z",
      unusual: { premiumSentinel: "must-not-inline" },
      dataDir: blocker,
    }),
    /manifest sidecar write failed/,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("render fail-closed smoke test passed");
