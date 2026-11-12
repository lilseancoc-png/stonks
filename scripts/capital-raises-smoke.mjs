// Offline regression checks for the deterministic capital-raise classifier.

import assert from "node:assert/strict";
import {
  capitalRaiseActionIsExplicit,
  capitalRaiseHeadlineMatchesIssuer,
  capitalRaiseIssuerIsSubject,
  capitalRaiseFiledIsRecent,
  classifyCapitalRaiseHeadline,
} from "./build.mjs";

function accepted(sym, companyName, title) {
  const kind = classifyCapitalRaiseHeadline(title);
  return !!kind && capitalRaiseHeadlineMatchesIssuer(sym, companyName, title) &&
    capitalRaiseActionIsExplicit(kind, title) && capitalRaiseIssuerIsSubject(sym, companyName, kind, title);
}

assert.equal(accepted("BAC", "Bank of America Corporation", "Bank of America announces a $1 billion debt offering"), true);
assert.equal(accepted("BAC", "Bank of America Corporation", "Regional bank XYZ announces a $1 billion debt offering"), false);
assert.equal(accepted("GM", "General Motors Company", "General Motors announces a $5 billion debt offering"), true);
assert.equal(accepted("GM", "General Motors Company", "General Electric announces a $5 billion debt offering"), false);
assert.equal(accepted("SQ", "Block, Inc.", "Block announces a $750 million notes offering"), true);
assert.equal(accepted("TGT", "Target Corporation", "Analyst raises price target after Acme announces a debt offering"), false);
assert.equal(accepted("NVDA", "NVIDIA Corporation", "NVIDIA prices a $2 billion notes offering"), true);
assert.equal(accepted("NVDA", "NVIDIA Corporation", "Supplier prices a $2 billion notes offering; NVDA watches demand"), false);
assert.equal(accepted("NVDA", null, "NVDA prices a $2 billion notes offering"), true);
assert.equal(accepted("UBS", "UBS Group AG", "UBS: Micron could announce a $2 billion stock offering"), false);

// Audit 2026-11-12, real headlines from the live feed: a company named only
// after another issuer's deal, or as a buyer of it, is not the issuer.
const ORCL_DEAL = "Oracle Rallies 6% as $20 Billion Stock and Bond Sale Clears Funding Overhang; CoreWeave Climbs 7%, Microsoft Gains 2%";
assert.equal(accepted("ORCL", "Oracle Corporation", ORCL_DEAL), true);
assert.equal(accepted("CRWV", "CoreWeave, Inc.", ORCL_DEAL), false);
assert.equal(accepted("MSFT", "Microsoft Corporation", ORCL_DEAL), false);
assert.equal(accepted("NVDA", "NVIDIA Corporation", "Nvidia, AMD and Broadcom could buy Meta shares as part of $35 billion stock offering"), false);
assert.equal(accepted("AVGO", "Broadcom Inc.", "Meta Launches $35B Stock Offering, Plans Another $60B Program In 2027: Nvidia, AMD, Broadcom Eye Up To $5B Investment"), false);
assert.equal(accepted("META", "Meta Platforms, Inc.", "AMD To Invest $1B In Meta Stock Offering As AI Partnership Expands"), true);
assert.equal(accepted("MS", "Morgan Stanley", "Morgan Stanley (MS) Could Be 18% Undervalued Following Its New Bond Offering"), true);
// A filed amount from years ago is not "the latest filed" size.
assert.equal(capitalRaiseFiledIsRecent("2017-09-30", "2026-11-11T21:00:00Z"), false);
assert.equal(capitalRaiseFiledIsRecent("2026-06-30", "2026-11-11T21:00:00Z"), true);

console.log("capital-raises smoke test passed");
