const DEFAULT_BACKOFF_MS = Object.freeze([500, 1500]);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTransientYahooError(err) {
  const msg = String(err?.message || err || "");
  if (
    /allowlist|401|403|429|5\d\d|ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
      msg,
    )
  )
    return true;
  // Schema failures are deterministic for the same input and should surface
  // immediately rather than burning the retry budget.
  if (/validation|schema|FailedYahooValidationError/i.test(msg)) return false;
  // Yahoo sometimes returns its legacy HTML "HTTP Status 400" page during a
  // transient chart-endpoint hiccup. Treat unknown transport-shaped failures
  // as retryable; callers still fail closed after the bounded attempt count.
  return true;
}

export function summarizeYahooError(err, maxLength = 180) {
  const raw = String(err?.message || err || "Unknown Yahoo error");
  const legacyStatus = raw.match(/HTTP Status\s+(\d+)\s*-\s*([^<\r\n]+)/i);
  if (legacyStatus) return `HTTP ${legacyStatus[1]} ${legacyStatus[2].trim()}`;
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 1)}…`
    : compact;
}

export async function withYahooRetry(
  operation,
  {
    attempts = 3,
    backoffMs = DEFAULT_BACKOFF_MS,
    isTransient = isTransientYahooError,
    sleep = defaultSleep,
    log = console.log,
    label = "Yahoo request",
  } = {},
) {
  if (typeof operation !== "function")
    throw new TypeError("operation must be a function");
  const maxAttempts = Math.max(1, Math.trunc(Number(attempts) || 1));
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) log(`    ↻ ${label} succeeded on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) break;
      const wait = backoffMs[attempt - 1] ?? backoffMs.at(-1) ?? 0;
      log(
        `    ↻ ${label} attempt ${attempt} failed (${summarizeYahooError(err)}) — retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }

  throw lastErr;
}
