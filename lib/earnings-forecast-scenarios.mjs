// One pure implementation is used by the browser and the offline contracts.
export function earningsScenarioFactory(){
  const finite=x=>typeof x==='number'&&Number.isFinite(x);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const basis=c=>JSON.stringify([c.symbol,c.forecast.id,c.forecast.inputKey,c.forecast.currency,c.forecast.outputs,c.forecast.assumptions,c.mix]);
  function mix(c,axis){
    const a=c.mix?.[axis],rows=a?.rows;
    if(!Array.isArray(rows)||!rows.length||rows.length>40||a.currency!==c.forecast.currency||a.reconciliation?.status!=='matched')return null;
    const total=rows.reduce((n,r)=>n+r.value,0);
    if(!finite(total)||total<=0||rows.some(r=>typeof r.name!=='string'||!finite(r.value)||r.value<0))return null;
    return {...a,total};
  }
  function defaults(c){
    const a=c.forecast.assumptions||{},splits={};
    for(const axis of ['product','geographic']){const m=mix(c,axis);splits[axis]=m?m.rows.map((r,i)=>({id:String(i),name:r.name,weight:r.value/m.total*100,demand:0,price:0,margin:null})):[];}
    splits.custom=[{id:'0',name:'Business line 1',weight:50,demand:0,price:0,margin:null},{id:'1',name:'Business line 2',weight:50,demand:0,price:0,margin:null}];
    return {name:'Working scenario',axis:'consolidated',revenueDelta:0,operatingMargin:finite(a.operatingMargin)?a.operatingMargin*100:null,grossMargin:finite(a.grossMargin)?a.grossMargin*100:null,taxRate:finite(a.taxRate)?a.taxRate*100:null,nonoperating:finite(a.nonoperating)?a.nonoperating/1e6:null,commonIncomeAdjustment:finite(a.commonIncomeAdjustment)?a.commonIncomeAdjustment/1e6:null,dilutedShares:finite(a.dilutedShares)?a.dilutedShares/1e6:null,splits};
  }
  function calculate(c,d){
    const errors=[],warnings=[],o=c.forecast.outputs||{};
    const check=(n,min,max,label,optional=false)=>{if(optional&&n===null)return;if(!finite(n)||n<min||n>max)errors.push(label+' must be '+min+' to '+max+'.');};
    if(!finite(o.revenue)){errors.push('The frozen revenue forecast is unavailable.');return {errors,warnings,outputs:{},rows:[]};}
    if(!['consolidated','product','geographic','custom'].includes(d?.axis))errors.push('Choose a supported revenue mix.');
    check(d?.revenueDelta,-100,500,'Overall revenue change');
    check(d?.operatingMargin,-200,100,'Operating margin',true);check(d?.grossMargin,-200,100,'Gross margin',true);check(d?.taxRate,0,100,'Tax rate',true);
    for(const k of ['nonoperating','commonIncomeAdjustment'])check(d?.[k],-1e9,1e9,k==='nonoperating'?'Nonoperating items in millions':'Common-income adjustment in millions',true);
    check(d?.dilutedShares,Number.MIN_VALUE,1e9,'Diluted shares in millions',true);
    let rows=[];
    if(d?.axis!=='consolidated'){
      const reported=['product','geographic'].includes(d?.axis),m=reported?mix(c,d.axis):null,rs=d?.splits?.[d?.axis];
      if(reported&&!m)errors.push('A same-period reconciled disclosure in the forecast currency is required for this mix.');
      if(!Array.isArray(rs)||rs.length<1||rs.length>40)errors.push('Use 1 to 40 revenue lines.');
      else{
        if(reported&&(rs.length!==m?.rows.length||rs.some((r,i)=>r.id!==String(i)||r.name!==m?.rows[i]?.name)))errors.push('Reported mix lines no longer match this source snapshot.');
        const ids=new Set();
        for(const r of rs){
          if(typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||!r.name.trim()||r.name.length>100)errors.push('Every line needs a unique identity and a name of 1 to 100 characters.');ids.add(r.id);
          check(r.weight,0,100,'Starting share');check(r.demand,-100,500,'Demand change');check(r.price,-100,500,'Price or currency change');check(r.margin,-200,100,'Line operating margin',true);
          const revenue=o.revenue*(r.weight/100)*(1+r.demand/100)*(1+r.price/100)*(1+d.revenueDelta/100),margin=r.margin===null?d.operatingMargin:r.margin;
          rows.push({...r,revenue,operatingIncome:finite(margin)?revenue*margin/100:null});
        }
        if(Math.abs(rs.reduce((n,r)=>n+r.weight,0)-100)>1e-6)errors.push('Starting shares must total 100%. Use Normalize shares or adjust the lines.');
      }
      warnings.push(d.axis==='custom'?'Custom mix is a hypothetical allocation, not an issuer disclosure.':'Reported weights are a dated starting assumption applied to the target-quarter forecast. They are not reported target-quarter revenue.');
    }
    if(errors.length)return {errors:[...new Set(errors)],warnings,outputs:{},rows:[]};
    const revenue=d.axis==='consolidated'?o.revenue*(1+d.revenueDelta/100):rows.reduce((n,r)=>n+r.revenue,0);
    const operatingIncome=d.axis==='consolidated'?(finite(d.operatingMargin)?revenue*d.operatingMargin/100:null):rows.every(r=>finite(r.operatingIncome))?rows.reduce((n,r)=>n+r.operatingIncome,0):null;
    const grossProfit=finite(d.grossMargin)?revenue*d.grossMargin/100:null;
    if(!finite(grossProfit)&&finite(operatingIncome))warnings.push('Gross margin is unknown. The operating-income assumption cannot be checked against gross profit.');
    if(finite(grossProfit)&&finite(operatingIncome)&&operatingIncome>grossProfit+Math.max(1e-6,Math.abs(grossProfit)*1e-12))return {errors:['Operating income exceeds gross profit. Review the line margins or consolidated gross margin.'],warnings,outputs:{},rows:[]};
    const pretaxIncome=finite(operatingIncome)&&finite(d.nonoperating)?operatingIncome+d.nonoperating*1e6:null;
    const taxes=pretaxIncome>0&&finite(d.taxRate)?pretaxIncome*d.taxRate/100:null;
    // An unproven base common-income bridge cannot be unlocked by a manual input.
    const netIncome=finite(o.netIncome)&&finite(pretaxIncome)&&finite(taxes)&&finite(d.commonIncomeAdjustment)?pretaxIncome-taxes+d.commonIncomeAdjustment*1e6:null;
    const eps=finite(o.eps)&&netIncome>0&&d.dilutedShares>0?netIncome/(d.dilutedShares*1e6):null;
    if(!finite(eps))warnings.push('EPS is withheld when the base bridge is unsupported, inputs are missing, or the scenario has a loss. No automatic loss tax benefit is assumed.');
    rows=rows.map(r=>({...r,resultShare:revenue>0?r.revenue/revenue:null}));
    return {errors,warnings,outputs:{revenue,grossProfit,operatingIncome,pretaxIncome,taxes,netIncome,eps},rows};
  }
  function pack(c,d){const r=calculate(c,d);if(r.errors.length)throw Error(r.errors.join(' '));const j={type:'mingstreet-earnings-scenario',version:1,symbol:c.symbol,basis:basis(c),exportedAt:new Date().toISOString(),assumptions:clone(d),results:r.outputs};unpack(c,j);return j;}
  function unpack(c,j){
    if(j?.type!=='mingstreet-earnings-scenario'||j.version!==1||j.symbol!==c.symbol||j.basis!==basis(c))throw Error('This scenario belongs to a different company or forecast/source snapshot. Open the matching snapshot before importing.');
    const d=j.assumptions;if(typeof d?.name!=='string'||!d.name.trim()||d.name.length>80)throw Error('A scenario needs a name of 1 to 80 characters.');
    // Bound inactive drafts too. Their incomplete totals can be fixed when selected.
    for(const axis of ['custom','product','geographic']){
      const rows=d.splits?.[axis];if(!Array.isArray(rows)||rows.length>40)throw Error('Invalid stored revenue lines.');
      for(const r of rows)if(!r||typeof r.id!=='string'||r.id.length>100||typeof r.name!=='string'||r.name.length>100||['weight','demand','price','margin'].some(k=>r[k]!==null&&!finite(r[k])))throw Error('Invalid stored revenue line values.');
    }
    const r=calculate(c,d);if(r.errors.length)throw Error(r.errors.join(' '));
    return clone(d);
  }
  return {basis,mix,defaults,calculate,pack,unpack};
}
