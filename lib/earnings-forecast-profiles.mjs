// Business relationships are research hypotheses, not fitted causal effects.
// Issuer-specific disclosures live in observations, never in these templates.
const definitions = {
  AAPL: ['Hardware and services', 'https://investor.apple.com/', [
    ['Consumer demand and product cycle', 'iPhone, Mac, iPad and wearables', 'Volume / mix', 'Replacement cycles, launch timing and realized prices affect hardware sales.'],
    ['Services adoption and pricing', 'Services', 'Revenue / margin', 'Installed-base activity and subscription or platform pricing affect Services separately from hardware.'],
    ['Currency and regional demand', 'International sales', 'Revenue', 'Regional sales are exposure context; product-by-region intersections are not assumed.']]],
  NVDA: ['Semiconductors and systems', 'https://investor.nvidia.com/', [
    ['Customer infrastructure spending', 'Compute and networking', 'Volume', 'Customer capex is a demand signal, not an order or recognized NVIDIA revenue.'],
    ['Product transitions and supply', 'Accelerators and systems', 'Volume / margin', 'Availability, system mix and transition costs can move revenue and gross margin differently.'],
    ['Export restrictions and competition', 'Eligible international customers', 'Revenue / mix', 'Regulatory restrictions and competing silicon can change accessible demand.']]],
  MSFT: ['Subscriptions, cloud and software', 'https://www.microsoft.com/en-us/Investor/', [
    ['Cloud consumption and capacity', 'Intelligent Cloud', 'Revenue / margin', 'Usage, capacity and pricing drive consumption revenue; capital spending is not current-period expense.'],
    ['Seats, retention and pricing', 'Productivity subscriptions', 'Revenue', 'Paid seats and realized pricing matter more than a general software-demand score.'],
    ['Depreciation and product mix', 'Consolidated earnings', 'Margin', 'Infrastructure depreciation and a changing cloud mix can offset revenue growth.']]],
  GOOGL: ['Advertising, cloud and subscriptions', 'https://abc.xyz/investor/', [
    ['Advertising demand and monetization', 'Search and YouTube', 'Revenue', 'Activity and realized advertising yield belong in the same revenue bridge.'],
    ['Cloud usage and competition', 'Google Cloud', 'Revenue / margin', 'Consumption, contracts and competitive pricing affect growth and operating leverage.'],
    ['Infrastructure and acquisition costs', 'Consolidated earnings', 'Costs', 'Traffic acquisition, depreciation and operating expenses need separate assumptions.']]],
  AMZN: ['Retail, marketplace, advertising and cloud', 'https://ir.aboutamazon.com/', [
    ['Consumer spending and seller activity', 'Retail and marketplace', 'Revenue', 'First-party sales and third-party fees have different revenue recognition.'],
    ['Cloud consumption and pricing', 'AWS', 'Revenue / margin', 'Capacity, usage and realized prices influence cloud revenue and profitability.'],
    ['Fulfillment efficiency and mix', 'Retail operating earnings', 'Margin', 'Shipping, fulfillment, advertising and marketplace mix can change margins independently of sales.']]],
  TSM: ['Semiconductor foundry', 'https://investor.tsmc.com/english/quarterly-results', [
    ['Wafer demand and capacity utilization', 'Foundry manufacturing', 'Volume', 'Customer demand and available capacity affect shipments; customer forecasts are not realized orders.'],
    ['Process-node and packaging mix', 'Wafer and packaging sales', 'Price / margin', 'Advanced-node mix, yields and packaging availability affect revenue and profitability.'],
    ['Currency and overseas fabrication costs', 'TWD reporting', 'Revenue / margin', 'Model in TWD. Local-share EPS is not USD EPS per US depositary receipt.']]],
  SPCX: ['Space, connectivity and Super Intelligence', 'https://ir.spacex.com/investors/', [
    ['External launch and contract performance', 'Space', 'Revenue', 'Customer mix and work performed matter; internal launches and backlog are not automatically external quarterly revenue.'],
    ['Customers, pricing and hardware', 'Connectivity', 'Revenue / margin', 'Average paying customers and realized yield are hypotheses when not independently disclosed.'],
    ['Contract activity and business perimeter', 'Super Intelligence', 'Revenue / comparability', 'Acquisitions and common-control combinations can break comparisons with historical consolidated growth.']]],
  META: ['Advertising and Reality Labs', 'https://investor.atmeta.com/', [
    ['Advertising impressions and price', 'Family of Apps', 'Revenue', 'Advertising demand, engagement and monetization share one revenue bridge.'],
    ['Infrastructure and operating expenses', 'Family of Apps earnings', 'Margin', 'Depreciation, compensation and infrastructure usage influence profit.'],
    ['Investment and regulatory changes', 'Reality Labs and consolidated earnings', 'Costs / tax', 'Losses, legal items and unusual tax effects are modeled separately from advertising demand.']]],
  AVGO: ['Semiconductors and infrastructure software', 'https://investors.broadcom.com/', [
    ['Custom silicon and networking demand', 'Semiconductor solutions', 'Volume / mix', 'Customer concentration and program timing can create lumpy revenue.'],
    ['Software renewals and pricing', 'Infrastructure software', 'Revenue', 'Contract duration and recognition differ from chip shipments.'],
    ['Acquisition accounting and mix', 'Consolidated earnings', 'Margin / adjustments', 'Acquisition amortization affects GAAP results; adjusted EPS is a separate basis.']]],
  TSLA: ['Vehicles, energy and services', 'https://ir.tesla.com/', [
    ['Deliveries and realized selling price', 'Automotive', 'Revenue', 'Demand and pricing affect sales; deliveries alone do not determine revenue.'],
    ['Storage deployment and recognition', 'Energy', 'Revenue / margin', 'Deployment timing and project acceptance can affect recognized sales.'],
    ['Mix, credits and operating costs', 'Consolidated earnings', 'Margin', 'Regulatory credits, product mix and R&D can move earnings independently of deliveries.']]],
};

const BOUNDARIES = ['A source-backed relationship is not a calibrated coefficient.', 'Product and geographic views are separate breakdowns of the same revenue.', 'Missing volume, price or regional intersections remain unknown.'];
const pctText = n => (n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0) + '%';

// Companies without a written profile get research prompts built from the
// lines they report: the largest product lines and regions, each with its
// share and growth. Nothing here is inferred beyond the filing.
function reportedDrivers(mix) {
  const out = [];
  for (const [axis, label] of [['product', 'Business line'], ['geographic', 'Region']]) {
    const a = mix?.[axis];
    if (!a?.rows?.length) continue;
    const total = a.rows.reduce((v, r) => v + r.value, 0);
    if (!(total > 0)) continue;
    const end = a.period?.currentPeriod?.endDate || 'the latest filing';
    for (const r of [...a.rows].filter(r => r.name !== 'Other').sort((x, y) => y.value - x.value).slice(0, axis === 'product' ? 3 : 2)) {
      const growth = r.previousValue > 0 ? ' and changed ' + (r.value >= r.previousValue ? '+' : '') + pctText(r.value / r.previousValue - 1) + ' against the prior comparable period' : '';
      out.push([r.name + (r.isNew ? ' (new line)' : ''), r.name, axis === 'product' ? 'Revenue / mix' : 'Revenue',
        label + ' reported at ' + pctText(r.value / total) + ' of disclosed revenue for the period ended ' + end + growth + '. What drives it still needs research.']);
    }
  }
  return out;
}

export function companyProfile(symbol, mix = null) {
  const written = definitions[symbol];
  const generated = written ? null : reportedDrivers(mix);
  const d = written || ['Operating company', null, generated.length ? generated : [['Business drivers require review', 'Consolidated revenue', 'Unavailable', 'No verified company-specific driver mapping is available.']]];
  return { version: '2026-10-27.1', source: written ? 'written' : generated.length ? 'reported-lines' : 'none', archetype: d[0], investorUrl: d[1], drivers: d[2].map(([name, exposure, channel, rationale]) => ({ name, exposure, channel, rationale, status: written ? 'research hypothesis' : 'reported line; drivers unreviewed', numericalEffect: null })),
    boundaries: written ? BOUNDARIES : ['These prompts come from the company\'s reported revenue lines. No written profile exists yet.', ...BOUNDARIES] };
}

export const hasWrittenProfile = symbol => Object.hasOwn(definitions, symbol);
