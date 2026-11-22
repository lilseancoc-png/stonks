// lib/mcp/journal-tools.mjs — the Owner intuition journal on the Mingstreet MCP.
//
// get_journal (Owner): the owners' own forward-looking market notes and
// calls, newest first, with the full time each was written, who wrote it, the
// call (subject, direction, target, by-date, confidence), the price and market
// numbers when it was written, the evidence picked from the site (value, page,
// as-of time; pictures are named, not sent), the result marked later and how
// many earlier versions an edited entry has. Read-only: reads the one journal
// record through ctx.journalStore (lib/mcp/read-only-store.mjs), zero AI calls.
import { JOURNAL_KEY, readJournalDoc, queryJournal, OUTCOMES, DIRECTIONS } from "../intuition-journal.mjs";

const OWNER = "owner";
const MAX_BYTES = 60_000;

export function journalTools({ fail, envelope }) {
  return [{
    name: "get_journal",
    title: "Read the intuition journal",
    audience: OWNER,
    journal: true,
    description: "The Owners' intuition journal on Mingstreet: forward-looking market notes and calls written by MiniMe and LilSean, newest first. Each entry has the exact time it was written (with year), the author, the text, tags, an optional call (subject ticker or MARKET, direction up/down/flat, target price, by-date, confidence 1-5), the price of the subject and the market (SPY, QQQ, VIX, 10-year yield, dollar, oil, gold) when it was written, evidence picked from site pages (the value or row, its page, link and as-of time; pictures are listed but not sent), the result marked later (right / wrong / mixed with a note) and the number of earlier versions if it was edited. Filter by `query` (words in the text, tags and evidence), `author`, `symbol`, `tag`, `direction`, `outcome` (right, wrong, mixed, or open = a call not yet marked), `since` / `until` (YYYY-MM-DD, by the day written) or one `id`. To check a call against today, read the subject with get_live_quotes and compare with price_when_written. Owner only; read-only.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", maxLength: 30, pattern: "^j[0-9a-z]{6,12}[0-9a-f]{8}$", description: "One entry by id (from an earlier result or an open_on_site link)." },
        query: { type: "string", maxLength: 120, description: "Words that must all appear in the entry text, tags, result note or evidence." },
        author: { type: "string", maxLength: 60, description: "Part of the author's name (MiniMe or LilSean)." },
        symbol: { type: "string", maxLength: 12, description: "Entries whose call is on this ticker (or MARKET), or that name it in the text." },
        tag: { type: "string", maxLength: 24, description: "Entries with this tag." },
        direction: { type: "string", enum: DIRECTIONS, description: "Calls in this direction." },
        outcome: { type: "string", enum: [...OUTCOMES, "open"], description: "Calls marked right, wrong or mixed, or open (a call not marked yet)." },
        since: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Written on or after this day (YYYY-MM-DD, UTC)." },
        until: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Written on or before this day (YYYY-MM-DD, UTC)." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Most entries to return (default 25)." },
        include_history: { type: "boolean", description: "Include the earlier versions of edited entries (text, tags and call before each edit)." },
      },
      additionalProperties: false,
    },
    async run(ctx, args) {
      if (!ctx.principal.owner) fail("FORBIDDEN", "Owner sign-in required");
      if (ctx.env?.JOURNAL_ENABLED === "0") fail("NOT_FOUND", "The journal is switched off");
      if (!ctx.journalStore) fail("DATA_UNAVAILABLE", "The journal is not available here");
      const doc = readJournalDoc(await ctx.journalStore.rawGet(JOURNAL_KEY));
      const results = queryJournal(doc, args, { origin: ctx.origin || "" });
      const warnings = [];
      // Keep whole entries (never cut an entry's text): drop the oldest of the
      // page until it fits.
      while (results.entries.length > 1 && Buffer.byteLength(JSON.stringify(results)) > MAX_BYTES) {
        results.entries.pop();
        results.more = true;
      }
      if (results.more) warnings.push("MORE: more entries match; narrow with since / until / query or a smaller limit.");
      if (args.id && !results.entries.length) fail("NOT_FOUND", "No journal entry has that id.");
      const newest = doc.entries.reduce((m, e) => (e.updatedAt > m ? e.updatedAt : m), "");
      return envelope(ctx, {
        tool: "get_journal",
        source: { record: "intuition journal", page: "/?journal=open" },
        payload: newest ? { updatedAt: newest } : null,
        owner: true,
        warnings,
        limitations: [
          "The owners' own opinions and predictions, written by hand; not research output and not advice.",
          "Times are when the server saved each entry (UTC); written_tz is the writer's time zone.",
        ],
        results,
      });
    },
  }];
}
