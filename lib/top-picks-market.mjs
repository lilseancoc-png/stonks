// Top Picks policy only. Does not alter the shared grade or market desks.
// The factory is also embedded in the browser for conservative live holds.
export function topPicksMarketFactory() {
  const VERSION = '2026-10-market-fit-v1';
  const anchors = { 'risk-on': 1.05, neutral: 1, fragile: .90, 'risk-off': .75, 'severe-risk-off': .60 };
  const stateRank = { 'severe-risk-off':0, 'risk-off':1, fragile:2, neutral:3, 'risk-on':4 };
  const num = v => v == null || v === '' || typeof v === 'boolean' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
  const day = iso => String(iso || '').slice(0, 10);
  function fresh(iso, now, hours = 96) {
    const ms = Date.parse(iso || '');
    return Number.isFinite(ms) && ms <= now + 300000 && now - ms <= hours * 3600000;
  }
  function assess({ macroRegime = null, asOf = null, desks = [], previous = null, earnings = null, transition = null } = {}) {
    const now = Date.parse(asOf || '');
    const mr = macroRegime;
    const state = mr?.state === 'neutral' && mr.fragile ? 'fragile' : mr?.state || 'insufficient-data';
    const known = Object.hasOwn(anchors, state) && mr?.dataQuality?.sufficient !== false;
    const axes = mr?.axes || {};
    const sourceAt = key => mr?.inputs?.[key]?.asOf || mr?.asOf || null;
    const coreReady = known && Number.isFinite(now) && ['indexes','vix'].every(key =>
      axes[key]?.available !== false && num(axes[key]?.score) != null && fresh(sourceAt(key), now,
        mr?.inputs?.[key]?.marketState === 'REGULAR' ? .5 : 96));
    const current = desks.map(d => d.id==='market' ? {...d,asOf,available:coreReady,
      stance:state==='risk-on'?1:state==='severe-risk-off'?-2:state==='risk-off'?-1:0} :
      { ...d, available: d.available !== false && num(d.stance) != null && fresh(d.asOf, now, d.maxAgeHours ?? (['heatmap','volume'].includes(d.id)?2:96)) &&
        (!['heatmap','volume'].includes(d.id)||day(d.asOf)===day(asOf)) });
    // The regime already includes sentiment and the overnight lead. Calendar is
    // a slow overlapping price read. These are context, never new full votes.
    const independent = current.filter(d => d.available && ['heatmap','volume'].includes(d.id));
    const directions = independent.map(d => Math.sign(d.stance) * (d.strength === 'lean' ? .5 : 1));
    const session = directions.length ? directions.reduce((a,b) => a+b,0) / directions.length : 0;
    const previousAxes = previous?.axisScores || {};
    const priorReady = previous?.date && previous.date < day(asOf) && fresh(previous.date, now, 10 * 24);
    const changes = priorReady ? Object.keys(axes).filter(k => axes[k].available !== false && num(axes[k].score) != null && num(previousAxes[k]) != null)
      .map(k => ({ key:k, delta: num(axes[k].score) - previousAxes[k] })) : [];
    const down = changes.filter(x => x.delta < 0).length, up = changes.filter(x => x.delta > 0).length;
    const qqq = num(mr?.inputs?.indexes?.qqq?.pctChange1d);
    const spy = num(mr?.inputs?.indexes?.spy?.pctChange1d);
    const divergence = qqq != null && spy != null && qqq <= -1.5 && qqq - spy <= -1;
    const earningsReady = earnings?.n >= 4 && fresh(earnings.asOf, now);
    const earningsWeak = earningsReady && earnings.negativeShare >= .65 && earnings.medianMovePct <= -2;
    const forwardWarnings=num(transition?.fragility?.warningCount)??0;
    const leadingCount=num(transition?.fragility?.leadingCount)??0;
    const forwardWeak=leadingCount>=3&&forwardWarnings>=3;
    const deterioration = down >= 3 || divergence || earningsWeak || forwardWeak;
    const improvement = !deterioration && up >= 3 && session > 0;
    // Confirmation and trajectory share ONE bounded adjustment. Additional
    // warnings cannot attenuate an existing adverse grade discount.
    let confirmation = session <= -.75 ? -.05 : session >= .75 ? .05 : 0;
    const month=current.find(d=>d.id==='index-cal'&&d.available);
    if(independent.length>=2&&month?.stance<0&&session<0)confirmation=-.075;
    if (deterioration) confirmation = Math.min(confirmation, -.05);
    if (down >= 5 && session < 0) confirmation = -.10;
    if (improvement) confirmation = Math.max(confirmation, .05);
    const negative = current.filter(d => d.available && d.id !== 'gamma' && d.stance < 0).length;
    const positive = current.filter(d => d.available && d.id !== 'gamma' && d.stance > 0).length;
    const gamma = current.find(d => d.id === 'gamma' && d.available);
    const amplification = gamma?.structure === 'amplify' && session < 0 && confirmation < 0;
    if (amplification) confirmation = Math.max(-.10, confirmation - .025);
    const reasons = [
      `${state === 'fragile' ? 'Fragile' : state} market`,
      independent.length ? `${independent.filter(d => d.stance < 0).length}/${independent.length} independent session reads defensive` : 'Session confirmation unavailable',
      deterioration ? `Deteriorating${divergence ? ': QQQ weakness is broader than SPY suggests' : earningsWeak ? ': negative earnings reactions' : forwardWeak ? ': forward regime warnings' : ': multiple market axes weakening'}` : improvement ? 'Improving across market axes and participation' : 'No confirmed change in trajectory',
      amplification ? 'Negative gamma proxy can amplify the confirmed selling' : null,
    ].filter(Boolean);
    const stress=num(mr?.stress)??0;
    const severity=state==='risk-off'?-.025*clamp((-stress-3)/3,0,1):state==='severe-risk-off'?-.025*clamp((-stress-6)/6,0,1):state==='risk-on'?.025*clamp((stress-2)/6,0,1):0;
    return { version:VERSION, asOf, state, stress:num(mr?.stress), ready:coreReady, base:anchors[state]!=null?round(anchors[state]+severity,3):null,
      confirmation:round(confirmation,3), trajectory:deterioration?'deteriorating':improvement?'improving':'stable',
      counts:{current:current.filter(d=>d.available).length,total:7,defensive:negative,constructive:positive},
      desks:current, reasons, earnings:earningsReady?earnings:null,forwardWarnings,leadingCount,
      independentFamilies:independent.map(d=>d.id), axisChanges:changes,
      priorAxes:priorReady?previous:null,
      missing:coreReady?[]:['Current index and volatility evidence required'],
      sourceAxes:Object.fromEntries(Object.entries(axes).map(([key,a])=>[key,{score:a.score,available:a.available!==false,label:a.label,asOf:sourceAt(key)}])),
      // Retain the original read for request-time review. No client-supplied
      // market value can ever be promoted into the persisted decision.
      macroRegime:mr };
  }
  function score(assessment, { conviction, optionAdjusted, side = 'call', exposure = 1, tradeFloor = 4, strongBar = 7 } = {}) {
    const raw = num(conviction) ?? 0, pre = num(optionAdjusted) ?? raw;
    const signedExposure = (side === 'put' ? -1 : 1) * exposure;
    let base = 1;
    const state = assessment?.state;
    if (signedExposure > 0) base = assessment?.base ?? anchors[state] ?? 1;
    else if (signedExposure < 0) base = state === 'risk-on' ? .75 : state === 'neutral' ? 1 : state === 'fragile' ? 1 : 1.05;
    const correction = signedExposure === 0 ? 0 : (assessment?.confirmation || 0) * Math.sign(signedExposure);
    let multiplier = clamp(base + correction, .50, 1.10);
    // Support can order already Strong names. It cannot recruit a below-bar
    // stock thesis or silently promote it across the Strong threshold.
    if (!assessment?.ready) multiplier = Math.min(1, multiplier);
    let value = Math.abs(pre) * multiplier;
    if (Math.abs(pre) < strongBar && value >= strongBar) value = strongBar - .1;
    if (Math.abs(pre) < tradeFloor && value >= tradeFloor) value = Math.abs(pre);
    return {version:VERSION,stockConviction:round(raw,1),optionAdjustedConviction:round(pre,1),
      tradeScore:round(Math.sign(pre || raw) * value,1),multiplier:round(multiplier,3),exposure,tradeFloor,strongBar,
      marketState:state || 'insufficient-data',marketAsOf:assessment?.asOf || null,
      eligible:assessment?.ready===true,trajectory:assessment?.trajectory||'unknown',reasons:assessment?.reasons||[]};
  }
  function revalidate(payload, assessment, { now = Date.now(), live = false } = {}) {
    if (!payload?.rosterMeta?.marketAssessment) return payload;
    const reviewed = Date.parse(payload.builtAtIso || '');
    const mr=assessment?.macroRegime;
    const coreCurrent=['indexes','vix'].every(key=>mr?.axes?.[key]?.available!==false&&num(mr?.axes?.[key]?.score)!=null&&
      fresh(mr?.inputs?.[key]?.asOf||mr?.asOf,now,mr?.inputs?.[key]?.marketState==='REGULAR'?.5:96));
    const current = assessment?.ready && coreCurrent && fresh(assessment.asOf, now, 96) && fresh(payload.builtAtIso, now, 26);
    const bar = payload.rosterMeta.actionableBar ?? 7;
    return {...payload,marketCheckedAt:assessment?.asOf||null,picks:(payload.picks||[]).map(p=>{
      if (!p.marketAdjustment) return p;
      const a=score(assessment,{conviction:p.stockConviction,optionAdjusted:p.optionAdjustedConviction,side:p.side,exposure:p.marketAdjustment.exposure,tradeFloor:p.marketAdjustment.tradeFloor,strongBar:p.marketAdjustment.strongBar});
      const original=p.publishedDecision||{group:p.group,entry:p.entry,tradeScore:p.tradeScore};
      const adverse=a.tradeScore!=null && Math.abs(a.tradeScore)<bar;
      const expired=!Number.isFinite(reviewed)||!current;
      const offline=payload.rosterMeta.marketPublication==='offline-research';
      // Live review only suspends. Recovery is confirmed by the next coherent
      // publication with fresh stock timing and executable contract evidence.
      const priorHold=p.marketApproval?.held===true;
      const direction=(p.side==='put'?-1:1)*(p.marketAdjustment.exposure??1);
      const publishedRank=stateRank[payload.rosterMeta.marketAssessment.state],currentRank=stateRank[assessment?.state];
      // Compare with the actual stock publication, even when a newer market
      // report was loaded before the live quotes. A rally can oppose puts.
      const headwind=publishedRank!=null&&currentRank!=null&&(currentRank-publishedRank)*direction<0;
      const held=offline||expired||adverse||headwind||priorHold;
      const reason=offline?'Offline regeneration requires a fresh scheduled stock and contract review':expired?'Market or stock review is stale or unavailable':headwind?'A new market headwind requires a fresh stock entry review':adverse?'The current market-adjusted score is below the recommendation bar':priorHold?'Wait for a fresh stock and contract review':'Market review clears';
      const tier=Math.abs(a.tradeScore)>=a.strongBar?'strong-'+p.side:Math.abs(a.tradeScore)>=a.tradeFloor?p.side:'no-trade';
      return {...p,publishedDecision:original,tradeScore:a.tradeScore,total:a.tradeScore,score:a.tradeScore,conviction:Math.abs(a.tradeScore),marketAdjustment:a,
        recommendation:{...p.recommendation,tier,label:tier==='no-trade'?'No trade':(tier.startsWith('strong-')?'Strong ':'')+(p.side==='put'?'Put':'Call'),conviction:tier==='no-trade'?'—':tier.startsWith('strong-')?'Very High':'High'},
        marketApproval:{version:VERSION,checkedAt:assessment?.asOf||null,held,reason,thesisReviewedAt:payload.builtAtIso},
        ...(held?{group:'watch',classification:'waitEntry',entry:{...p.entry,now:false,signal:'wait-market',headline:reason}}:{})};
    })};
  }
  function liveReview(previous, legs, at) {
    if (!previous?.macroRegime) return previous;
    const now=Date.parse(at), mr=JSON.parse(JSON.stringify(previous.macroRegime));
    const oldScores=Object.fromEntries(Object.entries(mr.axes).map(([k,a])=>[k,num(a.score)||0]));
    const usable=k=>legs?.[k]&&fresh(legs[k].asOf,now,legs[k].marketState==='REGULAR'?.5:96);
    const T=mr.thresholds||{};
    let core=0;
    if(usable('spy')&&usable('qqq')&&num(legs.spy.pctChange1d)!=null&&num(legs.qqq.pctChange1d)!=null){
      const spy=legs.spy,qqq=legs.qqq,avg=(num(spy.pctChange1d)+num(qqq.pctChange1d))/2,worst=Math.min(spy.pctChange1d,qqq.pctChange1d),best=Math.max(spy.pctChange1d,qqq.pctChange1d);
      const trends=[mr.inputs.indexes?.spy,mr.inputs.indexes?.qqq],below=trends.every(l=>l?.aboveSma20===false)&&trends.some(l=>num(l?.pctChange5d)!=null&&l.pctChange5d<=-(T.index5d??3)),above=trends.every(l=>l?.aboveSma20===true)&&trends.some(l=>num(l?.pctChange5d)!=null&&l.pctChange5d>=(T.index5d??3));
      const s=avg<=-(T.index1dStrong??1.8)||worst<=-2.5?-2:avg>=(T.index1dStrong??1.8)||best>=2.5?2:avg<=-(T.index1d??.8)?-1:avg>=(T.index1d??.8)?1:below?-1:above?1:0;
      mr.axes.indexes={...mr.axes.indexes,score:s,available:true,label:`Live SPY/QQQ ${round(avg)}% average`};
      const quoteAt=Date.parse(spy.asOf)<=Date.parse(qqq.asOf)?spy.asOf:qqq.asOf;
      mr.inputs.indexes={...mr.inputs.indexes,spy:{...mr.inputs.indexes?.spy,...spy},qqq:{...mr.inputs.indexes?.qqq,...qqq},asOf:quoteAt,marketState:spy.marketState};core++;
    }
    if(usable('vix')&&num(legs.vix.value)!=null){
      const v=legs.vix.value,reversing=legs.vix.pctChange1d<=(T.vixReversal1d??-8),rising=!reversing&&mr.inputs.vix?.trend==='rising',backward=mr.inputs.vix?.backwardation;
      const s=(v>=25&&rising)||(backward&&v>=20)?-2:v>=(T.riskoffVix??22)||(rising&&v>=18)||backward?-1:v<(T.vixCalm??15)?1:v<(T.vixEasing??17)&&mr.inputs.vix?.trend==='falling'?1:reversing&&v<18?1:0;
      mr.axes.vix={...mr.axes.vix,score:s,available:true,label:`Live VIX ${round(v)}`};
      mr.inputs.vix={...mr.inputs.vix,...legs.vix,asOf:legs.vix.asOf};core++;
    }
    // These fast prices are already returned by the same fixed-symbol quote
    // request. Slow policy, credit-spread and overnight-lead evidence retains
    // its published observation time instead of being invented intraday.
    const update=(key,score,label,input)=>{mr.axes[key]={score,label,available:true};mr.inputs[key]=input;};
    if(usable('dxy')&&num(legs.dxy.pctChange1d)!=null){
      const b=mr.inputs.dxy||{},d1=legs.dxy.pctChange1d,d5=num(b.pctChange5d)??0,t=T.dxy1d??.6;
      const rising=b.trend==='rising'&&d1>-t/2,falling=b.trend==='falling'&&d1<t/2;
      const s=d1>=(T.dxy1dStrong??1.2)?-2:d1>=t||(rising&&d5>=(T.dxy5d??1))?-1:d1<=-t||(falling&&d5<=-(T.dxy5d??1))?1:0;
      update('dxy',s,`Live DXY ${round(d1)}%`,{...b,...legs.dxy});
    }
    const yields=['tenY','thirtyY'].filter(k=>usable(k)&&num(legs[k].bpsChange1d)!=null);
    if(yields.length){
      const b=mr.inputs.yields||{},ten={...b.ten,...(usable('tenY')?legs.tenY:{})},moves=yields.map(k=>legs[k].bpsChange1d),up=Math.max(...moves),down=Math.min(...moves),t=T.yieldBps1d??10;
      const rising=yields.includes('tenY')&&ten.trend==='rising'&&ten.bpsChange5d>=t&&!(ten.bpsChange1d<=-t/2),falling=yields.includes('tenY')&&ten.trend==='falling'&&ten.bpsChange5d<=-t&&!(ten.bpsChange1d>=t/2);
      const s=up>=(T.yieldBps1dStrong??16)?-2:up>=t||rising?-1:down<=-t||falling?1:0;
      update('yields',s,`Live long yields ${round(up)} bps`,{...b,ten,thirty:{...b.thirty,...(usable('thirtyY')?legs.thirtyY:{})},asOf:legs[yields[0]].asOf});
    }
    if(T.twoYOn!==false&&usable('twoY')&&num(legs.twoY.bpsChange1d)!=null){
      const b=mr.inputs.twoY||{},d1=legs.twoY.bpsChange1d,d5=num(b.bpsChange5d)??0,t=T.twoYBps1d??8;
      const s=d1>=(T.twoYBps1dStrong??14)?-2:d1>=t||(b.trend==='rising'&&d5>=t)?-1:(d1<=-t||(b.trend==='falling'&&d5<=-t))&&mr.axes.indexes.score>=0?1:0;
      update('twoY',s,`Live 2Y ${round(d1)} bps`,{...b,...legs.twoY});
    }
    if(T.bondVolOn!==false&&usable('move')&&num(legs.move.value)!=null){
      const b=mr.inputs.bondVol||{},v=legs.move.value,jump=legs.move.pctChange1d>=(T.move1d??6);
      const s=v>=(T.moveVhi??140)||(v>=(T.moveHi??110)&&jump)?-2:v>=(T.moveHi??110)?-1:v<=(T.moveCalm??80)?1:0;
      update('bondVol',s,`Live MOVE ${round(v)}`,{...b,...legs.move});
    }
    if(T.commodityOn!==false&&usable('crude')&&usable('gold')){
      const b=mr.inputs.commodity||{},oil={...b.crude,...(usable('crude')?legs.crude:{})},gold={...b.gold,...(usable('gold')?legs.gold:{})};
      const o1=num(oil.pctChange1d),o5=num(oil.pctChange5d),g1=num(gold.pctChange1d),g5=num(gold.pctChange5d);
      const spike=o1!=null&&o1>=(T.oil1d??4),shock=o1!=null&&o1>=(T.oil1dStrong??8),run=o5!=null&&o5>=(T.oil5d??12);
      const haven=((g1!=null&&g1>=(T.gold1d??3)&&!(g5!=null&&g5<0))||(g5!=null&&g5>=(T.gold5d??6)))&&['indexes','vix','dxy'].some(k=>mr.axes[k]?.score<0);
      update('commodity',shock||(spike&&haven)?-2:spike||run||haven?-1:0,'Live crude/gold shock review',{crude:oil,gold,asOf:usable('crude')?legs.crude.asOf:legs.gold.asOf});
    }
    const oldState=previous.state;
    let state=mr.state;
    if(core===2){
      if(mr.axes.indexes.score<0||mr.axes.vix.score<0||mr.axes.credit?.score<0)for(const key of ['yields','twoY'])if(mr.axes[key]?.score>0)mr.axes[key].score=0;
      const weights=T.axisWeights||{indexes:1.5,vix:1.25,dxy:.75,twoY:1,bondVol:.75,commodity:.75};
      mr.stress=round((num(mr.stress)||0)+Object.entries(mr.axes).reduce((s,[k,a])=>s+((num(a.score)||0)-(oldScores[k]||0))*(weights[k]??1),0),1);
      const clusters={vix:'vol',sentiment:'vol',globalTape:'vol',putCall:'vol',dxy:'rates',yields:'rates',fed:'rates',twoY:'rates',bondVol:'rates',inflation:'rates',indexes:'equity',breadth:'equity',rotation:'equity'};
      const excluded=new Set(T.countExclude||['sentiment']);
      const count=dir=>{
        const groups={};let raw=0;
        for(const [k,a]of Object.entries(mr.axes)){if(a.available===false||Math.sign(a.score)!==dir)continue;raw++;if(!excluded.has(k))(groups[clusters[k]||k]||=[]).push(weights[k]??1);}
        if(T.axisDecorr===false)return raw;
        return Object.values(groups).reduce((s,ws)=>{const max=Math.max(...ws);return s+max+(T.clusterDiscount??.5)*(ws.reduce((a,b)=>a+b,0)-max);},0);
      };
      const off=count(-1),on=count(1),stress=mr.stress;
      state=off>=(T.severeAxes??3)&&stress<=(T.severeStress??-4)?'severe-risk-off':off>=(T.riskoffAxes??2)&&stress<=(T.riskoffStress??0)?'risk-off':on>=(T.riskonAxes??2)&&stress>=(T.riskonStress??2)&&off<=(T.riskonMaxOff??1)&&mr.axes.indexes.score>=0&&mr.axes.vix.score>=0&&!Object.values(mr.axes).some(a=>a.score<=-2)?'risk-on':'neutral';
    }
    mr.state=state;
    const next=assess({macroRegime:mr,asOf:at,desks:previous.desks,previous:previous.priorAxes,earnings:previous.earnings,transition:{fragility:{warningCount:previous.forwardWarnings,leadingCount:previous.leadingCount}}});
    next.newHeadwind=(stateRank[next.state]??3)<(stateRank[oldState]??3);
    next.exceptionalShock=core===2&&((mr.axes.indexes.score<=-2&&(mr.axes.vix.score<=-2||(legs.vix.value>=25&&legs.vix.pctChange1d>=15)))||
      (mr.axes.indexes.score>=2&&mr.axes.vix.score>=1&&legs.vix.pctChange1d<=(T.vixReversal1d??-8)));
    next.quoteAsOf=mr.inputs.indexes?.asOf;
    next.reasons=[...next.reasons,core<2?'Fresh core quote review incomplete':'Live quote review; recovery requires a fresh stock publication'];
    return next;
  }
  return { VERSION, anchors, assess, score, revalidate, liveReview, fresh };
}
export const topPicksMarket = topPicksMarketFactory();

// Build-only adapters consume the site's existing datasets without changing
// their producers, thresholds, storage or display.
export function topPicksMarketSources({macro,heatmap,volume,calendar,overnight,gamma,earnings,asOf}) {
  const n=v=>v==null||v===''||typeof v==='boolean'?null:Number.isFinite(Number(v))?Number(v):null;
  const desk=(id,name,stance,at,extra={})=>({id,name,stance,asOf:at,available:stance!=null,...extra});
  const mr=macro?.macroRegime||macro;
  const fg=n(mr?.inputs?.sentiment?.score);
  const desks=[desk('market','Market Analysis',!mr?.state?null:mr.state==='risk-on'?1:mr.state==='severe-risk-off'?-2:mr.state==='risk-off'?-1:0,asOf),
    desk('fear-greed','Fear & Greed',fg==null?null:fg<25?-2:fg<45?-1:fg>75?2:fg>55?1:0,mr?.inputs?.sentiment?.asOf)];
  const rows=(heatmap?.tickers||[]).filter(r=>n(r.chPct??r.changePct??r.ch)!=null);
  const up=rows.filter(r=>Number(r.chPct??r.changePct??r.ch)>.05).length;
  const weight=rows.reduce((s,r)=>s+(n(r.mc)||0),0);
  const avg=weight>0?rows.reduce((s,r)=>s+Number(r.chPct??r.changePct??r.ch)*(n(r.mc)||0),0)/weight:0;
  desks.push(desk('heatmap','Heatmap',!rows.length?null:up/rows.length>=.6&&avg>=.25?1:up/rows.length<=.4&&avg<=-.25?-1:0,heatmap?.builtAtIso));
  const sectors=new Map();
  for(const r of volume?.tickers||[]){
    const hits=(r.bucketHits||[]).filter(b=>!b.scanMissed&&b.hourlyFlagged&&n(b.priceMovePct)!=null).sort((a,b)=>Math.abs(b.priceMovePct)-Math.abs(a.priceMovePct));
    const move=r.eod?.flagged?n(r.eod.dayMovePct):n(hits[0]?.priceMovePct);
    if(move==null||move===0)continue;
    const sector=r.sectorGroup||r.sector||r.s||'Tracked universe';
    sectors.set(sector,(sectors.get(sector)||0)+Math.sign(move));
  }
  const vr=[...sectors.values()].filter(v=>v!==0),bear=vr.length?vr.filter(v=>v<0).length/vr.length:.5;
  desks.push(desk('volume','Volume',!vr.length?null:bear>.52?-1:bear<.48?1:0,volume?.scannedAt||volume?.builtAtIso,{strength:bear>=.65||bear<=.35?'full':'lean'}));
  const parts=Number.isFinite(Date.parse(asOf||''))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(asOf)):[];
  const part=k=>parts.find(p=>p.type===k)?.value;
  const today=parts.length?`${part('year')}-${part('month')}-${part('day')}`:'';
  const days=[...new Map((calendar?.days||[]).filter(r=>r.date&&r.date<=today).map(r=>[r.date,r])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  const month=days.some(r=>r.date.startsWith(today.slice(0,7)))?today.slice(0,7):days.at(-1)?.date.slice(0,7);
  const cd=days.filter(r=>r.date.startsWith(month));
  const monthReturn=k=>{const observations=cd.map(r=>n(r[k]?.chPct)).filter(v=>v!=null);return observations.length?observations.reduce((a,v)=>a*(1+v/100),1)-1:null;};
  const returns=['spy','qqq','iwm','smh','dia','vxus'].map(monthReturn).filter(v=>v!=null),vixMonth=monthReturn('vix'),positive=returns.filter(v=>v>0).length;
  desks.push(desk('index-cal','Index Calendar',returns.length<4?null:positive>=Math.ceil(returns.length*.75)&&(vixMonth==null||vixMonth<=0)?1:positive<=Math.floor(returns.length*.34)&&(vixMonth==null||vixMonth>0)?-1:0,cd.at(-1)?.date,{maxAgeHours:7*24}));
  const tone=overnight?.tone||overnight?.todayCall?.tone;
  const label=String(tone?.label||'').toLowerCase();
  desks.push(desk('overnight','Overseas Markets',!tone||/insufficient|not enough/.test(label)?null:/risk.off|lean.off|defensive/.test(label)?-1:/risk.on|lean.on/.test(label)?1:0,overnight?.builtAtIso||overnight?.asOf));
  desks.push(desk('gamma','Gamma Exposure',n(gamma?.net)!=null?0:null,gamma?.asOf,{structure:n(gamma?.net)==null?null:gamma.net<0?'amplify':'dampen'}));
  return {desks,earnings};
}
