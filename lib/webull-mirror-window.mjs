// A bounded execution window belongs to one published Top Picks build.
// No idle polling; follow-ups exist only to advance that build's working orders.
export async function runMirrorWindow({ trigger, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), followUps = 0, delayMs = 120000 }) {
  let response = await trigger(), checks = 1;
  const needsFollowUp = (r) => r.body?.summary?.followUpNeeded === true || r.body?.reason === "mirror already running";
  const failed = (r) => !r.ok || !!r.body?.summary?.alerts && r.body?.summary?.followUpNeeded !== true;
  while (checks <= followUps && !failed(response) && needsFollowUp(response)) {
    await sleep(delayMs);
    response = await trigger(); checks++;
  }
  return { response, checks, pending: needsFollowUp(response) };
}

// One bounded end-of-day window, not an all-day polling service. Keep checking
// through the cutoff even if the initial book is quiet; a late publication can
// still contain the day's final entry or a newly closed pick.
export async function runEndOfDayWindow({ trigger, session, now = Date.now,
  sleep = ms => new Promise(r => setTimeout(r, ms)), intervalMs = 60000, maxChecks = 23, finalGraceChecks = 3, allowPostClose = false }) {
  let checks = 0, response = null, finalChecks = 0, afterCloseChecked = false;
  while (checks < maxChecks) {
    const s = session(now());
    if (!s.monitor && checks === 0 && !(allowPostClose && s.known && s.open && !s.trading && s.minute >= s.closeMinute)) return { skipped: true, checks: 0, response: null, afterCloseChecked: false };
    response = await trigger(); checks++;
    if (!s.trading) {
      finalChecks++;
      afterCloseChecked = response.ok && response.body?.ran === true && !!response.body?.summary;
      const clean = afterCloseChecked && !response.body.summary.errors && !response.body.summary.alerts && !response.body.summary.followUpNeeded;
      if (clean || finalChecks >= finalGraceChecks) break;
    }
    if (response.body?.reason === "mirror off" || response.body?.reason === "webull paper keys not configured") break;
    await sleep(intervalMs);
  }
  return { skipped: false, checks, response, afterCloseChecked };
}
