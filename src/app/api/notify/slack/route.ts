import { apiRoute, ApiError, json } from "@/lib/server/http";
import { siteUrl, slackWebhook } from "@/lib/server/env";
import { buildEscalationBlocks } from "@/lib/server/slack";
import { slackNotifyRequestSchema } from "@/engine/schemas";

/** POST /api/notify/slack: posts the escalation as Block Kit when SLACK_WEBHOOK_URL is set. */
export const POST = apiRoute({ name: "slack", schema: slackNotifyRequestSchema, limit: { max: 6 } }, async (body) => {
  const hook = slackWebhook();
  if (!hook) throw new ApiError(404, "SLACK_NOT_CONFIGURED", "SLACK_WEBHOOK_URL is not set on this deployment, so nothing was sent.");
  const payload = buildEscalationBlocks(body, siteUrl());
  const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res || !res.ok) throw new ApiError(502, "SLACK_FAILED", "Slack did not accept the message.");
  return json({ ok: true });
});
