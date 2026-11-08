import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  COMMODITY_GROUPS,
  COMMODITY_TRACKERS,
  buildCommoditiesPayload,
  commoditySeriesFromSweep,
  fetchCommodityWorldBank,
  parseHhdcPage3,
  parsePinkSheetMonthly,
  pinkSheetMonthlyUrl,
} from "./build.mjs";

const byKey = new Map(COMMODITY_TRACKERS.map((item) => [item.key, item]));

assert.equal(COMMODITY_TRACKERS.length, 16, "the commodity desk should expose sixteen trackers");
assert.deepEqual(
  COMMODITY_GROUPS.slice(0, 2),
  [{ key: "energy", label: "Energy" }, { key: "precious", label: "Precious metals" }],
  "energy and precious metals should be first-class display groups",
);
for (const [key, symbol] of [["crude", "CL=F"], ["natgas", "NG=F"], ["copper", "HG=F"]]) {
  assert.equal(byKey.get(key)?.symbol, symbol, `${key} should use the ${symbol} series the overnight sweep already fetches`);
}
assert.deepEqual(
  { symbol: byKey.get("gold")?.symbol, group: byKey.get("gold")?.group, kind: byKey.get("gold")?.kind },
  { symbol: "GC=F", group: "precious", kind: "futures" },
  "gold should use the COMEX futures series",
);
assert.deepEqual(
  { symbol: byKey.get("silver")?.symbol, group: byKey.get("silver")?.group, kind: byKey.get("silver")?.kind },
  { symbol: "SI=F", group: "precious", kind: "futures" },
  "silver should use the COMEX futures series",
);

const series = [
  { d: "2026-07-15", v: 100 },
  { d: "2026-08-14", v: 110 },
];
const payload = buildCommoditiesPayload({
  builtAtIso: "2026-08-16T12:00:00.000Z",
  fetched: {
    gold: { symbol: "GC=F", series },
    silver: { symbol: "SI=F", series },
  },
});

for (const key of ["gold", "silver"]) {
  const item = payload.items.find((candidate) => candidate.key === key);
  assert.ok(item, `${key} should be emitted into commodities.json`);
  assert.equal(item.stale, false, `${key} should be current after a successful fetch`);
  assert.equal(item.last, 110, `${key} should use the latest settle`);
  assert.equal(item.changes.find((change) => change.label === "30d")?.pct, 10, `${key} should include a 30-day move`);
  assert.ok(item.watch.length >= 3, `${key} should include linked equity handoffs`);
}

const yearBars = [{ t: "2025-08-14", c: 66 }, { t: "2026-02-13", c: 69 }, { t: "2026-08-14", c: 71.5 }];
const swept = commoditySeriesFromSweep(byKey.get("crude"), { "CL=F": { bars: yearBars } });
assert.deepEqual(swept, { symbol: "CL=F", series: [{ d: "2025-08-14", v: 66 }, { d: "2026-02-13", v: 69 }, { d: "2026-08-14", v: 71.5 }] }, "the overnight sweep's bars should be reused as the crude series");
assert.equal(commoditySeriesFromSweep(byKey.get("crude"), {}), null, "a symbol the sweep missed falls back to its own fetch");
assert.equal(
  commoditySeriesFromSweep(byKey.get("crude"), { "CL=F": { bars: [{ t: "2026-08-13", c: 70 }, { t: "2026-08-14", c: 71.5 }] } }),
  null,
  "a truncated sweep slice falls back to the card's own one-year fetch",
);

// A fetch that succeeds but returns an old reading is flagged aged, not
// current: the potash PPI series the card used to read ended Dec 2022 yet
// came back "fresh".
const aged = buildCommoditiesPayload({
  builtAtIso: "2026-11-06T21:12:42.187Z",
  fetched: {
    potash: { symbol: "WB-KCL", series: [{ d: "2022-11-01", v: 377 }, { d: "2022-12-01", v: 378 }] },
    "palm-oil": { symbol: "PPOILUSDM", series: [{ d: "2026-08-01", v: 1132 }, { d: "2026-09-01", v: 1133 }] },
    gold: { symbol: "GC=F", series: [{ d: "2026-10-20", v: 4000 }, { d: "2026-10-23", v: 4100 }] },
    silver: { symbol: "SI=F", series: [{ d: "2026-11-05", v: 52 }, { d: "2026-11-06", v: 52.5 }] },
  },
});
const agedItem = (key) => aged.items.find((item) => item.key === key);
assert.equal(agedItem("potash").aged, true, "a monthly series years behind is aged");
assert.match(agedItem("potash").agedWhy, /2022-12-01/);
assert.equal(agedItem("potash").stale, false, "aged is not the same as a failed fetch (last-good)");
assert.equal(agedItem("palm-oil").aged, undefined, "a two-month-old monthly print is current");
assert.equal(agedItem("gold").aged, true, "a daily series two weeks behind is aged");
assert.equal(agedItem("silver").aged, undefined);

// --- Potash from the World Bank Pink Sheet ----------------------------------
// A minimal .xlsx (zip of XML parts, deflated) so the parsers run offline.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
// rows: [[rowNum, { A: value, ... }]]; strings go to shared strings unless
// wrapped as { inline: "text" }, numbers stay numeric cells.
function xlsx(sheets) {
  const shared = [];
  const sheetXml = (rows) => "<worksheet><sheetData>" + rows.map(([rn, cells]) => {
    if (!cells) return `<row r="${rn}" spans="1:3"/>`;
    return `<row r="${rn}">` + Object.entries(cells).map(([col, v]) => {
      const ref = `${col}${rn}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (v && typeof v === "object") return `<c r="${ref}" t="inlineStr"><is><t>${v.inline}</t></is></c>`;
      shared.push(v);
      return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join("") + "</row>";
  }).join("") + "</sheetData></worksheet>";
  const parts = {};
  const names = Object.keys(sheets);
  names.forEach((name, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[name]); });
  parts["xl/workbook.xml"] = "<workbook><sheets>" + names.map((name, i) => `<sheet r:id="rId${i + 1}" sheetId="${i + 1}" name="${name.replace(/&/g, "&amp;")}"/>`).join("") + "</sheets></workbook>";
  parts["xl/_rels/workbook.xml.rels"] = "<Relationships>" + names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + "</Relationships>";
  parts["xl/sharedStrings.xml"] = "<sst>" + shared.map((t) => `<si><t xml:space="preserve">${t.replace(/&/g, "&amp;")}</t></si>`).join("") + "</sst>";
  return zip(parts);
}

const potashDef = byKey.get("potash");
assert.deepEqual(
  { kind: potashDef.kind, symbol: potashDef.symbol, column: potashDef.column, fmt: potashDef.fmt, cadence: potashDef.cadence },
  { kind: "worldbank", symbol: "WB-KCL", column: "Potassium chloride", fmt: "usd0", cadence: "monthly" },
  "potash reads the World Bank Pink Sheet's potassium chloride column",
);

const months = [];
for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 10) months.push(`${y}M${String(m).padStart(2, "0")}`);
const pinkRows = [
  [1, { A: "World Bank Commodity Price Data (The Pink Sheet)" }],
  [2, { A: "Monthly prices in nominal US dollars, 1960 to present" }],
  [3, null],
  [5, { B: "Crude oil, average", C: "Phosphate rock", D: { inline: "Potassium chloride **" }, E: "Urea " }],
  [6, { B: "($/bbl)", C: "($/mt)", D: "($/mt)", E: "($/mt)" }],
  ...months.map((label, i) => [7 + i, { A: label, B: 70 + i, C: 150, D: label === "2025M03" ? ".." : 300 + i * 2.5, E: 400 }]),
];
const pinkBuf = xlsx({ Description: [[1, { A: "About these data & notes" }]], "Monthly Prices": pinkRows });
const parsedPink = parsePinkSheetMonthly(pinkBuf, /^\s*potassium chloride\b/i);
assert.equal(parsedPink.name, "Potassium chloride **");
assert.equal(parsedPink.unit, "($/mt)");
assert.equal(parsedPink.series.length, months.length - 1, "an '..' month is skipped, not read as zero");
assert.deepEqual(parsedPink.series.at(-1), { d: "2026-10-01", v: 300 + (months.length - 1) * 2.5 });
assert.equal(parsedPink.series[0].d, "2024-01-01");
assert.ok(!parsedPink.series.some((p) => p.d === "2025-03-01"));
assert.throws(() => parsePinkSheetMonthly(pinkBuf, /^\s*unobtainium\b/i), /column/);
assert.throws(() => parsePinkSheetMonthly(xlsx({ Other: pinkRows }), /^\s*potassium chloride\b/i), /sheet/);

const landing = `<a href="https://thedocs.worldbank.org/en/doc/abc-0050012026/related/CMO-Historical-Data-Annual.xlsx">Annual</a>
  <a href="https://thedocs.worldbank.org/en/doc/abc-0050012026/related/CMO-Historical-Data-Monthly.xlsx">Monthly prices</a>`;
assert.equal(pinkSheetMonthlyUrl(landing), "https://thedocs.worldbank.org/en/doc/abc-0050012026/related/CMO-Historical-Data-Monthly.xlsx");
assert.equal(pinkSheetMonthlyUrl("<p>no links</p>"), null);

// The page is read at most once a day; the workbook only when its link changes.
const calls = [];
const fakeSource = (file) => async (url, opts = {}) => {
  calls.push({ url, binary: !!opts.binary, ua: opts.userAgent });
  if (/commodity-markets/.test(url)) return landing.replaceAll("abc", file);
  return opts.binary ? pinkBuf : null;
};
const first = await fetchCommodityWorldBank(potashDef, null, "2026-11-08", fakeSource("abc"));
assert.equal(first.series.at(-1).d, "2026-10-01");
assert.equal(first.symbol, "WB-KCL");
assert.equal(first.cache.checkedOn, "2026-11-08");
assert.ok(first.cache.series.length <= 40, "only the trailing months are cached");
assert.deepEqual(calls.map((c) => c.binary), [false, true], "first run reads the page, then downloads the workbook");
assert.ok(calls.every((c) => /^Mingstreet /.test(c.ua)), "World Bank requests name the site, not a browser");
calls.length = 0;
const sameDay = await fetchCommodityWorldBank(potashDef, first.cache, "2026-11-08", fakeSource("abc"));
assert.equal(calls.length, 0, "a second build the same day makes no request");
assert.deepEqual(sameDay.series, first.series);
const nextDay = await fetchCommodityWorldBank(potashDef, first.cache, "2026-11-09", fakeSource("abc"));
assert.deepEqual(calls.map((c) => c.binary), [false], "next day: page only, the link is unchanged");
assert.equal(nextDay.cache.checkedOn, "2026-11-09");
calls.length = 0;
await fetchCommodityWorldBank(potashDef, nextDay.cache, "2026-12-03", fakeSource("def"));
assert.deepEqual(calls.map((c) => c.binary), [false, true], "a new release link downloads the workbook again");
await assert.rejects(
  fetchCommodityWorldBank(potashDef, null, "2026-11-08", async () => "<p>maintenance</p>"),
  /link not found/,
);
const wrongUnit = xlsx({ "Monthly Prices": pinkRows.map(([rn, cells]) => [rn, rn === 6 ? { ...cells, D: "($/bbl)" } : cells]) });
await assert.rejects(
  fetchCommodityWorldBank(potashDef, null, "2026-11-08", async (url, o = {}) => (o.binary ? wrongUnit : landing)),
  /unexpected unit/,
  "a unit change ships nothing rather than a wrong number",
);

const potashNow = buildCommoditiesPayload({
  builtAtIso: "2026-11-08T15:00:00.000Z",
  fetched: { potash: { symbol: first.symbol, series: first.series } },
}).items.find((item) => item.key === "potash");
assert.equal(potashNow.aged, undefined, "an October print read in November is current");
assert.equal(potashNow.unit, "USD/metric ton (monthly)");
assert.equal(potashNow.changes[0].label, "m/m");
assert.ok(potashNow.compare.some((c) => c.key === "1y"), "two years of months fill the 1-year comparison");

// A failed first fetch never carries the old PPI index forward under the new unit.
const switched = buildCommoditiesPayload({
  builtAtIso: "2026-11-08T15:00:00.000Z",
  prior: { items: [{ key: "potash", symbol: "PCU212391212391P", last: 378, asOf: "2022-12-01", unit: "US PPI index (monthly)" }] },
}).items.find((item) => item.key === "potash");
assert.equal(switched.missing, true);
assert.equal(switched.last, undefined);
const carried = buildCommoditiesPayload({
  builtAtIso: "2026-11-08T15:00:00.000Z",
  prior: { items: [{ key: "potash", symbol: "WB-KCL", last: 357.5, asOf: "2026-10-01" }, { key: "lumber", symbol: "LBS=F", last: 600, asOf: "2026-11-06" }] },
}).items;
assert.equal(carried.find((item) => item.key === "potash").last, 357.5, "the same source carries forward as last-good");
assert.equal(carried.find((item) => item.key === "potash").stale, true);
assert.equal(carried.find((item) => item.key === "lumber").last, 600, "an alternate futures symbol still counts as the same source");

// The NY Fed parser shares the sheet reader.
const hhdc = parseHhdcPage3(xlsx({
  "Page 3 Data": [
    [3, { A: "Total Debt Balance and its Composition (Trillions of $)" }],
    [4, { B: "Mortgage", C: "HE Revolving", D: "Auto Loan", E: "Credit Card", F: "Student Loan", G: "Other", H: "Total" }],
    [5, { A: "25:Q4", B: 13.1, C: 0.41, D: 1.66, E: 1.23, F: 1.65, G: 0.56, H: 18.61 }],
    [6, { A: "26:Q1", B: 13.2, C: 0.42, D: 1.65, E: 1.18, F: 1.66, G: 0.55, H: 18.66 }],
  ],
}));
assert.deepEqual(hhdc.map((r) => r.q), ["2025Q4", "2026Q1"]);
assert.equal(hhdc[1].creditCard, 1.18);
assert.equal(hhdc[1].total, 18.66);

console.log("commodities smoke: ok");
