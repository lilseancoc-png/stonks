// Shared serialization boundary and browser expiry policy for the Owner brief.
// Keep dependency-free: the factory is embedded in the browser bundle.
export function ownerMarketBriefDisplayFactory() {
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = v => Array.isArray(v) && v.every(x => typeof x === 'string');
  const objects = v => Array.isArray(v) && v.every(object);
  const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const number = v => v === null || typeof v === 'number' && Number.isFinite(v);
  const fields = (v, keys) => keys.every(k => typeof v[k] === 'string');
  const optionalObjects = (v, keys) => keys.every(k => v[k] == null || objects(v[k]));
  function marketCardValid(card) {
    if (!object(card) || !optionalObjects(card, ['highlights','indexes','recap','overnight','bonds','levels','volume','watchlist','flow','ivTrend','gex','events','headlines','releases','macro','playbook'])) return false;
    if (card.watchlist && !card.watchlist.every(w => w.reasons == null || strings(w.reasons))) return false;
    for (const name of ['fearGreed','breadth','tone','analog','extended','movers','sectors','extremes','toolScan']) if (card[name] != null && !object(card[name])) return false;
    if (card.movers && !optionalObjects(card.movers,['gainers','losers']) || card.sectors && !optionalObjects(card.sectors,['leaders','laggards']) || card.extremes && !optionalObjects(card.extremes,['highs','lows'])) return false;
    if (card.extended && (!optionalObjects(card.extended,['indexes','earnings']) || card.extended.movers != null && (!object(card.extended.movers) || !optionalObjects(card.extended.movers,['gainers','losers'])))) return false;
    const scan = card.toolScan;
    if (scan && (!['checked','coreChecked','missing'].every(k => scan[k] == null || strings(scan[k])) || !optionalObjects(scan,['standouts']) || scan.standouts && !scan.standouts.every(r => r.symbols == null || strings(r.symbols)))) return false;
    return true;
  }
  function finding(v) { return object(v) && fields(v,['id','tab','source','title','detail']) && (v.asOf === null || timestamp(v.asOf)); }
  function valid(d) {
    if (!object(d) || d.version !== 1 || !fields(d,['headline','summary','date','methodology']) || !timestamp(d.builtAtIso) || !timestamp(d.validUntil)) return false;
    const life = Date.parse(d.validUntil) - Date.parse(d.builtAtIso);
    if (life <= 0 || life > 86400000 || !['ready','insufficient-data'].includes(d.status)) return false;
    if (!objects(d.coverage) || !d.coverage.every(s => fields(s,['label','status','audience']) && (s.audience === 'public' || s.audience === 'owner' && fields(s,['id','tab']) && typeof s.maxHours === 'number' && (timestamp(s.asOf) || s.asOf === null)))) return false;
    if (!objects(d.findings) || !d.findings.every(finding) || !objects(d.priorities) || !d.priorities.every(finding) || !objects(d.publicFacts) || !d.publicFacts.every(finding)) return false;
    if (!objects(d.scenarios) || !d.scenarios.every(s => fields(s,['name','driver','horizon']) && timestamp(s.asOf) && objects(s.paths) && s.paths.every(p => fields(p,['label','condition','outcome'])))) return false;
    if (!objects(d.ideas) || !d.ideas.every(i => fields(i,['symbol','direction','status','summary','thesis','next','currency','horizon','investment','trading','suggestion'])
      && ['eligible','wait','watch','avoid'].includes(i.status) && typeof i.policyCurrent === 'boolean' && timestamp(i.asOf)
      && (i.policyValidUntil === null || timestamp(i.policyValidUntil)) && ['trigger','target','invalidation'].every(k => number(i[k]))
      && ['support','challenges','blocks','invalidators','changes'].every(k => strings(i[k])))) return false;
    if (!objects(d.forecasts) || !d.forecasts.every(f => fields(f,['symbol','period','currency','status']) && timestamp(f.cutoffAt) && number(f.revenue) && number(f.eps) && strings(f.warnings))) return false;
    if (!objects(d.catalysts) || !d.catalysts.every(c => fields(c,['title','date','source','tab'])) || !objects(d.changes) || !d.changes.every(c => fields(c,['tab','title','detail'])) || !strings(d.limits)) return false;
    return (d.publicRead === null || marketCardValid(d.publicRead)) && marketCardValid(d.publicCore);
  }
  function expired(d, now = Date.now()) { return now >= Date.parse(d.validUntil) || now < Date.parse(d.builtAtIso) - 300000; }
  function ideaCurrent(i, now = Date.now()) { return i.policyCurrent === true && timestamp(i.policyValidUntil) && now >= Date.parse(i.asOf) - 300000 && now < Date.parse(i.policyValidUntil); }
  function expiryKey(d, now = Date.now()) { return String(expired(d,now)) + d.ideas.map(i => ideaCurrent(i,now) ? ':current' : ':reference').join(''); }
  function coverageStatus(s, now = Date.now()) {
    if (s.status !== 'available') return s.status;
    if (!timestamp(s.asOf) || typeof s.maxHours !== 'number') return 'checked at assembly';
    return now >= Date.parse(s.asOf) + s.maxHours * 3600000 ? 'stale' : s.status;
  }
  return { valid, marketCardValid, expired, ideaCurrent, expiryKey, coverageStatus };
}
