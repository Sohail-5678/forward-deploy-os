import { apiRoute, json } from "@/lib/server/http";
import { runLlmTask } from "@/lib/server/groq";
import { llmPlanRequestSchema, llmPlanSchema } from "@/engine/schemas";
import { planActionsPrompt } from "@/engine/llm/prompts";

/**
 * POST /api/llm/plan-actions: receives the distilled tree and field NAMES only,
 * never values. The response schema has no place for a value (value binding).
 */
export const POST = apiRoute({ name: "llm", schema: llmPlanRequestSchema, limit: { max: 15 }, maxBytes: 200_000 }, async (body, { req }) => {
  const r = await runLlmTask(req, (canary, nonce) => planActionsPrompt(body, canary, nonce), llmPlanSchema, 1200);
  return json({ ok: true, data: r.data, model: r.model });
});
