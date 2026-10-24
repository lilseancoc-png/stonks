// Opt-in live, read-only check. No data/ writes, AI calls, or credentials logged.
import {writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {TICKERS} from "./build.mjs";
import {collectFreeNewsSources} from "../lib/free-news-sources.mjs";
import {evidenceSourceHealth} from "../lib/news-evidence.mjs";
if(!process.argv.includes("--live")){
  console.log("No network requested. Use --live to validate the reviewed official sources for TICKERS.");
}else{
  const state=await collectFreeNewsSources({universe:TICKERS});
  const output=join(tmpdir(),"stonks-official-news-check.json");
  await writeFile(output,JSON.stringify(state,null,2));
  console.log(JSON.stringify({builtAt:state.builtAtIso,coverage:state.coverage,sources:evidenceSourceHealth(state),events:state.events.map(e=>({title:e.title,symbols:e.symbols,kind:e.kind,contextOnly:e.contextOnly,facts:e.facts})),output},null,2));
  if(Object.values(state.sources).some(s=>s.status==="error" || s.partial))process.exitCode=1;
}
