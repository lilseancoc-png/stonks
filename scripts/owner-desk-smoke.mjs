// The Owner's own desk across the site (wave-1 integration, 2026-11-19): the
// picks feed's status line for the Owner controls. The Owner brief's desk
// findings are tested in owner-market-brief-smoke.mjs, the MCP's
// owner_controls in mcp-smoke.mjs. Run: node scripts/owner-desk-smoke.mjs
import assert from "node:assert/strict";
import { buildPicksFeedText } from "../lib/pick-trade-text.mjs";
import { activeControls, controlsSummary, readOwnerControlsDoc } from "../lib/owner-controls.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const nowMs = Date.parse("2026-11-19T18:00:00Z");
const acc = { builtAtIso: "2026-11-19T16:20:00Z", open: [], closed: [] };

const plain = buildPicksFeedText(acc, { nowMs });
ok(!/STOPPED|Status:/.test(plain), "no controls = no status line");
ok(buildPicksFeedText(acc, { nowMs, controls: null }) === plain, "null controls = the old feed, byte for byte");

const doc = readOwnerControlsDoc({ stop: { at: "2026-11-19T15:05:00Z", by: "owner" }, avoid: [{ sym: "AAPL", close: true, at: "2026-11-19T15:00:00Z" }, { sym: "MSFT", close: false, at: "2026-11-19T15:00:00Z" }], watch: [], catalysts: [], dial: null });
const active = activeControls(doc, nowMs);
const text = buildPicksFeedText(acc, { nowMs, controls: { ...controlsSummary(active), stopAt: active.stopAt } });
ok(/Status:\s+NEW TRADES STOPPED by the owner since/.test(text), "a stop is the first status line");
ok(/No new OPEN entries until resumed\. CLOSE entries keep coming\./.test(text), "the stop says closes continue");
ok(/open trades in AAPL close at the next run/.test(text) && !/MSFT/.test(text), "only avoid-and-close names are listed");
ok(text.indexOf("Status:") < text.indexOf("OPEN TRADES"), "status sits in the header");
const lines = text.split("\n");
const statusAt = lines.findIndex((l) => l.includes("Status:"));
ok(lines[statusAt + 1].startsWith("  ") && lines[statusAt + 1].includes("AAPL") && !lines[statusAt + 1].includes("Status:"), "the second status line is indented under the label");

const avoidOnly = buildPicksFeedText(acc, { nowMs, controls: { stop: false, close: ["AAPL", "bad sym!"] } });
ok(/Status:\s+Owner avoid list: open trades in AAPL close/.test(avoidOnly) && !/bad sym/.test(avoidOnly), "bad names never print");
ok(!/STOPPED/.test(buildPicksFeedText(acc, { nowMs, controls: { stop: false, close: [] } })), "nothing in force = no status");

console.log(`owner-desk-smoke: ${checks} checks passed (picks feed status line)`);
