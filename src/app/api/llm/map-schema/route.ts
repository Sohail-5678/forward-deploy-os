import { apiRoute, json } from "@/lib/server/http";
import { runLlmTask } from "@/lib/server/groq";
import { llmMapRequestSchema, llmMappingProposalSchema } from "@/engine/schemas";
import { mapSchemaPrompt } from "@/engine/llm/prompts";

/** POST /api/llm/map-schema: optional mapping proposals for required fields the deterministic matcher left open. */
export const POST = apiRoute({ name: "llm", schema: llmMapRequestSchema, limit: { max: 15 }, maxBytes: 200_000 }, async (body, { req }) => {
  const r = await runLlmTask(req, (canary, nonce) => mapSchemaPrompt(body, canary, nonce), llmMappingProposalSchema);
  return json({ ok: true, data: r.data.mappings, model: r.model });
});
