import { z } from "zod";
import { apiRoute, ApiError, json } from "@/lib/server/http";
import { promptGuardScore } from "@/lib/server/groq";

const schema = z.strictObject({ text: z.string().min(1).max(8000) });

/** POST /api/llm/prompt-guard: optional ML classifier signal (Llama Prompt Guard 2, preview on Groq), off unless ENABLE_PROMPT_GUARD=1. */
export const POST = apiRoute({ name: "llm", schema, limit: { max: 15 }, maxBytes: 40_000 }, async (body, { req }) => {
  const r = await promptGuardScore(req, body.text);
  if (!r) throw new ApiError(503, "PROMPT_GUARD_UNAVAILABLE", "The optional prompt-injection classifier is not enabled on this deployment.");
  return json({ ok: true, data: r, model: r.model });
});
