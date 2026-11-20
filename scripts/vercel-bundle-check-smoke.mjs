#!/usr/bin/env node
// Smoke test for scripts/vercel-bundle-check.mjs: the check passes on this
// repo, and fails on small fixture repos that reproduce each way a deployed
// function can lose a file (the #840 computed path among them).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkBundle, scanSource, vercelIgnoreMatcher, stripComments } from "./vercel-bundle-check.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok -", name); };

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-check-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

ok("this repo passes", () => {
  const r = checkBundle(ROOT);
  assert.deepEqual(r.failures, [], JSON.stringify(r.failures, null, 2));
  assert.ok(r.functions.includes("api/auth/[action].js"));
  assert.ok(r.files.includes("lib/mcp/server.mjs"), "walks into the MCP server");
  assert.ok(r.files.includes("lib/ai-disruption/index.mjs"), "walks into the AI disruption registry");
});

ok("a runtime-built asset path fails (the #840 crash)", () => {
  const dir = fixture({
    "api/a.js": 'export default async () => (await import("../lib/reg.mjs")).X;\n',
    "lib/reg.mjs": 'import { readFileSync } from "node:fs";\nconst load = (n) => readFileSync(new URL(`./${n}`, import.meta.url), "utf8");\nexport const X = load("x.json");\n',
    "lib/x.json": "{}",
  });
  const r = checkBundle(dir);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].why, /built at runtime/);
  assert.equal(r.failures[0].file, "lib/reg.mjs");
});

ok("the same registry with full names passes", () => {
  const dir = fixture({
    "api/a.js": 'import { X } from "../lib/reg.mjs";\nexport default () => X;\n',
    "lib/reg.mjs": 'import { readFileSync } from "node:fs";\nexport const X = readFileSync(new URL("./x.json", import.meta.url), "utf8");\n',
    "lib/x.json": "{}",
  });
  assert.deepEqual(checkBundle(dir).failures, []);
});

ok("a named file kept out by .vercelignore fails", () => {
  const dir = fixture({
    ".vercelignore": "/data/\n/scripts/*\n!/scripts/keep.mjs\n",
    "api/a.js": 'import "../lib/r.mjs";\nexport default () => 1;\n',
    "lib/r.mjs": 'export const u = new URL("../data/x.json", import.meta.url);\n',
    "data/x.json": "{}",
  });
  const r = checkBundle(dir);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0].why, /\.vercelignore/);
});

ok("a missing named file and a computed dynamic import fail", () => {
  const dir = fixture({
    "api/a.js": 'const n = "b";\nexport default async () => [new URL("./gone.json", import.meta.url), await import("../lib/" + n + ".mjs")];\n',
    "lib/b.mjs": "export const b = 1;\n",
  });
  const why = checkBundle(dir).failures.map((f) => f.why).join(" | ");
  assert.match(why, /does not exist/);
  assert.match(why, /imports a module through a path built at runtime/);
});

ok("an ignored function is not walked", () => {
  const dir = fixture({
    ".vercelignore": "api/old.js\n",
    "api/old.js": 'export const u = new URL(`./${x}`, import.meta.url);\n',
    "api/a.js": "export default () => 1;\n",
  });
  const r = checkBundle(dir);
  assert.deepEqual(r.functions, ["api/a.js"]);
  assert.deepEqual(r.failures, []);
});

ok("comments and plain templates are not flagged", () => {
  const s = scanSource('// new URL(`./${x}`, import.meta.url)\n/* import(name) */\nconst a = await import(`./plain.mjs`);\n');
  assert.deepEqual(s.problems, []);
  assert.equal(s.imports[0].spec, "./plain.mjs");
  assert.equal(stripComments('a // b\nc'), "a \nc");
});

ok(".vercelignore patterns", () => {
  const ig = vercelIgnoreMatcher("/data/\n/scripts/*\n!/scripts/prepare-vercel.mjs\n*.env\napi/config.js\n");
  assert.equal(ig("data/x.json"), true);
  assert.equal(ig("lib/data/x.json"), false);
  assert.equal(ig("scripts/build.mjs"), true);
  assert.equal(ig("scripts/prepare-vercel.mjs"), false);
  assert.equal(ig("r2.env"), true);
  assert.equal(ig("api/config.js"), true);
  assert.equal(ig("api/quote.js"), false);
});

console.log(`vercel-bundle-check smoke: ${passed} passed`);
