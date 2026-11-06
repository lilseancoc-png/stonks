// Top Picks settings: roster shape, conviction bars, entry timing, exits,
// sizing and IV cost. Moved out of scripts/build.mjs (2026-11-06) with no
// change in values or behavior; build.mjs imports every name and re-exports the
// ones it exported before, so existing imports keep working. Each value still
// reads its PICKS_* environment override once, when the module loads.
// See docs/top-picks.md.
import { ENTRY_VOLATILITY_POLICY } from "./entry-volatility-risk.mjs";

export const PICKS_FILE = "picks.json";
export const GRADES_FILE = "grades.json";
// Cross-build cache for the optional AI thesis-prose gloss (hybrid: deterministic
// thesis is the source of truth, the AI just writes the natural narrative). Keyed
// per symbol:side on a signature of the structured thesis, so the gloss is only
// re-generated when the thesis composition actually changes (regime/driver/
// strategy flip) — most builds reuse it for free. Read-before-wipe / write-after.
export const PICK_THESIS_CACHE_FILE = "pick-thesis-cache.json";

// ---- Roster shape ----------------------------------------------------------
export const PICKS_COUNT = Number(process.env.PICKS_COUNT ?? 6);   // max ACTIONABLE names shipped (Strong grade + Strong thesis)
export const PICKS_WATCH_COUNT = Number(process.env.PICKS_WATCH_COUNT ?? 6); // max IDEAS/WATCH names (demoted: weak thesis or moderate grade)
// Only the TOP N data-gate survivors BY DETERMINISTIC CONVICTION are sent to
// the AI for a thesis + final grade. = PICKS_COUNT (2026-07-10, owner
// directive): the engine is deterministic-first — the deterministic grade
// alone decides WHICH six names are candidates and in what order; the AI is
// ONLY the final should-we-act check on those six (grade / veto / entry
// verdict). There is deliberately NO bench beyond the top 6: an AI reject or
// wait among them means the roster honestly ships fewer actionable picks
// (cash is a position) — it is never backfilled from below the deterministic
// cut. A name beyond the cut ships its deterministic card as a watch idea
// (buildTopPicks falls back like a keyless build; classifyPick's ai-ungraded
// demotion keeps it out of actionable while the grader is live).
export const PICKS_MAX_AI_THESES = Number(process.env.PICKS_MAX_AI_THESES ?? PICKS_COUNT);
export const PICKS_MAX_PER_SIDE = 8;                 // don't ship an all-one-way book

// ---- The conviction scale (absolute, fixed forever) ------------------------
// total = T + M + F + N + timing + ivCost.  Pillars are each clamped to +/-5,
// timing to [-8,+2], ivCost to [-2,+1], so |total| tops out ~ +/-20.
export const PICKS_MIN_CONVICTION = Number(process.env.PICKS_MIN_CONVICTION ?? 4); // actionable (Call/Put)
export const PICKS_TIER_STRONG = Number(process.env.PICKS_TIER_STRONG ?? 7);       // Strong conviction
// ---- Edge-governed selection bar (stand down harder when actually losing) ---
// computeEdgeScale already cuts SIZE when the trailing record is losing, but the
// resolved book had run a ~33% option win rate against the legacy +20%/−30% exits — an
// expectancy that needs a >60% win rate just to break even, so trading the same
// breadth of names *smaller* still trades a structurally losing book. When the
// realized option edge is materially negative, RAISE the actionable conviction
// bar toward the Strong tier so the engine ships only its highest-conviction
// reads (genuinely standing down — top-picks lessons #1 "stand down" / #6 "hold
// cash"), and relaxes automatically as the trailing record recovers.
export const PICKS_EDGE_GATE = process.env.PICKS_EDGE_GATE !== "0";       // on by default
export const PICKS_EDGE_GATE_SOFT = Number(process.env.PICKS_EDGE_GATE_SOFT ?? -8);   // edge ≤ −8% → bar +2
export const PICKS_EDGE_GATE_HARD = Number(process.env.PICKS_EDGE_GATE_HARD ?? -15);  // edge ≤ −15% → bar = Strong
export const PICKS_EDGE_GATE_MIN_N = Number(process.env.PICKS_EDGE_GATE_MIN_N ?? 12); // need this many decided closes to trust the edge
// Only closes from the last N calendar days feed the gate (2026-10-27, owner
// decision). The whole-record average could never recover once negative: a
// raised bar opens few trades, so few new closes move it. 0 = whole record.
export const PICKS_EDGE_GATE_WINDOW_DAYS = Number(process.env.PICKS_EDGE_GATE_WINDOW_DAYS ?? 10);
// While the edge gate is engaged (a losing record), an OPEN PICK needs this
// score instead of PICKS_TIER_STRONG (owner decision 2026-10-19). The candidate
// bar above alone could never bite on open picks: they already need Strong.
export const PICKS_EDGE_GATE_STRONG_BAR = Number(process.env.PICKS_EDGE_GATE_STRONG_BAR ?? 8);
export const PICKS_PILLAR_CLAMP = 5;                 // no single pillar dominates
export const PICKS_TRAJECTORY_CLAMP = 2;             // forward-trajectory nudge into the fundamentals pillar (blend, don't dominate)

// ---- Contract selection (near-the-money, 1-3 month runway) -----------------
// 2026-07-10: the window moved out (was 14-60, ideal 21-45) — picks are
// buy-and-hold-while-the-thesis-holds trades now (no time stop), and a 2-week
// contract turns a thesis trade into a theta race. 30 DTE minimum keeps early
// decay slow; the 45-75 ideal buys the thesis 1.5-2.5 months to play out.
// MAX_EXPIRATIONS must keep covering PICKS_MAX_DTE for weekly-heavy chains.
export const PICKS_MIN_DTE = 30;
export const PICKS_MAX_DTE = 90;
export const PICKS_IDEAL_DTE_LO = 45;
export const PICKS_IDEAL_DTE_HI = 75;
export const PICKS_DELTA_MIN = 0.30;
export const PICKS_DELTA_MAX = 0.50;
export const PICKS_SINGLE_DELTA_IDEAL = 0.40;
export const PICKS_DELTA_IDEAL = 0.55; // debit-spread anchor; independent of single options
export const PICKS_MAX_SPREAD_PCT = 0.12;            // bid/ask spread cap
export const PICKS_MIN_OI = 100;                      // need a real two-sided quote
export const PICKS_MAX_IV = 2.0;                       // 200% IV ceiling
export const PICKS_MAX_PREMIUM_PCT = 0.12;            // premium <= max($35, 12% of spot)
export const PICKS_MAX_PREMIUM_ABS = 35;
export const PICKS_MIN_QUALITY = 0.45;                // composite contract-quality floor

// ---- Strategy selection (structure: naked long vs defined-risk verticals) ---
// The grade decides the SIDE + conviction; selectStrategy() then decides the
// STRUCTURE from the IV regime + conviction strength + THESIS QUALITY (see
// docs/top-picks.md §Strategy). The whole point: stop reflexively buying a naked
// long into every setup, and never recommend a structure when the thesis is too
// thin to justify a defined trade. Four outcomes, one deterministic decision tree:
//   * NONE — the thesis is WEAK (assessThesisQuality tier === "weak"). We show the
//     grade but recommend no structure ("high grade, weak thesis — watch only").
//   * CREDIT vertical — the name's options are VERY RICH under the site's one IV
//     rule (lib/iv-richness.mjs: own-history percentile >= 90 AND ATM IV above
//     30-day realized vol) and the grade is a directional read: SELL the rich
//     premium on the bias side (bullish -> bull-put credit spread; bearish ->
//     bear-call), near-money short + further-OTM wing, targeting a credit
//     ~PICKS_CREDIT_WIDTH_FRAC of the strike width. High IV mean-reverts, so you
//     collect theta + a vol-contraction tailwind. Suppressed into binary events
//     (a gap maxes the loss) and on illiquid wings. (Before 2026-10-26 the credit
//     band was z >= 1.5σ or the 60th percentile.)
//   * NAKED long — RARE: very-high grade (Strong tier) AND a STRONG thesis AND IV
//     Cheap or Normal: a single long for max gamma/delta + uncapped upside,
//     accepting full premium + theta because the edge is exceptional.
//   * DEBIT vertical — the default for a grounded directional view with a non-weak
//     thesis, and the structure whenever IV is Rich but not Very rich (or Very
//     rich but event-blocked): long near-money financed by a short OTM wing. Caps
//     theta/vega + the premium at risk; capped upside is the price. A candidate
//     must clear PICKS_DEBIT_MIN_RR (reward:risk >= 1.0 — the debit can never
//     exceed half the strike width) or it is rejected, mirroring the credit
//     side's PICKS_CREDIT_WIDTH_FRAC_MIN floor.
export const PICKS_STRATEGY_AUTO = process.env.PICKS_STRATEGY_AUTO !== "0"; // off -> always naked long (legacy)
export const PICKS_SKEW_ADVERSE_RAW = Number(process.env.PICKS_SKEW_ADVERSE_RAW ?? 0.05); // 5 vol-point side premium before skew history matures
export const PICKS_CREDIT_WIDTH_FRAC = Number(process.env.PICKS_CREDIT_WIDTH_FRAC ?? 0.34); // target credit ~ 1/3 of the spread width
export const PICKS_CREDIT_WIDTH_FRAC_MIN = 0.22;      // reject a credit spread paying < this fraction of width
export const PICKS_CREDIT_SHORT_DELTA = 0.34;         // credit spread: sell ~this delta (near-the-money); the long wing is chosen by pickCreditWing to hit PICKS_CREDIT_WIDTH_FRAC
export const PICKS_DEBIT_SHORT_DELTA = 0.28;          // debit spread: short the OTM financing wing ~this delta
export const PICKS_DEBIT_MIN_RR = Number(process.env.PICKS_DEBIT_MIN_RR ?? 1.0); // reject a debit spread whose maxProfit/maxLoss < this — never pay more than width/(1+RR) (1.0 = never more than half the width)
export const PICKS_VERT_MIN_WIDTH_PCT = 0.02;         // a vertical's strikes must be >= 2% of spot apart (a real wing)
export const PICKS_VERT_MAX_SPREAD_PCT = 0.18;        // per-leg bid/ask cap on a vertical's wings (looser than a naked NTM long)
export const PICKS_VERT_MIN_OI = 50;                  // per-leg open-interest floor on a vertical's wings
export const PICKS_VERT_DELTA_BAND = 0.15;            // max |Δ| distance from the leg target — without a band, a thin chain let the "~0.34Δ" credit short silently be a 0.9Δ deep-ITM row
export const PICKS_IVRANK_STD_MIN_N = Number(process.env.PICKS_IVRANK_STD_MIN_N ?? 20); // need >= this many IV samples for a z-score
// A binary event THIS close forces a defined-risk debit (no naked long into the
// IV crush; no credit spread into the gap). Kept near the hold/contract window —
// NOT the full PICKS_MAX_DTE, or every quarterly print would block naked/credit.
export const PICKS_STRATEGY_EARNINGS_DAYS = Number(process.env.PICKS_STRATEGY_EARNINGS_DAYS ?? 14);
// DEFAULT-OFF stub. A market-wide scheduled macro print (NFP/CPI/FOMC) sets the
// book's eventRisk.active, which currently defers EVERY elevated-IV name from a
// credit spread down to a long-premium debit (selectStrategy step 1 is gated on
// !eventImminent). Because macro prints cluster ~monthly with a 5-day window,
// that means the engine almost never actually SELLS rich premium even when its
// own z-score flags it as richest. Flip this to "1" to let a DEFINED-RISK credit
// spread (width-capped, so the gap loss is bounded) fire into a *macro* event —
// it actually benefits from the post-print IV crush. Single-name EARNINGS stay
// deferred (a name-specific gap can still max the spread) and the naked-long gate
// is never relaxed. Ships OFF: retune only on RESOLVED picks, never day-1 marks.
export const PICKS_CREDIT_INTO_MACRO_EVENT = process.env.PICKS_CREDIT_INTO_MACRO_EVENT === "1";

// ---- Thesis quality (assessThesisQuality) ----------------------------------
// A name's GRADE and its THESIS are scored separately. The grade says "how
// strong is the signal"; the thesis quality says "is there a clear, multi-factor,
// testable, strategy-coherent CASE behind it" (the spec's "a Strong Thesis must
// have clear drivers + supporting evidence + clear invalidation + a logical
// strategy link"). assessThesisQuality sums an auditable 0..8 points rubric and
// maps it to strong/moderate/weak; that tier crosses the grade tier in the
// execution matrix (buildTopPicks) to decide actionable vs. watch + whether a
// strategy is recommended at all.
export const PICKS_THESIS_STRONG_SCORE = Number(process.env.PICKS_THESIS_STRONG_SCORE ?? 5); // >= this (+ hard gates) -> strong thesis
export const PICKS_THESIS_MOD_SCORE = Number(process.env.PICKS_THESIS_MOD_SCORE ?? 3);       // >= this (+ alignment) -> moderate thesis

// ---- Exits -----------------------------------------------------------------
export const PICKS_OPT_TP_PCT = 0.25;                 // +25% of premium: hard take-profit (banks half + trails when PICKS_OPT_SCALE_OUT=1)
export const PICKS_OPT_STOP_PCT = 0.50;               // cut loss at -50% of premium
// Scale-out + trail (OPT-IN since 2026-07-15): the former flat +20% take-profit caps
// every winner at ~+20%, so the scale-out banked HALF at the TP and trailed the
// runner (breakeven floor, ratcheting to peak − giveback). But with the book
// capped at PICKS_MAX_OPEN_POSITIONS, armed runners held slots open for days
// and froze enrollment — the record filled to 20 open / 0 closed inside three
// sessions. Owner call: resolve fast (flat +20% TP / −50% stop) so positions
// turn over and new picks keep enrolling; PICKS_OPT_SCALE_OUT=1 restores the
// bank-half-and-trail behavior.
export const PICKS_OPT_SCALE_OUT = process.env.PICKS_OPT_SCALE_OUT === "1";           // 1 = bank half + trail the runner at the TP
export const PICKS_OPT_TRAIL_GIVEBACK_PCT = Number(process.env.PICKS_OPT_TRAIL_GIVEBACK_PCT ?? 0.25); // runner stop = max(breakeven, peak − 25pts)
// The exit ladder's confirmed-bar structural stock stop (buildExitPlan's `cut`)
// is ENFORCED in the track record: a name that closes through it resolves
// (status hit-stop-under) even if the modeled premium hasn't printed -50% at a
// mark yet — the premium stop alone only fires at build-time marks, so gaps
// sailed straight through it. 0 = display-only (legacy).
export const PICKS_UNDERLYING_STOP = process.env.PICKS_UNDERLYING_STOP !== "0";
// There is deliberately NO time stop and NO pre-earnings exit: a position is
// held — through earnings prints, past two weeks — for as long as its thesis
// stays intact and the contract hasn't expired (resolvePickOutcome's
// thesis-broken exit is the invalidation path). The theta stop below remains:
// a dead-money bleeder is a vehicle failure, not a thesis call.
export const PICKS_THETA_STOP_PCT = 0.025;            // dead-money bleed/day ...
export const PICKS_THETA_STOP_MIN_HOLD = 4;           // ... after 4 days held
// Credit verticals decay in our favor, so they take profit / stop on a different
// scale than a long debit: bank ~half the credit captured, cut if the cost to
// buy it back runs past ~1.5x the credit received (defined-risk, but don't ride
// a loser toward max loss). Expressed as % of the credit received (the marked
// P/L base for a credit spread in markOptionToMarket). The stop default was
// -100% of the credit (buy-back ~2x) — a 2:1 inverted payoff vs the +50% TP
// that let one stopped spread erase two winners; -50% makes the gates symmetric.
export const PICKS_CREDIT_TP_PCT = Number(process.env.PICKS_CREDIT_TP_PCT ?? 0.50);   // bank +50% of the credit
export const PICKS_CREDIT_STOP_PCT = Number(process.env.PICKS_CREDIT_STOP_PCT ?? 0.50); // cut at -50% of the credit (buyback ~1.5x)

// ---- Sizing ----------------------------------------------------------------
export const PICKS_GROSS_TARGET = 0.80;               // deploy 80% of book, rest cash
export const PICKS_DISPLAY_ACCOUNT = Number(process.env.PICKS_DISPLAY_ACCOUNT ?? 25000);
export const PICKS_SIZE_FULL_ROSTER_N = 5;            // ramp gross to full at 5 names
export const PICKS_SIZE_TILT_MIN = 0.6, PICKS_SIZE_TILT_MAX = 1.4;
// A pick whose entry signal is still a wait/dip trigger (entry.now === false)
// sizes down. Since the 2026-07-10 entry gate an actionable pick is ALWAYS
// entry-confirmed (a wait-entry name demotes to the watch group), so this
// haircut now only shapes the display sizing of contract-bearing WATCH ideas.
export const PICKS_ENTRY_WAIT_SIZE_MULT = Number(process.env.PICKS_ENTRY_WAIT_SIZE_MULT ?? 0.75);
// Tactical puts are a below-bar defensive exception, so their advertised size
// reduction must survive portfolio normalization rather than being redistributed
// to the same name when the roster is small.
export const PICKS_TACTICAL_SIZE_CONFIG = Number(process.env.PICKS_TACTICAL_SIZE_MULT ?? 0.50);
export const PICKS_TACTICAL_SIZE_MULT = Number.isFinite(PICKS_TACTICAL_SIZE_CONFIG)
  ? Math.max(0.25, Math.min(0.75, PICKS_TACTICAL_SIZE_CONFIG))
  : 0.50;

// A high-cap continuation regime may favor primary-scenario alignment in rank,
// but only by a small bounded amount. Against-primary names in that state must
// already be Strong before the regime layer touches them.
export const PICKS_SCENARIO_HIGH_GROSS_MIN = Number(process.env.PICKS_SCENARIO_HIGH_GROSS_MIN ?? 0.85);
export const PICKS_PRIMARY_ALIGNMENT_SORT_NUDGE = 0.15;

// ---- One simple market regime (SPY trend + VIX) ----------------------------
export const PICKS_RISKOFF_VIX = 20;
export const PICKS_SEVERE_VIX = 28;
export const PICKS_RISKOFF_SPY = -1.0;                // SPY 1d % that confirms risk-off
export const PICKS_RISKON_SPY = 0.6;
export const PICKS_RISKOFF_GROSS = 0.6;               // de-gross multipliers
export const PICKS_SEVERE_GROSS = 0.4;
export const PICKS_RISKOFF_PUT_BAR = -3;              // tactical-put bar in risk-off (sub-conviction)

// ---- Entry-timing thresholds (also mirrored to the client live gate) -------
// Entry timing is an EXECUTION overlay, not part of directional conviction.
// Every price/volume indicator below is recomputed from one confirmed-bar cutoff.
export const PICKS_TIMING_MIN_BARS = 30;
export const PICKS_TIMING_KNIFE_RET1D = -6;           // legacy fallback when prior ATR is unavailable
export const PICKS_TIMING_KNIFE_RET3D = -8;
export const PICKS_TIMING_KNIFE_SEVERE_1D = -8;
export const PICKS_TIMING_KNIFE_SEVERE_3D = -12;
export const PICKS_TIMING_CHASE_RSI = 72;             // soft heat band in the trade direction
export const PICKS_TIMING_CHASE_DIST_SMA20 = 8;       // soft extension band
export const PICKS_TIMING_CHASE_DIST_SMA20_SOFT = 4;  // mild stretch
export const PICKS_TIMING_CHASE_52W = 0.97;           // retained for the live client gate
export const PICKS_TIMING_CHASE_RET5D = 12;           // exhaustion-confluence input
export const PICKS_TIMING_CHASE_RET3D = 10;
export const PICKS_TIMING_VOL_CONFIRM = 1.3;          // directional turn-day confirmation
export const PICKS_TIMING_VOL_DRY = 0.90;             // pullback volume vs preceding baseline
export const PICKS_TIMING_VOL_CLIMAX = 1.80;
export const PICKS_TIMING_PULLBACK_BAND = 3;          // retained for the live client gate
// 1 = the 3–7 session macro-event drag counts toward the timing score again
// (pre-2026-10-27 behavior). The 0–2 session hard wait always applies.
export const PICKS_EVENT_SOFT_BLOCKS = process.env.PICKS_EVENT_SOFT_BLOCKS === "1";
// Event-aware Top Picks (2026-11-06): open picks may enter THROUGH a macro
// event or the stock's own earnings when lib/event-play.mjs says the evidence
// agrees, instead of always waiting for the event to clear; plus the
// post-shock put lane. Top Picks only (topPicksPolicy); the shared grade and
// every other caller keep the old waits. PICKS_EVENT_AWARE=0 restores them.
export const PICKS_EVENT_AWARE = process.env.PICKS_EVENT_AWARE !== "0";
// 0 = call the AI grader even when no candidate can become an open pick.
export const PICKS_AI_SKIP_WHEN_NONE_READY = process.env.PICKS_AI_SKIP_WHEN_NONE_READY !== "0";
export const PICKS_ENTRY_READY_BAR = 2;               // execution score bar; prerequisites also bind
export const PICKS_ENTRY_EXTENDED_DIST = 4;
export const PICKS_ENTRY_EXTENDED_HARD = 15;
export const PICKS_ENTRY_CHASE_RSI_HARD = 80;
export const PICKS_ENTRY_EXTREME_DIST = 25;           // a single catastrophic extension is still a veto
export const PICKS_ENTRY_EXTREME_RSI = 88;
export const PICKS_ENTRY_EXTREME_RET5D = 20;
export const PICKS_ENTRY_PULLBACK_ATR_MULT = 1.5;     // reachable wait trigger, clamped 2–5%
export const PICKS_TIMING_IMPULSE_LOOKBACK = 20;
export const PICKS_TIMING_IMPULSE_MIN_PCT = 4;
export const PICKS_TIMING_PULLBACK_RETRACE_LO = 0.25;
export const PICKS_TIMING_PULLBACK_RETRACE_HI = 0.50;
export const PICKS_TIMING_PULLBACK_RETRACE_DEEP = 0.67;
export const PICKS_TIMING_PULLBACK_MAX_SESSIONS = 10;
export const PICKS_TIMING_STRUCTURE_MAX_ATR = 2;
export const PICKS_TIMING_MIN_RR = 1.5;
export const PICKS_TIMING_EARNINGS_HARD_DAYS = 2;
export const PICKS_TIMING_EARNINGS_DEFER_DAYS = 7;
export const PICKS_TIMING_EVENT_HARD_DAYS = 2;
export const PICKS_ENTRY_TIMING_VERSION = 5;
export const PICKS_TIMING_THRESHOLDS = Object.freeze({
  volatility: ENTRY_VOLATILITY_POLICY,
  knifeRet1d: PICKS_TIMING_KNIFE_RET1D,
  knifeRet3d: PICKS_TIMING_KNIFE_RET3D,
  chaseRsi: PICKS_TIMING_CHASE_RSI,
  chaseDistSma20: PICKS_TIMING_CHASE_DIST_SMA20,
  chaseDistSma20Soft: PICKS_TIMING_CHASE_DIST_SMA20_SOFT,
  chase52w: PICKS_TIMING_CHASE_52W,
  chaseRet5d: PICKS_TIMING_CHASE_RET5D,
  chaseRet3d: PICKS_TIMING_CHASE_RET3D,
  volConfirm: PICKS_TIMING_VOL_CONFIRM,
  volDry: PICKS_TIMING_VOL_DRY,
  extendedDist: PICKS_ENTRY_EXTENDED_DIST,
  extendedHard: PICKS_ENTRY_EXTENDED_HARD,
  rsiHard: PICKS_ENTRY_CHASE_RSI_HARD,
  minRewardRisk: PICKS_TIMING_MIN_RR,
});

// ---- IV cost ---------------------------------------------------------------
// Cheap / Rich / Very rich cut-offs live in lib/iv-richness.mjs (one rule for
// the grade, Top Picks, the Strategy builder and Trending IV).
export const PICKS_IVRANK_MIN_N = Number(process.env.PICKS_IVRANK_MIN_N ?? 10); // min IV-history entries to rank (attachIvRanks)

// ---- Overnight global-tape axis (consumed by deriveGlobalTapeAxis) ----------
// The axis is the day's saved PRE-OPEN overnight call (lib/overnight-tone.mjs,
// data/overnight-log.json), frozen at about 09:05 ET. Intraday swings in
// futures belong to the indexes axis, so the tape axis no longer re-reads the
// live session. PICKS_MACRO_GLOBAL=0 turns the axis off.
export const PICKS_MACRO_GLOBAL = process.env.PICKS_MACRO_GLOBAL !== "0";
