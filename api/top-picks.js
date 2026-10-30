import {getSession} from '../lib/session.mjs';
import {store} from '../lib/datastore.mjs';
import macroHandler from './macro-live.js';
import {approvedTopPicks} from '../lib/top-picks-approval.mjs';
let cached=null,pending=null;
export async function topPicksLiveQuotes() {
  if(cached&&Date.now()-cached.at<30000)return cached.data;
  if(pending)return pending;
  pending=(async()=>{
    let data=null;
    const response={setHeader(){},status(code){this.statusCode=code;return this;},json(value){if(this.statusCode===200)data=value;return this;}};
    await macroHandler({method:'GET',query:{}},response);
    if(data)cached={at:Date.now(),data};
    return data;
  })().finally(()=>{pending=null;});
  return pending;
}
export function createTopPicksHandler({session=getSession,dataStore=store,quotes=topPicksLiveQuotes}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'method not allowed'});}
    if(process.env.PRIVATE_DATA_ENABLED!=='1')return res.status(404).json({error:'not found'});
    const owner=await session(req).catch(()=>null);
    if(owner?.tp!==true||owner?.tr!==true)return res.status(401).json({error:'owner role required'});
    try {
      const payload=await approvedTopPicks({store:dataStore,fetchLive:quotes});
      return payload?res.status(200).json(payload):res.status(404).json({error:'recommendations unavailable'});
    } catch {return res.status(503).json({error:'Current market approval unavailable; wait before entering a new trade'});}
  };
}
export default createTopPicksHandler();
