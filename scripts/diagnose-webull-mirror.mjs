// Read-only operational check. No lease acquisition, checkpoint, or broker calls.
// Run with the existing R2 credentials: node --env-file=r2.env scripts/diagnose-webull-mirror.mjs
// Output deliberately contains only status, timestamps and counts, never
// credentials, account IDs, positions, trade IDs, lock owner tokens or ETags.
import { pathToFileURL } from "node:url";
import { describeObjectLease } from "../lib/object-lease.mjs";
import { pickTradeId } from "../lib/pick-trade-text.mjs";

export async function diagnoseMirrorStore(store, nowMs = Date.now()) {
  if (store.backend !== "r2" || !store.hasToken()) throw new Error("Complete R2 configuration is required for mirror diagnostics.");
  const readJson = async (key, raw = false) => {
    const buf = await (raw ? store.rawGet(key) : store.get(key));
    if (buf == null) return { present: false, value: null };
    try { return { present: true, value: JSON.parse(buf.toString("utf8")) }; }
    catch { return { present: true, value: null, invalid: true }; }
  };
  const [lock, saved, published] = await Promise.all([
    readJson("_stonks/leases/webull-paper.json", true),
    readJson("webull-paper-ledger.json"), readJson("picks-accuracy.json"),
  ]);
  const ledger = saved.value, acc = published.value;
  const goLive = Date.parse(ledger?.goLiveIso);
  const current = Array.isArray(acc?.open) && Number.isFinite(goLive)
    ? acc.open.filter((e) => e.contract && Date.parse(e.entryDate) >= goLive) : null;
  return {
    readOnly: true,
    checkedAtIso: new Date(nowMs).toISOString(),
    executionLock: describeObjectLease(lock.present ? { value: lock.value } : null, nowMs),
    ledger: { available: !!ledger && !saved.invalid, lastRunIso: ledger?.lastRunIso ?? null,
      engineSnapshotIso: ledger?.engineSnapshotIso ?? null,
      reconciliationStatus: ledger?.reconciliation?.status ?? null,
      alertCount: Array.isArray(ledger?.reconciliation?.alerts) ? ledger.reconciliation.alerts.length : null },
    engine: { available: !!acc && !published.invalid, builtAtIso: acc?.builtAtIso ?? null,
      untrackedEligibleOpenCount: current ? current.filter((e) => !ledger.trades?.[pickTradeId(e)]).length : null },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { store } = await import("../lib/datastore.mjs");
    console.log(JSON.stringify(await diagnoseMirrorStore(store), null, 2));
  } catch {
    console.error("Read-only mirror diagnostics failed. Check R2 configuration and read access; no broker action was attempted.");
    process.exitCode = 1;
  }
}
