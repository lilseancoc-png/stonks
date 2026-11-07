// Event plays for the Top Picks engine (2026-11-06, owner directive: "begin
// trading events and earnings"). Pure, dependency-free rules that decide when
// an open pick may be entered THROUGH a scheduled event instead of waiting for
// it to clear, plus the post-shock put lane, the caps and the exits that
// manage those trades. build.mjs owns the wiring; this file owns the rules.
//
//   macro    FOMC / CPI / PPI / jobs inside two sessions. Trade through only
//            when the market tape agrees with the trade's side.
//   earnings The stock's own print inside two sessions. Trade through only
//            when the stock's record, this season's reactions and the run-in
//            into the print add up on the trade's side.
//   shock    A confirmed index break (risk-off tape, SPY/QQQ axis at -2 and
//            both below their 20-day average). Puts may open at the regular
//            put bar instead of the Strong bar, and close after 10 sessions.
//
// Every event trade counts toward the caps below, carries a frozen
// `eventPlay` tag in the record, and gets one post-event review. An earnings
// trade is a debit spread (selectStrategy's earnings-inside-the-hold rule).
// Since 2026-11-07 (single options by default) a macro or post-shock trade is a
// single call or put unless another structure rule applies; with
// PICKS_SINGLES_DEFAULT=0 every event-window trade is a debit spread again.

export const EVENT_PLAY_VERSION = "2026-11-06-events-v1";

export const EVENT_PLAY_LIMITS = Object.freeze({
  perEvent: 2,          // open picks trading through the same macro event
  perWeek: 4,           // event opens across the trailing 7 calendar days
  shockOpen: 2,         // post-shock puts open at once
  shockMaxSessions: 10, // post-shock follow-through fades by ~20 sessions
  reviewBar: 4,         // post-event grade on the trade's side needed to stay
  minPrints: 4,         // own earnings record needed before trading a print
  crowdedRunIn: 0.06,   // a 6%+ run-in on the trade's side is crowded
  seasonMin: 8,         // season reactions needed before the season counts
});

const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Macro: the tape has to agree with the side. Calls trade through in a
// risk-on or neutral tape (the grade's bullish lean is intentional); puts only
// in a risk-off or severe tape. A trade that fights the tape keeps the wait.
export function macroEventPlay({ side, regime, eventRisk, sessionsOut } = {}) {
  if (!eventRisk || !eventRisk.active) return null;
  const isCall = side === "call";
  const r = regime || "neutral";
  const aligned = isCall ? (r === "risk-on" || r === "neutral") : (r === "risk-off" || r === "severe");
  const label = eventRisk.label || "macro event";
  const base = {
    kind: "macro", label, date: eventRisk.date || null,
    sessionsOut: num(sessionsOut ?? eventRisk.sessionsOut),
    key: `macro:${label}:${eventRisk.date || "?"}`,
    releaseEtMin: /fomc/i.test(label) ? 840 : /jolts/i.test(label) ? 600 : 510,
    version: EVENT_PLAY_VERSION,
  };
  if (!aligned) {
    return { ...base, ok: false, reason: `the ${r} tape does not back a ${isCall ? "call" : "put"} through ${label}` };
  }
  return { ...base, ok: true, reason: `the ${r} tape backs the ${isCall ? "call" : "put"} side going into ${label}` };
}

// The stock's own reaction record: prints with a priced next-session move.
// Prefers the ~10-year long-run count when it has enough prints.
export function ownEarningsRecord(earningsHx) {
  const recent = (earningsHx?.events || []).map((e) => num(e?.movePct)).filter((v) => v != null);
  const lr = earningsHx?.longRun;
  if (lr && num(lr.n) >= EVENT_PLAY_LIMITS.minPrints * 2 && num(lr.up) != null) {
    return { n: num(lr.n), up: num(lr.up), upShare: num(lr.up) / num(lr.n), source: "long-run" };
  }
  if (!recent.length) return { n: 0, up: 0, upShare: null, source: "recent" };
  const up = recent.filter((v) => v > 0).length;
  return { n: recent.length, up, upShare: up / recent.length, source: "recent" };
}

// Earnings: three votes on the trade's side.
//   own record  +1 when ≥60% of prints moved the trade's way, −1 when ≤40%
//   season      +1 when ≥60% of this season's prints moved the trade's way,
//               −1 when ≤40% (needs EVENT_PLAY_LIMITS.seasonMin prints)
//   run-in      −1 when the stock already ran ≥6% the trade's way into the
//               print (crowded; sell-the-news risk); a put gets +1 when the
//               stock ran ≥6% UP into a season that sells prints
// Trade through when the votes total at least +1 and the stock's own record
// is not against the trade. Thin records (fewer than 4 prints) wait.
export function earningsEventPlay({ side, earningsHx, season, sessionsOut, date, symbol } = {}) {
  const isCall = side === "call";
  const own = ownEarningsRecord(earningsHx);
  const base = {
    kind: "earnings", label: "earnings", date: date || earningsHx?.next?.date || null,
    session: earningsHx?.next?.session || null,
    sessionsOut: num(sessionsOut), key: `earnings:${symbol || "?"}:${date || earningsHx?.next?.date || "?"}`,
    version: EVENT_PLAY_VERSION,
  };
  if (!(own.n >= EVENT_PLAY_LIMITS.minPrints) || own.upShare == null) {
    return { ...base, ok: false, votes: null, own, reason: `only ${own.n} priced prints on record` };
  }
  const sideShare = isCall ? own.upShare : 1 - own.upShare;
  const ownVote = sideShare >= 0.6 ? 1 : sideShare <= 0.4 ? -1 : 0;
  const sN = num(season?.n), neg = num(season?.negativeShare);
  let seasonVote = 0, seasonSide = null;
  if (sN != null && sN >= EVENT_PLAY_LIMITS.seasonMin && neg != null) {
    seasonSide = isCall ? 1 - neg : neg;
    seasonVote = seasonSide >= 0.6 ? 1 : seasonSide <= 0.4 ? -1 : 0;
  }
  const runRaw = num(earningsHx?.next?.pre10Pct);
  const runSide = runRaw == null ? null : (isCall ? runRaw : -runRaw);
  let runVote = 0;
  if (runSide != null && runSide >= EVENT_PLAY_LIMITS.crowdedRunIn) runVote = -1;
  else if (!isCall && runRaw != null && runRaw >= EVENT_PLAY_LIMITS.crowdedRunIn && seasonVote > 0) runVote = 1;
  const votes = ownVote + seasonVote + runVote;
  const ok = votes >= 1 && ownVote >= 0;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const bits = [
    `${pct(sideShare)} of ${own.n} prints moved the ${isCall ? "call" : "put"} way`,
    seasonSide != null ? `${pct(seasonSide)} of ${sN} prints this season did` : "season too thin to count",
    runRaw != null ? `run-in ${runRaw >= 0 ? "+" : ""}${(runRaw * 100).toFixed(1)}%` : "no run-in read",
  ];
  return {
    ...base, ok, votes: { own: ownVote, season: seasonVote, runIn: runVote, total: votes },
    own, seasonShare: seasonSide, runInPct: runRaw,
    reason: `${ok ? "trading the print" : "waiting for the print"}: ${bits.join("; ")}`,
  };
}

// Bottom tracker stages (lib/bottom-tracker.mjs) at which the post-shock put
// lane closes: once the selloff's causes are easing, new puts are late.
export const SHOCK_LANE_BOTTOM_STAGES = Object.freeze(["potential", "emerging", "confirmed"]);

// Post-shock lane: a confirmed broad break. Needs a risk-off or severe tape,
// the SPY/QQQ axis at −2, and both indexes below their 20-day average (one
// red day inside an uptrend is not a break). It stays shut while the Bottom
// tracker reads a potential bottom or later (`bottom` = { verdict, asOf }).
export function shockLaneState(macroRegime, indexes, bottom = null) {
  const state = macroRegime?.state || null;
  const idx = num(macroRegime?.axes?.indexes?.score);
  const legs = [indexes?.spy, indexes?.qqq].filter(Boolean);
  const below = legs.length > 0 && legs.every((l) => l.aboveSma20 === false);
  const broke = (state === "risk-off" || state === "severe-risk-off") && idx != null && idx <= -2 && below;
  const bottomHeld = broke && SHOCK_LANE_BOTTOM_STAGES.includes(bottom?.verdict) ? bottom.verdict : null;
  const active = broke && !bottomHeld;
  return {
    active, state, indexesScore: idx, belowTrend: below,
    bottomHeld,
    key: active ? `shock:${state}` : null,
    reason: active ? `confirmed index break (${state}, SPY/QQQ axis ${idx}, both below the 20-day)`
      : bottomHeld ? `index break, but the Bottom tracker reads "${bottomHeld}", so no new post-shock puts` : null,
  };
}

const DAY_MS = 86400000;

// Caps: how many event opens are already on the book. `records` = open +
// closed track-record rows (each may carry `eventPlay`).
export function eventPlayCounts(records, nowIso) {
  const now = Date.parse(nowIso);
  const perKey = {};
  let week = 0, shockOpen = 0;
  for (const r of records || []) {
    const ep = r?.eventPlay;
    if (!ep || !ep.kind) continue;
    const t = Date.parse(r.entryDate);
    const open = !r.exitDate && !r.status;
    if (Number.isFinite(t) && Number.isFinite(now) && now - t <= 7 * DAY_MS && now >= t) week++;
    if (open && ep.key) perKey[ep.key] = (perKey[ep.key] || 0) + 1;
    if (open && ep.kind === "shock") shockOpen++;
  }
  return { perKey, week, shockOpen };
}

export function eventPlayCapHit(play, counts) {
  if (!play || !counts) return null;
  if ((counts.week || 0) >= EVENT_PLAY_LIMITS.perWeek) return "week";
  if (play.kind === "shock" && (counts.shockOpen || 0) >= EVENT_PLAY_LIMITS.shockOpen) return "shock";
  if (play.kind === "macro" && play.key && (counts.perKey?.[play.key] || 0) >= EVENT_PLAY_LIMITS.perEvent) return "event";
  return null;
}

export function eventPlayCountAdd(play, counts) {
  if (!play || !counts) return;
  counts.week = (counts.week || 0) + 1;
  if (play.key) counts.perKey[play.key] = (counts.perKey[play.key] || 0) + 1;
  if (play.kind === "shock") counts.shockOpen = (counts.shockOpen || 0) + 1;
}

// When a scheduled event has resolved, in ET. Macro releases carry their ET
// release minute (8:30 for BLS, 14:00 for FOMC); an AM print resolves at the
// open; a PM or unconfirmed print resolves the next calendar day.
export function eventResolved(play, todayIso, etNowMin) {
  if (!play || !play.date || !todayIso) return false;
  const date = String(play.date).slice(0, 10);
  // Any later ET date has seen the release (a PM print trades the next day).
  if (todayIso > date) return true;
  if (todayIso < date) return false;
  // Same ET day.
  if (play.kind === "earnings") return play.session === "AM" && etNowMin != null && etNowMin >= 600;
  const releaseMin = num(play.releaseEtMin) ?? 510;
  return etNowMin != null && etNowMin >= releaseMin + 15;
}

// The one post-event review: once the event has resolved, the live grade on
// the trade's side must still clear the regular trade bar, or the position is
// closed ("event-review"). Shock trades instead close after
// EVENT_PLAY_LIMITS.shockMaxSessions sessions ("shock-time").
// Returns { status } to close, { reviewed } to stamp and hold, or null.
export function eventPlayExit(record, { todayIso, etNowMin, gradeNow, heldSessions } = {}) {
  const ep = record?.eventPlay;
  if (!ep || !ep.kind) return null;
  if (ep.kind === "shock") {
    return num(heldSessions) != null && heldSessions >= EVENT_PLAY_LIMITS.shockMaxSessions ? { status: "shock-time" } : null;
  }
  if (ep.reviewed) return null;
  if (!eventResolved(ep, todayIso, etNowMin)) return null;
  const g = num(gradeNow);
  if (g == null) return null;
  const sideGrade = record.side === "call" ? g : -g;
  if (sideGrade < EVENT_PLAY_LIMITS.reviewBar) return { status: "event-review", sideGrade };
  return { reviewed: { at: todayIso, sideGrade } };
}
