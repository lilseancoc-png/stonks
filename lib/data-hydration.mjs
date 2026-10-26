// Normal runs need rolling record history, while backtests explicitly need
// the complete archive. This policy controls downloads, never remote retention.
import { SCANNER_OWNERS, isLocalOnlyKey, isUnifiedSignalKey, UNIFIED_SIGNAL_KEY } from "./data-ownership.mjs";

export function hydrationDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function hydrationPolicy({ owner = "bake", bakeDate = hydrationDate(), includeArchives = false } = {}) {
  owner ||= "bake";
  if (owner !== "bake" && !SCANNER_OWNERS.includes(owner)) throw new Error(`unknown hydration owner: ${owner}`);
  const date = new Date(`${bakeDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bakeDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== bakeDate) {
    throw new Error(`invalid hydration date: ${bakeDate}`);
  }
  const cutoff = days => new Date(date.getTime() - days * 86400000).toISOString().slice(0, 10);
  const evidenceStart = cutoff(59); // evidence loader: today and previous 59 dates
  const rejectionStart = cutoff(60); // firstSeen loader: previous 60 dates plus today's log
  return key => {
    if (isLocalOnlyKey(key)) return false;
    // Current decisions contain their own previous-snapshot diff. Normal
    // runs need no archive downloads; research can opt into full hydration.
    if (isUnifiedSignalKey(key) && key !== UNIFIED_SIGNAL_KEY) return owner === "bake" && includeArchives;
    const archive = /^(evidence|ai-rejections)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(key);
    if (!archive || includeArchives) return true;
    if (owner !== "bake") return false;
    const start = archive[1] === "evidence" ? evidenceStart : rejectionStart;
    return archive[2] >= start && archive[2] <= bakeDate;
  };
}
