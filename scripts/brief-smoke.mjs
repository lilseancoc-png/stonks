import assert from "node:assert/strict";
import { collectBriefSiteTools, briefUserMessage, briefClause, briefTakeNoMoves, pmNamesOneMeeting } from "./build.mjs";

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
assert.equal(scan.total, 23, "22 public evidence payloads plus Narratives should be audited");
assert.match(scan.facts.find((row) => row.source === "MA tracker")?.text || "", /ACME.*50-day average.*cross above/i);
const buyoutFact = scan.facts.find((row) => row.source === "Pending buyouts")?.text || "";
assert.match(buyoutFact, /EXM: Reported talks.*3 linked publishers/i);
assert.doesNotMatch(buyoutFact, /0d to the guided close|0\.0% current-vs-deal spread/,
  "undisclosed rumor/talks economics must stay undisclosed in the Brief");

const prompt = briefUserMessage("intraday", "2026-08-16", { toolScan: scan });
assert.match(prompt, /\[MA tracker\].*ACME/);
assert.match(prompt, /\[Pending buyouts\].*EXM/);

// Brief prose formatting: whole-English amounts, times and counts, never raw
// machine values (QC of builds #523-#572).
const fixedNow = new Date("2026-11-06T15:00:00Z");
const fixedIso = fixedNow.toISOString();
const prose = await collectBriefSiteTools({
  kind: "morning",
  narratives: [],
  dataDir: "Z:/brief-smoke-missing-data",
  now: fixedNow,
  payloads: {
    overnight: {
      builtAtIso: fixedIso,
      preopen: { today: { date: "2026-11-06", cutoffIso: "2026-11-06T14:01:29.366Z",
        tone: { label: "leaning risk-off", present: 5, gap: { call: "up", movePct: 0.7 } }, session: { call: "no-edge" } } },
    },
    "ma-tracker": {
      builtAtIso: fixedIso,
      summary: { topAbove: [], topBelow: [{ symbol: "OKTA", period: 100, direction: "below", absDistancePct: 0.23, score: 93, status: "likely", projectedSessions: 1 }] },
    },
    streaks: {
      builtAtIso: fixedIso,
      tickers: [{ symbol: "MRVL", lastEnded: { sameDays: 5, color: "red", cumulativePct: -46.9, reversalPct: 5.7, sessionsAgo: 0 } }],
    },
    raises: {
      builtAtIso: fixedIso,
      events: [{ ticker: "AAPL", kind: "debt", kindLabel: "Debt / notes", publishedAt: "2026-11-06T13:00:00Z",
        headline: "Apple prices $7.5 billion bond sale", headlineAmount: 7500000000 }],
    },
  },
});
const factText = (label) => prose.facts.find((row) => row.source === label)?.text || "";
assert.match(factText("Overnight markets"), /as of Nov 6, 09:01 ET/);
assert.match(factText("Overnight markets"), /futures indicate an up opening gap/);
assert.doesNotMatch(factText("Overnight markets"), /\d{4}-\d{2}-\d{2}T/);
assert.match(factText("MA tracker"), /~1 session at/);
assert.match(factText("Streaks"), /run \(-46\.9%\) ended today/);
assert.match(factText("Capital raises"), /headline amount: \$7\.5B/);

// The closing heatmap headline already carries the cap-weighted move; the
// standout must not repeat it (QC of builds #473-#522).
const closeNow = new Date("2026-11-06T21:12:00Z");
const closing = await collectBriefSiteTools({
  kind: "afternoon",
  narratives: [],
  dataDir: "Z:/brief-smoke-missing-data",
  now: closeNow,
  payloads: {
    heatmap: {
      builtAtIso: closeNow.toISOString(),
      eodSummary: { date: "2026-11-06", headline: "41 up, 31 down, 1 flat; cap-weighted +1.53%. Leading: Industrials & energy +8.55%.",
        stats: { avgChangeWeighted: 1.53 } },
    },
  },
});
const heatFact = closing.facts.find((row) => row.source === "Heatmap")?.text || "";
assert.match(heatFact, /cap-weighted \+1\.53%/);
assert.equal((heatFact.match(/cap-weighted/gi) || []).length, 1, "cap-weighted move is stated once");

// Headline cuts skip abbreviations; watchlist notes never quote an old move
// from a cached news take (2026-11-22: AMD "nearly 8%" on a -13% day).
assert.equal(briefClause("The U.S. Commerce Department widened chip export curbs. Shares fell."), "The U.S. Commerce Department widened chip export curbs");
assert.equal(briefClause("Nvidia Corp. said demand stays strong; guidance raised"), "Nvidia Corp. said demand stays strong");
assert.equal(briefTakeNoMoves("AMD shares rose nearly 8% after the deal. The company expects data center demand to keep growing."), "The company expects data center demand to keep growing.");
assert.equal(briefTakeNoMoves("AMD fell 13 percent today on guidance."), null);
// A two-meeting Polymarket event never fills one meeting's row.
assert.equal(pmNamesOneMeeting({ title: "Fed decision in March?", slug: "fed-decision-in-march-2027" }, "march"), true);
assert.equal(pmNamesOneMeeting({ title: "Fed decisions Dec - Mar", slug: "fed-decisions-dec-mar" }, "march"), false);
assert.equal(pmNamesOneMeeting({ title: "How many Fed cuts between December and March?" }, "december"), false);
assert.equal(pmNamesOneMeeting({ title: "What may the Fed do in March?" }, "may"), false, "may the verb is not May");

console.log("brief cross-tool coverage smoke: ok");
