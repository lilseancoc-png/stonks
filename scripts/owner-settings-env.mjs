// Loaded with `node --import ./scripts/owner-settings-env.mjs scripts/build.mjs`
// (daily.yml "Build site"). Copies the Owner's saved settings from the
// hydrated data/owner-settings.json into process.env BEFORE build.mjs and
// lib/top-picks-config.mjs read their switches, so a site setting behaves like
// a repo variable. A repo variable that is already set wins. The report rides
// OWNER_SETTINGS_REPORT; build.mjs writes it to owner-settings-applied.json
// and stamps the Top Picks part on new trades. No file = nothing changes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OWNER_SETTINGS_KEY, applyOwnerSettingsToEnv } from "../lib/owner-settings.mjs";

let raw = null;
try { raw = readFileSync(resolve(process.env.OWNER_SETTINGS_DATA_DIR || "data", OWNER_SETTINGS_KEY), "utf8"); } catch { raw = null; }
try {
  const report = applyOwnerSettingsToEnv(raw, process.env);
  process.env.OWNER_SETTINGS_REPORT = JSON.stringify(report);
  const n = Object.keys(report.applied).length;
  console.log(`owner settings: ${n ? `applied ${Object.entries(report.applied).map(([k, v]) => `${k}=${v}`).join(", ")}` : "all defaults"}` +
    (report.skipped.length ? `; skipped ${report.skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}` : ""));
} catch (err) {
  // Never block a build over the settings file: run on the defaults.
  console.warn(`owner settings: ignored (${String(err?.message || err)})`);
}
