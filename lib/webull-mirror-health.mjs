// Saved-state diagnostics only. No broker, quote, store writes, or order actions.
// Use the raw Open Picks record and execution ledger, never reporting projections.
import { etClock, sessionForDate, previousTradingDate } from "./us-equity-calendar.mjs";
import { endOfDayWindow } from "./webull-execution-policy.mjs";
import { pickTradeId } from "./pick-trade-text.mjs";

const FINAL = new Set(["FILLED", "CANCELLED", "FAILED", "REJECTED", "EXPIRED"]);
const validMs = value => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const quantity = value => value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const attempts = t => [...(t.entryAttempts || []), ...(t.exitAttempts || [])];
function exposure(t) {
  const filled = quantity(t.filledQty) ?? (t.entryAttempts || []).reduce((n, a) => n + (quantity(a.filledQty) ?? (a.status === "FILLED" ? quantity(a.quantity) ?? 1 : 0)), 0);
  const closed = quantity(t.closedQty) ?? (t.exitAttempts || []).reduce((n, a) => n + (quantity(a.filledQty) ?? (a.status === "FILLED" ? quantity(a.quantity) ?? 1 : 0)), 0);
  return { filled, open: quantity(t.openQty) ?? filled - closed - (quantity(t.settledQty) ?? 0) };
}

// A 20-minute allowance covers build/publication latency. It is not a trading
// permission. Before the first daily decision, the previous session still counts.
export function expectedOpenPicksPublication(nowMs) {
  const clock = etClock(nowMs - 20 * 60000), session = sessionForDate(clock.date);
  if (!session) return null;
  const slots = [660, 930].filter(minute => minute < session.closeMinute && minute <= clock.minute);
  if (session.open && slots.length) return { date: clock.date, minute: slots.at(-1) };
  const date = previousTradingDate(clock.date), previous = date && sessionForDate(date);
  return previous ? { date, minute: [660, 930].filter(minute => minute < previous.closeMinute).at(-1) } : null;
}

function lastCompletedSession(nowMs) {
  const clock = etClock(nowMs - 5 * 60000), session = sessionForDate(clock.date);
  if (!session) return null;
  return session.open && clock.minute >= session.closeMinute ? clock.date : previousTradingDate(clock.date);
}

export function mirrorHealth({ acc, ledger, executionLock = null, enabled = null }, nowMs = Date.now()) {
  const issues = [];
  const issue = (code, message) => issues.push({ code, message });
  const engineAvailable = !!acc && Array.isArray(acc.open) && Array.isArray(acc.closed);
  const ledgerAvailable = !!ledger && !!ledger.trades && typeof ledger.trades === "object" && !Array.isArray(ledger.trades);
  const built = validMs(acc?.builtAtIso), goLive = validMs(ledger?.goLiveIso);
  const expectedPublication = expectedOpenPicksPublication(nowMs), completedSession = lastCompletedSession(nowMs);
  if (enabled === false) issue("MIRROR_DISABLED", "The Webull mirror is disabled in the deployment configuration.");
  if (!engineAvailable) issue("OPEN_PICKS_UNAVAILABLE", "The Open Picks record is missing or malformed.");
  if (!ledgerAvailable || goLive == null) issue("MIRROR_LEDGER_UNAVAILABLE", "The execution ledger or its go-live date is unavailable.");
  if (!expectedPublication || !completedSession) issue("CALENDAR_UNAVAILABLE", "The exchange calendar cannot verify the required decision and closing windows.");
  if (built == null || built > nowMs) issue("OPEN_PICKS_TIMESTAMP_INVALID", "The Open Picks publication time is missing, invalid, or in the future.");
  else if (expectedPublication) {
    const at = etClock(built);
    if (at.date < expectedPublication.date || at.date === expectedPublication.date && at.minute < expectedPublication.minute)
      issue("OPEN_PICKS_STALE", "Open Picks has not reached the latest expected decision window.");
  }
  const source = engineAvailable ? acc.open.filter(e => e?.symbol && e.entryDate && e.contract) : [];
  const indexed = new Map(ledgerAvailable ? Object.entries(ledger.trades).map(([id, t]) => [t.tradeId || id, t]) : []);
  const counts = { openPicks: source.length, mirroredOpenPicks: 0, untrackedEligibleOpenPicks: 0,
    missedOpenPicks: 0, pendingOpenPicks: 0, preGoLiveOpenPicks: 0, signaledExitsOpen: 0,
    unconfirmedOrders: 0, workingOrders: 0, tradesNeedingReview: 0 };
  if (ledgerAvailable && goLive != null) for (const e of source) {
    const t = indexed.get(e.tradeId) || indexed.get(pickTradeId(e));
    if (t && exposure(t).open > 0) counts.mirroredOpenPicks++;
    else if ((validMs(e.entryDate) ?? Infinity) < goLive) counts.preGoLiveOpenPicks++;
    else if (!t) counts.untrackedEligibleOpenPicks++;
    else if (["missed", "skipped", "settled", "closed"].includes(t.state)) counts.missedOpenPicks++;
    else counts.pendingOpenPicks++;
  }
  if (counts.untrackedEligibleOpenPicks) issue("OPEN_PICKS_UNTRACKED", "Eligible Open Picks have no mirror record.");
  if (counts.missedOpenPicks) issue("OPEN_PICKS_UNFILLED", "Open Picks contain missed or ended mirror entries. A later session cannot automatically catch up.");
  if (counts.preGoLiveOpenPicks) issue("OPEN_PICKS_PRE_GO_LIVE", "Open Picks predate the mirror go-live cutoff. Any existing holding needs verified adoption before automated exits can manage it.");
  const closedIds = new Set(engineAvailable ? [...acc.closed, ...(Array.isArray(acc.archive) ? acc.archive : [])].flatMap(e => [e?.tradeId, pickTradeId(e)].filter(Boolean)) : []);
  for (const [id, t] of ledgerAvailable ? Object.entries(ledger.trades) : []) {
    if (exposure(t).open > 0 && (closedIds.has(t.tradeId || id) || t.engineExitIso || t.mirrorCloseReason)) counts.signaledExitsOpen++;
    if (t.needsReview) counts.tradesNeedingReview++;
    for (const a of attempts(t)) {
      if (!FINAL.has(a.status)) counts.workingOrders++;
      if (a.lookupFailed || ["UNKNOWN", "PREPARED"].includes(a.status)) counts.unconfirmedOrders++;
    }
  }
  if (counts.signaledExitsOpen) issue("SIGNALED_EXIT_PENDING", "A close signal still has confirmed broker exposure in the saved ledger.");
  if (counts.unconfirmedOrders) issue("ORDER_OUTCOME_UNCONFIRMED", "Saved order outcomes need broker verification before new entries.");
  if (counts.tradesNeedingReview) issue("TRADE_REVIEW_REQUIRED", "The execution ledger contains trades marked for review.");
  const reconciliation = ledger?.reconciliation;
  if (!reconciliation || reconciliation.status !== "matched" || reconciliation.alerts?.length)
    issue("RECONCILIATION_NOT_MATCHED", "The saved holdings reconciliation is missing or needs attention.");
  const reconciled = validMs(reconciliation?.checkedAtIso);
  if (reconciled == null || reconciled > nowMs || built != null && reconciled < built)
    issue("RECONCILIATION_STALE", "The saved holdings check has not verified the current Open Picks publication.");
  if (built != null && (validMs(ledger?.engineSnapshotIso) ?? -Infinity) < built)
    issue("MIRROR_BEHIND_OPEN_PICKS", "The mirror has not processed the latest Open Picks publication.");
  const observed = validMs(ledger?.lastEndOfDayDeadlineIso);
  const deadlineObserved = observed != null && observed <= nowMs && endOfDayWindow(observed).due &&
    completedSession != null && etClock(observed).date >= completedSession;
  if (completedSession && !deadlineObserved)
    issue("CLOSING_DEADLINE_MISSED", "No completed mirror check is recorded in the last ten minutes of the latest completed exchange session.");
  if (["invalid", "unsupported", "unavailable"].includes(executionLock?.state))
    issue("EXECUTION_LOCK_UNVERIFIED", "The execution lock is invalid, unsupported, or unavailable.");
  return { readOnly: true, source: "Open Picks: picks-accuracy.json", checkedAtIso: new Date(nowMs).toISOString(),
    status: issues.length ? "attention" : counts.workingOrders || counts.pendingOpenPicks ? "pending" : "saved-checks-current",
    brokerVerified: false, expectedPublication, latestCompletedSession: completedSession,
    openPicksBuiltAtIso: acc?.builtAtIso ?? null, mirrorSnapshotIso: ledger?.engineSnapshotIso ?? null,
    lastRunIso: ledger?.lastRunIso ?? null, deadlineObserved, counts, issues,
    limitations: ["This reads saved state only. It does not contact Webull or verify current holdings, orders, fills, credentials, or quote freshness.",
      "Pre-go-live Open Picks require separate verified adoption before the mirror can manage them.",
      "Current saved checks and passing offline tests do not guarantee future fills or scheduler punctuality."] };
}
