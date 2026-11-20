#!/usr/bin/env node
// Vercel bundle check (2026-11-20). Fails when code that a deployed function
// can load reads a file Vercel will not pack into that function.
//
// Why: Vercel traces each function's imports and packs only the files it can
// see. A file read through a path built at runtime (new URL(`./${name}`, ...))
// is invisible to the trace, so the deploy ships without it and the function
// crashes on load (FUNCTION_INVOCATION_FAILED). That took down /mcp, the MCP
// server card and the AI-disruption review endpoint from #840 (2026-11-16)
// until 2026-11-20, while every local test passed, because locally the file is
// always there.
//
// What it does, offline and with no dependency:
//   1. Walks every deployed api/ function (minus .vercelignore) through its
//      relative imports, static and dynamic, to every file it can load.
//   2. In each of those files, fails on:
//      - new URL(<anything but a plain string>, import.meta.url)
//      - import(<anything but a plain string>) of a relative module
//      - a plain new URL("./x", import.meta.url) or import("./x") whose target
//        is missing or excluded from the deploy by .vercelignore
//   3. Prints what it walked, so a reviewer can see the coverage.
//
// Usage: node scripts/vercel-bundle-check.mjs [--root DIR] [--quiet]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_EXT = /\.(?:m?js|cjs)$/;

// .vercelignore lines as path tests, enough for the patterns this repo uses:
// "/dir/", "/dir/*", "/file", "*.ext", "name", and "!" re-includes.
export function vercelIgnoreMatcher(text) {
  const rules = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    let pat = negate ? line.slice(1) : line;
    const anchored = pat.startsWith("/");
    if (anchored) pat = pat.slice(1);
    const dirOnly = pat.endsWith("/");
    if (dirOnly) pat = pat.slice(0, -1);
    const rx = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    const body = anchored ? "^" + rx : "(?:^|/)" + rx;
    rules.push({ negate, test: new RegExp(body + (dirOnly ? "(?:/|$)" : "(?:/|$)")) });
  }
  return (rel) => {
    let ignored = false;
    for (const r of rules) if (r.test.test(rel)) ignored = !r.negate;
    return ignored;
  };
}

// Strip comments so commented-out examples are not read as code. Keeps string
// contents (paths live there). Good enough for this repo's style.
export function stripComments(src) {
  let out = "", i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

const STATIC_IMPORT = /(?:^|[;\s}])(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_LITERAL = /\bimport\(\s*(["'])([^"']+)\1\s*\)/g;
const DYNAMIC_TEMPLATE_PLAIN = /\bimport\(\s*`([^`$]+)`\s*\)/g;
const DYNAMIC_ANY = /\bimport\(\s*([^\s)])/g;
const URL_META = /new\s+URL\(\s*([\s\S]{0,200}?),\s*import\.meta\.url\s*\)/g;

export function scanSource(src) {
  const code = stripComments(src);
  const imports = [], problems = [], assets = [];
  for (const m of code.matchAll(STATIC_IMPORT)) imports.push({ spec: m[1], kind: "static" });
  for (const m of code.matchAll(DYNAMIC_LITERAL)) imports.push({ spec: m[2], kind: "dynamic" });
  for (const m of code.matchAll(DYNAMIC_TEMPLATE_PLAIN)) imports.push({ spec: m[1], kind: "dynamic" });
  for (const m of code.matchAll(DYNAMIC_ANY)) {
    const start = m[1];
    const rest = code.slice(m.index + m[0].length - 1);
    // A plain string or template that is the whole argument is fine; one
    // that is glued to anything else ("../lib/" + name) is built at runtime.
    if ((start === '"' || start === "'") && new RegExp("^" + start + "[^" + start + "\\n]*" + start + "\\s*\\)").test(rest)) continue;
    if (start === "`") {
      const tpl = /^`([^`]*)`\s*\)/.exec(rest);
      if (tpl && !tpl[1].includes("${")) continue;
    }
    const line = code.slice(0, m.index).split("\n").length;
    problems.push({ line, kind: "computed-import", text: code.slice(m.index, m.index + 80).split("\n")[0] });
  }
  for (const m of code.matchAll(URL_META)) {
    const arg = m[1].trim();
    const lit = /^(["'])([^"']+)\1$/.exec(arg) || /^`([^`$]+)`$/.exec(arg);
    const line = code.slice(0, m.index).split("\n").length;
    if (lit) assets.push({ spec: lit[2] ?? lit[1], line });
    else problems.push({ line, kind: "computed-asset", text: m[0].slice(0, 120).replace(/\s+/g, " ") });
  }
  return { imports, problems, assets };
}

function resolveModule(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, base + ".mjs", base + ".js", path.join(base, "index.mjs"), path.join(base, "index.js")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function listFunctions(root, ignored) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name), rel = path.relative(root, abs).split(path.sep).join("/");
      if (ignored(rel)) continue;
      if (ent.isDirectory()) walk(abs);
      else if (/\.(?:m?js|ts)$/.test(ent.name)) out.push(abs);
    }
  };
  const api = path.join(root, "api");
  if (fs.existsSync(api)) walk(api);
  return out.sort();
}

export function checkBundle(root) {
  const ignoreFile = path.join(root, ".vercelignore");
  const ignored = vercelIgnoreMatcher(fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "");
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const functions = listFunctions(root, ignored);
  const seen = new Set(), queue = [...functions], failures = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SOURCE_EXT.test(file)) continue;
    const { imports, problems, assets } = scanSource(fs.readFileSync(file, "utf8"));
    for (const p of problems) failures.push({ file: rel(file), line: p.line, why: p.kind === "computed-asset"
      ? "reads a file through a path built at runtime; Vercel cannot see it, so the deploy ships without it. Name the file in full: new URL(\"./name.json\", import.meta.url)."
      : "imports a module through a path built at runtime; Vercel cannot see it. Import it by its literal path.", text: p.text });
    for (const a of assets) {
      const target = path.resolve(path.dirname(file), a.spec);
      if (!fs.existsSync(target)) failures.push({ file: rel(file), line: a.line, why: `reads ${a.spec}, which does not exist.` });
      else if (ignored(rel(target))) failures.push({ file: rel(file), line: a.line, why: `reads ${rel(target)}, which .vercelignore keeps out of the deploy.` });
    }
    for (const imp of imports) {
      if (!imp.spec.startsWith(".")) continue;
      const target = resolveModule(file, imp.spec);
      if (!target) { failures.push({ file: rel(file), why: `imports ${imp.spec}, which does not resolve to a file.` }); continue; }
      if (ignored(rel(target))) failures.push({ file: rel(file), why: `imports ${rel(target)}, which .vercelignore keeps out of the deploy.` });
      queue.push(target);
    }
  }
  return { functions: functions.map(rel), files: [...seen].map(rel).sort(), failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 ? path.resolve(argv[rootFlag + 1]) : fileURLToPath(new URL("../", import.meta.url));
  const { functions, files, failures } = checkBundle(root);
  if (!argv.includes("--quiet")) console.log(`Vercel bundle check: ${functions.length} functions, ${files.length} files they can load.`);
  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f.file}${f.line ? ":" + f.line : ""}: ${f.why}${f.text ? "\n     " + f.text : ""}`);
    console.error(`${failures.length} problem(s). A deployed function would crash or miss data on Vercel.`);
    process.exit(1);
  }
  console.log("PASS: every file those functions read is named in full and ships with the deploy.");
}
