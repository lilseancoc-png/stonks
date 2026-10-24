// Webull OpenAPI client for the PaperTrade (sandbox) environment only.
//
// Used by the Webull paper mirror (lib/webull-mirror.mjs, run from
// api/auth/[action].js "webull-mirror"). It signs requests the same way the
// official Python SDK (webull-openapi-python-sdk 3.x,
// webull/core/auth/composer/default_signature_composer.py) does:
//
//   sign params  = x-app-key, x-timestamp, x-signature-version,
//                  x-signature-algorithm, x-signature-nonce, host
//                  + the query params (same key: "a&b")
//   string       = uri & k1=v1&k2=v2 ... (keys sorted) [& SHA256(body) hex, upper]
//   signature    = base64(HMAC-SHA256(secret + "&", encodeURIComponent-ish(string)))
//
// Fail closed: the host must be on SANDBOX_HOSTS. There is no way to point
// this client at the live trading host, so a misconfigured env var can never
// place a real-money order.

import { createHash, createHmac, randomUUID } from "node:crypto";

export const SANDBOX_HOSTS = Object.freeze(["api.sandbox.webull.com"]);
export const DEFAULT_SANDBOX_HOST = SANDBOX_HOSTS[0];

const SIGN_VERSION = "1.0";
const OPTION_HEADERS = Object.freeze({ category: "US_OPTION" });
const SIGN_ALGORITHM = "HMAC-SHA256";

// Python's urllib.parse.quote(s, safe=""): everything but A-Z a-z 0-9 - . _ ~
// is %XX-encoded (UTF-8). encodeURIComponent also leaves ! ' ( ) * alone.
export function quoteAll(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// "2026-10-21T14:05:09Z": UTC, whole seconds (the SDK's FORMAT_ISO_8601).
export function isoSeconds(d = new Date()) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Body as the SDK serializes it: json.dumps(..., separators=(",", ":"),
// ensure_ascii=False). JSON.stringify matches for the plain objects we send.
export function compactJson(body) {
  return JSON.stringify(body);
}

// Pure signer. Returns the headers to send (host is signed but not sent; fetch
// sets it). `body` is the object to send, or null for GET.
export function signRequest({ appKey, appSecret, host, path, query = null, body = null, timestamp, nonce }) {
  const headers = {
    "x-app-key": appKey,
    "x-timestamp": timestamp || isoSeconds(),
    "x-signature-version": SIGN_VERSION,
    "x-signature-algorithm": SIGN_ALGORITHM,
    "x-signature-nonce": nonce || randomUUID(),
  };
  const params = {};
  for (const [k, v] of Object.entries(headers)) params[k.toLowerCase()] = String(v);
  params.host = host;
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      params[k] = params[k] != null ? `${params[k]}&${v}` : String(v);
    }
  }
  const keys = Object.keys(params).sort();
  let s = path + "&" + keys.map((k) => `${k}=${params[k]}`).join("&");
  if (body != null) {
    s += "&" + createHash("sha256").update(compactJson(body), "utf8").digest("hex").toUpperCase();
  }
  const signature = createHmac("sha256", appSecret + "&").update(quoteAll(s), "utf8").digest("base64");
  return { ...headers, "x-signature": signature };
}

export class WebullError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "WebullError";
    this.status = status;
    this.code = code;
  }
}

// Minimal client for the calls the mirror needs. `fetchImpl` is injectable
// for tests. Responses are parsed JSON; a non-2xx status throws WebullError
// with Webull's error code/message (never the request headers).
export function createWebullClient({ appKey, appSecret, host = DEFAULT_SANDBOX_HOST, accessToken = null, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!appKey || !appSecret) throw new WebullError("Webull app key/secret not configured", { code: "NO_CREDENTIALS" });
  if (!SANDBOX_HOSTS.includes(host)) throw new WebullError(`refusing non-sandbox Webull host ${host}`, { code: "NOT_SANDBOX" });

  async function call(method, path, { query = null, body = null, extraHeaders = null } = {}) {
    const signed = signRequest({ appKey, appSecret, host, path, query, body: method === "GET" ? null : body ?? {} });
    const headers = { ...signed, "x-version": "v3", "Content-Type": "application/json", "Accept": "application/json" };
    if (accessToken) headers["x-access-token"] = accessToken;
    if (extraHeaders) Object.assign(headers, extraHeaders);
    const qs = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`https://${host}${path}${qs}`, {
        method,
        headers,
        body: method === "GET" ? undefined : compactJson(body ?? {}),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new WebullError(`Webull ${path} request failed: ${String(err?.message || err)}`, { code: "NETWORK" });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const code = json?.error_code || json?.code || null;
      const msg = json?.message || json?.msg || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new WebullError(`Webull ${path}: ${msg}`, { status: res.status, code });
    }
    return json;
  }

  return {
    host,
    accountList: () => call("GET", "/trading/accounts/list"),
    balance: (accountId) => call("GET", "/trading/assets/balances/get", { query: { account_id: accountId } }),
    positions: (accountId) => call("GET", "/trading/assets/positions/list", { query: { account_id: accountId } }),
    openOrders: (accountId) => call("GET", "/trading/orders/open-orders/list", { query: { account_id: accountId } }),
    // Option orders carry an unsigned "category: US_OPTION" header, as the
    // SDK's add_custom_headers_from_order sets it.
    previewOrder: (accountId, newOrders) => call("POST", "/trading/orders/preview", { body: { account_id: accountId, new_orders: newOrders }, extraHeaders: OPTION_HEADERS }),
    placeOrder: (accountId, newOrders) => call("POST", "/trading/orders/place", { body: { account_id: accountId, new_orders: newOrders }, extraHeaders: OPTION_HEADERS }),
    orderDetail: (accountId, clientOrderId) => call("GET", "/trading/orders/get", { query: { account_id: accountId, client_order_id: clientOrderId } }),
    cancelOrder: (accountId, clientOrderId) => call("POST", "/trading/orders/cancel", { body: { account_id: accountId, client_order_id: clientOrderId } }),
  };
}
