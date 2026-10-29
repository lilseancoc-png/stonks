import { createHash } from "node:crypto";

export function transcriptCharacterBudget(raw) {
  if (raw == null || raw === "") return 90_000;
  const chars = Number(raw);
  if (!Number.isSafeInteger(chars) || chars <= 0) {
    throw new Error("AI_TRANSCRIPT_CHARS must be a positive integer");
  }
  return Math.max(20_000, chars);
}

// Keep source selection lossless. A character-budget failure must happen before
// generation, never turn a head-only excerpt into a purported full-call read.
export function prepareTranscriptInput(text, maxChars) {
  if (typeof text !== "string" || !text.trim()) {
    const err = new Error("transcript source is empty");
    err.transcriptContentFailure = true;
    throw err;
  }
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new Error("transcript character budget must be a positive integer");
  }
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length > maxChars) {
    const err = new Error(`complete transcript exceeds input budget (${normalized.length} > ${maxChars} chars); source was not clipped`);
    err.transcriptContentFailure = true;
    throw err;
  }
  return {
    text: normalized,
    coverage: "complete",
    originalChars: text.length,
    suppliedChars: normalized.length,
    sourceHash: createHash("sha256").update(normalized).digest("hex"),
  };
}

// A response cut off at the output ceiling has still been paid for. Keep every
// value that finished before the cut by closing the brackets still open after
// the last complete element. Returns null when no object can be recovered.
export function salvageTruncatedJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  const stack = [], cuts = [];
  let inString = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") {
      stack.pop();
      if (!stack.length) break;
      cuts.push({ at: i + 1, closers: [...stack].reverse().join("") });
    } else if (c === ",") cuts.push({ at: i, closers: [...stack].reverse().join("") });
  }
  for (let k = cuts.length - 1; k >= Math.max(0, cuts.length - 200); k--) {
    try {
      const value = JSON.parse(s.slice(start, cuts[k].at) + cuts[k].closers);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
  }
  return null;
}

// API schemas intentionally omit maxItems because this backend has rejected
// the nested constrained schema, so the model can return a longer list than
// the prompt asked for. A paid response is kept whole, with nothing clipped;
// each overrun is recorded instead.
export function transcriptListOverruns(value, schema, path = "$", notes = []) {
  if (schema?.type === "array" && Array.isArray(value)) {
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) {
      notes.push({ path, issue: "over-limit", items: value.length, limit: schema.maxItems });
    }
    value.forEach((item, i) => transcriptListOverruns(item, schema.items, `${path}[${i}]`, notes));
  } else if (schema?.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) transcriptListOverruns(value[key], child, `${path}.${key}`, notes);
    }
  }
  return notes;
}
