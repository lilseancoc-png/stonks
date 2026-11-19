// Where the Webull data runner keeps its records (2026-11-19). Everything
// sits under `_stonks/webull-data/v1/` in the private R2 store, like Sports:
// outside the published data generations, so the public /data reader can't
// serve it, sync-data never pushes or deletes it, and the MCP refuses the
// `_stonks/` prefix. Objects are gzipped JSON.
import { gzipSync, gunzipSync } from "node:zlib";

export const WEBULL_DATA_PREFIX = "_stonks/webull-data/v1/";
export const WEBULL_DATA_LEASE = "webull-data";
const MAX_BYTES = 32 * 1024 * 1024;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYM = /^[A-Z][A-Z0-9.]{0,9}$/;
const OCC = /^[A-Z][A-Z0-9.]{0,5}\d{6}[CP]\d{8}$/;

export const webullDataKeys = Object.freeze({
  state: () => WEBULL_DATA_PREFIX + "state.json.gz",
  // One object per name per day: that day's saved option snapshots.
  snapshot: (date, sym) => { must(DATE.test(date) && SYM.test(sym)); return `${WEBULL_DATA_PREFIX}options/snapshots/${date}/${sym}.json.gz`; },
  snapshotDay: (date) => { must(DATE.test(date)); return `${WEBULL_DATA_PREFIX}options/snapshots/${date}/`; },
  snapshotsRoot: () => `${WEBULL_DATA_PREFIX}options/snapshots/`,
  // One object per expired contract: its whole life of daily bars.
  expired: (expiry, occ) => { must(DATE.test(expiry) && OCC.test(occ)); return `${WEBULL_DATA_PREFIX}options/expired/${expiry}/${occ}.json.gz`; },
  expiredDay: (expiry) => { must(DATE.test(expiry)); return `${WEBULL_DATA_PREFIX}options/expired/${expiry}/`; },
  expiredRoot: () => `${WEBULL_DATA_PREFIX}options/expired/`,
  // Every contract seen in our band, one object per expiry date.
  registry: (expiry) => { must(DATE.test(expiry)); return `${WEBULL_DATA_PREFIX}options/registry/${expiry}.json.gz`; },
  registryRoot: () => `${WEBULL_DATA_PREFIX}options/registry/`,
});
function must(ok) { if (!ok) throw new Error("invalid webull-data key part"); }

export const isWebullDataKey = (key) => typeof key === "string" && key.startsWith(WEBULL_DATA_PREFIX) && !key.includes("..");

export async function readGz(store, key) {
  if (!isWebullDataKey(key)) throw new Error("not a webull-data key");
  const buf = await store.rawGet(key);
  if (buf == null) return null;
  if (buf.length > MAX_BYTES) throw Object.assign(new Error("webull-data record exceeds its size ceiling"), { code: "RESOURCE_LIMIT" });
  const b = Buffer.from(buf);
  // gzip magic 1f 8b; a plain JSON object is read as-is.
  const text = b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b).toString("utf8") : b.toString("utf8");
  return JSON.parse(text);
}

export async function writeGz(store, key, value) {
  if (!isWebullDataKey(key)) throw new Error("not a webull-data key");
  const body = gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
  if (body.length > MAX_BYTES) throw Object.assign(new Error("webull-data record exceeds its size ceiling"), { code: "RESOURCE_LIMIT" });
  await store.rawPut(key, body);
  return body.length;
}
