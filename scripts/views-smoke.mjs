// Smoke test for the shared sort / view helpers (scripts/render/views-client.mjs):
// remembered choices, the flip button, sortBy ordering and table-cell parsing.
// Pure — no browser, no network. Run: node scripts/views-smoke.mjs
import assert from "node:assert/strict";
import { viewsFactory } from "./render/views-client.mjs";

const store = {};
const win = { localStorage: {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
} };
const V = viewsFactory(win, {});

// Remembered choices: unknown or retired values fall back.
assert.equal(V.choose("t.sort", "a", ["a", "b"]), "a");
V.set("t.sort", "b");
assert.equal(V.choose("t.sort", "a", ["a", "b"]), "b");
V.set("t.sort", "gone");
assert.equal(V.choose("t.sort", "a", ["a", "b"]), "a");
V.set("t.sort", null);
assert.equal(V.get("t.sort", "x"), "x");

// sortBy: numbers high-to-low, missing last, stable ties; text A-Z.
const rows = [{ s: "B", v: 2 }, { s: "A", v: null }, { s: "C", v: 5 }, { s: "D", v: 2 }];
assert.deepEqual(V.sortBy(rows, (r) => r.v, false).map((r) => r.s), ["C", "B", "D", "A"]);
assert.deepEqual(V.sortBy(rows, (r) => r.v, true).map((r) => r.s), ["B", "D", "C", "A"]);
assert.deepEqual(V.sortBy(rows, (r) => r.s, true).map((r) => r.s), ["A", "B", "C", "D"]);

// Flip reverses the order but keeps missing values last.
V.set("rev:t", true);
assert.equal(V.reversed("t"), true);
assert.deepEqual(V.sortBy(rows, (r) => r.v, false, "t").map((r) => r.s), ["D", "B", "C", "A"]);
assert.deepEqual(V.applyDir([1, 2, 3], "t"), [3, 2, 1]);
const inPlace = [1, null, 2];
V.applyDir(inPlace, "t", (x) => x == null);
assert.deepEqual(inPlace, [2, 1, null]);
V.clearAll();
assert.equal(V.reversed("t"), false);

// Cards / Table switch defaults to cards.
assert.equal(V.viewMode("x"), "cards");
V.set("view:x", "table");
assert.equal(V.viewMode("x"), "table");
V.set("view:x", "chart");
assert.equal(V.viewMode("x"), "cards");
assert.equal(V.viewMode("x", [["chart", "Chart"]]), "chart");
assert.match(V.viewToggleHtml("x", [["chart", "Chart"]]), /data-view-mode="chart" aria-pressed="true"/);

// Cell parsing: money, percents, suffixes, dates, missing.
const cell = (text, attr) => ({ getAttribute: (k) => (k === "data-sort" ? (attr ?? null) : null), textContent: text, innerText: text });
const num = (t) => V.parseCell(cell(t)).v;
assert.equal(num("$1,234.50"), 1234.5);
assert.equal(num("−12.5%"), -12.5);
assert.equal(num("$4.2B"), 4.2e9);
assert.equal(num("850K"), 850000);
assert.equal(V.parseCell(cell("—")).kind, "missing");
assert.equal(V.parseCell(cell("n/a")).kind, "missing");
assert.equal(num("2026-10-21"), Date.UTC(2026, 9, 21));
assert.equal(num("Oct 21, 2026"), Date.UTC(2026, 9, 21));
assert.equal(V.parseCell(cell("Tech")).kind, "text");
assert.equal(V.parseCell(cell("anything", "42")).v, 42);

// Markup helpers carry the hooks the delegated handlers look for.
assert.match(V.sortMenuHtml("data-x-sort", [["a", "A"], ["b", "B"]], "b", "x", "Sort x"), /<select data-x-sort[\s\S]*value="b" selected[\s\S]*data-sort-flip="x"/);
assert.match(V.viewToggleHtml("x"), /data-view-toggle="x"[\s\S]*data-view-mode="table"/);
const t = V.tableHtml([{ label: "N", num: true, cell: (r) => String(r.n), sort: (r) => r.n }], [{ n: 3 }], { key: "k" });
assert.match(t, /data-ts-key="k"/);
assert.match(t, /data-sort="3"/);

console.log("views smoke passed");
