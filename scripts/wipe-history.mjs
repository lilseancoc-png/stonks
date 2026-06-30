// wipe-history.mjs — reset the Top Picks track record in the PRIVATE data store
// (Path B; see CLAUDE.md "Private data + Discord-role gating" and
// docs/private-data-migration.md), and purge the now-removed Day Trades store
// objects (the Day Trades tab + engine were deleted).
//
// Use this after a strategy change to start the track record fresh, so the
// displayed win-rate / closed-P&L don't blend old-strategy and new-strategy
// results. Reuses lib/datastore.mjs, so it targets whichever backend is
// configured (Cloudflare R2 when the four R2_* vars are set, else Vercel Blob).
// Requires those store creds in the environment — exactly like sync-data.mjs.
//
//   DRY-RUN BY DEFAULT. Nothing is mutated unless you pass --apply.
//
// Scope (additive; the CORE targets are ALWAYS included):
//   (core, always)  picks-accuracy.json        Top Picks track record: closed
//                                               P&L + win/loss stats + the
//                                               currently-enrolled open picks
//                                               (re-enroll next bake) — RESET
//   (core, always)  day-trades.json            REMOVED feature — always DELETED
//                   day-trades-history.json     REMOVED feature — always DELETED
//   --picks-logs    + picks-changes.json        Top Picks in/out churn log
//                   + picks-roster.json         Top-10 in/out roster snapshot
//   --grade-logs    + grades-history.json       whole-universe grade-change log
//                   + grades-daily.json         daily grade snapshots (IC substrate)
//   --all           = --picks-logs --grade-logs
//
// Mode:
//   --empty   (default) overwrite each key with a VALID EMPTY payload — the
//             premium tab immediately shows "no history yet" (no 404 window).
//   --delete  remove the key entirely — the next bake recreates it, but the tab
//             404s until then (up to ~1h for picks). The two day-trades keys are
//             ALWAYS deleted regardless of this flag — nothing recreates them
//             now that the feature is gone.
//
// Examples:
//   node scripts/wipe-history.mjs                       # dry run, core only
//   node scripts/wipe-history.mjs --picks-logs          # dry run, core + picks logs
//   node scripts/wipe-history.mjs --picks-logs --apply  # really wipe
//   node scripts/wipe-history.mjs --all --delete --apply
//
// NOTE on --grade-logs: wiping grades-history.json clears the `latest` baseline
// that the next build diffs against, so that build will log every currently
// actionable name as a fresh "entered" event in picks-changes.json (a one-time
// churn flood). If you wipe grade logs, wipe --picks-logs too so that flood
// lands in an already-cleared log. (Leaving grade logs alone avoids this.)

import { store } from "../lib/datastore.mjs";

const argv = process.argv.slice(2);
const args = new Set(argv);
const APPLY = args.has("--apply");
const MODE = args.has("--delete") ? "delete" : "empty";
const nowIso = new Date().toISOString();

if (args.has("--help") || args.has("-h")) {
  console.log(
    "Usage: node scripts/wipe-history.mjs [--picks-logs] [--grade-logs] [--all] [--empty|--delete] [--apply]\n" +
      "Dry run by default. See the file header for full docs.",
  );
  process.exit(0);
}

const wantPicksLogs = args.has("--picks-logs") || args.has("--all");
const wantGradeLogs = args.has("--grade-logs") || args.has("--all");

// Each target: the store key + a VALID EMPTY payload the next-bake/scan reader
// AND the browser both tolerate (verified against the read/render code).
const TARGETS = [
  // ---- CORE: the two performance track records (always wiped) ----
  {
    key: "picks-accuracy.json", group: "core", label: "Top Picks track record",
    empty: { builtAtIso: nowIso, lastResetWeek: null, open: [], closed: [], stats: null },
    summarize: (p) => `${(p.closed || []).length} closed, ${(p.open || []).length} open` +
      (p.stats && p.stats.winRate != null ? `, ${Math.round(p.stats.winRate * 100)}% win` : ""),
  },
  // Co-written with picks-accuracy.json by updatePicksAccuracyFile (the open
  // marks the Top Picks "since it appeared" chip reads). Wipe it in lock-step so
  // the live chip doesn't keep showing stale open marks after a track-record
  // reset until the next build regenerates it.
  {
    key: "picks-open.json", group: "core", label: "Top Picks open-marks (chip)",
    empty: { builtAtIso: nowIso, open: [] },
    summarize: (p) => `${(p.open || []).length} open`,
  },
  // The Day Trades tab + engine were removed — these store objects are orphaned
  // (nothing reads or recreates them). Always DELETE them, regardless of --empty.
  {
    key: "day-trades.json", group: "core", label: "Day Trades roster (removed)",
    forceDelete: true,
    summarize: (p) => `${(p.trades || []).length} active`,
  },
  {
    key: "day-trades-history.json", group: "core", label: "Day Trades history (removed)",
    forceDelete: true,
    summarize: (p) => `${(p.closed || []).length} closed`,
  },
  // ---- --picks-logs: Top Picks in/out churn + roster ----
  {
    key: "picks-changes.json", group: "picks-logs", label: "Picks in/out churn log",
    empty: { changes: [] },
    summarize: (p) => `${(p.changes || []).length} events`,
  },
  {
    key: "picks-roster.json", group: "picks-logs", label: "Top-10 roster snapshot",
    empty: { builtAtIso: nowIso, count: 0, roster: [], exited: [], swaps: [], stale: false },
    summarize: (p) => `${(p.roster || []).length} in / ${(p.exited || []).length} out`,
  },
  // ---- --grade-logs: whole-universe grade-change log + IC substrate ----
  {
    key: "grades-history.json", group: "grade-logs", label: "Grade-change log",
    empty: { latest: {}, changes: [] },
    summarize: (p) => `${(p.changes || []).length} changes, ${Object.keys(p.latest || {}).length} graded`,
  },
  {
    key: "grades-daily.json", group: "grade-logs", label: "Daily grade snapshots (IC)",
    empty: { days: [] },
    summarize: (p) => `${(p.days || []).length} days`,
  },
];

const selected = TARGETS.filter((t) =>
  t.group === "core" ||
  (t.group === "picks-logs" && wantPicksLogs) ||
  (t.group === "grade-logs" && wantGradeLogs),
);

console.log(
  `\nwipe-history — mode=${MODE} ${APPLY ? "APPLY (will mutate the store)" : "DRY RUN (no writes)"}\n` +
    `scope: core${wantPicksLogs ? " + picks-logs" : ""}${wantGradeLogs ? " + grade-logs" : ""}\n` +
    `targets: ${selected.length} key(s)\n`,
);

let mutated = 0, failed = 0;
for (const t of selected) {
  let current = null, curDesc = "(absent)";
  try {
    const buf = await store.get(t.key);
    if (buf) {
      const txt = buf.toString("utf8");
      curDesc = `${txt.length} bytes`;
      try { current = JSON.parse(txt); curDesc += ` — ${t.summarize(current)}`; } catch { curDesc += " — (unparseable)"; }
    }
  } catch (err) {
    curDesc = `(read error: ${err?.message || err})`;
  }

  // A removed-feature target (forceDelete) is always deleted, regardless of MODE.
  const mode = t.forceDelete ? "delete" : MODE;
  const action = mode === "delete" ? "DELETE" : "OVERWRITE-EMPTY";
  console.log(`  • ${t.key.padEnd(24)} [${t.label}]\n      now:  ${curDesc}\n      ${APPLY ? "doing" : "would"}: ${action}`);

  if (!APPLY) continue;
  try {
    if (mode === "delete") await store.del(t.key);
    else await store.put(t.key, Buffer.from(JSON.stringify(t.empty), "utf8"));
    mutated++;
    console.log(`      done.`);
  } catch (err) {
    failed++;
    console.log(`      FAILED: ${err?.message || err}`);
  }
}

if (!APPLY) {
  console.log(`\nDry run complete — nothing changed. Re-run with --apply to execute.\n`);
} else {
  console.log(`\nDone — ${mutated} key(s) ${MODE === "delete" ? "deleted" : "reset"}, ${failed} failed.`);
  console.log(
    `The next scheduled bake will repopulate the Top Picks track record (within ` +
      `~1h). The deleted Day Trades keys are gone for good (the feature was removed).\n`,
  );
}
process.exit(failed > 0 ? 1 : 0);
