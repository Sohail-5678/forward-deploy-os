import { createHash } from "node:crypto";
import { apiRoute, ApiError, json } from "@/lib/server/http";
import { checkpointSecret } from "@/lib/server/env";
import { decisionsMatch, verifyCheckpoint } from "@/lib/server/checkpoint";
import { verifyRequestSchema } from "@/engine/schemas";
import { canonicalJSON } from "@/engine/hash";

/**
 * POST /api/checkpoint/verify: before a run resumes, recompute the state hash
 * from the submitted state and check the HMAC. A checkpoint edited after it was
 * signed (for example, an amount changed) is rejected with 409.
 */
export const POST = apiRoute({ name: "checkpoint-verify", schema: verifyRequestSchema, limit: { max: 40 } }, async (body) => {
  const secret = checkpointSecret();
  if (!secret) throw new ApiError(503, "CHECKPOINT_SECRET_MISSING", "This deployment has no CHECKPOINT_SECRET, so checkpoints cannot be verified.");
  const verdict = verifyCheckpoint(secret.secret, body.checkpoint);
  if (!verdict.ok) throw new ApiError(409, verdict.code, verdict.message);
  const mismatch = decisionsMatch(body.checkpoint.state, body.decisions);
  if (mismatch) throw new ApiError(422, "DECISION_INVALID", mismatch);
  const decisionsSha256 = createHash("sha256").update(canonicalJSON(body.decisions)).digest("hex");
  return json({ ok: true, stateSha256: verdict.stateSha256, decisionsSha256, verifiedAt: new Date().toISOString() });
});
