// Owner settings (2026-11-10, owner request): the Owner Settings page lets an
// Owner change a short, fixed list of switches and numbers on the site instead
// of in the repo. Everything here is an override on top of the code default:
//
//   build  read by the bake. scripts/owner-settings-env.mjs (loaded with
//          `node --import` before scripts/build.mjs) copies the saved values
//          into process.env, so lib/top-picks-config.mjs and the other
//          switches read them exactly as if a repo variable were set. A value
//          already in the environment (a repo variable Sean set) wins and the
//          setting shows as pinned. Changes apply from the next build; Top
//          Picks changes from the next 11:00 or 15:30 ET run.
//   site   read at request time by api/auth/[action].js. These can only turn
//          a feature OFF. "On" means "follow the Vercel setting", so anything
//          switched off in Vercel stays off.
//
// The list is closed on purpose. Models, AI budgets, exits, grading weights,
// conviction bars, schedules, the stock list, secrets and Robinhood approvals
// stay in the repo; there is no track record reset here.
//
// Stored in owner-settings.json: Owner-only, request-time-owned (written only
// by api/auth/[action].js "owner-settings", never by a workflow). Shape:
//   { version, values: { KEY: value }, updatedAt, by, seq,
//     history: [{ id, at, by, kind, changes: [{ key, from, to }], undone? }] }
// A value missing from `values` is the default. from/to null = the default.

export const OWNER_SETTINGS_KEY = "owner-settings.json";
export const OWNER_SETTINGS_APPLIED_KEY = "owner-settings-applied.json";
export const OWNER_SETTINGS_HISTORY = 50;
export const OWNER_SETTINGS_VERSION = 1;

const DEC7 = "2026-12-07";

// kind: switch (true/false), number, choice. env(v) is the environment string
// for a non-default value. picks: changes which Top Picks trades open, so new
// trades are stamped and the Track Record draws a dated divider.
// tab + group: where the page shows it (a tab, then a section inside it).
// Every key here must be read from process.env at bake or request time.
const tape = (key, label, help) => ({ key, scope: "build", tab: "Market tape", group: "Inputs the tape reads", kind: "switch", default: true, picks: true, label, help });
export const OWNER_SETTINGS_TABS = Object.freeze(["Top Picks", "Market tape", "AI & cost", "Data & desks", "Research", "After Dec 7", "Live site"]);
export const OWNER_SETTINGS = Object.freeze([
  // --- Top Picks: engine ----------------------------------------------------
  { key: "PICKS_EVENT_AWARE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Changes which trades open around Fed days, CPI and jobs reports, and earnings. Off makes the engine wait out every event and stops post-shock puts, so far fewer trades open in event weeks.",
    label: "Event plays", help: "Trades through macro events and earnings when the evidence agrees, and post-shock puts. Off = the engine waits out events." },
  { key: "PICKS_MACRO_CONTEXT", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the guard that keeps calls and puts from fighting the rates, credit and rotation backdrop, so trades can open against the market's direction.",
    label: "Macro context block", help: "Keeps calls and puts off when they fight the rates, credit and rotation backdrop." },
  { key: "PICKS_MACRO_BLOCK_PTS", scope: "build", tab: "Top Picks", group: "Engine", kind: "number", default: 0.5, min: 0.25, max: 1.5, step: 0.25, picks: true,
    label: "Macro block strength", help: "How strongly the macro read must lean against a trade to block it. Lower blocks more trades." },
  { key: "PICKS_SINGLES_DEFAULT", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Changes the structure of every new trade. Off brings back the spread-heavy mix that lost to single options in the 2026 backtest.",
    label: "Single options by default", help: "Single calls and puts unless earnings fall inside the hold or a contract costs more than the cap. Off = the older spread-heavy mix." },
  { key: "PICKS_STRATEGY_AUTO", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off makes every new trade a plain single call or put, including into earnings and when options are very expensive. No debit or credit spreads open at all.",
    label: "Pick the option structure", help: "Chooses single, debit spread or credit spread from the IV level and events. Off = always a single call or put." },
  { key: "PICKS_EDGE_GATE", scope: "build", tab: "Top Picks", group: "Engine", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the brake that raises the bar while the recent record is losing money. In a losing streak the engine keeps opening normal trades.",
    label: "Raise the bar after losses", help: "When the recent record is losing money, only the highest-conviction names may open. Relaxes as the record recovers." },
  // --- Top Picks: book and sizes --------------------------------------------
  { key: "PICKS_COUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 6, min: 1, max: 6, step: 1, picks: true,
    label: "Most picks per run", help: "How many actionable picks a run can ship. Capped at 6 so the AI grader never reads more names than today." },
  { key: "PICKS_MAX_OPEN_POSITIONS", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 20, min: 5, max: 30, step: 1, picks: true,
    impact: "high", warn: "Sets how many trades can be open at the same time. Higher means more money at risk at once; lower means new picks wait until trades close.",
    label: "Most open trades", help: "The book's limit. Once this many trades are open, new picks wait for a slot. Open trades are never closed by this." },
  { key: "PICKS_MAX_NEW_PER_FACTOR_RUN", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 2, min: 1, max: 4, step: 1, picks: true,
    impact: "high", warn: "Higher lets one run open more trades in the same kind of stock (for example four tech names at once), so one bad day for that group hits the book harder. Lower can leave good picks waiting.",
    label: "New trades per stock group per run", help: "At most this many new trades from one group (such as tech/AI) in a single run." },
  { key: "PICKS_WATCH_COUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 6, min: 0, max: 10, step: 1,
    label: "Most watch ideas", help: "How many watch ideas show under the picks. Display only; no AI." },
  { key: "PICKS_SINGLE_MAX_COST", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 5000, min: 1000, max: 10000, step: 500, unit: "$", picks: true,
    impact: "high", warn: "Changes which picks are single options and which become spreads. Higher lets one contract cost up to this much, so a single losing trade can lose more money; lower turns more picks into debit spreads.",
    label: "Single option cost cap", help: "One contract of a single costing more than this becomes a debit spread." },
  { key: "PICKS_DISPLAY_ACCOUNT", scope: "build", tab: "Top Picks", group: "Book and sizes", kind: "number", default: 25000, min: 1000, max: 1000000, step: 1000, unit: "$",
    label: "Display account size", help: "The account size used for the suggested position sizes on cards. Display only." },
  // --- Top Picks: events ----------------------------------------------------
  { key: "PICKS_FOMC_ALWAYS_DEFER", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off lets single options open right before Fed decisions and CPI, PPI and jobs reports whenever prediction markets look sure. That is where IV crush and surprises do the most damage.",
    label: "Wait out Fed, CPI, PPI and jobs days", help: "Treats those releases as event risk inside the window however sure the odds look. Off = only coin-flip events count." },
  { key: "PICKS_EVENT_RISK", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off turns off the whole event check: entries are no longer delayed or limited before big scheduled releases.",
    label: "Event risk check", help: "Looks for big scheduled releases inside the entry window and lowers or defers entries before them." },
  { key: "PICKS_STRATEGY_EARNINGS_DAYS", scope: "build", tab: "Top Picks", group: "Events", kind: "number", default: 14, min: 0, max: 30, step: 1, unit: "days", picks: true,
    label: "Earnings window for spreads", help: "Earnings this many days out or fewer counts as inside the hold, so the pick becomes a debit spread." },
  { key: "PICKS_CREDIT_INTO_MACRO_EVENT", scope: "build", tab: "Top Picks", group: "Events", kind: "switch", default: false, picks: true,
    impact: "high", warn: "On lets credit spreads (which sell options) open with a Fed day or CPI inside the hold. A big move after the release can hit the spread's full loss.",
    label: "Credit spreads into macro events", help: "Lets a credit spread open when a macro release is inside the hold. Off keeps credit spreads out of event windows." },
  // --- Market tape ------------------------------------------------------------
  { key: "PICKS_MACRO_REGIME", scope: "build", tab: "Market tape", group: "Overall", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off makes every pick ignore the market tape: no bearish tilt, no size cut and no change to the put bar, even in a risk-off or severe market.",
    label: "Market tape on the picks", help: "The risk-on / risk-off read that tilts the book, cuts size and changes the put bar. Off = picks ignore the tape." },
  tape("PICKS_MACRO_INDEX", "Indexes (SPY and QQQ)", "The overall market's 1-day and 5-day moves."),
  tape("PICKS_MACRO_CREDIT", "Credit spreads", "High-yield spreads and the HYG/LQD ratio."),
  tape("PICKS_MACRO_BREADTH", "Breadth", "Share of covered stocks above their 50 and 200-day averages, and new highs minus new lows."),
  tape("PICKS_MACRO_PUTCALL", "Put/call", "The put/call read from covered stocks' options (or Cboe, see After Dec 7)."),
  tape("PICKS_MACRO_BONDVOL", "Bond volatility (MOVE)", "How much the bond market expects rates to swing."),
  tape("PICKS_MACRO_SENTIMENT", "Fear & Greed", "CNN's Fear & Greed index and its trend."),
  tape("PICKS_MACRO_INFLATION", "Inflation and jobs", "CPI and the unemployment trend."),
  tape("PICKS_MACRO_COMMODITY", "Oil and gold shocks", "Big moves in crude and gold."),
  tape("PICKS_MACRO_NEWS", "War, tariff and Iran headlines", "Geopolitical headlines from the last day."),
  tape("PICKS_MACRO_GLOBAL", "Overnight markets", "Asian and European sessions before the US open."),
  tape("PICKS_MACRO_ROTATION", "Sector rotation", "Defensive versus growth leadership over the past month."),
  // --- AI & cost (each can only lower AI spend) -------------------------------
  { key: "AI_THESIS", scope: "build", tab: "AI & cost", group: "AI final grader", kind: "switch", default: true, picks: true,
    impact: "high", warn: "Off removes the AI's final grade and buy-now/wait call on every pick. The AI can no longer veto a weak thesis, and trades open on the rules alone, which have not been tested without it.",
    label: "AI final grader", help: "The AI grade and buy-now/wait call on the top names. Off saves its AI cost; grades and exits are unchanged and trades are stamped grader off." },
  { key: "AI_THESIS_SEARCH", scope: "build", tab: "AI & cost", group: "AI final grader", kind: "switch", default: true, picks: true,
    label: "Web search before grading", help: "A short Google-grounded search for fresh facts before the grader decides. Off saves that call; the grader judges the site's own data." },
  // --- Data & desks -----------------------------------------------------------
  { key: "PREDICTION_MARKETS", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true, picks: true,
    label: "Prediction-market odds", help: "Kalshi and Polymarket odds for macro releases and earnings. The event risk check uses them. Off skips the fetch." },
  { key: "CROWD", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    impact: "high", warn: "Off stops new crowd readings. The crowd test that decides the After Dec 7 hooks gets no new days while it is off.",
    label: "Crowd & positioning data", help: "The free crowd sources. Off carries the last files forward." },
  { key: "CROWD_BORROW", scope: "build", tab: "Data & desks", group: "Data sources", kind: "switch", default: true,
    label: "Borrow fees (IBKR)", help: "The daily stock borrow-fee file used by the crowd page. Off carries the last reading forward." },
  { key: "LEAPS_SCORE", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "switch", default: true,
    label: "LEAPS desk", help: "Scores names for a one- to two-year hold. No AI. Off keeps the last scores." },
  { key: "STOCK_PICKS_MAX", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "number", default: 8, min: 1, max: 24, step: 1,
    label: "Stock picks shown", help: "How many quality-dip names the Stock picks desk lists. No AI." },
  { key: "EARNINGS_FORECAST_ENABLED", scope: "build", tab: "Data & desks", group: "Owner desks", kind: "switch", default: true,
    label: "Earnings Forecast refresh", help: "Refreshes the Earnings Forecast desk. Off keeps the last snapshot." },
  // --- Research and measurement ---------------------------------------------
  { key: "PICKS_RUN_ARCHIVE", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Runs made while it is off are never saved and can't be rebuilt later, so the Dec 7 engine review and later backtests have a hole for those days.",
    label: "Top Picks run archive", help: "Saves every decision run's scored universe for later tests. Measurement only." },
  { key: "REGIME_LAB", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Days while it is off are missing from the Regime Lab paper books and can't be filled in later.",
    label: "Regime Lab", help: "The Owner Lab regime paper books. Changes no pick." },
  { key: "LOOP", scope: "build", tab: "Research", group: "Measurement", kind: "switch", default: true,
    impact: "high", warn: "Off stops the prediction ledger. Chances not written on those days can't be added later, so the loop's record and the Dec 7 tuning check lose those days.",
    label: "Self-improving loop", help: "Prediction ledger, diagnosis and challengers. Off stops the measurement and keeps the prior files." },
  // --- Locked until Dec 7 -----------------------------------------------------
  { key: "PICKS_CROWD_SQUEEZE_VETO", scope: "build", tab: "After Dec 7", group: "Crowd hooks", kind: "switch", default: false, picks: true, lockedUntil: DEC7, confirm: true,
    impact: "high", warn: "Blocks new puts on hard-to-borrow names, so it changes which puts open. Turn it on only if the Evidence board shows it passing.",
    label: "Crowd squeeze veto", help: "No new puts on hard-to-borrow names. Turn on only after the Evidence table shows it clearing the bar." },
  { key: "PICKS_CROWD_GRADER", scope: "build", tab: "After Dec 7", group: "Crowd hooks", kind: "switch", default: false, picks: true, lockedUntil: DEC7, confirm: true,
    impact: "high", warn: "Changes what the AI grader reads, so its grades and buy-now calls can change on every pick.",
    label: "Crowd lines in the AI grader", help: "Adds the crowd facts to the AI grader's prompt." },
  { key: "PICKS_MACRO_PUTCALL_SRC", scope: "build", tab: "After Dec 7", group: "Crowd hooks", kind: "choice", default: "universe", picks: true, lockedUntil: DEC7, confirm: true,
    options: [["universe", "Covered stocks"], ["cboe", "Cboe equity put/call"]],
    impact: "high", warn: "Changes one of the market tape's votes, which can move the tape between neutral and risk-off and with it the whole book's tilt.",
    label: "Put/call source for the market tape", help: "Which put/call reading votes on the market tape." },
  { key: "SELF_TUNE", scope: "build", tab: "After Dec 7", group: "Self-tuning", kind: "choice", default: "shadow", picks: true, lockedUntil: DEC7, lockedValues: ["on"], confirm: true,
    options: [["shadow", "Shadow (proposals only)"], ["off", "Off (frozen base)"], ["on", "On (applies inside the limits)"]],
    impact: "high", warn: "On lets the loop change input weights by itself every week (up to 2 points per name, never flipping a side). Off freezes the loop's tuning.",
    label: "Self-tuning", help: "Shadow shows proposals and changes nothing. On applies the tuned weights inside the loop's limits, from Dec 7 only." },
  // --- Live site switches (request time, can only turn off) -------------------
  { key: "CONTACT_ENABLED", scope: "site", tab: "Live site", group: "Public", kind: "switch", default: true,
    impact: "high", warn: "Off hides the public message form for every visitor. Nobody can send a message until it is back on.",
    label: "Message box", help: "The public Send us a message form. Off stops new messages; the inbox keeps every message." },
  { key: "MCP_PUBLIC_ACCESS", scope: "site", tab: "Live site", group: "Public", kind: "switch", default: true,
    impact: "high", warn: "Off cuts off everyone who uses the MCP tools without signing in, at once.",
    label: "Public MCP tools", help: "The MCP tools anyone can use without signing in, when Vercel allows them. Off = the MCP is Owner-only." },
  { key: "SPORTS_ENABLED", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    label: "Sports section", help: "The Owner NBA, NFL and Pick Builder pages and their MCP tools." },
  { key: "MCP_ENABLED", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Off disconnects ChatGPT, Claude and every other AI client from the site at once, for both owners.",
    label: "MCP server", help: "The read-only research server for ChatGPT, Claude and other AI clients." },
  { key: "WEBULL_MIRROR", scope: "site", tab: "Live site", group: "Owner", kind: "switch", default: true,
    impact: "high", warn: "Trades that open or close while it is off are not copied when they happen, so the Webull paper record gets gaps or late fills.",
    label: "Webull paper mirror", help: "Copies Top Picks trades into the Webull paper account. Off pauses it. It only runs when Vercel has it on." },
]);

const BY_KEY = new Map(OWNER_SETTINGS.map((d) => [d.key, d]));
export const ownerSettingDef = (key) => BY_KEY.get(key) || null;

// The environment value that means "off" for each site switch.
const SITE_OFF = { CONTACT_ENABLED: "0", SPORTS_ENABLED: "0", MCP_ENABLED: "0", MCP_PUBLIC_ACCESS: "0", WEBULL_MIRROR: "off" };

export function etDate(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// True when this value may not be set yet (before the lock date).
export function isLocked(def, value, today = etDate()) {
  if (!def || !def.lockedUntil || today >= def.lockedUntil) return false;
  if (sameValue(value, def.default)) return false;
  if (Array.isArray(def.lockedValues)) return def.lockedValues.includes(value);
  return true;
}

function sameValue(a, b) { return a === b; }

// True when a change away from the default needs an "are you sure".
export const needsConfirm = (def) => !!(def && (def.confirm || def.impact === "high"));

// Clean one value for a setting; undefined when it is not allowed.
export function cleanValue(def, raw) {
  if (!def) return undefined;
  if (def.kind === "switch") {
    if (raw === true || raw === "on" || raw === "1" || raw === 1) return true;
    if (raw === false || raw === "off" || raw === "0" || raw === 0) return false;
    return undefined;
  }
  if (def.kind === "number") {
    if (raw === "" || raw == null || typeof raw === "boolean") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < def.min || n > def.max) return undefined;
    const steps = Math.round((n - def.min) / def.step);
    if (Math.abs(def.min + steps * def.step - n) > 1e-9) return undefined;
    return Math.round(n * 1e6) / 1e6;
  }
  if (def.kind === "choice") {
    const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return def.options.some((o) => o[0] === v) ? v : undefined;
  }
  return undefined;
}

// The environment string for a value.
export function envValue(def, value) {
  if (def.kind === "switch") {
    if (def.scope === "site") return value ? null : SITE_OFF[def.key];
    return value ? "1" : "0";
  }
  return String(value);
}

function emptyDoc() {
  return { version: OWNER_SETTINGS_VERSION, values: {}, updatedAt: null, by: null, seq: 0, history: [] };
}

function cleanChange(c) {
  const def = c && ownerSettingDef(c.key);
  if (!def) return null;
  const v = (x) => (x == null ? null : cleanValue(def, x) ?? null);
  return { key: def.key, from: v(c.from), to: v(c.to) };
}

// Read the stored record. A missing, unreadable or unknown record reads as
// every default, and unknown keys or out-of-range values are dropped, so a bad
// file can never push a setting outside its range.
export function readOwnerSettingsDoc(raw) {
  let doc = null;
  try {
    if (raw == null) doc = null;
    else if (typeof raw === "string") doc = JSON.parse(raw);
    else if (raw instanceof Uint8Array) doc = JSON.parse(Buffer.from(raw).toString("utf8"));
    else doc = raw;
  } catch { doc = null; }
  if (!doc || typeof doc !== "object") return emptyDoc();
  const values = {};
  const src = doc.values && typeof doc.values === "object" ? doc.values : {};
  for (const def of OWNER_SETTINGS) {
    if (!Object.prototype.hasOwnProperty.call(src, def.key)) continue;
    const v = cleanValue(def, src[def.key]);
    if (v !== undefined && !sameValue(v, def.default)) values[def.key] = v;
  }
  const history = (Array.isArray(doc.history) ? doc.history : []).filter((h) => h && typeof h === "object").slice(0, OWNER_SETTINGS_HISTORY).map((h) => ({
    id: Number.isFinite(Number(h.id)) ? Number(h.id) : 0,
    at: typeof h.at === "string" ? h.at : null,
    by: typeof h.by === "string" ? h.by.slice(0, 64) : null,
    kind: ["set", "reset", "reset-all", "undo"].includes(h.kind) ? h.kind : "set",
    changes: (Array.isArray(h.changes) ? h.changes : []).map(cleanChange).filter(Boolean),
    ...(h.undone ? { undone: true } : {}),
    ...(Number.isFinite(Number(h.of)) ? { of: Number(h.of) } : {}),
  }));
  return {
    version: OWNER_SETTINGS_VERSION,
    values,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    by: typeof doc.by === "string" ? doc.by.slice(0, 64) : null,
    seq: Number.isFinite(Number(doc.seq)) ? Number(doc.seq) : history.reduce((m, h) => Math.max(m, h.id), 0),
    history,
  };
}

export const currentValue = (doc, def) => (Object.prototype.hasOwnProperty.call(doc.values, def.key) ? doc.values[def.key] : def.default);

// Apply one Owner request:
//   { act: "set", values: { KEY: value, ... }, confirm? }
//   { act: "reset", key }        one setting back to its default
//   { act: "reset-all" }         every setting back to its default
//   { act: "undo" }              reverse the newest change not yet undone
// Returns { doc } | { doc, unchanged: true } | { error }.
export function applyOwnerSettingsRequest(current, body, { at = new Date().toISOString(), by = null } = {}) {
  const cur = readOwnerSettingsDoc(current);
  const who = typeof by === "string" && by ? by.slice(0, 64) : null;
  const today = etDate(at);
  const act = body && typeof body === "object" ? body.act : null;
  let target = null; // { KEY: value|null(default) }
  let kind = act;
  let undoOf = null;
  if (act === "set") {
    const vals = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : null;
    const keys = vals ? Object.keys(vals) : [];
    if (!keys.length || keys.length > OWNER_SETTINGS.length) return { error: "nothing to change" };
    target = {};
    for (const k of keys) {
      const def = ownerSettingDef(k);
      if (!def) return { error: `unknown setting ${String(k).slice(0, 40)}` };
      const v = cleanValue(def, vals[k]);
      if (v === undefined) return { error: `${def.label}: value out of range` };
      if (isLocked(def, v, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      target[k] = sameValue(v, def.default) ? null : v;
    }
  } else if (act === "reset") {
    const def = ownerSettingDef(body.key);
    if (!def) return { error: "unknown setting" };
    target = { [def.key]: null };
  } else if (act === "reset-all") {
    target = Object.fromEntries(OWNER_SETTINGS.map((d) => [d.key, null]));
  } else if (act === "undo") {
    const last = cur.history.find((h) => h.kind !== "undo" && !h.undone);
    if (!last) return { error: "nothing to undo" };
    target = {};
    for (const c of last.changes) {
      const def = ownerSettingDef(c.key);
      // An undo may never turn a locked value back on early.
      if (c.from != null && isLocked(def, c.from, today)) return { error: `${def.label} can't be turned on before ${def.lockedUntil}` };
      target[c.key] = c.from;
    }
    undoOf = last.id;
  } else return { error: "bad request" };

  const changes = [];
  const values = { ...cur.values };
  for (const [k, v] of Object.entries(target)) {
    const def = ownerSettingDef(k);
    const from = Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null;
    if (sameValue(from, v)) continue;
    if (v == null) delete values[k]; else values[k] = v;
    changes.push({ key: def.key, from, to: v });
  }
  if (!changes.length && undoOf == null) return { doc: cur, unchanged: true };
  // Moving a big-impact or locked-hook setting off its default needs an
  // explicit "are you sure" (body.confirm), whether by a set or an undo.
  // Going back to the default (reset, reset all) never does.
  const needs = changes.filter((c) => c.to != null && needsConfirm(ownerSettingDef(c.key)));
  if (needs.length && body.confirm !== true) return { error: `${needs.map((c) => ownerSettingDef(c.key).label).join(", ")}: needs confirmation`, needsConfirm: true };
  const id = cur.seq + 1;
  const history = cur.history.map((h) => (undoOf != null && h.id === undoOf ? { ...h, undone: true } : h));
  const entry = { id, at, by: who, kind, changes, ...(undoOf != null ? { of: undoOf } : {}) };
  return { doc: { version: OWNER_SETTINGS_VERSION, values, updatedAt: at, by: who, seq: id, history: [entry, ...history].slice(0, OWNER_SETTINGS_HISTORY) } };
}

// What the page shows: the catalog with each setting's value.
export function ownerSettingsView(doc, { today = etDate(), applied = null, env = null } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const pinned = new Set(Array.isArray(applied?.pinned) ? applied.pinned : []);
  return {
    version: d.version,
    updatedAt: d.updatedAt,
    by: d.by,
    today,
    settings: OWNER_SETTINGS.map((def) => {
      const value = currentValue(d, def);
      // A site switch is held off by Vercel when its env already says off.
      const vercelOff = def.scope === "site" && env ? siteEnvOff(def.key, env) : false;
      return {
        key: def.key, scope: def.scope, tab: def.tab, group: def.group, kind: def.kind, label: def.label, help: def.help,
        default: def.default, value, changed: !sameValue(value, def.default),
        ...(def.kind === "number" ? { min: def.min, max: def.max, step: def.step, unit: def.unit || null } : {}),
        ...(def.kind === "choice" ? { options: def.options } : {}),
        ...(def.picks ? { picks: true } : {}),
        ...(needsConfirm(def) ? { confirm: true } : {}),
        ...(def.impact === "high" ? { impact: "high", warn: def.warn } : {}),
        ...(def.lockedUntil && today < def.lockedUntil ? { lockedUntil: def.lockedUntil, lockedValues: def.lockedValues || null } : {}),
        ...(pinned.has(def.key) ? { pinned: true } : {}),
        ...(vercelOff ? { vercelOff: true } : {}),
      };
    }),
    history: d.history,
    applied: applied || null,
  };
}

function siteEnvOff(key, env) {
  const v = String(env[key] ?? "").trim().toLowerCase();
  if (key === "WEBULL_MIRROR") return v !== "on";
  if (key === "MCP_PUBLIC_ACCESS") return v !== "1";
  return v === "0";
}

// --- build side ---------------------------------------------------------------
// Copy saved build values into env. A key already set (non-empty) in env is a
// repo variable and wins (pinned). Locked values are skipped again here, so a
// hand-edited file can't switch one on early. Returns the report the build
// writes to owner-settings-applied.json and stamps on new trades.
export function applyOwnerSettingsToEnv(doc, env = process.env, { at = new Date() } = {}) {
  const d = readOwnerSettingsDoc(doc);
  const today = etDate(at);
  const applied = {}, pinned = [], skipped = [];
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "build") continue;
    const envNow = env[def.key];
    const has = envNow != null && String(envNow).trim() !== "";
    if (has) pinned.push(def.key);
    if (!Object.prototype.hasOwnProperty.call(d.values, def.key)) continue;
    const value = d.values[def.key];
    if (has) { skipped.push({ key: def.key, reason: "repo variable" }); continue; }
    if (isLocked(def, value, today)) { skipped.push({ key: def.key, reason: `locked until ${def.lockedUntil}` }); continue; }
    env[def.key] = envValue(def, value);
    applied[def.key] = value;
  }
  // Once a Top Picks setting has ever been changed here, trades opened back on
  // the defaults are stamped "default", so the Track Record starts a new
  // segment when the Owner reverts instead of folding those trades in with
  // the ones from before the Settings page existed.
  const everPicks = d.history.some((h) => h.changes.some((c) => ownerSettingDef(c.key)?.picks));
  const tag = picksTag(applied) || (everPicks ? "default" : "");
  return { appliedAt: new Date(at).toISOString(), settingsUpdatedAt: d.updatedAt, seq: d.seq, applied, pinned, skipped, picksTag: tag };
}

// Short stable tag of the applied Top Picks settings, e.g.
// "PICKS_COUNT=4,PICKS_EVENT_AWARE=off". Empty when every one is the default.
export function picksTag(applied) {
  return Object.keys(applied || {}).filter((k) => ownerSettingDef(k)?.picks).sort().map((k) => {
    const v = applied[k];
    return `${k}=${v === true ? "on" : v === false ? "off" : v}`;
  }).join(",");
}

// Plain words for a tag, for the Track Record divider.
export function describePicksTag(tag) {
  if (!tag) return "";
  if (tag === "default") return "back on the defaults";
  return String(tag).split(",").map((part) => {
    const [k, v] = part.split("=");
    const def = ownerSettingDef(k);
    return def ? `${def.label} ${v}` : part;
  }).join("; ");
}

// --- request side ---------------------------------------------------------------
// Site switches the Owner turned off, as env overrides for this request.
export function runtimeEnvOverrides(doc) {
  const d = readOwnerSettingsDoc(doc);
  const out = {};
  for (const def of OWNER_SETTINGS) {
    if (def.scope !== "site") continue;
    if (Object.prototype.hasOwnProperty.call(d.values, def.key) && d.values[def.key] === false) out[def.key] = SITE_OFF[def.key];
  }
  return out;
}
