import { resolve, sep } from "node:path";

// Resolve an object-store key beneath a local hydration directory. Store keys
// are external input: validate the complete set before the caller deletes or
// writes anything locally so a poisoned key cannot escape data/.
export function resolveStoreKeyPath(baseDir, key) {
  if (typeof key !== "string" || !key || key.includes("\\") || key.includes("\0")) {
    throw new Error(`unsafe private-store key: ${JSON.stringify(key)}`);
  }
  const segments = key.split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`unsafe private-store key: ${JSON.stringify(key)}`);
  }
  const base = resolve(baseDir);
  const target = resolve(base, key);
  if (!target.startsWith(`${base}${sep}`)) {
    throw new Error(`private-store key escapes data directory: ${JSON.stringify(key)}`);
  }
  return target;
}
