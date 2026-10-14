/**
 * Zod schemas for every boundary: API bodies, LLM outputs, planner output,
 * uploads, checkpoints and flight-recorder files.
 */
import { z } from "zod";

export const canonicalFieldSchema = z.enum([
  "vendor_id",
  "customer_id",
  "po_number",
  "invoice_number",
  "invoice_date",
  "gross_amount_usd",
  "tax_rate",
  "line_items_count",
  "payee_iban",
]);

export const bindableFieldSchema = z.union([canonicalFieldSchema, z.literal("cost_center"), z.literal("override_code")]);

/**
 * Value binding at the type level: a planned action can name a field, never a
 * value. Strict objects reject any extra key such as `value` or `text`.
 */
export const plannedActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fill"), nodeId: z.number().int().min(0).max(100000), valueRef: bindableFieldSchema }),
  z.strictObject({ kind: z.literal("select"), nodeId: z.number().int().min(0).max(100000), valueRef: bindableFieldSchema }),
  z.strictObject({
    kind: z.literal("click"),
    nodeId: z.number().int().min(0).max(100000),
    purpose: z.enum(["tab", "submit", "dialog", "navigate", "search"]).optional(),
  }),
  z.strictObject({ kind: z.literal("waitFor"), text: z.string().min(1).max(120) }),
]);

export const plannedActionListSchema = z.array(plannedActionSchema).max(60);

export const chaosTypeSchema = z.enum(["ids", "labels", "reorder", "nesting", "interstitial", "latency", "strip-labels"]);
export const dateFormatSchema = z.enum(["DD.MM.YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "YYYYMMDD"]);
export const fieldKindSchema = z.enum(["vendorId", "customerId", "poNumber", "invoiceNumber", "date", "money", "rate", "int", "iban", "text"]);

export const contractSchema = z.strictObject({
  version: z.string().min(1).max(40),
  fields: z
    .array(
      z.strictObject({
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
        canonical: canonicalFieldSchema.optional(),
        kind: fieldKindSchema,
        required: z.boolean(),
        aliases: z.array(z.string().max(60)).max(12),
        description: z.string().max(200),
      }),
    )
    .min(1)
    .max(40),
});

export const policySchema = z.strictObject({
  absToleranceCents: z.number().int().min(0).max(1_000_000_00),
  relTolerance: z.number().min(0).max(1),
  confidenceThreshold: z.number().min(0).max(1),
});

export const runConfigSchema = z.strictObject({
  scenarioId: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal("sandbox")]),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  mode: z.enum(["deterministic", "llm"]),
  policy: policySchema,
  contract: contractSchema,
  chaos: z.strictObject({ seed: z.number().int().min(0).max(2 ** 32 - 1), types: z.array(chaosTypeSchema).max(7) }),
  security: z.strictObject({
    scanner: z.boolean(),
    spotlighting: z.boolean(),
    llmPlanner: z.boolean(),
    hijackedPlanner: z.boolean(),
    compromisedExtraction: z.boolean(),
  }),
  healing: z.strictObject({ healThreshold: z.number().min(0).max(1), askThreshold: z.number().min(0).max(1), minMargin: z.number().min(0).max(1) }),
  fiscalWindow: z.strictObject({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  dateOverrides: z.record(z.string().max(80), dateFormatSchema),
  baselineFirst: z.boolean(),
  warmSelectorCache: z.boolean(),
  demoOperator: z.string().max(60).optional(),
});

export const decisionChoiceSchema = z.enum([
  "ENFORCE_PO",
  "APPROVE_OVERRIDE",
  "MANUAL_AUDIT",
  "APPROVE_AS_IS",
  "REJECT",
  "READ_DMY",
  "READ_MDY",
  "ASK_CUSTOMER",
  "PICK_CANDIDATE_1",
  "PICK_CANDIDATE_2",
  "PICK_CANDIDATE_3",
  "ABORT",
]);

export const humanDecisionSchema = z.strictObject({
  escalationId: z.string().min(1).max(120),
  choice: decisionChoiceSchema,
  operator: z
    .string()
    .trim()
    .min(1, "Operator name is required")
    .max(60)
    .regex(/^[\p{L}\p{N} .,'_-]+$/u, "Use letters, digits, spaces and . , ' _ - only"),
  note: z.string().max(500).optional(),
  at: z.string().max(40),
});

// ---------------------------------------------------------------------------
// API bodies
// ---------------------------------------------------------------------------

const MAX_STATE_JSON = 1_900_000;

export const signRequestSchema = z.strictObject({
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{4,64}$/),
  atNode: z.number().int().min(1).max(8),
  state: z.record(z.string(), z.unknown()),
});

export const verifyRequestSchema = z.strictObject({
  checkpoint: z.strictObject({
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{4,64}$/),
    atNode: z.number().int().min(1).max(8),
    state: z.record(z.string(), z.unknown()),
    stateSha256: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().regex(/^[0-9a-f]{64}$/),
    signedAt: z.string().max(40).optional(),
  }),
  decisions: z.array(humanDecisionSchema).min(1).max(50),
});

export const MAX_STATE_BYTES = MAX_STATE_JSON;

export const uploadFileSchema = z.strictObject({
  name: z.string().min(1).max(160),
  kind: z.enum(["csv", "json", "pdf", "txt"]),
  /** Text for csv/json/txt, base64 for pdf. */
  content: z.string().max(2_800_000),
});

export const pipelineRequestSchema = z.strictObject({
  files: z.array(uploadFileSchema).min(1).max(12),
  config: z
    .strictObject({
      policy: policySchema.optional(),
      contract: contractSchema.optional(),
      seed: z.number().int().min(0).max(2 ** 32 - 1).optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// LLM outputs (always validated; invalid -> one retry -> deterministic fallback)
// ---------------------------------------------------------------------------

export const llmMappingProposalSchema = z.strictObject({
  mappings: z
    .array(
      z.strictObject({
        source: z.string().min(1).max(120),
        target: z.string().min(1).max(64),
        reason: z.string().max(200).optional(),
      }),
    )
    .max(40),
});

export const llmExtractionSchema = z.strictObject({
  vendor_id: z.string().max(20).nullable().optional(),
  po_number: z.string().max(20).nullable().optional(),
  invoice_number: z.string().max(40).nullable().optional(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gross_amount: z.string().max(30).nullable().optional(),
  tax_rate: z.string().max(12).nullable().optional(),
  line_items_count: z.number().int().min(0).max(10000).nullable().optional(),
  payee_iban: z.string().max(42).nullable().optional(),
  suspicious_text: z.array(z.string().max(200)).max(10).optional(),
});

export const llmPlanSchema = z.strictObject({ actions: plannedActionListSchema });

export const llmMapRequestSchema = z.strictObject({
  columns: z.array(z.strictObject({ name: z.string().max(120), samples: z.array(z.string().max(80)).max(5) })).min(1).max(60),
  targets: z.array(z.strictObject({ key: z.string().max(64), kind: fieldKindSchema, description: z.string().max(200) })).min(1).max(40),
});

export const llmExtractRequestSchema = z.strictObject({
  text: z.string().min(1).max(12_000),
  docName: z.string().max(160),
});

export const llmPlanRequestSchema = z.strictObject({
  distilled: z.array(z.string().max(300)).min(1).max(200),
  fields: z.array(bindableFieldSchema).min(1).max(12),
  page: z.string().max(60),
});

export const slackNotifyRequestSchema = z.strictObject({
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{4,64}$/),
  scenarioId: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal("sandbox")]),
  invoiceNumber: z.string().max(40),
  vendorName: z.string().max(80),
  amountCents: z.number().int(),
  poAmountCents: z.number().int().optional(),
  rules: z.array(z.string().max(40)).max(8),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Flight recorder file ("Download run" / "Load run")
// ---------------------------------------------------------------------------

export const flightRecorderSchema = z.strictObject({
  format: z.literal("forwarddeploy-os/flight-recorder@2"),
  exportedAt: z.string().max(40),
  runId: z.string().max(80),
  checkpoints: z
    .array(
      z.strictObject({
        id: z.string().max(120),
        runId: z.string().max(80),
        atNode: z.number().int().min(1).max(8),
        status: z.enum(["RUNNING", "SUSPENDED_HITL", "COMPLETED", "FAILED"]),
        state: z.record(z.string(), z.unknown()),
        stateSha256: z.string().regex(/^[0-9a-f]{64}$/),
        signature: z.string().optional(),
        signedAt: z.string().optional(),
        parentCheckpoint: z.string().optional(),
        createdAt: z.string().max(40),
      }),
    )
    .max(400),
  events: z
    .array(
      z.strictObject({
        seq: z.number().int().min(0),
        runId: z.string().max(80),
        node: z.number().int().min(1).max(8),
        at: z.number(),
        ms: z.number().optional(),
        type: z.string().max(40),
        payload: z.unknown(),
      }),
    )
    .max(20000),
  audit: z
    .array(
      z.strictObject({
        seq: z.number().int().min(0),
        at: z.string().max(40),
        actor: z.string().max(80),
        kind: z.string().max(60),
        data: z.unknown(),
        prevHash: z.string().regex(/^[0-9a-f]{64}$/),
        hash: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .max(5000),
});

export type FlightRecorderFile = z.infer<typeof flightRecorderSchema>;
