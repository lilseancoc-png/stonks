#!/usr/bin/env node
// Read saved `gh run view <id> --log` output. No provider calls, credentials,
// site-data writes or production telemetry. Each file must represent one run.
import { readFile, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { estimateAiBucketCost } from "./build.mjs";

export function auditTranscriptLog(text) {
  const usage = [];
  for (const line of text.split(/\r?\n/)) {
    const response = /\[ai\]\s+(\S+) earnings-call (\S+)/.exec(line);
    if (!response) continue;
    const [,symbol,model] = response;
    const counts = /in=(\d+) cached=(\d+) out=(\d+)(?: thought=(\d+))?/.exec(line);
    if (!counts) {
      usage.push({symbol,model,usageAvailable:false,ledgerEstimatedUsd:null});
      continue;
    }
    const [,input,cached,output,thought] = counts;
    const bucket = {inputTokens:Number(input),cachedTokens:Number(cached),outputTokens:Number(output),thoughtTokens:Number(thought || 0)};
    usage.push({symbol,model,usageAvailable:true,...bucket,ledgerEstimatedUsd:estimateAiBucketCost(model,bucket)});
  }
  const counts = [...text.matchAll(/earnings-calls: \d+\/\d+ names covered, (\d+) new summar(?:y|ies)/g)];
  if (counts.length > 1) throw new Error("Log contains multiple transcript runs; pass one file per run");
  const accepted = counts.length ? Number(counts[0][1]) : null;
  const failures = [...text.matchAll(/\[calls\] (\S+) summary failed: ([^\r\n]+)/g)].map((m)=>({symbol:m[1],reason:m[2]}));
  const parseFailures = [...text.matchAll(/\[calls\] (\S+) transcript fetch\/parse failed/g)].map(m=>m[1]);
  const unpricedModels = [...new Set(usage.filter(u=>u.usageAvailable && u.ledgerEstimatedUsd == null).map(u=>u.model))];
  const incompleteUsageSymbols = [...new Set(usage.filter(u=>!u.usageAvailable).map(u=>u.symbol))];
  const missingResponseUsage = accepted != null && accepted > usage.length;
  const estimatedUsd = missingResponseUsage || usage.some(u=>u.ledgerEstimatedUsd == null)
    ? null : usage.reduce((sum,u)=>sum+u.ledgerEstimatedUsd,0);
  return {
    recordedModelResponses:usage.length,
    acceptedSummaries:accepted,
    summaryFailures:failures,
    fetchOrParseFailures:parseFailures,
    ledgerEstimatedUsd:estimatedUsd,
    ledgerUsdPerAcceptedSummary:accepted > 0 && estimatedUsd != null ? estimatedUsd/accepted : null,
    unpricedModels,
    incompleteUsageSymbols,
    missingResponseUsage,
    usage,
    limitations:[
      "Accepted means published by the transcript pipeline, not independently checked for factual completeness.",
      "Estimates use the existing conservative code rates, not invoice prices. No automatic quality or model-routing decisions follow from this report.",
      "Failures without response usage metadata may have unobserved spend; this is recorded response cost, not a complete billing reconciliation.",
      "Cost per accepted summary is undefined when none were published or the final count is missing.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = [...new Set(await Promise.all(process.argv.slice(2).map(file=>realpath(file))))];
  if (!files.length) throw new Error("Usage: node scripts/audit-transcript-output.mjs saved-run.log [another-run.log]");
  const reports=[];
  for (const file of files) reports.push({file,...auditTranscriptLog(await readFile(file,"utf8"))});
  console.log(JSON.stringify(reports,null,2));
}
