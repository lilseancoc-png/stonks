// One broad sector grouping for the whole site (site audit I1, 2026-10-26).
//
// SECTORS in scripts/build.mjs keeps its fine labels ("Semis", "Payments",
// "Restaurants", …) — the grade's macro profiles, the sector growth bars and
// the search box all want that detail. After the cut to 85 names, though,
// twelve fine labels hold a single stock, so any feature that GROUPS stocks by
// the fine label ends up with one-stock "sectors": a Top Picks sector cap that
// can never bind, a one-tile heatmap block, a Compare sector average that is
// just the stock itself.
//
// So every feature that groups stocks reads this map instead. Each fine label
// belongs to exactly one group and every group holds at least five tracked
// stocks (scripts/sector-groups-smoke.mjs checks both). Finer purpose-built
// baskets stay as they are — Sector rotation, Event spillover and the
// leveraged-ETF routing each pair a basket with its own ETF, which a broad
// group cannot do.
//
// Written in ES5 so app-js.mjs can embed the factory with toString().
export function sectorGroupsFactory() {
  var ORDER = [
    'Mega-cap tech',
    'Semis & hardware',
    'Software & IT services',
    'Financials',
    'Consumer & media',
    'Healthcare',
    'Industrials & energy',
    'ETF'
  ];
  var OF_LABEL = {
    'Mega-cap tech': 'Mega-cap tech',
    'Semis': 'Semis & hardware',
    'Storage': 'Semis & hardware',
    'Hardware': 'Semis & hardware',
    'Networking': 'Semis & hardware',
    'Software': 'Software & IT services',
    'IT services': 'Software & IT services',
    'Tech services': 'Software & IT services',
    'Bank': 'Financials',
    'Payments': 'Financials',
    'Broker': 'Financials',
    'Fintech': 'Financials',
    'Asset mgmt': 'Financials',
    'Crypto': 'Financials',
    'Retail': 'Consumer & media',
    'Apparel': 'Consumer & media',
    'Beauty': 'Consumer & media',
    'E-commerce': 'Consumer & media',
    'Restaurants': 'Consumer & media',
    'Homebuilder': 'Consumer & media',
    'Consumer': 'Consumer & media',
    'Meme': 'Consumer & media',
    'Media': 'Consumer & media',
    'Telecom': 'Consumer & media',
    'Cable': 'Consumer & media',
    'Social': 'Consumer & media',
    'China tech': 'Consumer & media',
    'Pharma': 'Healthcare',
    'Insurance': 'Healthcare',
    'Medical': 'Healthcare',
    'Pharmacy': 'Healthcare',
    'Telehealth': 'Healthcare',
    'Industrial': 'Industrials & energy',
    'Defense': 'Industrials & energy',
    'Logistics': 'Industrials & energy',
    'Materials': 'Industrials & energy',
    'Space': 'Industrials & energy',
    'Data center': 'Industrials & energy',
    'Power': 'Industrials & energy',
    'Clean energy': 'Industrials & energy',
    'Nuclear': 'Industrials & energy',
    'Energy': 'Industrials & energy',
    'ETF': 'ETF'
  };
  // Broad group for a fine SECTORS label. An unlisted label keeps its own name,
  // so a new label can never drop a stock out of grouping; the smoke test fails
  // until it is added above.
  function of(label) {
    if (!label) return null;
    return OF_LABEL[label] || label;
  }
  return { ORDER: ORDER, OF_LABEL: OF_LABEL, of: of };
}

const GROUPS = sectorGroupsFactory();
export const SECTOR_GROUP_ORDER = GROUPS.ORDER;
export const SECTOR_GROUP_OF_LABEL = GROUPS.OF_LABEL;
export const sectorGroupOfLabel = GROUPS.of;
