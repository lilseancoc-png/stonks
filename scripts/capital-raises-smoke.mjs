// Offline regression checks for the deterministic capital-raise classifier.

import assert from "node:assert/strict";
import {
  capitalRaiseActionIsExplicit,
  capitalRaiseHeadlineMatchesIssuer,
  classifyCapitalRaiseHeadline,
} from "./build.mjs";

function accepted(sym, companyName, title) {
  const kind = classifyCapitalRaiseHeadline(title);
  return !!kind && capitalRaiseHeadlineMatchesIssuer(sym, companyName, title) &&
    capitalRaiseActionIsExplicit(kind, title);
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

console.log("capital-raises smoke test passed");
