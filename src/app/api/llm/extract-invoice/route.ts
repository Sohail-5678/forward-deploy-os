import { apiRoute, json } from "@/lib/server/http";
import { runLlmTask } from "@/lib/server/groq";
import { llmExtractRequestSchema, llmExtractionSchema } from "@/engine/schemas";
import { extractInvoicePrompt } from "@/engine/llm/prompts";

/** POST /api/llm/extract-invoice: optional field extraction from messy PDF text (spotlighted, validated). */
export const POST = apiRoute({ name: "llm", schema: llmExtractRequestSchema, limit: { max: 15 }, maxBytes: 200_000 }, async (body, { req }) => {
  const r = await runLlmTask(req, (canary, nonce) => extractInvoicePrompt(body, canary, nonce), llmExtractionSchema);
  return json({ ok: true, data: r.data, model: r.model });
});
