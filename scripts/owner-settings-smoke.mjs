// Owner Settings page (lib/owner-settings.mjs): ranges, locks, confirmation,
// history / undo / reset, the build preload, the live-site switches and the
// server route. Offline: the store is replaced by an in-memory map.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  OWNER_SETTINGS, OWNER_SETTINGS_TABS, OWNER_SETTINGS_KEY, OWNER_SETTINGS_APPLIED_KEY, ownerSettingDef, cleanValue, isLocked,
  readOwnerSettingsDoc, applyOwnerSettingsRequest, ownerSettingsView, applyOwnerSettingsToEnv,
  runtimeEnvOverrides, picksTag, describePicksTag,
} from "../lib/owner-settings.mjs";
import { isPremiumKey } from "../lib/premium-keys.mjs";
import { REQUEST_TIME_EXCLUSIVE_KEYS } from "../lib/data-ownership.mjs";
import { OWNER_PAGE_IDS } from "../lib/owner-access-policy.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// --- catalog --------------------------------------------------------------------
const keys = OWNER_SETTINGS.map((d) => d.key);
eq(new Set(keys).size, keys.length, "setting keys are unique");
for (const d of OWNER_SETTINGS) {
  ok(["build", "site"].includes(d.scope) && d.label && d.help && d.group, `${d.key} is described`);
  ok(cleanValue(d, d.default) === d.default, `${d.key} default is a valid value`);
  if (d.scope === "site") ok(d.kind === "switch" && d.default === true, `${d.key}: site switches default to on (follow Vercel)`);
}
// Every setting sits on a known tab, and every key is really read from the
// environment by the build or the site (a dead key would look like it works).
const codeFiles = [];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); } else if (/\.(mjs|js)$/.test(f) && !/smoke|owner-settings/.test(f)) codeFiles.push(p); } };
walk(resolve("lib")); walk(resolve("api")); codeFiles.push(resolve("scripts/build.mjs"));
const code = codeFiles.map((f) => readFileSync(f, "utf8")).join("\n");
for (const d of OWNER_SETTINGS) {
  ok(OWNER_SETTINGS_TABS.includes(d.tab), `${d.key} sits on a known tab`);
  ok(new RegExp(`env\\??\\.${d.key}\\b`).test(code), `${d.key} is read from the environment by site code`);
  // A constant copied from the env must also be used, or the switch does
  // nothing (PICKS_EVENT_NO_NAKED_LONG was declared in build.mjs and never read).
  const decl = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=[^;\\n]*env\\??\\.${d.key}\\b`, "g");
  let m;
  while ((m = decl.exec(code))) {
    const uses = (code.match(new RegExp(`(?<!env\\??\\.)\\b${m[1].replace(/\$/g, "\\$")}\\b`, "g")) || []).length;
    ok(uses >= 2, `${d.key}: ${m[1]} is used after it is read`);
  }
}
// Big-impact settings carry a careful warning and always need an "are you sure".
const high = OWNER_SETTINGS.filter((d) => d.impact === "high");
ok(high.length >= 20, "big-impact settings are marked");
for (const d of high) ok(typeof d.warn === "string" && d.warn.length >= 40 && /[.!]$/.test(d.warn), `${d.key} has a full warning`);
for (const d of OWNER_SETTINGS) if (d.warn) eq(d.impact, "high", `${d.key}: a warning means big impact`);
for (const k of ["PICKS_MACRO_REGIME", "AI_THESIS", "PICKS_EDGE_GATE", "PICKS_MAX_OPEN_POSITIONS", "PICKS_RUN_ARCHIVE", "MCP_ENABLED", "WEBULL_MIRROR", "SELF_TUNE"]) eq(ownerSettingDef(k).impact, "high", `${k} is big impact`);
// AI cost can only go down from this page: no setting adds AI calls.
for (const k of ["AI_THESIS", "AI_THESIS_SEARCH"]) eq(ownerSettingDef(k).default, true, `${k}: the page can only turn AI off`);
// Guard rails: no model, budget, exit, conviction, schedule or reset setting.
for (const k of keys) ok(!/MODEL|TOKEN_CAP|CALL_CAP|_TP_|STOP|CONVICTION|TIER_STRONG|RESET|EPOCH|ROBINHOOD/.test(k), `${k} is not a guarded repo setting`);
eq(ownerSettingDef("PICKS_COUNT").max, 6, "picks per run can't exceed today's 6 (AI grader cost)");
for (const k of ["PICKS_CROWD_SQUEEZE_VETO", "PICKS_CROWD_GRADER", "PICKS_MACRO_PUTCALL_SRC", "SELF_TUNE"]) {
  eq(ownerSettingDef(k).lockedUntil, "2026-12-07", `${k} is locked until Dec 7`);
  ok(ownerSettingDef(k).confirm, `${k} needs confirmation`);
}

// --- values -----------------------------------------------------------------------
const count = ownerSettingDef("PICKS_COUNT");
eq(cleanValue(count, 4), 4, "in range"); eq(cleanValue(count, "3"), 3, "numeric string");
eq(cleanValue(count, 7), undefined, "over max"); eq(cleanValue(count, 0), undefined, "under min");
eq(cleanValue(count, 2.5), undefined, "off step"); eq(cleanValue(count, ""), undefined, "empty");
eq(cleanValue(ownerSettingDef("PICKS_MACRO_BLOCK_PTS"), 0.75), 0.75, "quarter steps");
eq(cleanValue(ownerSettingDef("PICKS_EVENT_AWARE"), "off"), false, "switch words");
eq(cleanValue(ownerSettingDef("SELF_TUNE"), "LIVE"), undefined, "choice outside options");
const tune = ownerSettingDef("SELF_TUNE");
ok(isLocked(tune, "on", "2026-11-10") && !isLocked(tune, "off", "2026-11-10") && !isLocked(tune, "on", "2026-12-07"), "SELF_TUNE: only on is locked, until Dec 7");

// A tampered file can't push a value out of range.
const tampered = readOwnerSettingsDoc(JSON.stringify({ values: { PICKS_COUNT: 50, PICKS_EVENT_AWARE: false, NOPE: 1, PICKS_WATCH_COUNT: 6 } }));
eq(tampered.values, { PICKS_EVENT_AWARE: false }, "bad, unknown and default values are dropped");
eq(readOwnerSettingsDoc("not json").values, {}, "unreadable file = defaults");

// --- requests: set / confirm / lock / reset / undo -----------------------------------
const at = "2026-11-10T15:00:00Z";
const unsure = applyOwnerSettingsRequest(null, { act: "set", values: { PICKS_COUNT: 4, PICKS_EVENT_AWARE: false } }, { at, by: "MiniMe" });
ok(unsure.needsConfirm && /Event plays/.test(unsure.error), "a big-impact change needs an are-you-sure");
ok(!applyOwnerSettingsRequest(null, { act: "set", values: { PICKS_COUNT: 4 } }, { at }).error, "a small change needs none");
let r = applyOwnerSettingsRequest(null, { act: "set", values: { PICKS_COUNT: 4, PICKS_EVENT_AWARE: false }, confirm: true }, { at, by: "MiniMe" });
ok(!r.error, "set two at once");
let doc = r.doc;
eq(doc.values, { PICKS_COUNT: 4, PICKS_EVENT_AWARE: false }, "values saved");
eq(doc.history[0].changes.length, 2, "one history entry with both changes");
eq(doc.history[0].by, "MiniMe", "who changed it");
ok(applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_COUNT: 9 } }, { at }).error, "out of range refused");
ok(applyOwnerSettingsRequest(doc, { act: "set", values: { AI_MODEL: "x" } }, { at }).error, "unknown key refused");
ok(applyOwnerSettingsRequest(doc, { act: "set", values: {} }, { at }).error, "empty set refused");
ok(applyOwnerSettingsRequest(doc, { act: "explode" }, { at }).error, "bad act refused");
let locked = applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_CROWD_GRADER: true }, confirm: true }, { at });
ok(/before 2026-12-07/.test(locked.error), "crowd hook locked before Dec 7");
ok(/before 2026-12-07/.test(applyOwnerSettingsRequest(doc, { act: "set", values: { SELF_TUNE: "on" }, confirm: true }, { at }).error), "SELF_TUNE on locked before Dec 7");
ok(!applyOwnerSettingsRequest(doc, { act: "set", values: { SELF_TUNE: "off" }, confirm: true }, { at }).error, "SELF_TUNE off is allowed now");
const dec8 = "2026-12-08T15:00:00Z";
const noConfirm = applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_CROWD_GRADER: true } }, { at: dec8 });
ok(noConfirm.needsConfirm, "after Dec 7 a confirm setting still needs confirm");
ok(!applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_CROWD_GRADER: true }, confirm: true }, { at: dec8 }).error, "confirmed after Dec 7 works");
eq(applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_COUNT: 4 } }, { at }).unchanged, true, "same value = unchanged");

r = applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_SINGLE_MAX_COST: 3000 }, confirm: true }, { at: "2026-11-10T16:00:00Z", by: "MiniMe" });
doc = r.doc;
r = applyOwnerSettingsRequest(doc, { act: "undo" }, { at: "2026-11-10T16:05:00Z" });
doc = r.doc;
eq(doc.values, { PICKS_COUNT: 4, PICKS_EVENT_AWARE: false }, "undo reverses the newest change");
ok(doc.history[1].undone && doc.history[0].kind === "undo", "undo is logged and marks the entry");
r = applyOwnerSettingsRequest(doc, { act: "undo" }, { at: "2026-11-10T16:06:00Z" });
doc = r.doc;
eq(doc.values, {}, "a second undo walks back the one before");
ok(applyOwnerSettingsRequest(doc, { act: "undo" }, { at }).error, "nothing left to undo");
doc = applyOwnerSettingsRequest(doc, { act: "set", values: { PICKS_COUNT: 3, REGIME_LAB: false, MCP_ENABLED: false }, confirm: true }, { at }).doc;
ok(!applyOwnerSettingsRequest(doc, { act: "reset", key: "MCP_ENABLED" }, { at }).error, "going back to the default needs no confirm");
const resetMcp = applyOwnerSettingsRequest(doc, { act: "reset", key: "MCP_ENABLED" }, { at }).doc;
ok(applyOwnerSettingsRequest(resetMcp, { act: "undo" }, { at }).needsConfirm, "an undo that turns a big-impact setting back off needs confirm");
eq(applyOwnerSettingsRequest(resetMcp, { act: "undo", confirm: true }, { at }).doc.values.MCP_ENABLED, false, "confirmed undo works");
doc = applyOwnerSettingsRequest(doc, { act: "reset", key: "PICKS_COUNT" }, { at }).doc;
eq(doc.values, { REGIME_LAB: false, MCP_ENABLED: false }, "reset one");
doc = applyOwnerSettingsRequest(doc, { act: "reset-all" }, { at }).doc;
eq(doc.values, {}, "reset all");
eq(doc.history[0].changes.length, 2, "reset all lists what it put back");
let hist = null;
for (let i = 0; i < 70; i++) hist = applyOwnerSettingsRequest(hist, { act: "set", values: { PICKS_WATCH_COUNT: i % 2 ? 3 : 4 } }, { at }).doc;
eq(hist.history.length, 50, "history keeps the newest 50");

// --- view ---------------------------------------------------------------------------
const v = ownerSettingsView({ values: { PICKS_COUNT: 2, WEBULL_MIRROR: false } }, { today: "2026-11-10", applied: { pinned: ["AI_THESIS"] }, env: { WEBULL_MIRROR: "", CONTACT_ENABLED: "0" } });
const row = (k) => v.settings.find((s) => s.key === k);
eq(row("PICKS_COUNT").value, 2, "view value"); ok(row("PICKS_COUNT").changed, "changed flag");
ok(row("AI_THESIS").pinned, "pinned by repo variable");
ok(row("WEBULL_MIRROR").vercelOff && row("CONTACT_ENABLED").vercelOff && !row("MCP_ENABLED").vercelOff, "Vercel-off shown");
eq(row("SELF_TUNE").lockedUntil, "2026-12-07", "lock shown before Dec 7");
ok(!ownerSettingsView(null, { today: "2026-12-07" }).settings.find((s) => s.key === "SELF_TUNE").lockedUntil, "lock gone on Dec 7");

// --- build side -------------------------------------------------------------------------
const env = { AI_THESIS: "", LOOP: "1" };
const report = applyOwnerSettingsToEnv({ values: { PICKS_COUNT: 4, PICKS_EVENT_AWARE: false, AI_THESIS: false, LOOP: false, CROWD: false, PICKS_CROWD_GRADER: true, MCP_ENABLED: false } }, env, { at: new Date("2026-11-10T15:00:00Z") });
eq(env.PICKS_COUNT, "4", "number to env"); eq(env.PICKS_EVENT_AWARE, "0", "switch off to env");
eq(env.AI_THESIS, "0", "empty repo variable does not pin"); eq(env.CROWD, "0", "research switch");
eq(env.LOOP, "1", "a set repo variable wins");
ok(report.pinned.includes("LOOP") && report.skipped.some((s) => s.key === "LOOP"), "pinned and skipped reported");
ok(!("PICKS_CROWD_GRADER" in env) && report.skipped.some((s) => s.key === "PICKS_CROWD_GRADER" && /locked/.test(s.reason)), "a locked value in the file is skipped by the build");
ok(!("MCP_ENABLED" in env), "site switches never reach the build env");
eq(report.picksTag, "AI_THESIS=off,PICKS_COUNT=4,PICKS_EVENT_AWARE=off", "picks tag lists only Top Picks settings");
eq(picksTag({ REGIME_LAB: false }), "", "research-only change stamps nothing");
ok(/Most picks per run 4/.test(describePicksTag(report.picksTag)), "tag in words");
{
  // Reverting every Top Picks setting stamps "default" so the record splits.
  const reverted = applyOwnerSettingsRequest(applyOwnerSettingsRequest(null, { act: "set", values: { PICKS_COUNT: 3 } }).doc, { act: "reset-all" }).doc;
  eq(applyOwnerSettingsToEnv(reverted, {}).picksTag, "default", "back on defaults after a Top Picks change stamps default");
  const researchOnly = applyOwnerSettingsRequest(null, { act: "set", values: { REGIME_LAB: false } }).doc;
  eq(applyOwnerSettingsToEnv(researchOnly, {}).picksTag, "", "research-only history stamps nothing");
  eq(applyOwnerSettingsToEnv(null, {}).picksTag, "", "no settings file stamps nothing");
  eq(describePicksTag("default"), "back on the defaults", "default tag in words");
}

// The preload sets the env before build.mjs-style modules read it.
const dir = mkdtempSync(join(tmpdir(), "owner-settings-"));
writeFileSync(join(dir, OWNER_SETTINGS_KEY), JSON.stringify({ values: { PICKS_COUNT: 3, PICKS_SINGLES_DEFAULT: false } }));
const probe = join(dir, "probe.mjs");
writeFileSync(probe, `const c = await import(${JSON.stringify(resolve("lib/top-picks-config.mjs"))}); console.log(JSON.stringify({ n: c.PICKS_COUNT, s: c.PICKS_SINGLES_DEFAULT, r: JSON.parse(process.env.OWNER_SETTINGS_REPORT).picksTag }));`);
const run = spawnSync(process.execPath, ["--import", "./scripts/owner-settings-env.mjs", probe], { env: { ...process.env, OWNER_SETTINGS_DATA_DIR: dir, PICKS_COUNT: "", PICKS_SINGLES_DEFAULT: "" }, encoding: "utf8" });
eq(run.status, 0, run.stderr);
eq(JSON.parse(run.stdout.trim().split("\n").pop()), { n: 3, s: false, r: "PICKS_COUNT=3,PICKS_SINGLES_DEFAULT=off" }, "preload reaches lib/top-picks-config.mjs");
const none = spawnSync(process.execPath, ["--import", "./scripts/owner-settings-env.mjs", "-e", "console.log(process.env.PICKS_COUNT ?? 'unset')"], { env: { ...process.env, OWNER_SETTINGS_DATA_DIR: join(dir, "missing"), PICKS_COUNT: undefined }, encoding: "utf8" });
eq(none.status, 0, "no file never fails the build");
ok(/unset/.test(none.stdout), "no file = no change");

// --- request side -----------------------------------------------------------------------
eq(runtimeEnvOverrides({ values: { MCP_ENABLED: false, WEBULL_MIRROR: false, CONTACT_ENABLED: true, PICKS_COUNT: 2 } }), { MCP_ENABLED: "0", WEBULL_MIRROR: "off" }, "site switches only turn things off");

// --- storage / access ---------------------------------------------------------------------
ok(isPremiumKey(OWNER_SETTINGS_KEY) && isPremiumKey(OWNER_SETTINGS_APPLIED_KEY), "both files are Owner-only");
ok(REQUEST_TIME_EXCLUSIVE_KEYS.has(OWNER_SETTINGS_KEY), "no workflow pushes or deletes the settings");
ok(!REQUEST_TIME_EXCLUSIVE_KEYS.has(OWNER_SETTINGS_APPLIED_KEY), "the build's report is bake-owned");
ok(OWNER_PAGE_IDS.includes("owner-settings"), "the page is Owner-only");

// --- server route ---------------------------------------------------------------------------
const { store } = await import("../lib/datastore.mjs");
const mem = new Map();
store.get = async (k) => (mem.has(k) ? Buffer.from(mem.get(k)) : null);
store.put = async (k, v) => { mem.set(k, String(v)); };
store.backend = "memory";
process.env.PRIVATE_DATA_ENABLED = "1";
process.env.SESSION_SECRET = "offline-owner-settings-secret";
const { SESSION_COOKIE, signSession } = await import("../lib/session.mjs");
const { default: auth } = await import("../api/auth/[action].js");
const owner = await signSession({ sub: "owner", name: "MiniMe", tr: true, tp: true });
const partial = await signSession({ sub: "owner", tr: true });
function res() {
  return { headers: {}, statusCode: 200, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(v) { this.body = v; return v; }, end(v) { this.body = v; return v; } };
}
const hdr = (cookie, origin = "https://example.test") => ({ host: "example.test", "x-forwarded-proto": "https", origin, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) });
const call = async (method, body, cookie = owner, origin) => { const out = res(); await auth({ query: { action: "owner-settings" }, method, headers: hdr(cookie, origin), body }, out); return out; };
let out = await call("GET", null, null); eq(out.statusCode, 401, "signed out"); eq(out.headers["cache-control"], "private, no-store", "never cached");
out = await call("GET", null, partial); eq(out.statusCode, 401, "both claims needed");
out = await call("DELETE"); eq(out.statusCode, 405, "method");
out = await call("POST", { act: "set", values: { PICKS_COUNT: 2 } }, owner, "https://evil.test"); eq(out.statusCode, 403, "cross-site POST refused");
out = await call("POST", { act: "set", values: { PICKS_COUNT: 99 } }); eq(out.statusCode, 400, "bad value refused"); ok(!mem.has(OWNER_SETTINGS_KEY), "nothing stored on a bad value");
out = await call("POST", { act: "set", values: { SELF_TUNE: "off" } }); eq(out.statusCode, 400, "confirm needed"); ok(out.body.needsConfirm, "needsConfirm flag");
out = await call("GET"); eq(out.statusCode, 200, "owner GET"); eq(out.body.settings.length, OWNER_SETTINGS.length, "catalog returned");
const prevMcp = process.env.MCP_ENABLED;
out = await call("POST", { act: "set", values: { PICKS_COUNT: 2, MCP_ENABLED: false } });
eq(out.statusCode, 400, "big-impact switch refused without confirm"); ok(out.body.needsConfirm && !mem.has(OWNER_SETTINGS_KEY), "nothing stored before the are-you-sure");
out = await call("POST", { act: "set", values: { PICKS_COUNT: 2, MCP_ENABLED: false }, confirm: true });
eq(process.env.MCP_ENABLED, "0", "a saved switch applies on this instance at once"); eq(out.statusCode, 200, "owner POST");
eq(JSON.parse(mem.get(OWNER_SETTINGS_KEY)).values, { PICKS_COUNT: 2, MCP_ENABLED: false }, "stored");
eq(out.body.history[0].by, "MiniMe", "change records the Owner");
mem.set(OWNER_SETTINGS_APPLIED_KEY, JSON.stringify({ applied: { PICKS_COUNT: 2 }, pinned: [], skipped: [], builtAtIso: at }));
out = await call("GET"); eq(out.body.applied.applied, { PICKS_COUNT: 2 }, "last build report shown");
// The MCP switch reaches the MCP route.
const mcpOut = res();
await auth({ query: { action: "mcp-meta", kind: "as" }, method: "GET", headers: { host: "example.test", "x-forwarded-proto": "https" } }, mcpOut);
eq(process.env.MCP_ENABLED, "0", "MCP off applied for the MCP route");
out = await call("POST", { act: "undo" }); eq(out.statusCode, 200, "undo via route");
await new Promise((r) => setTimeout(r, 5));
await auth({ query: { action: "mcp-meta", kind: "as" }, method: "GET", headers: { host: "example.test", "x-forwarded-proto": "https" } }, res());
eq(process.env.MCP_ENABLED, prevMcp, "MCP back to the Vercel value after undo");
// Requests outside the gated actions leave the forced value in place, so a
// request running alongside never sees a half-restored env.
out = await call("POST", { act: "set", values: { MCP_ENABLED: false }, confirm: true });
await auth({ query: { action: "me" }, method: "GET", headers: { host: "example.test", "x-forwarded-proto": "https" } }, res());
eq(process.env.MCP_ENABLED, "0", "other actions do not restore a forced switch");
out = await call("POST", { act: "reset", key: "MCP_ENABLED" });
eq(process.env.MCP_ENABLED, prevMcp, "reset restores the Vercel value");

console.log(`owner settings smoke passed (${checks} checks)`);
