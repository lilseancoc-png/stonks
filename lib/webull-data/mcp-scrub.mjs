// Keeps Webull values out of the MCP (W3, 2026-11-19).
//
// Webull's data is shown on Owner pages only; in this wave it does not go
// through the Owner MCP either. The W3 keys themselves are denied outright
// (lib/mcp/tools.mjs DENIED_KEYS). Other Owner files can carry a Webull value
// the bake copied in: the shadow keys in grades-daily.json and trade entry
// snapshots, the Bottom tracker's Webull context row, a backup street target
// in valuation-lab.json, a Fear & Greed stand-in. scrubWebull() removes them
// from a parsed payload before any tool sees it. Pure; returns a new value.

export const WEBULL_FIELDS = Object.freeze(["wfl", "wft", "wfl5", "wbAdv", "wbHL", "wbUp5"]);
const FIELD_SET = new Set(WEBULL_FIELDS);
const BACKUP_SOURCES = new Set(["webull-backup", "Webull (backup)"]);

// Cheap pre-check on the raw text, so most payloads skip the walk.
export function mayHoldWebull(text) {
  return typeof text === "string" && /webull|"wfl5?"|"wft"|"wb(?:Adv|HL|Up5)"/i.test(text);
}

const isWebullRow = (v) => v && typeof v === "object" && !Array.isArray(v)
  && ((typeof v.id === "string" && /^webull-/.test(v.id)) || (typeof v.source === "string" && /^Webull OpenAPI/.test(v.source)));

function walk(v, depth) {
  if (depth > 40 || v == null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.filter((x) => !isWebullRow(x)).map((x) => walk(x, depth + 1));
  if (typeof v.source === "string" && BACKUP_SOURCES.has(v.source)) return { source: "webull-backup", withheld: true };
  // A shadow block ({ keys, rows }): blank the Webull columns.
  const cols = Array.isArray(v.keys) && v.rows && typeof v.rows === "object" && !Array.isArray(v.rows)
    ? v.keys.map((k, i) => (FIELD_SET.has(k) ? i : -1)).filter((i) => i >= 0) : [];
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (FIELD_SET.has(k)) continue;
    if (k === "rows" && cols.length) {
      const rows = {};
      for (const [s, row] of Object.entries(x)) rows[s] = Array.isArray(row) ? row.map((c, i) => (cols.includes(i) ? null : c)) : walk(row, depth + 1);
      out[k] = rows;
      continue;
    }
    out[k] = walk(x, depth + 1);
  }
  return out;
}

export function scrubWebull(payload) {
  return walk(payload, 0);
}
