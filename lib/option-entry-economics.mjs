import { bsPrice, expiryCloseEpochSec } from './greeks.mjs';

export const OPTION_ENTRY_POLICY_VERSION = '2026-10-23-reviewed-entry-v3';
export const OPTION_ENTRY_HORIZON_DAYS = 14;
const DAY_MS = 86400000;
const finite = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = value => Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;

// A feasibility screen, not an expected-return forecast. Future liquidation
// uses theoretical values less today's half bid/ask widths. IV stresses carry
// no probabilities. Fees are explicit/configurable; zero means not estimated.
export function assessOptionEntryEconomics({ side, spot, contract, plan, nowMs = Date.now(), rate = .045,
  horizonDays = OPTION_ENTRY_HORIZON_DAYS, takeProfitPct = 25, stopPct = 50, feePerLeg = 0,
  minDebitRewardRisk = 0, minCreditFraction = 0 } = {}) {
  const result = { version: OPTION_ENTRY_POLICY_VERSION, eligible: false, reason: 'unavailable',
    horizonDays, takeProfitPct, stopPct, model: 'European Black-Scholes, zero dividends',
    costBasis: 'cross current quotes; future close uses current half-spreads',
    feePerLeg, feesEstimated: feePerLeg > 0, scenarios: [] };
  const fail = reason => ({ ...result, reason });
  const entrySpot = finite(spot), target = finite(plan?.target), stop = finite(plan?.invalidation);
  const direction = side === 'call' ? 1 : side === 'put' ? -1 : 0;
  if (!direction || !(entrySpot > 0) || !(target > 0) || !(stop > 0)
    || (target - entrySpot) * direction <= 0 || (stop - entrySpot) * direction >= 0) return fail('invalid-stock-plan');
  if (![horizonDays, nowMs, rate, feePerLeg, takeProfitPct, stopPct, minDebitRewardRisk, minCreditFraction].every(Number.isFinite)
    || !(horizonDays > 0) || feePerLeg < 0 || !(takeProfitPct > 0) || !(stopPct > 0 && stopPct <= 100)
    || minDebitRewardRisk < 0 || minCreditFraction < 0) return fail('invalid-assumptions');
  if (!contract || !['long', 'debit_vertical', 'credit_vertical'].includes(contract.structure || 'long')) return fail('invalid-structure');
  const credit = contract?.structure === 'credit_vertical';
  const vertical = credit || contract?.structure === 'debit_vertical';
  const sourceLegs = vertical ? contract?.legs : [{ ...contract, type: side, qty: 1 }];
  if (!Array.isArray(sourceLegs) || sourceLegs.length !== (vertical ? 2 : 1)) return fail('missing-legs');
  const legs = [];
  let signedEntry = 0, closeFriction = 0;
  const horizonMs = nowMs + horizonDays * DAY_MS;
  for (const leg of sourceLegs) {
    const bid = finite(leg.bid), ask = finite(leg.ask), strike = finite(leg.strike), iv = finite(leg.iv);
    const expiry = finite(leg.expiry ?? contract?.expiry), qty = finite(leg.qty);
    if (!(bid > 0) || !(ask >= bid) || !(strike > 0) || !(iv > 0)
      || !['call', 'put'].includes(leg.type) || ![1, -1].includes(qty) || !(expiry > 0)) return fail('missing-quotes');
    const expiresMs = expiryCloseEpochSec(expiry) * 1000;
    if (!Number.isFinite(expiresMs) || expiresMs <= horizonMs) return fail('insufficient-runway');
    signedEntry += qty > 0 ? ask : -bid;
    closeFriction += (ask - bid) / 2;
    legs.push({ type: leg.type, strike, iv, qty, years: (expiresMs - horizonMs) / (365 * DAY_MS) });
  }
  const fees = legs.length * feePerLeg / 100;
  if (vertical && (legs[0].qty + legs[1].qty !== 0 || legs[0].type !== legs[1].type
    || legs[0].strike === legs[1].strike || legs[0].years !== legs[1].years)) return fail('invalid-vertical');
  if (vertical) {
    const long = legs.find(leg => leg.qty === 1), short = legs.find(leg => leg.qty === -1);
    const expectedType = credit ? side === 'call' ? 'put' : 'call' : side;
    const ordered = expectedType === 'call' ? long.strike < short.strike : long.strike > short.strike;
    if (long.type !== expectedType || ordered === credit) return fail('invalid-vertical-direction');
    if (credit && (side === 'call' ? short.strike >= entrySpot : short.strike <= entrySpot)) return fail('credit-defense-already-breached');
  }
  const entryBasis = credit ? -signedEntry - fees : signedEntry + fees;
  if (!(entryBasis > 0)) return fail('nonpositive-entry-value');
  const width = vertical ? Math.abs(legs[0].strike - legs[1].strike) : null;
  if (vertical && !(entryBasis < width)) return fail('unexecutable-spread');
  result.entryPrice = round(entryBasis);
  result.closeFriction = round(closeFriction + fees);
  const maximumLoss = (credit ? width - entryBasis : entryBasis) + fees;
  const maximumProfit = vertical ? (credit ? entryBasis : width - entryBasis) - fees : null;
  result.maximumLoss = round(maximumLoss);
  result.maximumProfit = vertical ? round(maximumProfit) : null;
  result.referenceMid = round(credit ? sourceLegs.reduce((sum, leg) => sum - leg.qty * (Number(leg.bid) + Number(leg.ask)) / 2, 0)
    : sourceLegs.reduce((sum, leg) => sum + leg.qty * (Number(leg.bid) + Number(leg.ask)) / 2, 0));
  result.quoteBasedExits = {
    takeProfitClosePrice: round(credit ? entryBasis * (1 - takeProfitPct / 100) - fees : entryBasis * (1 + takeProfitPct / 100) + fees),
    stopClosePrice: round(credit ? entryBasis * (1 + stopPct / 100) - fees : entryBasis * (1 - stopPct / 100) + fees),
    action: credit ? 'buy-back' : 'sell',
  };
  result.stockPlan = { entry: entrySpot, target, invalidation: stop };
  if (vertical && !credit && maximumProfit / maximumLoss < minDebitRewardRisk) return fail('debit-payoff-below-minimum-after-costs');
  if (credit && entryBasis / width < minCreditFraction) return fail('credit-too-small-after-costs');
  let flatTargetReturn = null;
  const serializeMark = mark => mark && ({ pnlPerShare: round(mark.pnlPerShare), returnPct: round(mark.returnPct) });
  for (const [label, multiplier] of [['iv-down', .8], ['iv-flat', 1], ['iv-up', 1.2]]) {
    const mark = stock => {
      let value = 0;
      for (const leg of legs) {
        const price = bsPrice(leg.type, stock, leg.strike, leg.years, leg.iv * multiplier, rate);
        if (!Number.isFinite(price)) return null;
        value += leg.qty * price;
      }
      // Different leg IVs can imply an impossible vertical surface. Clipping a
      // value above the width into the max payout fabricated profitable Buys.
      if (vertical && (credit ? value < -width - 1e-7 || value > 1e-7 : value < -1e-7 || value > width + 1e-7)) return null;
      if (vertical) value = credit ? Math.max(-width, Math.min(0, value)) : Math.max(0, Math.min(width, value));
      // Signed proceeds: a credit close is a negative cash flow.
      const liquidation = credit ? Math.max(-width, value - closeFriction) - fees : Math.max(0, value - closeFriction) - fees;
      const pnl = credit ? entryBasis + liquidation : liquidation - entryBasis;
      return { pnlPerShare: pnl, returnPct: pnl / entryBasis * 100 };
    };
    const atTarget = mark(target), atInvalidation = mark(stop);
    if (label === 'iv-flat') flatTargetReturn = atTarget?.returnPct ?? null;
    result.scenarios.push({ label, ivMultiplier: multiplier, atTarget: serializeMark(atTarget), atInvalidation: serializeMark(atInvalidation),
      ...(!atTarget || !atInvalidation ? { reason: 'inconsistent-spread-model' } : {}) });
  }
  const flat = result.scenarios.find(row => row.label === 'iv-flat');
  if (!flat.atTarget || !flat.atInvalidation) return fail('inconsistent-spread-model');
  result.eligible = flatTargetReturn >= takeProfitPct;
  result.reason = result.eligible ? 'target-supports-profit-exit' : flatTargetReturn <= 0 ? 'target-unprofitable' : 'target-below-profit-exit';
  return result;
}
