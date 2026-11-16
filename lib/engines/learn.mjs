// Strategy engines: self-enforcement and learning. Each engine keeps its own
// compact outcome log (real trades and "shadow" trades: setups it saw but
// did not take) and adjusts itself from it, inside fixed bounds:
//   - a losing-streak brake that pauses new trades (the engine keeps
//     shadow-trading, and resumes when the pause ends),
//   - a mute for a setup whose whole record is clearly losing (40+ results),
//     lifted only when 40+ shadow trades opened after the mute clearly win,
//   - a stand-down in a market type that keeps losing, lifted the same way,
//   - an entry bar that moves up when trades just over the bar lose and
//     higher-scoring trades did better, and down when setups just under it
//     would have won.
// A mute, a stand-down and a bar move each need a result that is unlikely to
// be luck (an average 1.5 to 2.5 standard errors from zero, by rule), because
// option results are noisy and a rule that reacts to every bad week just
// trades less at the wrong times (the first history test showed exactly that).
//
// A setup marked `probation` in the registry starts muted: it is tracked on
// shadow from day one and earns its way in by the same lift rule.
//
// Every change bumps the engine's rules version, is written to its change
// log, and is stamped on new trades so the record can be split by it.
// Learning can only restrict an engine or move its bar inside [min, max]:
// it never adds slots, size, setups or data, and never touches Top Picks.
//
// The same code runs in the history test (learning on vs off).
// Pure. No network, no AI.

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const DAY = 86400000;

export const LEARN = Object.freeze({
  kept: 500,                    // outcomes kept per engine
  brakeLosses: 5,               // this many real losses in a row pauses the engine ...
  brakeAvgN: 8, brakeAvg: -20,  // ... or the last 8 real trades averaging -20% or worse
  pauseSessions: 5,
  look: 40,                     // results judged for a market-type stand-down
  minN: 20,                     // fewest results before it can fire
  loseAvg: -10,                 // average at or under this ...
  loseT: -2,                    // ... and at least 2 standard errors under zero
  holdSessions: 20,             // a mute or stand-down lasts at least this long
  setupN: 40, setupAvg: -8, setupT: -2.5, // a setup is muted on its whole record: 40+ results, clearly losing
  liftN: 20, liftAvg: 0,        // a stand-down lifts when the shadow trades opened since break even
  // A setup that started on shadow needs real proof: 40+ shadow trades
  // averaging +5% or better, at least 1.5 standard errors above zero.
  probationLiftN: 40, probationLiftAvg: 5, probationLiftT: 1.5,
  barEvery: 10, barLook: 40, barBand: 8, barN: 10, barLose: -8, barWin: 5, barT: 1.5, barBetter: 5,
  logKept: 60,
});

export function addWeekdays(date, n) {
  let ms = Date.parse(date + "T12:00:00Z"), left = n;
  while (left > 0) { ms += DAY; const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) left--; }
  return new Date(ms).toISOString().slice(0, 10);
}

function weekdaysApart(from, to) {
  const a = Date.parse(String(from).slice(0, 10) + "T12:00:00Z"), b = Date.parse(String(to).slice(0, 10) + "T12:00:00Z");
  if (!fin(a) || !fin(b) || b <= a) return 0;
  let n = 0;
  for (let ms = a + DAY; ms <= b; ms += DAY) { const d = new Date(ms).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}

export function newEngineState(spec) {
  const setups = {};
  for (const [key, s] of Object.entries(spec.setups || {})) if (s.probation) setups[key] = { muted: true, since: null, probation: true };
  return { bar: spec.bar.base, v: 1, paused: null, setups, cells: {}, outcomes: [], log: [], seen: {}, cooldown: {}, shadow: { open: [], closed: [] }, realSinceBar: 0 };
}
export const rulesVersion = (spec, es) => `${spec.tag}-${es?.v || 1}`;

const avg = (rows) => (rows.length ? rows.reduce((a, r) => a + r.p, 0) / rows.length : null);
const winRate = (rows) => (rows.length ? rows.filter((r) => r.p > 0).length / rows.length : null);
// The average in standard errors from zero.
export function tStat(rows) {
  const n = rows.length; if (n < 3) return null;
  const m = avg(rows), sd = Math.sqrt(rows.reduce((a, r) => a + (r.p - m) ** 2, 0) / (n - 1));
  return sd > 0 ? m / (sd / Math.sqrt(n)) : null;
}
const losing = (rows) => rows.length >= LEARN.minN && avg(rows) <= LEARN.loseAvg && (tStat(rows) ?? 0) <= LEARN.loseT;
const sign = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

function change(es, spec, date, kind, text) {
  es.v = (es.v || 1) + 1;
  es.log.unshift({ date, v: `${spec.tag}-${es.v}`, kind, text });
  if (es.log.length > LEARN.logKept) es.log.length = LEARN.logKept;
}

// Record one finished trade (real or shadow) on the engine's outcome log.
export function observe(es, trade, { shadow = false } = {}) {
  if (!fin(trade?.optionPnlPct)) return;
  es.outcomes.push({
    d: String(trade.exitDate || "").slice(0, 10), e: String(trade.entryDate || "").slice(0, 10), s: trade.setup, side: trade.side === "put" ? "p" : "c",
    sc: trade.score ?? null, p: Math.round(trade.optionPnlPct * 10) / 10, c: trade.regime?.cell || null,
    sh: shadow ? 1 : 0, why: shadow ? trade.shadowWhy || null : null,
  });
  if (es.outcomes.length > LEARN.kept) {
    const cut = es.outcomes.length - LEARN.kept;
    const cutReal = es.outcomes.slice(0, cut).filter((o) => !o.sh).length;
    es.outcomes.splice(0, cut);
    // The brake's bookmark counts real outcomes, so it moves with the cut.
    if (es.brakeAt) es.brakeAt = Math.max(0, es.brakeAt - cutReal);
  }
  if (!shadow) es.realSinceBar = (es.realSinceBar || 0) + 1;
}

// Apply the rules above. Returns the changes made this call.
// parts: which rules run (all by default; the history test switches them one
// at a time to see what each is worth).
export function adapt(es, spec, { today, parts = null } = {}) {
  const on = (k) => !parts || parts[k] !== false;
  const made = [];
  const note = (kind, text) => { change(es, spec, today, kind, text); made.push({ kind, text }); };
  const real = es.outcomes.filter((o) => !o.sh), all = es.outcomes;

  // 1. Brake.
  if (!on("brake")) { /* off */ } else if (es.paused) {
    if (today >= es.paused.until) {
      const since = all.filter((o) => o.sh && o.d >= es.paused.since);
      const a = avg(since);
      es.paused = null;
      note("resume", a == null ? "Pause over: trading again." : `Pause over: trading again (shadow trades during the pause averaged ${sign(a)}).`);
      es.brakeAt = real.length;
    }
  } else {
    const fresh = real.slice(Math.min(es.brakeAt || 0, real.length));
    const lastN = fresh.slice(-LEARN.brakeLosses), lastAvg = fresh.slice(-LEARN.brakeAvgN);
    const streak = lastN.length === LEARN.brakeLosses && lastN.every((o) => o.p < 0);
    const deep = lastAvg.length === LEARN.brakeAvgN && avg(lastAvg) <= LEARN.brakeAvg;
    if (streak || deep) {
      es.paused = { since: today, until: addWeekdays(today, LEARN.pauseSessions), why: streak ? `${LEARN.brakeLosses} losses in a row` : `last ${LEARN.brakeAvgN} trades averaged ${avg(lastAvg).toFixed(1)}%` };
      note("pause", `Paused new trades for ${LEARN.pauseSessions} sessions: ${es.paused.why}. Setups are still tracked as shadow trades.`);
    }
  }

  // 2. Setups.
  for (const key of on("setups") ? Object.keys(spec.setups) : []) {
    const st = (es.setups[key] ||= { muted: false });
    const rows = all.filter((o) => o.s === key);
    if (!st.muted) {
      // A setup is judged on its whole kept record since its last lift, not
      // on its latest stretch: reacting to a bad month muted dip-buying right
      // before its best trades in the history test.
      const look = rows.filter((o) => !st.clearFrom || o.e >= st.clearFrom);
      if (look.length >= LEARN.setupN && avg(look) <= LEARN.setupAvg && (tStat(look) ?? 0) <= LEARN.setupT) {
        st.muted = true; st.since = today; st.probation = true;
        note("mute", `Stopped trading "${spec.setups[key].label}": its ${look.length} results averaged ${avg(look).toFixed(1)}% with ${Math.round(winRate(look) * 100)}% winners. It stays on shadow until it proves itself again.`);
      }
    } else {
      // Lifted only by shadow trades opened after the mute began, all of them
      // together (not the best recent stretch).
      const sh = rows.filter((o) => o.sh && (!st.since || o.e >= st.since));
      const held = !st.since || weekdaysApart(st.since, today) >= LEARN.holdSessions;
      if (held && sh.length >= LEARN.probationLiftN && avg(sh) >= LEARN.probationLiftAvg && (tStat(sh) ?? 0) >= LEARN.probationLiftT) {
        const was = !st.since;
        st.muted = false; st.since = null; st.probation = false; st.clearFrom = today;
        note("unmute", `${was ? "Started trading" : "Trading"} "${spec.setups[key].label}"${was ? "" : " again"}: its ${sh.length} shadow results since averaged ${sign(avg(sh))}.`);
      }
    }
  }

  // 3. Market types.
  const cells = on("cells") ? [...new Set(all.map((o) => o.c).filter(Boolean))] : [];
  for (const cell of cells) {
    const st = (es.cells[cell] ||= { off: false });
    const rows = all.filter((o) => o.c === cell);
    if (!st.off) {
      const look = rows.filter((o) => !st.clearFrom || o.e >= st.clearFrom).slice(-LEARN.look);
      if (losing(look)) {
        st.off = true; st.since = today;
        note("stand-down", `Standing down in "${cell}" markets: the last ${look.length} results there averaged ${avg(look).toFixed(1)}%. Setups there stay on shadow.`);
      }
    } else {
      const sh = rows.filter((o) => o.sh && o.e >= st.since);
      if (weekdaysApart(st.since, today) >= LEARN.holdSessions && sh.length >= LEARN.liftN && avg(sh) >= LEARN.liftAvg) {
        st.off = false; st.since = null; st.clearFrom = today;
        note("stand-up", `Trading in "${cell}" markets again: the ${sh.length} shadow results there since averaged ${sign(avg(sh))}.`);
      }
    }
  }

  // 4. The entry bar.
  if (on("bar") && (es.realSinceBar || 0) >= LEARN.barEvery) {
    es.realSinceBar = 0;
    const recent = real.slice(-LEARN.barLook).filter((o) => fin(o.sc));
    const justOver = recent.filter((o) => o.sc >= es.bar && o.sc < es.bar + LEARN.barBand);
    const higher = recent.filter((o) => o.sc >= es.bar + LEARN.barBand);
    const justUnder = all.slice(-LEARN.barLook * 2).filter((o) => o.sh && o.why === "below the bar" && fin(o.sc) && o.sc >= es.bar - LEARN.barBand && o.sc < es.bar);
    const overT = tStat(justOver), underT = tStat(justUnder);
    // Up: the lowest-scoring trades lose, and higher scores really did better
    // (otherwise a higher bar only means fewer trades).
    if (justOver.length >= LEARN.barN && avg(justOver) <= LEARN.barLose && overT != null && overT <= -LEARN.barT
      && higher.length >= 5 && avg(higher) >= avg(justOver) + LEARN.barBetter && es.bar < spec.bar.max) {
      const from = es.bar; es.bar = Math.min(spec.bar.max, es.bar + spec.bar.step);
      note("bar-up", `Entry bar ${from} to ${es.bar}: trades scoring ${from}-${from + LEARN.barBand - 1} averaged ${avg(justOver).toFixed(1)}%, higher scores ${sign(avg(higher))}.`);
    } else if (justUnder.length >= LEARN.barN && avg(justUnder) >= LEARN.barWin && underT != null && underT >= LEARN.barT && es.bar > spec.bar.min) {
      const from = es.bar; es.bar = Math.max(spec.bar.min, es.bar - spec.bar.step);
      note("bar-down", `Entry bar ${from} to ${es.bar}: shadow setups scoring ${es.bar}-${from - 1} averaged ${sign(avg(justUnder))}.`);
    }
  }
  return made;
}

// A compact read of the engine's learning state for the page.
export function learnView(es, spec) {
  const rows = es.outcomes || [];
  const bySetup = Object.keys(spec.setups).map((key) => {
    const r = rows.filter((o) => o.s === key && !o.sh), s = rows.filter((o) => o.s === key && o.sh);
    const st = es.setups?.[key] || {};
    return { key, label: spec.setups[key].label, how: spec.setups[key].how, muted: !!st.muted, probation: !!st.probation, since: st.since || null,
      real: { n: r.length, avg: avg(r), win: winRate(r) }, shadow: { n: s.length, avg: avg(s), win: winRate(s) } };
  });
  return {
    bar: es.bar, barBase: spec.bar.base, barMin: spec.bar.min, barMax: spec.bar.max, rulesVersion: rulesVersion(spec, es),
    paused: es.paused, setups: bySetup,
    cells: Object.entries(es.cells || {}).filter(([, v]) => v.off).map(([cell, v]) => ({ cell, since: v.since })),
    log: (es.log || []).slice(0, 20),
    shadow: { open: es.shadow?.open?.length || 0, closed: es.shadow?.closed?.length || 0 },
  };
}
