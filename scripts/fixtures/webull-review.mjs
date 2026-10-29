// Synthetic data for repeatable UI checks. Never used by the production app.
import { newTrade, updateQuantities, ledgerToTestTrades, ledgerToFillRows, fillRowsToCsv, orderAttemptsToCsv, recordOrderObservation } from '../../lib/webull-mirror.mjs';
import { pickTradeId } from '../../lib/pick-trade-text.mjs';

function executionFixture() {
  const ledger = { trades: {} }, open = [], closed = [];
  const entryDate = '2026-10-28T19:33:00Z', expiry = Date.UTC(2026, 11, 18) / 1000;
  const specs = [['MU', 980, 1130, 50.65, 51.75], ['TSM', 440, 480, 14.18, 14.36], ['WDC', 390, 470, 26.42, 26.42], ['ORCL', 145, 175, 9.67, 9.55]];
  for (const [symbol, long, short, model, actual] of specs) {
    const pick = { symbol, side: 'call', entryDate, contract: { structure: 'debit_vertical', netDebit: model, expiry,
      legs: [{ qty: 1, strike: long, type: 'call', expiry }, { qty: -1, strike: short, type: 'call', expiry }] } };
    const t = newTrade(pick, pickTradeId(pick)), manual = symbol !== 'ORCL';
    const attempt = (n, extra) => ({ phase: 'entry', n, quantity: 1, filledQty: 0, status: 'CANCELLED', sentIso: '2026-10-28T19:35:00Z',
      limit: model, filledPrice: null, referencePrice: model, quoteSource: 'Synthetic quote', ...extra });
    t.entryAttempts = [attempt(1, { cancelRequestedIso: '2026-10-28T19:37:00Z' }), attempt(2, manual ? {} : {
      policyStage: 'entry-4', allowancePct: 4, status: 'FILLED', filledQty: 1, filledPrice: actual, filledIso: '2026-10-28T19:39:34Z', feeActual: 0.12 })];
    if (manual) {
      t.entrySource = 'manual'; t.automaticEntryOutcome = 'missed'; t.automaticEntryAttemptCount = 2;
      t.entryAttempts.push(attempt(3, { source: 'manual', status: 'FILLED', filledQty: 1, filledPrice: actual, limit: actual, referencePrice: null,
        sentIso: '2026-10-29T13:30:01Z', filledIso: '2026-10-29T13:30:05Z', feeActual: 0.12, quoteSource: 'Unknown' }));
    }
    t.state = 'open';
    if (symbol === 'MU' || symbol === 'ORCL') {
      t.engineExitIso = '2026-10-29T19:30:00Z'; t.engineExitPrice = symbol === 'MU' ? 60 : 10;
      t.engineCloseReason = 'hit-tp-prem'; t.enginePnlPct = (t.engineExitPrice / model - 1) * 100;
      t.exitAttempts = [{ phase: 'exit', n: 1, policyStage: 'emergency-exit', emergency: true,
        quantity: 1, filledQty: symbol === 'ORCL' ? 1 : 0, status: symbol === 'ORCL' ? 'FILLED' : 'SUBMITTED',
        sentIso: '2026-10-29T19:50:00Z', limit: 0.01, referencePrice: t.engineExitPrice,
        filledPrice: symbol === 'ORCL' ? 9.35 : null, filledIso: symbol === 'ORCL' ? '2026-10-29T19:50:08Z' : null,
        bid: 9.3, ask: 9.8, quoteSource: 'Synthetic net quote', quoteObservedIso: '2026-10-29T19:50:00Z', feeActual: symbol === 'ORCL' ? 0.12 : null }];
      t.state = symbol === 'ORCL' ? 'closed' : 'exiting';
      closed.push({ ...pick, exitDate: t.engineExitIso, status: t.engineCloseReason, optionPnlPct: t.enginePnlPct });
    } else open.push(pick);
    recordOrderObservation(t.entryAttempts.at(-1), manual ? 'manual-broker-import' : 'broker-detail', manual ? '2026-10-29T13:31:00Z' : '2026-10-28T19:40:00Z');
    if (t.exitAttempts.length) recordOrderObservation(t.exitAttempts[0], 'broker-detail', '2026-10-29T19:51:00Z');
    updateQuantities(t); ledger.trades[t.tradeId] = t;
  }
  return { mirror: { enabled: true, lastRunIso: '2026-10-29T19:51:00Z', engineSnapshotIso: '2026-10-29T19:30:00Z',
    lastEndOfDayDeadlineIso: '2026-10-29T19:51:00Z', reconciliation: { status: 'matched', checkedAtIso: '2026-10-29T19:51:00Z', alerts: [] },
    trades: ledgerToTestTrades(ledger), rows: ledgerToFillRows(ledger) }, csv: fillRowsToCsv(ledgerToFillRows(ledger)), ordersCsv: orderAttemptsToCsv(ledger),
    accuracy: { builtAtIso: '2026-10-29T19:30:00Z', open, closed, baseline: { open: [], closed: [] } } };
}

export function webullReviewFixture(now = Date.now(), mode = 'standard') {
  if (mode === 'execution') return executionFixture();
  const trades = [], records = [], baseline = [];
  for (let i = 0; i < 36; i++) {
    const symbol = ['NVDA', 'AAPL', 'MSFT', 'AMD', 'META', 'TSLA'][i % 6];
    const side = i % 3 === 0 ? 'put' : 'call', credit = i % 4 === 0, single = !credit && i % 2 === 0;
    const engineEntryIso = new Date(now - (80 - i * 2) * 86400000).toISOString().slice(0, 10) + (i % 2 ? 'T19:30:00Z' : 'T15:00:00Z');
    const closeFillIso = new Date(Date.parse(engineEntryIso) + 5 * 86400000).toISOString();
    const paperPnlPct = [-35, 28, 42, -18, 15, 7, -52, 68, 12][i % 9];
    const enginePnlPct = paperPnlPct + [2, 6, -4, 9][i % 4];
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(engineEntryIso)).map(p => [p.type, p.value]));
    const tradeId = symbol + '-' + (side === 'put' ? 'P' : 'C') + '-' + parts.month + '/' + parts.day + '/' + parts.year.slice(-2) + '-' + parts.hour + ':' + parts.minute;
    trades.push({ tradeId, symbol, side, structure: credit ? 'credit_vertical' : single ? 'long' : 'debit_vertical', state: 'closed', engineEntryIso, closeFillIso,
      engineExitIso: closeFillIso, fillIso: engineEntryIso, entrySentIso: engineEntryIso,
      fillPrice: 4, engineEntryPrice: 4, closeFillPrice: 4 * (1 + (credit ? -1 : 1) * paperPnlPct / 100), engineExitPrice: 4 * (1 + (credit ? -1 : 1) * enginePnlPct / 100),
      paperPnlPct, enginePnlPct, entryDiffPct: [-1, 0, 1.5, 4, 7][i % 5], exitDiffPct: [-3, 1, -2, 5][i % 4], fees: 1.2,
      entryBid: 3.8, entryAsk: 4.2, exitBid: 4 * (1 + (credit ? -1 : 1) * paperPnlPct / 100) - .1, exitAsk: 4 * (1 + (credit ? -1 : 1) * paperPnlPct / 100) + .1,
      entryTries: 1, exitTries: 1, entryHow: i % 4 ? 'first' : 'reprice', engineCloseReason: paperPnlPct > 0 ? 'hit-tp-prem' : 'hit-cut-prem' });
    records.push({ tradeId, symbol, side, entryDate: engineEntryIso, exitDate: closeFillIso, entrySpot: 100, exitSpot: side === 'put' ? i % 4 ? 95 : 106 : i % 4 ? 108 : 94, contract: { pop: [.35, .5, .6, .75][i % 4] }, thesis: { aiGrade: ['A', 'B', 'C'][i % 3] }, label: ['High conviction', 'Actionable'][i % 2], sector: i % 3 ? 'Technology' : 'Consumer cyclical', entryRegime: i % 4 ? 'risk-on' : 'risk-off' });
    if (i % 3) baseline.push({ pairKey: symbol + ':' + side + ':' + engineEntryIso, exitDate: closeFillIso, optionPnlPct: 8 });
  }
  ['open', 'entering', 'exiting', 'missed', 'skipped', 'settlement-pending'].forEach((state, i) => trades.push({ tradeId: 'pending-' + i, symbol: 'NVDA', side: i % 2 ? 'put' : 'call', structure: 'long', state, engineEntryIso: new Date(now - 86400000).toISOString(), engineEntryPrice: 3, fillPrice: state === 'open' || state === 'exiting' ? 3 : null }));
  const result = { mirror: { enabled: true, lastRunIso: new Date(now).toISOString(), engineSnapshotIso: new Date(now).toISOString(), reconciliation: { status: 'ok', checkedAtIso: new Date(now).toISOString(), alerts: [], externalGroups: 2 }, goLiveIso: new Date(now - 90 * 86400000).toISOString(), trades }, accuracy: { builtAtIso: new Date(now).toISOString(), open: [], closed: records, baseline: { closed: baseline, open: [] } } };
  if (mode === 'edge') {
    trades[0].closeFillIso = null;
    Object.assign(trades[1], { requestedQty: 3, filledQty: 3, closedQty: 3, openQty: 0, fees: 3 });
    Object.assign(trades[2], { needsReview: true, note: 'Review <unsafe> broker response', requestedQty: 1, filledQty: 0, closedQty: 0, openQty: 0 });
    const archived = records.splice(3, 1)[0];
    archived.aiGrade = 'Archived A'; archived.thesis = null; archived.sector = 'constructor'; archived.archived = true;
    result.accuracy.archive = [archived];
    trades.push({ tradeId: 'partial-exit-review', symbol: 'NVDA', side: 'put', structure: 'long', state: 'error', requestedQty: 3, filledQty: 2, closedQty: 1, openQty: 1, needsReview: true, engineEntryIso: new Date(now - 86400000).toISOString(), fillPrice: 3, closeFillPrice: 4, paperPnlPct: 33 });
    result.mirror.engineSnapshotIso = new Date(now - 86400000).toISOString();
    result.mirror.reconciliation = { status: 'attention', checkedAtIso: new Date(now).toISOString(), alerts: ['NVDA: review <unsafe> holdings', 'Entry orders paused until broker quantities reconcile.'] };
  }
  if (mode === 'empty') { result.mirror.trades = []; result.accuracy.closed = []; }
  if (mode === 'open') { result.mirror.trades = trades.filter(t => t.state !== 'closed'); result.accuracy.closed = []; }
  return result;
}
