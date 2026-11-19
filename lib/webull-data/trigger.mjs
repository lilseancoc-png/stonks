// Bearer token for the Webull data runner's ping (api/auth/[action].js
// "webull-data"), derived from R2_SECRET_ACCESS_KEY like the mirror's, with
// its own label, so no new secret is shared between GitHub and Vercel and a
// mirror token can't start the data runner (or the other way round).
import { createHmac } from "node:crypto";

export function webullDataTriggerToken(secret) {
  return createHmac("sha256", String(secret)).update("webull-data-trigger:v1").digest("hex");
}
