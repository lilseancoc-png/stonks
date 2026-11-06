// Top Picks exposure caps (moved out of scripts/build.mjs, 2026-11-06).
//
// One place for the roster's correlation limits, shared by buildTopPicks and
// the AI-slot priority pass (prioritizeAiSlots) so both count the same way.
//
// - Sector cap: at most PICKS_MAX_PER_SECTOR names per broad sector group per
//   roster (ETFs uncapped).
// - Factor cap: the semis / software / mega-cap tech / data-center power
//   complex trades as one beta across several sectors, so it is capped on top
//   of the sector cap.
// - Same-run factor limit (2026-11-06, owner decision, live with no shadow
//   period): a single Top Picks run opens at most PICKS_MAX_NEW_PER_FACTOR_RUN
//   NEW trades from one factor. Every actionable pick in a run is a new entry
//   (names already open are dropped earlier by re-entry suppression), so the
//   limit applies to the actionable roster. Why: on Oct 28 15:33 ET one run
//   opened WDC, TSM, MU and ORCL calls together and all four were stopped;
//   the old 5-per-factor cap allowed it. Watch ideas keep the wider cap.
//   Names held back trace as gate "factor-run-cap" in the gate log.

export const PICKS_MAX_PER_SECTOR = 3;
export const PICKS_MAX_PER_FACTOR = 5;
export const PICKS_MAX_NEW_PER_FACTOR_RUN = Math.max(1, Number(process.env.PICKS_MAX_NEW_PER_FACTOR_RUN ?? 2) || 2);
// Stamped on every trade enrolled under this rule set (Track Record divider).
export const PICKS_CAPS_VERSION = "2026-11-06-factor-run-2";

export const FACTOR_OF_SECTOR = Object.freeze({
  "Mega-cap tech": "Tech/AI growth", "Semis": "Tech/AI growth", "Storage": "Tech/AI growth",
  "Software": "Tech/AI growth", "Hardware": "Tech/AI growth", "Networking": "Tech/AI growth",
  "Tech services": "Tech/AI growth", "IT services": "Tech/AI growth", "Data center": "Tech/AI growth",
  "Power": "Tech/AI growth", "Clean energy": "Tech/AI growth", "Nuclear": "Tech/AI growth",
});

// The correlated factor for a curated SECTORS label, or null (ETFs and
// sectors outside the tech complex rely on the sector cap alone).
export function factorOfSectorLabel(label) {
  if (!label || label === "ETF") return null;
  return FACTOR_OF_SECTOR[label] || null;
}

// The factor limit for one roster: actionable picks are this run's new
// entries, so they get the same-run limit; watch ideas keep the wider cap.
export function factorCapFor(actionable) {
  return actionable ? Math.min(PICKS_MAX_PER_FACTOR, PICKS_MAX_NEW_PER_FACTOR_RUN) : PICKS_MAX_PER_FACTOR;
}

// Which exposure cap (if any) blocks one more name. `counts` holds the names
// already admitted to the same roster: { sector: {label: n}, factor: {id: n} }.
// Returns "sector-cap", "factor-run-cap", "factor-cap" or null.
export function exposureCapBlock({ sector, factor, actionable }, counts) {
  if (!sector || sector === "ETF") return null;
  if ((counts.sector[sector] || 0) >= PICKS_MAX_PER_SECTOR) return "sector-cap";
  if (factor) {
    const n = counts.factor[factor] || 0;
    if (n >= PICKS_MAX_PER_FACTOR) return "factor-cap";
    if (actionable && n >= factorCapFor(true)) return "factor-run-cap";
  }
  return null;
}

// Record one admitted name against the roster's counts.
export function countExposure({ sector, factor }, counts) {
  if (!sector || sector === "ETF") return;
  counts.sector[sector] = (counts.sector[sector] || 0) + 1;
  if (factor) counts.factor[factor] = (counts.factor[factor] || 0) + 1;
}
