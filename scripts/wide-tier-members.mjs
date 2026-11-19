// Rebuild lib/wide-tier-members.json, the committed copy of the wide tier's
// member list (S&P 500 + Nasdaq-100). The bake re-reads the same two public
// lists itself at most once every 30 days (lib/wide-tier.mjs refreshMembers);
// this script refreshes the committed fallback by hand.
//
//   node scripts/wide-tier-members.mjs                 # read both lists online
//   node scripts/wide-tier-members.mjs --sp <csv> --ndx <yaml> [--note "..."]
//                                                     # from saved copies
// No AI, no Yahoo. Writes one file.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshMembers, MEMBER_SOURCES } from "../lib/wide-tier.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "lib/wide-tier-members.json");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const spFile = arg("--sp"), ndxFile = arg("--ndx"), note = arg("--note");
let prior = null;
try { prior = JSON.parse(await readFile(OUT, "utf8")); } catch { prior = null; }
const fetchText = async (url) => {
  if (url === MEMBER_SOURCES.sp500.url && spFile) return readFile(spFile, "utf8");
  if (url.startsWith(MEMBER_SOURCES.ndx.url(2000).replace("2000.yaml", "")) && ndxFile) {
    const year = url.match(/(\d{4})\.yaml$/)?.[1];
    if (!ndxFile.includes(year)) throw new Error(`no saved Nasdaq-100 file for ${year}`);
    return readFile(ndxFile, "utf8");
  }
  const r = await fetch(url, { headers: { "user-agent": "stonks-wide-tier/1" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.text();
};
const out = await refreshMembers({ prior, fetchText, force: true, log: (m) => console.log(m) });
if (!out.refreshed) { console.error(`not refreshed: ${out.error || "unknown"}`); process.exit(1); }
const members = { ...out.members, ...(note ? { note } : {}) };
await writeFile(OUT, JSON.stringify(members, null, 1) + "\n");
const m = members.list;
console.log(`wrote ${OUT}: ${m.length} names (${m.filter((r) => r.idx.includes("S")).length} S&P 500, ${m.filter((r) => r.idx.includes("N")).length} Nasdaq-100, ${m.filter((r) => !r.sec).length} without a GICS sector yet)`);
