// Pure market-data boundary and presentation rules, shared with the browser.
// The renderer embeds this factory so coverage and evidence use one contract.
export function marketAnalysisFactory() {
  const number = (value) => value == null || value === '' || typeof value === 'boolean'
    ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  function timestamp(value) {
    if (value == null || value === '') return null;
    const ms = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value)
      : value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) && ms >= Date.UTC(2000, 0, 1) ? new Date(ms).toISOString() : null;
  }
  function sourceUsable(leg, now = Date.now()) {
    if (!leg) return false;
    const date = timestamp(leg.asOf);
    if (!date) return false;
    const age = now - Date.parse(date);
    // Closed markets and official daily series can legitimately carry across
    // a weekend. A trading quote must be recent; unknown times never look live.
    const maxAge = leg.marketState === 'REGULAR' ? 30 * 60e3 : 96 * 3600e3;
    return age >= -5 * 60e3 && age <= maxAge;
  }
  function liveLeg(leg, now = Date.now()) {
    return sourceUsable(leg, now) ? leg : null;
  }
  function dailyMoves(quote, rows, isYield = false) {
    const value = number(quote?.regularMarketPrice);
    const quoteAt = timestamp(quote?.regularMarketTime);
    const date = quoteAt?.slice(0, 10);
    const history = (rows || []).map((row) => ({ date: timestamp(row?.date)?.slice(0, 10), close: number(row?.close) }))
      .filter((row) => row.date && row.close != null && row.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const prior = date ? history.filter((row) => row.date < date) : [];
    // Yahoo's previous-close field is the daily-return authority. History is
    // a date-aligned fallback, never an assumed second-to-last array element.
    const previous = number(quote?.regularMarketPreviousClose) ?? prior.at(-1)?.close ?? null;
    const fifth = prior.length >= 5 ? prior[prior.length - 5].close : null;
    const pct = (base) => value != null && base != null && base > 0 ? (value / base - 1) * 100 : null;
    const bps = (base) => isYield && value != null && base != null ? (value - base) * 100 : null;
    return { prior1d: previous, prior5d: fifth, pctChange1d: pct(previous), pctChange5d: pct(fifth),
      bpsChange1d: bps(previous), bpsChange5d: bps(fifth), asOf: quoteAt };
  }
  function creditAxis(credit, thresholds, now = Date.now()) {
    const oas = number(credit?.oas), change = number(credit?.oasChg5d);
    const asOf = credit?.oasAsOf || credit?.asOf || null;
    const stale = asOf && !sourceUsable({ asOf }, now);
    if (oas == null || stale) return { score: 0, label: stale ? 'stale HY spread observation' : 'no HY spread data', available: false };
    let score = 0, label = `HY OAS ${oas.toFixed(2)}%`;
    if (change != null && change >= thresholds.creditOas5dStrong) { score = -2; label += ` +${change.toFixed(2)}pp 5d — credit stress`; }
    else if (change != null && change >= thresholds.creditOas5d) { score = -1; label += ` +${change.toFixed(2)}pp 5d — widening`; }
    else if (change != null && change <= -thresholds.creditOasTight5d) { score = 1; label += ` ${change.toFixed(2)}pp 5d — tightening`; }
    if (oas >= thresholds.creditOasStressVhi && score > -2) { score = -2; label = `HY OAS ${oas.toFixed(2)}% — acute credit stress`; }
    else if (oas >= thresholds.creditOasStressHi && score > -1) { score = -1; label = `HY OAS ${oas.toFixed(2)}% — elevated spread`; }
    else if (oas <= thresholds.creditOasTightLvl && score === 0 && change != null && change <= 0.05) { score = 1; label += ' — tight / stable spreads'; }
    return { score, label, available: true, asOf, source: 'ICE BofA HY OAS via FRED' };
  }
  function contextAxes(axes) {
    // Falling yields are not evidence of easier risk-taking during an equity
    // sell-off or credit stress. Preserve the observed move without a positive vote.
    if ((axes.indexes?.score < 0 || axes.credit?.score < 0 || axes.vix?.score < 0)) {
      for (const key of ['yields', 'twoY']) {
        if (axes[key]?.score > 0) axes[key] = { ...axes[key], score: 0,
          label: axes[key].label.split(' — ')[0] + ' — Treasury easing unconfirmed by risk signals' };
      }
    }
    return axes;
  }
  function indexLabel(average, moves, score) {
    const prefix = `Indexes ${average >= 0 ? '+' : ''}${average.toFixed(2)}%`;
    if (moves.length < 2) return prefix + ' — single-index read';
    if (Math.min(...moves) < 0 && Math.max(...moves) > 0) return prefix + ' — mixed index leadership';
    return prefix + (score <= -2 ? ' — broad sell-off' : score >= 2 ? ' — broad rally' : score < 0 ? ' — weak' : ' — firm');
  }
  function geoTone(headlines, maxAgeHours, now = Date.now()) {
    let conflict = 0, theme = 0;
    for (const item of headlines || []) {
      const text = String(item?.title || item?.headline || (typeof item === 'string' ? item : ''));
      const at = timestamp(item?.date);
      if (!at || now - Date.parse(at) > maxAgeHours * 3600e3 || Date.parse(at) > now + 5 * 60e3) continue;
      // A reported escalation takes precedence over a failed/violated ceasefire.
      const escalation = /\b(?:violat\w*|breach\w*|collaps\w*|reject\w*|fail\w*|stall\w*|breaks? down|resum\w*|renew\w*)\b/i.test(text)
        || /\b(?:no|without) (?:a |any )?(?:ceasefire|peace (?:deal|agreement)|trade deal)\b/i.test(text);
      const peace = /\b(?:ceasefire|peace (?:deal|agreement|talks)|de-escalat\w*|end(?:s|ing)? (?:the )?war|withdraw\w*|cancel\w*|tariff (?:relief|exemptions?)|remov\w* (?:\w+ ){0,2}tariffs?|trade deal|lift\w* (?:\w+ ){0,2}sanctions?)\b/i.test(text);
      if (peace && !escalation) continue;
      const nuclearEnergy = /\bnuclear\s+(?:power|energy|reactor|plant|stocks?|fuel)\b/i.test(text);
      const hard = /\b(?:wars?|warfare|conflicts?|blockade|invasions?|invade[sd]?|air ?strikes?|missiles?|drone (?:attack|strike)s?|troops|hostilit\w*|escalat\w*|strait of hormuz|attacks? (?:on|against)|strikes? (?:on|against))\b/i.test(text)
        || (!nuclearEnergy && /\bnuclear\s+(?:weapons?|threat|attack|war|test)\b/i.test(text));
      const soft = /\b(?:sanctions?|embargo(?:es)?|tariffs?|trade war|blockade)\b/i.test(text);
      if (hard || (peace && escalation)) conflict++;
      else if (soft) theme++;
    }
    const score = conflict ? -Math.min(2, conflict + (theme ? 1 : 0)) : theme ? -1 : 0;
    return { score, drivers: [conflict ? 'war/conflict headlines' : null, theme ? 'tariff/geopolitical headlines' : null].filter(Boolean) };
  }
  function coverage(axes, inputs = {}, now = Date.now()) {
    const missing = [], stale = [], enabled = [];
    for (const [key, axis] of Object.entries(axes || {})) {
      if (/axis off|geo-news off/.test(axis.label || '')) { axis.available = false; continue; }
      enabled.push(key);
      axis.available = axis.available !== false && !/^no |^stale |unavailable/.test(axis.label || '');
      const at = inputs[key]?.asOf;
      if (at && !sourceUsable(inputs[key], now)) { axis.available = false; stale.push(key); }
      if (!axis.available) missing.push(key);
    }
    const coreMissing = ['indexes', 'vix'].filter((key) => !axes[key]?.available);
    const independent = ['dxy', 'yields', 'fed', 'commodity', 'geo', 'inflation', 'globalTape', 'twoY', 'bondVol', 'credit']
      .some((key) => axes[key]?.available);
    if (!independent) coreMissing.push('independent confirmation');
    const sufficient = coreMissing.length === 0;
    return { status: !sufficient ? (stale.some((key) => coreMissing.includes(key)) ? 'stale' : 'insufficient') : missing.length ? 'partial' : 'ready',
      sufficient, available: enabled.length - missing.length, total: enabled.length, missing, coreMissing, stale };
  }
  function contributions(regime, thresholds = {}) {
    const weights = thresholds.axisWeights || {};
    return Object.entries(regime?.axes || {}).map(([key, axis]) => ({ key, label: axis.label,
      score: axis.available === false ? null : number(axis.score),
      weight: number(weights[key]) ?? 1,
      contribution: axis.available === false ? null : (number(axis.score) ?? 0) * (number(weights[key]) ?? 1),
      available: axis.available !== false,
      live: !!axis.live, asOf: axis.asOf || null }));
  }
  function freshInputs(original, builtAtIso, now = Date.now()) {
    const input = JSON.parse(JSON.stringify(original || {}));
    function leg(value, parentAt) {
      if (!value) return value;
      const asOf = value.asOf || parentAt || builtAtIso;
      // Old payloads without observation times remain explicitly snapshot data.
      // A known expired input must not confirm another axis before coverage runs.
      return asOf && !sourceUsable({ ...value, asOf }, now) ? { asOf, marketState:value.marketState } : { ...value, asOf };
    }
    if (input.indexes) for (const key of ['spy','qqq','iwm']) input.indexes[key] = leg(input.indexes[key], input.indexes.asOf);
    if (input.yields) for (const key of ['ten','thirty']) input.yields[key] = leg(input.yields[key], input.yields.asOf);
    if (input.commodity) for (const key of ['crude','gold']) input.commodity[key] = leg(input.commodity[key], input.commodity.asOf);
    for (const key of ['vix','dxy','twoY','bondVol']) input[key] = leg(input[key]);
    return input;
  }
  function mergedInputs(baked, live) {
    const input = JSON.parse(JSON.stringify(baked?.inputs || {}));
    const overlay = (base, leg, keys) => {
      const out = { ...(base || {}) };
      if (!leg) return out;
      for (const key of keys) if (number(leg[key]) != null) out[key] = number(leg[key]);
      out.asOf = leg.asOf || null;
      out.marketState = leg.marketState || null;
      return out;
    };
    input.indexes = { ...(input.indexes || {}) };
    for (const key of ['spy', 'qqq']) input.indexes[key] = overlay(input.indexes[key], live?.[key], ['value', 'pctChange1d']);
    const aggregateTime = (legs, fallback) => legs.filter((leg) => leg && sourceUsable(leg) && (number(leg.pctChange1d) != null || number(leg.bpsChange1d) != null))
      .map((leg) => timestamp(leg.asOf)).filter(Boolean).sort().at(-1) || fallback || null;
    input.indexes.asOf = aggregateTime([input.indexes.spy,input.indexes.qqq], input.indexes.asOf);
    input.indexes.marketState = live?.spy?.marketState || live?.qqq?.marketState || input.indexes.marketState || null;
    input.vix = overlay(input.vix, live?.vix, ['value', 'pctChange1d']);
    input.dxy = overlay(input.dxy, live?.dxy, ['value', 'pctChange1d']);
    const yieldAt = input.yields?.asOf;
    input.yields = { ten: overlay(input.yields?.ten, live?.tenY, ['value', 'bpsChange1d']), thirty: overlay(input.yields?.thirty, live?.thirtyY, ['value', 'bpsChange1d']) };
    input.yields.asOf = aggregateTime([input.yields.ten,input.yields.thirty], yieldAt);
    input.yields.marketState = live?.tenY?.marketState || live?.thirtyY?.marketState || null;
    input.twoY = overlay(input.twoY, live?.twoY, ['value', 'bpsChange1d']);
    input.bondVol = overlay(input.bondVol, live?.move, ['value', 'pctChange1d']);
    const commodityAt = input.commodity?.asOf;
    input.commodity = { crude: overlay(input.commodity?.crude, live?.crude, ['pctChange1d']), gold: overlay(input.commodity?.gold, live?.gold, ['pctChange1d']) };
    input.commodity.asOf = aggregateTime([input.commodity.crude,input.commodity.gold], commodityAt);
    if (live?.fng) {
      input.sentiment = overlay(input.sentiment, live.fng, ['score','breadth','credit','week','month']);
      if (number(live.fng.prevClose) != null) input.sentiment.prev = number(live.fng.prevClose);
      // An old categorical rating must not describe a newly observed score.
      input.sentiment.rating = live.fng.rating || null;
    }
    return input;
  }
  return { number, finite, timestamp, sourceUsable, liveLeg, dailyMoves, creditAxis, contextAxes, indexLabel, geoTone, coverage, contributions, freshInputs, mergedInputs };
}

export const marketAnalysis = marketAnalysisFactory();
