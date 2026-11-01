// The stored/public shape differs from build-time inputs: internal _bars are
// deliberately stripped. Both publication and monitoring validate this shape.
export function publishedTickerError(payload) {
  if(!(Number.isFinite(payload?.spot) && payload.spot>0))return 'invalid spot';
  if(!payload?.chains || typeof payload.chains!=='object')return 'missing chains';
  if(!payload?.technicals || typeof payload.technicals!=='object')return 'missing technicals';
  const chains=Object.values(payload.chains);
  const count=chains.reduce((sum,row)=>sum+(Array.isArray(row?.c)?row.c.length:0)+(Array.isArray(row?.p)?row.p.length:0),0);
  if(!chains.length || count<2)return 'empty/thin option chain';
  if(!Array.isArray(payload?.priceSeries?.t) || !Array.isArray(payload?.priceSeries?.c) || payload.priceSeries.t.length<20 || payload.priceSeries.c.length!==payload.priceSeries.t.length)return 'thin/invalid priceSeries';
  if(!Number.isFinite(Date.parse(payload.quoteAsOf || '')))return 'missing quoteAsOf provenance';
  return null;
}
