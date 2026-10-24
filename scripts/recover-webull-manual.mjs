// Default: read-only plan. --apply checkpoints the verified adoption under the
// account-wide lease; it NEVER submits, previews or cancels a broker order.
// Private JSON config: { manualClientOrderId, externalClientOrderIds: [] }.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { prepareManualRecovery } from "../lib/webull-manual-recovery.mjs";

export async function recoverManualSpread({ store, client, accountId, config, apply = false, now = () => new Date().toISOString() }) {
  if (store.backend !== "r2" || !accountId || typeof config?.manualClientOrderId !== "string" || !config.manualClientOrderId ||
      !Array.isArray(config.externalClientOrderIds) || config.externalClientOrderIds.some(id => typeof id !== "string" || !id)) throw new Error("complete R2/account configuration and explicit broker order IDs are required");
  const inspect = async (guard = () => {}) => {
    guard();
    const [ledgerBuf, accBuf, accounts, positions, open] = await Promise.all([
      store.get("webull-paper-ledger.json"), store.get("picks-accuracy.json"), client.accountList(), client.positions(accountId), client.openOrders(accountId),
    ]);
    const listed = Array.isArray(accounts) ? accounts : accounts?.accounts ?? accounts?.data;
    if (!Array.isArray(listed) || !listed.some(a => String(a.account_id) === accountId)) throw new Error("configured paper account is not available to this broker key");
    const openRows = Array.isArray(open) ? open : open?.data;
    if (!Array.isArray(openRows) || openRows.length || open?.pagination_key) throw new Error("open or incomplete broker order book requires review before adoption");
    if (!ledgerBuf || !accBuf) throw new Error("saved ledger and published record are required");
    const ledger = JSON.parse(String(ledgerBuf)), acc = JSON.parse(String(accBuf));
    if (ledger.accountId !== accountId) throw new Error("ledger account mismatch");
    const heldIds = Object.values(ledger.trades || {}).filter(t => t.openQty > 0 && t.entrySource !== "manual")
      .flatMap(t => t.entryAttempts.map(a => a.clientOrderId));
    const ids = [...new Set([config.manualClientOrderId, ...config.externalClientOrderIds, ...heldIds])];
    const orders = new Map();
    for (const id of ids) { guard(); orders.set(id, await client.orderDetail(accountId, id)); }
    const checkedAtIso = now();
    const plan = prepareManualRecovery({ ledger, acc, positions, accountId, checkedAtIso,
      manualOrder: orders.get(config.manualClientOrderId), externalOrders: config.externalClientOrderIds.map(id => orders.get(id)),
      heldOrders: heldIds.map(id => orders.get(id)) });
    if (apply) {
      // Compare again immediately before the checkpoint. The lease excludes
      // mirror writers; this also catches an unexpected out-of-band edit or
      // a research publication that closed the pick during inspection.
      const [latestLedger, latestAcc] = await Promise.all([store.get("webull-paper-ledger.json"), store.get("picks-accuracy.json")]);
      if (!Buffer.from(latestLedger || "").equals(Buffer.from(ledgerBuf)) || !Buffer.from(latestAcc || "").equals(Buffer.from(accBuf))) throw new Error("ledger or published record changed during recovery; inspect again");
      guard(); plan.ledger.reconciliation = plan.reconciliation;
      plan.ledger.recovery.appliedAtIso = checkedAtIso;
      await store.put("webull-paper-ledger.json", JSON.stringify(plan.ledger));
    }
    return plan;
  };
  if (!apply) return inspect();
  const lease = await store.withLease("webull-paper", inspect);
  if (lease.busy) throw Object.assign(new Error("paper account has an active writer; recovery was not applied"), { code: "LEASE_HELD" });
  return lease.result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), configPath = args.find(x => x.startsWith("--config="))?.slice(9);
    const outputPath = args.find(x => x.startsWith("--output="))?.slice(9);
    if (!configPath || args.some(x => x !== "--apply" && !x.startsWith("--config=") && !x.startsWith("--output="))) throw new Error("use --config=<private-json-path> [--output=<private-plan-path>] [--apply]");
    if (outputPath && args.includes("--apply")) throw new Error("--output is for read-only planning; apply reports the durable checkpoint separately");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    const { store } = await import("../lib/datastore.mjs"), { createWebullClient } = await import("../lib/webull-client.mjs");
    const env = k => String(process.env[k] || "").trim();
    const client = createWebullClient({ appKey: env("WEBULL_APP_KEY"), appSecret: env("WEBULL_APP_SECRET"), accessToken: env("WEBULL_ACCESS_TOKEN") || null, timeoutMs: 5000 });
    const apply = args.includes("--apply");
    const plan = await recoverManualSpread({ store, client, accountId: env("WEBULL_PAPER_ACCOUNT_ID"), config, apply });
    if (outputPath) await writeFile(outputPath, JSON.stringify(plan, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ applied: apply, brokerMutations: 0, reconciliation: plan.reconciliation.status,
      managedManualContracts: plan.ledger.trades[plan.manualTradeId].filledQty,
      externalGroupsRetained: Object.keys(plan.ledger.positionBaseline.groups).length }));
  } catch (err) {
    // Broker errors can echo private order details. Keep them out of stdout.
    console.error("Manual recovery stopped; no broker orders were submitted.", err?.name === "WebullError" ? { code: err.code, status: err.status } : { message: err.message, code: err.code });
    process.exitCode = 1;
  }
}
