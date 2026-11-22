// Smoke test for gamma squeeze rule 1 (lib/gamma-squeeze.mjs): a near-the-money
// call strike counts only when it stands out against its neighbors in the
// same expiration, not against the average of the whole +/-60% band.
// Run: node scripts/gamma-squeeze-smoke.mjs
import assert from 'node:assert/strict';
import { oiWall, concentratedNearMoneyCall, CONCENTRATED_RATIO, NEIGHBOR_STRIKES } from '../lib/gamma-squeeze.mjs';

const EXP1 = 1_800_000_000, EXP2 = EXP1 + 7 * 86400;
const chain = (exp, rows) => rows.map(([strike, oi]) => ({ side: 'call', strike, oi, expSec: exp }));
const spot = 100;

// An even ladder near the money with nearly empty far strikes: the old rule
// (1.5x the band-wide average) fired here; nothing stands out locally.
{
  const near = [];
  for (let k = 90; k <= 115; k += 1) near.push([k, 1500]);
  const far = [];
  for (let k = 40; k < 90; k += 2.5) far.push([k, 20]);
  for (let k = 117.5; k <= 160; k += 2.5) far.push([k, 20]);
  const calls = chain(EXP1, [...far, ...near]);
  const bandAvg = calls.reduce((s, c) => s + c.oi, 0) / calls.length;
  assert(1500 >= CONCENTRATED_RATIO * bandAvg, 'the old band-wide test would have fired');
  assert.equal(concentratedNearMoneyCall(calls, spot), null, 'an even ladder has no strike that stands out');
}

// One strike at five times its neighbors: found, with the ratio.
{
  const rows = [];
  for (let k = 95; k <= 115; k += 1) rows.push([k, k === 105 ? 5000 : 1000]);
  const hit = concentratedNearMoneyCall(chain(EXP1, rows), spot);
  assert(hit && hit.contract.strike === 105, 'the $105 wall stands out');
  assert.equal(hit.neighborAvg, 1000);
  assert.equal(hit.ratio, 5);
  assert(Math.abs(hit.otm - 0.05) < 1e-9);
}

// The heaviest qualifying strike across both expirations is named.
{
  const a = chain(EXP1, [[100, 800], [101, 800], [102, 3000], [103, 800], [104, 800]]);
  const b = chain(EXP2, [[104, 900], [105, 900], [106, 6000], [107, 900], [108, 900]]);
  const hit = concentratedNearMoneyCall([...a, ...b], spot);
  assert.equal(hit.contract.strike, 106);
  assert.equal(hit.contract.expSec, EXP2, 'neighbors come from the same expiration');
}

// Each expiration is compared with itself: a big strike in one expiration
// does not make the same strike in the other stand out.
{
  const a = chain(EXP1, [[103, 1200], [104, 1200], [105, 1200], [106, 1200], [107, 1200]]);
  const b = chain(EXP2, [[103, 100], [104, 100], [105, 9000], [106, 100], [107, 100]]);
  const hit = concentratedNearMoneyCall([...a, ...b], spot);
  assert.equal(hit.contract.expSec, EXP2);
  assert.equal(concentratedNearMoneyCall(a, spot), null);
}

// Floors and bands.
{
  const small = chain(EXP1, [[103, 100], [104, 100], [105, 900], [106, 100], [107, 100]]);
  assert.equal(concentratedNearMoneyCall(small, spot), null, 'under 1,000 contracts never counts');
  const far = chain(EXP1, [[113, 100], [114, 100], [115, 9000], [116, 100], [117, 100]]);
  assert.equal(concentratedNearMoneyCall(far, spot), null, '15% out of the money is outside the band');
  const itm = chain(EXP1, [[93, 100], [94, 100], [95, 9000], [96, 100], [97, 100]]);
  assert.equal(concentratedNearMoneyCall(itm, spot), null, 'in-the-money calls are not overhead');
  const lonely = chain(EXP1, [[104, 100], [105, 9000]]);
  assert.equal(concentratedNearMoneyCall(lonely, spot), null, 'one neighbor is too few to compare');
  const empty = chain(EXP1, [[103, 0], [104, 0], [105, 2000], [106, 0], [107, 0]]);
  assert.equal(concentratedNearMoneyCall(empty, spot).contract.strike, 105, 'neighbors with no open interest: the floor alone decides');
  assert.equal(concentratedNearMoneyCall([], spot), null);
  assert.equal(concentratedNearMoneyCall(null, spot), null);
}

// Only up to NEIGHBOR_STRIKES strikes on each side are compared.
{
  const rows = [];
  for (let k = 95; k <= 115; k += 1) rows.push([k, k === 105 ? 2000 : k >= 100 && k <= 110 ? 1000 : 50000]);
  assert.equal(NEIGHBOR_STRIKES, 4);
  const hit = concentratedNearMoneyCall(chain(EXP1, rows), spot);
  assert(hit && hit.contract.strike === 105 && hit.neighborAvg === 1000, 'strikes beyond the window do not enter the average');
}

// Puts are ignored.
{
  const puts = [[103, 100], [104, 100], [105, 9000], [106, 100], [107, 100]].map(([strike, oi]) => ({ side: 'put', strike, oi, expSec: EXP1 }));
  assert.equal(concentratedNearMoneyCall(puts, spot), null);
}

// OI walls sit on the right side of the price.
{
  const rows = [
    { side: 'call', strike: 240, oi: 90000 }, { side: 'call', strike: 260, oi: 500 },
    { side: 'call', strike: 275, oi: 4000 }, { side: 'call', strike: 300, oi: 4000 },
    { side: 'put', strike: 300, oi: 80000 }, { side: 'put', strike: 250, oi: 7000 }, { side: 'put', strike: 230, oi: 2000 },
  ];
  assert.equal(oiWall(rows, 'call', 255).strike, 275, 'call wall: biggest OI at or above the price, nearer strike wins a tie');
  assert.equal(oiWall(rows, 'put', 255).strike, 250, 'put wall: biggest OI at or below the price');
  assert.equal(oiWall(rows, 'call', 400), null, 'no call strike above the price -> no wall');
  assert.equal(oiWall(rows, 'put', 0), null, 'no price -> no wall');
  // 2026-11-22: a wall sits within 10% of the price.
  const spy = [{ side: 'put', strike: 600, oi: 90000 }, { side: 'put', strike: 680, oi: 30000 }, { side: 'call', strike: 800, oi: 90000 }, { side: 'call', strike: 700, oi: 20000 }];
  assert.equal(oiWall(spy, 'put', 690).strike, 680, 'a far-away strike is not the put wall');
  assert.equal(oiWall(spy, 'call', 690).strike, 700, 'a far-away strike is not the call wall');
  assert.equal(oiWall([{ side: 'put', strike: 600, oi: 9 }], 'put', 690), null, 'nothing inside the band -> no wall');
}

console.log('gamma-squeeze smoke: ok');
