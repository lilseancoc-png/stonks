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

// API schemas intentionally omit maxItems because this backend has rejected
// the nested constrained schema. Enforce the authored limits at response entry,
// before normalization could silently trim a material final row or caveat.
export function assertTranscriptResponse(value, schema, path = "$") {
  const fail = message => {
    const err = new Error(`transcript summary ${path} ${message}; response was not clipped`);
    err.transcriptContentFailure = true;
    throw err;
  };
  if (schema.type === "string") {
    if (typeof value !== "string") fail("must be a string");
    if (schema.enum && !schema.enum.includes(value)) fail("has an unsupported value");
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("must be an array");
    if (value.length > schema.maxItems) {
      fail(`exceeds ${schema.maxItems} items`);
    }
    for (let i = 0; i < value.length; i++) assertTranscriptResponse(value[i], schema.items, `${path}[${i}]`);
  } else if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("must be an object");
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) fail(`is missing ${key}`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) assertTranscriptResponse(value[key], child, `${path}.${key}`);
    }
  }
}
