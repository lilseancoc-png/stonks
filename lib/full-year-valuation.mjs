// Shared pure calculations for the Owner full-year sensitivity workbench.
// Serialized to the browser; keep this factory dependency-free.
export function fullYearValuationFactory(){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const sum=xs=>xs.reduce((a,b)=>a+b,0);
  function base(c){
    const rows=(c.companyRecord?.quarters||[]),latest=rows.at(-1),same=rows.filter(q=>q.currency===latest?.currency&&q.basis===latest?.basis).slice(-4);
    const continuous=same.length===4&&same.every((q,i)=>!i||(Date.parse(q.start)-Date.parse(same[i-1].end))/86400000>=1&&(Date.parse(q.start)-Date.parse(same[i-1].end))/86400000<=20);
    const a=c.forecast.assumptions||{},f=c.valuationReference||{},mix=c.mix?.product;
    const age=(Date.parse(f.asOf||c.companyRecord?.asOf)-Date.parse(latest?.end))/86400000;
    const newerReported=Date.parse(f.reportedPeriodEnd)-Date.parse(latest?.end)>14*86400000;
    const unavailableReason=c.former?'This company left the current research list. Its frozen quarterly record remains available.':newerReported?'A newer reporting period is known. Full-year valuation waits for its supported financial statements.':!Number.isFinite(age)||age<0||age>180?'The latest supported reporting period is missing or more than 180 days old.':null;
    const ready=!unavailableReason&&continuous&&same.every(q=>finite(q.metrics.revenue?.value)&&q.metrics.revenue.value>0);
    const reportedMix=mix?.reconciliation?.status==='matched'&&mix.currency===latest?.currency&&Array.isArray(mix.rows)&&mix.rows.length&&mix.rows.every(r=>finite(r.value)&&r.value>=0);
    const total=reportedMix?sum(mix.rows.map(r=>r.value)):0;
    const lines=total>0?mix.rows.map(r=>({name:r.name,weight:r.value/total,demandPct:0,pricePct:0})):[{name:'Consolidated business',weight:1,demandPct:0,pricePct:0}];
    return {version:1,symbol:c.symbol,currency:latest?.currency||c.forecast.currency||null,status:ready?'ready':'incomplete-history',unavailableReason,
      baselineRevenue:ready?sum(same.map(q=>q.metrics.revenue.value)):null,quarters:same.map(q=>({start:q.start,end:q.end,revenue:q.metrics.revenue?.value??null})),
      latestEnd:latest?.end||null,targetStart:c.forecast.target?.start||null,
      // Four quarter-medians are an explicit annual assumption, not a reported annual result.
      inputs:{growthPct:finite(a.growthRate)?a.growthRate*100:0,grossMarginPct:finite(a.grossMargin)?a.grossMargin*100:null,operatingMarginPct:finite(a.operatingMargin)?a.operatingMargin*100:null,taxRatePct:finite(a.taxRate)?a.taxRate*100:null,nonoperating:finite(a.nonoperating)?a.nonoperating*4:null,commonIncomeAdjustment:finite(a.commonIncomeAdjustment)?a.commonIncomeAdjustment*4:null,dilutedShares:latest?.metrics.dilutedShares?.value??null,shareChangePct:0,exitMultiple:finite(f.forwardPE)&&f.forwardPE>0?f.forwardPE:null,dividendsPerShare:null,lines},
      epsSupported:finite(c.forecast.outputs?.eps)&&c.forecast.latestEnd===latest?.end,reference:f,
      mixPeriod:reportedMix?mix.period?.currentPeriod?.endDate||null:null,
      mixBasis:reportedMix?'Disclosed product mix allocated across the full-year baseline; historical shares are a scenario assumption':'Consolidated baseline',
      sourceFingerprint:JSON.stringify([c.forecast.id,c.forecast.inputKey,c.former,latest?.end,same.map(q=>q.metrics),mix,f]),
      note:'Next four fiscal quarters, approximately twelve months. A constant annual growth assumption is applied to the last four comparable seasonal quarters. Financial bridge uses explicit annual assumptions. This is an uncalibrated sensitivity, not a price forecast.'};
  }
  function calculate(b,d,{asOf=b.reference.asOf}={}){
    const unavailable=reason=>({status:'unavailable',reason,revenue:null,operatingIncome:null,netIncome:null,eps:null,target:null,priceReturnPct:null,totalReturnPct:null,requiredRevenue:null});
    if(b.status!=='ready'||!finite(b.baselineRevenue))return unavailable(b.unavailableReason||'Four consecutive same-basis reported quarters are required. Missing quarters are not annualized.');
    if(!finite(d.growthPct)||d.growthPct< -100||d.growthPct>500)return unavailable('Annual revenue growth must be between -100% and 500%.');
    if(finite(d.grossMarginPct)&&(d.grossMarginPct< -100||d.grossMarginPct>100||finite(d.operatingMarginPct)&&d.operatingMarginPct>d.grossMarginPct))return unavailable('Operating margin cannot exceed the assumed gross margin. Gross margin must be between -100% and 100%.');
    if(!Array.isArray(d.lines)||!d.lines.length||d.lines.length>40||d.lines.some(r=>!finite(r.weight)||r.weight<0||!finite(r.demandPct)||r.demandPct< -100||r.demandPct>500||!finite(r.pricePct)||r.pricePct< -100||r.pricePct>500)||Math.abs(sum(d.lines.map(r=>r.weight))-1)>1e-8)return unavailable('Business-line starting shares must total 100%, with valid demand and price assumptions.');
    const adjustedLines=d.lines.map(r=>({...r,revenue:b.baselineRevenue*(1+d.growthPct/100)*r.weight*(1+r.demandPct/100)*(1+r.pricePct/100)}));
    const revenue=sum(adjustedLines.map(r=>r.revenue));
    const operatingIncome=finite(d.operatingMarginPct)&&d.operatingMarginPct>=-100&&d.operatingMarginPct<=100?revenue*d.operatingMarginPct/100:null;
    const pretax=finite(operatingIncome)&&finite(d.nonoperating)?operatingIncome+d.nonoperating:null;
    const bridge=b.epsSupported&&finite(pretax)&&pretax>0&&finite(d.taxRatePct)&&d.taxRatePct>=0&&d.taxRatePct<=100&&finite(d.commonIncomeAdjustment)&&finite(d.dilutedShares)&&d.dilutedShares>0&&finite(d.shareChangePct)&&d.shareChangePct> -100&&d.shareChangePct<=500;
    const shares=bridge?d.dilutedShares*(1+d.shareChangePct/100):null;
    const net=bridge?pretax*(1-d.taxRatePct/100)+d.commonIncomeAdjustment:null;
    const eps=finite(net)&&net>0?net/shares:null;
    const target=finite(eps)&&finite(d.exitMultiple)&&d.exitMultiple>0&&d.exitMultiple<=200?eps*d.exitMultiple:null;
    const ref=b.reference,age=(Date.parse(asOf)-Date.parse(ref.quoteAsOf))/3600000;
    const comparable=ref.currency===b.currency&&b.currency==='USD'&&b.symbol!=='TSM'&&finite(ref.spot)&&ref.spot>0&&Number.isFinite(age)&&age>=0&&age<=96;
    const priceReturnPct=comparable&&finite(target)?(target/ref.spot-1)*100:null;
    const dividends=finite(d.dividendsPerShare)&&d.dividendsPerShare>=0?d.dividendsPerShare:null;
    const totalReturnPct=finite(priceReturnPct)&&dividends!==null?(target+dividends-ref.spot)/ref.spot*100:null;
    const requiredEps=comparable&&finite(d.exitMultiple)&&d.exitMultiple>0&&d.exitMultiple<=200?ref.spot/d.exitMultiple:null;
    const requiredRevenue=bridge&&finite(requiredEps)&&d.taxRatePct<100&&d.operatingMarginPct>0?((requiredEps*shares-d.commonIncomeAdjustment)/(1-d.taxRatePct/100)-d.nonoperating)/(d.operatingMarginPct/100):null;
    return {status:finite(eps)?'supported':'partial',revenue,operatingIncome,pretaxIncome:pretax,netIncome:finite(eps)?net:null,dilutedShares:shares,eps,target,priceReturnPct,totalReturnPct,requiredRevenue:finite(requiredRevenue)&&requiredRevenue>=0?requiredRevenue:null,requiredGrowthPct:finite(requiredRevenue)&&requiredRevenue>=0?(requiredRevenue/b.baselineRevenue-1)*100:null,adjustedLines,
      reason:!b.epsSupported?'The accepted quarterly EPS bridge is unsupported; manual inputs cannot override that source limitation.':!finite(eps)?'EPS is withheld for missing financial inputs, unsupported share changes or losses.':!comparable?'Price comparison is unavailable: source date, currency or share basis is not comparable.':!finite(target)?'Enter a positive exit P/E, up to 200×, to calculate conditional value.':null};
  }
  return {base,calculate};
}
