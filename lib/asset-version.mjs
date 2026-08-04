import { createHash } from "node:crypto";

// Immutable assets must change URL when (and only when) their bytes change.
// A short SHA-256 prefix is deterministic across data-only rebuilds, keeps the
// collision risk negligible, and prevents a year-long cache entry from
// stranding an actual renderer change. Canonicalize text line endings so the
// same Git asset gets the same URL on Windows workstations and Linux CI.
export function contentAssetVersion(content) {
  const canonical = typeof content === "string" ? content.replace(/\r\n?/g, "\n") : content;
  return `sha256-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}
