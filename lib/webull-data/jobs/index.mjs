// The Webull data runner's jobs, in run order (lib/webull-data/runner.mjs
// describes the interface). The expiry saver goes first: its contracts are
// the ones Webull deletes soonest. Later jobs append below.
import optionExpiry from "./option-expiry.mjs";
import optionSnapshots from "./option-snapshots.mjs";
// W3 (2026-11-19): order flow, market breadth and backups, Owner-only data
// keys read by the bake (lib/webull-data/bake.mjs).
import webullFlow from "./webull-flow.mjs";
import webullBreadth from "./webull-breadth.mjs";
import webullBackup from "./webull-backup.mjs";

export const WEBULL_DATA_JOBS = Object.freeze([
  optionExpiry,
  optionSnapshots,
  webullFlow,
  webullBreadth,
  webullBackup,
]);
