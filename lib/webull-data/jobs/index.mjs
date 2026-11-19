// The Webull data runner's jobs, in run order (lib/webull-data/runner.mjs
// describes the interface). The expiry saver goes first: its contracts are
// the ones Webull deletes soonest. Later jobs append below.
import optionExpiry from "./option-expiry.mjs";
import optionSnapshots from "./option-snapshots.mjs";

export const WEBULL_DATA_JOBS = Object.freeze([
  optionExpiry,
  optionSnapshots,
]);
