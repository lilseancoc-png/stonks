// Verified long-term issuer credit ratings for covered operating companies.
//
// Credit ratings are agency opinions, not balance-sheet fields, and agencies
// can disagree. Keep each entry agency-qualified, dated, and linked to the
// rating action. Missing companies intentionally emit no rating rather than an
// inferred or stale grade.
const ISSUER_CREDIT_RATINGS = Object.freeze({
  ORCL: Object.freeze({
    agency: "S&P",
    rating: "BBB-",
    outlook: "Stable",
    asOf: "2026-07-08",
    classification: "Lowest investment grade",
    sourceUrl: "https://www.spglobal.com/ratings/en/regulatory/article/-/view/type/HTML/id/3591397",
  }),
});

export function issuerCreditRatingFor(symbol) {
  const entry = ISSUER_CREDIT_RATINGS[String(symbol || "").toUpperCase()];
  return entry ? { ...entry } : null;
}
