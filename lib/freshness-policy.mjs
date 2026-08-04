import { etDateKey } from "./volume-flags.mjs";

// The fetch layer tolerates a wider transient failure band, but publication is
// deliberately stricter: a partial universe can distort cross-sectional ranks.
const requestedTickerSuccessRate = Number(process.env.FRESHNESS_MIN_TICKER_SUCCESS_RATE ?? 0.95);
export const MIN_TICKER_SUCCESS_RATE = Number.isFinite(requestedTickerSuccessRate)
  ? Math.min(1, Math.max(0.75, requestedTickerSuccessRate))
  : 0.95;

const requestedIvSuccessRate = Number(process.env.FRESHNESS_MIN_IV_SUCCESS_RATE ?? 0.9);
export const MIN_IV_SUCCESS_RATE = Number.isFinite(requestedIvSuccessRate)
  ? Math.min(1, Math.max(0.5, requestedIvSuccessRate))
  : 0.9;

function validMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function tickerInputError(data) {
  if (!(Number.isFinite(data?.spot) && data.spot > 0)) return "invalid spot";
  if (!data?.chains || typeof data.chains !== "object") return "missing chains";
  if (!data?.technicals || typeof data.technicals !== "object") return "missing technicals";
  const chainRows = Object.values(data.chains);
  const contractCount = chainRows.reduce(
    (sum, row) => sum + (Array.isArray(row?.c) ? row.c.length : 0) + (Array.isArray(row?.p) ? row.p.length : 0),
    0,
  );
  if (!chainRows.length || contractCount < 2) return "empty/thin option chain";
  if (!Array.isArray(data._bars) || data._bars.length < 20) return "thin/invalid price history";
  if (validMs(data.quoteAsOf) == null) return "missing quoteAsOf provenance";
  if (!(typeof data.marketState === "string" && data.marketState)) return "missing marketState provenance";
  return null;
}

// In-memory, pre-AI mirror of the two expensive-build blockers enforced again
// by verify-data-freshness after serialization. It never relaxes the final gate;
// it only proves when a bake is already certain to be rejected, so Gemini is not
// called for output that cannot publish.
export function assessDecisionInputsBeforeAi({
  chains,
  expectedSymbols,
  sampleIv,
  now = new Date(),
} = {}) {
  const source = chains && typeof chains === "object" ? chains : {};
  const expected = Array.isArray(expectedSymbols) ? expectedSymbols : [];
  const available = expected.filter((symbol) => source[symbol]);
  const errors = [];
  const invalid = [];
  const validRows = [];

  const minimumTickers = Math.ceil(expected.length * MIN_TICKER_SUCCESS_RATE);
  if (available.length < minimumTickers) {
    errors.push(`ticker coverage ${available.length}/${expected.length}; need at least ${minimumTickers}`);
  }

  for (const symbol of available) {
    const data = source[symbol];
    const reason = tickerInputError(data);
    if (reason) invalid.push({ symbol, reason });
    else validRows.push({ symbol, data, quoteMs: validMs(data.quoteAsOf) });
  }
  if (invalid.length) {
    errors.push(
      `${invalid.length} fetched ticker input(s) cannot pass publication: ` +
      invalid.slice(0, 8).map((row) => `${row.symbol} (${row.reason})`).join(", ") +
      (invalid.length > 8 ? ", ..." : ""),
    );
  }

  const regularCount = validRows.filter((row) => row.data.marketState === "REGULAR").length;
  const regularSession = validRows.length > 0 && regularCount >= Math.ceil(validRows.length / 2);
  let currentIvSamples = 0;
  let minimumIvSamples = Math.ceil(available.length * MIN_IV_SUCCESS_RATE);

  if (regularSession) {
    const currentEtDate = etDateKey(now);
    const staleQuotes = validRows.filter((row) => etDateKey(new Date(row.quoteMs)) !== currentEtDate);
    if (staleQuotes.length) {
      errors.push(
        `${staleQuotes.length} ticker quote(s) are not from the current ET session while the market is regular: ` +
        staleQuotes.slice(0, 8).map((row) => row.symbol).join(", ") +
        (staleQuotes.length > 8 ? ", ..." : ""),
      );
    }

    if (typeof sampleIv !== "function") throw new TypeError("sampleIv must be a function");
    currentIvSamples = validRows.filter((row) => {
      const iv = Number(sampleIv(row.data));
      return Number.isFinite(iv) && iv >= 0.02 && iv <= 5;
    }).length;
    if (currentIvSamples < minimumIvSamples) {
      errors.push(
        `current decision-grade IV coverage ${currentIvSamples}/${available.length}; ` +
        `need at least ${minimumIvSamples} during regular trading`,
      );
    }
  }

  return {
    errors,
    available: available.length,
    expected: expected.length,
    valid: validRows.length,
    invalid,
    regularCount,
    regularSession,
    currentIvSamples,
    minimumIvSamples,
  };
}
