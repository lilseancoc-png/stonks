import assert from "node:assert/strict";
import { collectBriefSiteTools, briefUserMessage } from "./build.mjs";

const nowIso = new Date().toISOString();
const scan = await collectBriefSiteTools({
  kind: "intraday",
  narratives: [],
  dataDir: "Z:/brief-smoke-missing-data",
  payloads: {
    "ma-tracker": {
      builtAtIso: nowIso,
      summary: {
        topAbove: [{
          symbol: "ACME",
          period: 50,
          direction: "above",
          absDistancePct: 0.8,
          score: 82,
          status: "likely",
          projectedSessions: 2,
        }],
        topBelow: [],
      },
    },
    buyouts: {
      builtAtIso: nowIso,
      deals: [{
        target: "Example Corp",
        targetTicker: "EXM",
        acquirer: "Buyer Inc.",
        stage: "active_talks",
        statusLabel: "Reported talks",
        coverageCount: 3,
        lastUpdateAtIso: nowIso,
        nextCatalyst: { label: "Definitive terms or talks ending" },
      }],
    },
  },
});

assert.ok(scan.checked.includes("MA tracker"));
assert.ok(scan.checked.includes("Pending buyouts"));
assert.equal(scan.total, 20, "19 public evidence payloads plus Narratives should be audited");
assert.match(scan.facts.find((row) => row.source === "MA tracker")?.text || "", /ACME.*50-day average.*cross above/i);
const buyoutFact = scan.facts.find((row) => row.source === "Pending buyouts")?.text || "";
assert.match(buyoutFact, /EXM: Reported talks.*3 linked publishers/i);
assert.doesNotMatch(buyoutFact, /0d to the guided close|0\.0% current-vs-deal spread/,
  "undisclosed rumor/talks economics must stay undisclosed in the Brief");

const prompt = briefUserMessage("intraday", "2026-08-16", { toolScan: scan });
assert.match(prompt, /\[MA tracker\].*ACME/);
assert.match(prompt, /\[Pending buyouts\].*EXM/);

console.log("brief cross-tool coverage smoke: ok");
