// Discover and run the repository's regression checks without a build, provider
// collection, workflow dispatch, or production write. Logs stay outside the repo.
// Usage: node scripts/audit-checks.mjs --unit|--browser|--syntax [--list]
// PLAYWRIGHT_MODULE may point at a temporary Playwright installation.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv.includes('--browser') ? 'browser' : process.argv.includes('--syntax') ? 'syntax' : 'unit';
const output = resolve(process.env.AUDIT_OUTPUT || resolve(tmpdir(), 'stonks-audits-checks'), mode);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const commands = new Map();
function add(args, extraEnv = {}) {
  const browser = args.some(s => /browser|--browser/.test(s));
  if ((mode === 'browser') !== browser) return;
  const key = JSON.stringify([args, extraEnv]);
  if (!commands.has(key)) commands.set(key, { args, extraEnv });
}
if (mode === 'syntax') {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.js', '*.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const path of files) commands.set(path, { args: ['--check', path], extraEnv: {} });
} else {
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    // The old branch runner repeats a fixed subset. Its constituent checks are
    // discovered below, and the runner itself is covered by syntax validation.
    if (!/^(test|verify):/.test(name) || name === 'test:branches') continue;
    for (const part of cmd.split(' && ')) {
      const tokens = part.trim().split(/\s+/), extraEnv = {};
      while (/^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) {
        const token = tokens.shift(), at = token.indexOf('=');
        extraEnv[token.slice(0, at)] = token.slice(at + 1);
      }
      if (tokens.shift() !== 'node') throw new Error('Unsupported test command: ' + part);
      add(tokens, extraEnv);
    }
  }
  for (const name of (await readdir(resolve(root, 'scripts'))).sort()) {
    if (/(?:-smoke|-selftest|-browser)\.mjs$/.test(name)) add(['scripts/' + name]);
  }
  add(['scripts/market-cost-check.mjs']);
  add(['scripts/audit-fix-proof.mjs']);
}
const selected = process.env.AUDIT_FILTER ? new RegExp(process.env.AUDIT_FILTER) : null;
const checks = [...commands.values()].filter(c => !selected || selected.test(c.args.join(' ')));
if (!checks.length) throw new Error('No checks matched the requested audit selection');
if (process.argv.includes('--list')) {
  console.log(JSON.stringify({ mode, count: checks.length, checks }, null, 2));
  process.exit(0);
}
await mkdir(output, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/TOKEN|SECRET|API_KEY|PASSWORD|R2_|BLOB_|WEBULL_|DISCORD_|GEMINI_/.test(name)));
env.NODE_OPTIONS = '--unhandled-rejections=strict';
const results = [];
for (let i = 0; i < checks.length; i++) {
  const { args, extraEnv } = checks[i];
  const started = Date.now(), chunks = [];
  const result = await new Promise(resolveResult => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, Number(process.env.AUDIT_TIMEOUT_MS) || 240000);
    child.stdout.on('data', c => chunks.push(c));
    child.stderr.on('data', c => chunks.push(c));
    child.on('error', error => chunks.push(Buffer.from(error.message)));
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, timedOut }); });
  });
  const label = [...Object.entries(extraEnv).map(([k, v]) => k + '=' + v), ...args].join(' ');
  const log = resolve(output, String(i + 1).padStart(3, '0') + '-' + (args.find(a => a.endsWith('.mjs') || a.endsWith('.js')) || 'check').split('/').pop() + '.log');
  await writeFile(log, Buffer.concat(chunks));
  const row = { command: label, passed: result.code === 0 && !result.timedOut, ...result, durationMs: Date.now() - started, log };
  results.push(row);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ mode, total: checks.length, completed: results.length, passed: results.filter(r => r.passed).length, results }, null, 2) + '\n');
  console.log(`${i + 1}/${checks.length} ${row.passed ? 'PASS' : 'FAIL'} ${label} (${row.durationMs}ms)`);
  if (!row.passed) console.log(Buffer.concat(chunks).toString().slice(-2500));
}
console.log(JSON.stringify({ mode, passed: results.filter(r => r.passed).length, total: checks.length, output }));
if (results.some(r => !r.passed)) process.exitCode = 1;
