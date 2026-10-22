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
assert.equal(num("$89.66 build price"), 89.66);
assert.equal(num("12 mo"), 12);
assert.equal(num("2 trades"), 2);
assert.equal(num("3 months"), 3);
assert.equal(num("12.5M shares"), 12500000);
assert.equal(num("2 bps"), 2);
assert.equal(num("2trades"), 2);
assert.equal(num("12months"), 12);
assert.equal(V.parseCell(cell("—")).kind, "missing");
assert.equal(V.parseCell(cell("n/a")).kind, "missing");
assert.equal(num("2026-10-21"), Date.UTC(2026, 9, 21));
assert.equal(num("Oct 21, 2026"), Date.UTC(2026, 9, 21));
assert.equal(num("Jan 15 '27"), Date.UTC(2027, 0, 15));
assert.equal(num("Jan 15 ’28"), Date.UTC(2028, 0, 15));
assert.equal(V.parseCell(cell("Tech")).kind, "text");
assert.equal(V.parseCell(cell("anything", "42")).v, 42);

// Markup helpers carry the hooks the delegated handlers look for.
assert.match(V.sortMenuHtml("data-x-sort", [["a", "A"], ["b", "B"]], "b", "x", "Sort x"), /<select data-x-sort[\s\S]*value="b" selected[\s\S]*data-sort-flip="x"/);
assert.match(V.viewToggleHtml("x"), /data-view-toggle="x"[\s\S]*data-view-mode="table"/);
const t = V.tableHtml([{ label: "N", num: true, cell: (r) => String(r.n), sort: (r) => r.n }], [{ n: 3 }], { key: "k" });
assert.match(t, /data-ts-key="k"/);
assert.match(t, /data-sort="3"/);

win.localStorage.setItem('stonks-acc-view', JSON.stringify({ eqSplit: 'sector', cmpPreset: 'structure' }));
V.clearAll();
assert.equal(win.localStorage.getItem('stonks-acc-view'), null);

// The capture handler clears each pane's sorts before its own renderer runs,
// including tables currently unmounted by a Cards/Table switch.
const events = {};
const doc = {
  body: {}, getElementById: () => null, querySelectorAll: () => [],
  addEventListener(type, fn, capture) { (events[type] ||= []).push({ fn, capture }); },
};
const controls = viewsFactory({ ...win, requestAnimationFrame: fn => fn() }, doc);
controls.start();
const change = events.change.find(e => e.capture).fn;
const click = events.click.find(e => !e.capture).fn;
const panes = ['picks', 'open-picks', 'tickers', 'stocks', 'rotation', 'levetf', 'leaps', 'streaks', 'heatmap', 'compare'];
for (const pane of panes) {
  const key = 'tsort:' + pane + '|table';
  const other = 'tsort:unrelated|table';
  const header = { col: 1, dir: 'desc' };
  const scope = { id: 'page-pane-' + pane };
  controls.set(key, header);
  controls.set(other, header);
  change({ target: {
    matches: s => s === 'select',
    closest: s => s === '.sort-with-flip' ? {} : scope,
  } });
  assert.equal(controls.get(key, null), null, pane + ' menu clears header sort');
  assert.deepEqual(controls.get(other), header, pane + ' preserves other panes');
  controls.set(key, header);
  let rerendered = false;
  controls.onFlip(pane, () => {
    assert.equal(controls.get(key, null), null, 'clears before rendering');
    rerendered = true;
  });
  const flip = { getAttribute: () => pane, closest: () => scope };
  click({ target: { closest: s => s === '[data-sort-flip]' ? flip : null } });
  assert.equal(rerendered, true);
  assert.deepEqual(controls.get(other), header);
}

console.log("views smoke passed");
