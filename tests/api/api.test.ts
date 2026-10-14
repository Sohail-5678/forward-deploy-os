import { beforeAll, describe, expect, it } from "vitest";
import { POST as sign } from "@/app/api/checkpoint/sign/route";
import { POST as verify } from "@/app/api/checkpoint/verify/route";
import { POST as slack } from "@/app/api/notify/slack/route";
import { POST as mapSchema } from "@/app/api/llm/map-schema/route";
import { GET as health } from "@/app/api/health/route";
import { createRun, runToPause } from "@/engine/agent/graph";
import { fixedClock } from "@/engine/clock";
import { buildScenarioInput, scenarioConfig } from "@/engine/data/scenarios";
import type { GraphState } from "@/engine/types";
import { fsLoader } from "../../scripts/lib/fs-loader";

let ipSeq = 0;
/** A non-browser (server-to-server) call: no Origin header; a fresh client address per test. */
function req(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const ip = headers["x-forwarded-for"] ?? `203.0.113.${++ipSeq}`;
  return new Request(`http://localhost:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

let suspended: GraphState;

beforeAll(async () => {
  delete process.env.GROQ_API_KEY;
  delete process.env.SLACK_WEBHOOK_URL;
  // Scenario 2 pauses at node 5 for the $1,800 conflict (nodes 1-5 need no browser).
  const clock = fixedClock();
  const r = await runToPause(createRun(await buildScenarioInput(2, fsLoader, []), scenarioConfig(2), { clock, runId: "run_api_test" }), { clock });
  suspended = r.state;
  expect(suspended.status).toBe("SUSPENDED_HITL");
});

describe("checkpoint signing", () => {
  it("signs a suspended run and verifies it unchanged", async () => {
    const s = await sign(req("/api/checkpoint/sign", { runId: suspended.runId, atNode: 5, state: suspended }));
    expect(s.status).toBe(200);
    const signed = (await s.json()) as { stateSha256: string; signature: string; signedAt: string; secretMode: string };
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    const decisions = suspended.pending.map((p) => ({ escalationId: p.id, choice: "ENFORCE_PO", operator: "Test Operator", at: "2026-10-14T12:00:00.000Z" }));
    const v = await verify(req("/api/checkpoint/verify", { checkpoint: { runId: suspended.runId, atNode: 5, state: suspended, stateSha256: signed.stateSha256, signature: signed.signature, signedAt: signed.signedAt }, decisions }));
    expect(v.status).toBe(200);
    expect(((await v.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("rejects a checkpoint edited after it was signed (409)", async () => {
    const s = (await (await sign(req("/api/checkpoint/sign", { runId: suspended.runId, atNode: 5, state: suspended }))).json()) as { stateSha256: string; signature: string };
    const tampered = structuredClone(suspended);
    tampered.n4!.reconciliations[0].invoice.gross_amount_cents += 100_000;
    const decisions = suspended.pending.map((p) => ({ escalationId: p.id, choice: "APPROVE_OVERRIDE", operator: "Mallory", at: "2026-10-14T12:00:00.000Z" }));
    const v = await verify(req("/api/checkpoint/verify", { checkpoint: { runId: suspended.runId, atNode: 5, state: tampered, stateSha256: s.stateSha256, signature: s.signature }, decisions }));
    expect(v.status).toBe(409);
    expect(((await v.json()) as { error: { code: string } }).error.code).toBe("CHECKPOINT_TAMPERED");
  });

  it("rejects a forged signature", async () => {
    const s = (await (await sign(req("/api/checkpoint/sign", { runId: suspended.runId, atNode: 5, state: suspended }))).json()) as { stateSha256: string };
    const decisions = suspended.pending.map((p) => ({ escalationId: p.id, choice: "ENFORCE_PO", operator: "Test Operator", at: "2026-10-14T12:00:00.000Z" }));
    const v = await verify(req("/api/checkpoint/verify", { checkpoint: { runId: suspended.runId, atNode: 5, state: suspended, stateSha256: s.stateSha256, signature: "0".repeat(64) }, decisions }));
    expect(v.status).toBe(409);
  });
});

describe("request hygiene", () => {
  it("blocks cross-site browser requests", async () => {
    const r = await sign(req("/api/checkpoint/sign", { runId: "x", atNode: 5, state: {} }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(r.status).toBe(403);
  });

  it("validates bodies and answers with a JSON error and request id, no stack trace", async () => {
    const r = await sign(req("/api/checkpoint/sign", "{not json"));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string; message: string; requestId: string } };
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("caps request bodies at 2 MB", async () => {
    const r = await sign(req("/api/checkpoint/sign", "x", { "content-length": String(3 * 1024 * 1024) }));
    expect(r.status).toBe(413);
  });

  it("rate limits per client address", async () => {
    const ip = "198.51.100.77";
    const body = { runId: "run_test1", scenarioId: 2, invoiceNumber: "INV-1", vendorName: "Test", amountCents: 100, rules: ["AMOUNT_DELTA_ABS"], confidence: 0.5 };
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await slack(req("/api/notify/slack", body, { "x-forwarded-for": ip }))).status);
    expect(codes).toContain(429);
  });
});

describe("optional integrations stay optional", () => {
  it("health reports deterministic mode without a model key", async () => {
    const r = await health(req("/api/health"));
    const h = (await r.json()) as { mode: string; llm: { configured: boolean } };
    expect(h.mode).toBe("deterministic");
    expect(h.llm.configured).toBe(false);
  });

  it("LLM routes fall back cleanly without a key, and reject malformed keys", async () => {
    const body = { columns: [{ name: "supplier_code", samples: ["V-1042"] }], targets: [{ key: "vendor_id", kind: "vendorId", description: "Vendor" }] };
    expect((await mapSchema(req("/api/llm/map-schema", body))).status).toBe(503);
    expect((await mapSchema(req("/api/llm/map-schema", body, { "x-groq-key": "not-a-key" }))).status).toBe(400);
  });

  it("Slack answers 404 when no webhook is configured", async () => {
    const r = await slack(req("/api/notify/slack", { runId: "run_test1", scenarioId: 2, invoiceNumber: "INV-1", vendorName: "Test", amountCents: 100, rules: ["AMOUNT_DELTA_ABS"], confidence: 0.5 }));
    expect(r.status).toBe(404);
  });
});
