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
