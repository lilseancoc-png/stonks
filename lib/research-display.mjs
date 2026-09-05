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

// Translate structural levels from the planned underlying entry, for either side.
export function leveragedEntryPlan(idea) {
  const p = idea?.plan;
  if (!p) return null;
  const num = v => v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const entry = num(p.entry?.now ? (p.entry?.price ?? idea?.under?.spot) : p.entry?.trigger);
  const stop = num(p.invalidation?.underlyingPx), target = num(p.target?.underlyingPx);
  const side = idea?.direction === 'bear' ? -1 : 1;
  const k = Math.abs(num(idea?.leverage) || 0);
  const risk = entry > 0 && stop > 0 ? side * (entry - stop) / entry * 100 : null;
  const reward = entry > 0 && target > 0 ? side * (target - entry) / entry * 100 : null;
  const valid = risk > 0 && reward > 0 && k > 0;
  return { ...p, basisPrice: entry, basis: 'planned-entry',
    invalidation: p.invalidation ? {...p.invalidation, underlyingMovePct: risk, etfMovePct: risk > 0 && k > 0 ? risk * k : null} : null,
    target: p.target ? {...p.target, underlyingMovePct: reward, etfMovePct: reward != null && k > 0 ? reward * k : null} : null,
    riskReward: valid ? reward / risk : null,
    warning: valid ? null : 'Entry, target and invalidation do not form a valid directional plan.' };
}
export function earningsCallAge(entry, now = Date.now()) {
  const ms = Date.parse(entry?.callDate || '');
  const age = Number.isFinite(ms) ? Math.floor((now - ms) / 86400000) : null;
  const recent = age != null && age >= 0 && age <= 30;
  return { age, recent, label: age == null || age < 0 ? 'Call date unverified' : (recent ? 'Recent call' : 'Older research') + ' · ' + age + ' days old' };
}

export function callReportContext(entry, tracker, now = Date.now()) {
  const rows = (tracker?.seasons || []).flatMap(s => s.rows || []).concat(tracker?.recentlyReported || []);
  const call = Date.parse(entry?.callDate || '');
  const dates = rows.filter(r => r.sym === entry?.sym && r.epsActual != null).map(r => Date.parse(r.date)).filter(d => Number.isFinite(d) && d <= now);
  const latest = dates.length ? Math.max(...dates) : null;
  const newer = Number.isFinite(call) && latest != null && latest > call + 2 * 86400000;
  const built = Date.parse(tracker?.builtAtIso || '');
  const fresh = Number.isFinite(built) && now >= built && now - built < 3 * 86400000;
  const matched = fresh && Number.isFinite(call) && latest != null && call >= latest && call - latest <= 2 * 86400000;
  return { newer, label: newer ? 'Newer tracked report: ' + new Date(latest).toISOString().slice(0,10) : matched ? 'Matches latest tracked report · tracker as of ' + new Date(built).toISOString().slice(0,10) : 'Latest reporting period not verified' };
}
