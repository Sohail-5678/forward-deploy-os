import { apiRoute, ApiError, json } from "@/lib/server/http";
import { checkpointSecret } from "@/lib/server/env";
import { policyIntegrity, signCheckpoint } from "@/lib/server/checkpoint";
import { signRequestSchema } from "@/engine/schemas";

/** POST /api/checkpoint/sign: the server hashes the suspended state itself and returns an HMAC signature. */
export const POST = apiRoute({ name: "checkpoint-sign", schema: signRequestSchema, limit: { max: 40 } }, async (body) => {
  const secret = checkpointSecret();
  if (!secret) throw new ApiError(503, "CHECKPOINT_SECRET_MISSING", "This deployment has no CHECKPOINT_SECRET, so checkpoints cannot be signed. Set it in the host's environment settings.");
  const problem = policyIntegrity(body.state, body.runId);
  if (problem) throw new ApiError(422, "CHECKPOINT_INCONSISTENT", `Refusing to sign: ${problem}.`);
  const signed = signCheckpoint(secret.secret, body.runId, body.atNode, body.state);
  return json({ ...signed, secretMode: secret.mode });
});
