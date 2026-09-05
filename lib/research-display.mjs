// Shared, deterministic presentation decisions. Kept dependency-free so the
// browser renderer can embed the same functions used by the build and tests.
export function pickDisplayDecision(p) {
  const entry = p?.entry || {};
  const timing = p?.entryTiming || {};
  const unavailable = !p?.contract || p?.strategy?.type === 'none';
  const blocked = timing.hardWait || timing.hardVeto || timing.state === 'avoid' || entry.ai?.blocked === true;
  const ready = !unavailable && !blocked && p?.group === 'actionable' && entry.now === true;
  return {
    ready,
    label: unavailable ? 'Research only' : blocked ? 'Do not enter' : ready ? 'Entry confirmed' : 'Wait for confirmation',
    reason: blocked ? (timing.headline || entry.headline || 'An entry veto is active.')
      : unavailable ? 'No trade strategy is currently qualified.'
      : entry.headline || (ready ? 'The published entry gate is confirmed.' : 'Wait for a fresh build to confirm the entry.'),
    trigger: entry.trigger != null && Number(entry.trigger) > 0 ? Number(entry.trigger) : null,
  };
}

export function shareEntryPayoff(execution) {
  const p = execution || {};
  const price = p.entry?.price == null ? null : Number(p.entry.price);
  const target = p.target?.price == null ? null : Number(p.target.price);
  const review = p.review?.price == null ? null : Number(p.review.price);
  const known = Number.isFinite(price) && price > 0;
  const research = p.action?.key === 'research';
  const upsidePct = known && Number.isFinite(target) ? (target / price - 1) * 100 : null;
  const reviewPct = known && Number.isFinite(review) ? (review / price - 1) * 100 : null;
  const valid = !research && upsidePct > 0 && reviewPct < 0;
  return { basisPrice: known ? price : null, upsidePct: research ? null : upsidePct,
    reviewPct: research ? null : reviewPct, rr: valid ? upsidePct / -reviewPct : null,
    warning: research ? 'No entry is qualified; payoff is not available.'
      : !known ? 'Entry price is unavailable; payoff is not available.'
      : upsidePct != null && upsidePct <= 0 ? 'The first target is at or below the entry trigger. Reassess the plan before entry.'
      : reviewPct != null && reviewPct >= 0 ? 'The review level must be below entry to define downside.' : '' };
}

export function pickReviewCheckpoint(p, now = Date.now()) {
  const c = p?.contract || {};
  let expiry = Number(c.expiry);
  if (expiry > 0 && expiry < 1e12) expiry *= 1000;
  if (!Number.isFinite(expiry) || expiry <= 0) return null;
  // A review reminder, not an automatic exit or a change to the model ledger.
  // Friday checkpoint if the 14-calendar-day reminder falls on a weekend.
  const d = new Date(expiry - 14 * 86400000);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 2);
  const date = d.toISOString().slice(0, 10);
  return { date, due: now >= d.getTime(), expired: now >= expiry };
}

export function scenarioEventPhase(ev, now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const date = p.year + '-' + p.month + '-' + p.day;
  if (!ev?.date) return 'unscheduled';
  if (ev.date < date) return 'past';
  if (ev.date > date) return 'upcoming';
  const time = String(ev.window || '').match(/^(\d{1,2}):(\d{2})(?:\s*(ET|EST|EDT))?$/i);
  if (!time) return 'today'; // Never invent a completion time for AM/PM/all-day events.
  const elapsed = Number(p.hour) * 60 + Number(p.minute) >= Number(time[1]) * 60 + Number(time[2]);
  return elapsed ? 'past' : 'upcoming';
}
