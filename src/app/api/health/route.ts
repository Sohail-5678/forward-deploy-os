import { apiRoute, json } from "@/lib/server/http";
import { commitSha, secretMode, slackWebhook } from "@/lib/server/env";
import { llmStatus } from "@/lib/server/groq";
import { rateLimitBackend } from "@/lib/server/rate-limit";
import { ENGINE_VERSION } from "@/engine/config";

/** GET /api/health: mode (deterministic or LLM-assisted), version, commit, and which optional integrations are on. */
export const GET = apiRoute({ name: "health", limit: { max: 120 }, sameOrigin: false }, async () => {
  const llm = llmStatus();
  return json({
    status: "ok",
    version: ENGINE_VERSION,
    commit: commitSha(),
    mode: llm.configured ? "llm-assisted" : "deterministic",
    model: llm.configured ? llm.model : null,
    llm,
    checkpointSigning: secretMode(),
    slack: !!slackWebhook(),
    rateLimit: rateLimitBackend(),
  });
});
