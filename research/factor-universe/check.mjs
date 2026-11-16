// Offline check of the extractor on a made-up company.
import assert from "node:assert/strict";
import { extract, firstFiled, dayNo } from "./extract.mjs";
const f = (start, end, val, filed, form = "10-Q") => ({ start, end, val, filed, form, fy: 2020, fp: "Q1" });
const i = (end, val, filed, form = "10-Q") => ({ end, val, filed, form });
const years = [2018, 2019, 2020, 2021];
const usd = (rows) => ({ units: { USD: rows } });
const gaap = {
  Revenues: usd(years.flatMap((y) => [f(`${y}-01-01`, `${y}-12-31`, 1000 + y, `${y + 1}-02-10`, "10-K"), f(`${y}-01-01`, `${y}-03-31`, 240, `${y}-05-01`), f(`${y}-01-01`, `${y}-06-30`, 490, `${y}-08-01`), f(`${y}-04-01`, `${y}-06-30`, 250, `${y}-08-01`), f(`${y}-01-01`, `${y}-09-30`, 740, `${y}-11-01`)])),
  // The new tag restates 2018 a year later; the earlier filing must win.
  RevenueFromContractWithCustomerExcludingAssessedTax: usd([f("2018-01-01", "2018-12-31", 3019, "2020-02-10", "10-K"), f("2018-01-01", "2018-12-31", 9999, "2019-02-10", "8-K"), f("2019-02-01", "2019-03-15", 5, "2019-05-01")]),
  NetIncomeLoss: usd(years.map((y) => f(`${y}-01-01`, `${y}-12-31`, 100, `${y + 1}-02-10`, "10-K"))),
  Assets: usd(years.flatMap((y) => ["03-31", "06-30", "09-30", "12-31"].map((d) => i(`${y}-${d}`, 5000, `${y}-${d}`.replace(/-\d\d$/, "-28"))))),
  WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: years.map((y) => f(`${y}-01-01`, `${y}-12-31`, 1e6, `${y + 1}-02-10`, "10-K")) } },
};
const out = extract({ facts: { "us-gaap": gaap, dei: { EntityCommonStockSharesOutstanding: { units: { shares: [i("2021-01-31", 1.1e6, "2021-02-10", "10-K")] } } } } });
assert.ok(out && out.rev && out.ni && out.assets && out.wsh && out.sh);
const fy18 = out.rev.find((r) => r[0] === dayNo("2018-01-01") && r[1] === dayNo("2018-12-31"));
assert.deepEqual(fy18, [dayNo("2018-01-01"), dayNo("2018-12-31"), dayNo("2019-02-10"), 3018], "the first filing of a period wins over a later restatement under a new tag, and other forms are ignored");
assert.equal(out.rev.filter((r) => r[1] - r[0] < 80).length, 0, "odd-length periods are dropped");
assert.equal(out.rev.length, years.length * 5);
assert.equal(out.assets.length, 16);
assert.deepEqual(out.sh, [[dayNo("2021-01-31"), dayNo("2021-02-10"), 1.1e6]]);
assert.equal(extract({ facts: { "us-gaap": { Assets: gaap.Assets } } }), null, "no yearly profits: not kept");
assert.equal(extract({ facts: { "ifrs-full": {} } }), null, "no US GAAP facts: not kept");
assert.equal(firstFiled(gaap, ["Assets"], "USD", true).length, 0);
console.log("factor-universe extract check: ok");
// Earnings per share rides along in dollars a share.
{
  const { extract: ex, whyDropped } = await import("./extract.mjs");
  const g2 = { ...gaap, EarningsPerShareDiluted: { units: { "USD/shares": years.map((y) => f(`${y}-01-01`, `${y}-12-31`, 1.25, `${y + 1}-02-10`, "10-K")) } } };
  const o2 = ex({ facts: { "us-gaap": g2 } });
  assert.equal(o2.eps.length, years.length);
  assert.equal(o2.eps[0][3], 1.25);
  assert.match(whyDropped({ facts: { "us-gaap": { Assets: gaap.Assets } } }), /assets 16, profit rows 0/);
  assert.match(whyDropped({ facts: { "ifrs-full": {} } }), /no US GAAP facts/);
  console.log("factor-universe eps check: ok");
}
// An earlier registrant's rows are merged in, and the earliest filing still wins.
{
  const { extract: ex, mergeFacts } = await import("./extract.mjs");
  const newer = { facts: { "us-gaap": { Revenues: usd([f("2020-01-01", "2020-12-31", 3020, "2021-02-10", "10-K"), f("2019-01-01", "2019-12-31", 2999, "2021-02-10", "10-K")]) } } };
  const older = { facts: { "us-gaap": gaap } };
  const o3 = ex(mergeFacts(newer, older));
  assert.ok(o3 && o3.assets.length === 16, "the earlier registrant's balance sheets are there");
  const fy19 = o3.rev.find((r) => r[0] === dayNo("2019-01-01") && r[1] === dayNo("2019-12-31"));
  assert.equal(fy19[3], 3019, "the earlier registrant's own filing of 2019 wins over the later comparative");
  // Basic share counts and per-share figures are preferred when both are filed the same day.
  const g4 = { ...gaap, WeightedAverageNumberOfSharesOutstandingBasic: { units: { shares: years.map((y) => f(`${y}-01-01`, `${y}-12-31`, 9e5, `${y + 1}-02-10`, "10-K")) } } };
  assert.equal(ex({ facts: { "us-gaap": g4 } }).wsh[0][3], 9e5);
  console.log("factor-universe predecessor check: ok");
}
