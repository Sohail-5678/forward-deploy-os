/**
 * ForwardDeploy OS engine data model (spec section 7).
 * Framework-free (rule E1). Every type that crosses a boundary has a matching
 * Zod schema in `schemas.ts`.
 */

// ---------------------------------------------------------------------------
// Canonical contract
// ---------------------------------------------------------------------------

export interface CanonicalInvoice {
  vendor_id: string; // "V-1042"
  customer_id: string; // "C-7781"
  po_number: string; // "PO-88412"
  invoice_number: string;
  invoice_date: string; // ISO 8601 date "2026-10-14"
  gross_amount_usd: number; // dollars; the engine stores integer cents (InvoiceRecord)
  tax_rate: number; // 0.0825
  line_items_count: number;
  payee_iban: string; // must match the vendor master (section 10)
}

export type CanonicalField = keyof CanonicalInvoice;

/** Internal record. Money is always integer cents, never a float. */
export interface InvoiceRecord extends Omit<CanonicalInvoice, "gross_amount_usd"> {
  gross_amount_cents: number;
}

export type FieldKind =
  | "vendorId"
  | "customerId"
  | "poNumber"
  | "invoiceNumber"
  | "date"
  | "money"
  | "rate"
  | "int"
  | "iban"
  | "text";

export interface ContractField {
  /** Output column name. Editable in Sandbox mode. */
  key: string;
  /** Semantic binding used by reconciliation and the portal. Custom fields have none. */
  canonical?: CanonicalField;
  kind: FieldKind;
  required: boolean;
  /** Extra words the matcher may use for this field (from the target schema docs). */
  aliases: string[];
  description: string;
}

export interface ContractDef {
  version: string;
  fields: ContractField[];
}

// ---------------------------------------------------------------------------
// Run configuration and input
// ---------------------------------------------------------------------------

export type ScenarioId = 1 | 2 | 3 | 4 | 5 | "sandbox";
export type EngineMode = "deterministic" | "llm";
export type ChaosType = "ids" | "labels" | "reorder" | "nesting" | "interstitial" | "latency" | "strip-labels";

export interface PolicyConfig {
  /** AMOUNT_DELTA_ABS fires above this many cents (default $250.00). */
  absToleranceCents: number;
  /** AMOUNT_DELTA_REL fires above this relative difference (default 2%). */
  relTolerance: number;
  /** LOW_CONFIDENCE fires below this calibrated probability (default 0.85). */
  confidenceThreshold: number;
}

/**
 * Layers that can be switched off in the Security Playground. The tool
 * boundary guard is deliberately absent: it cannot be disabled (rule S4).
 */
export interface SecurityToggles {
  scanner: boolean;
  spotlighting: boolean;
  /** Use the LLM to plan portal actions (LLM-assisted mode only). */
  llmPlanner: boolean;
  /** Replace the planner with a stub that behaves like a fully hijacked model. */
  hijackedPlanner: boolean;
  /** Simulate an extraction model that obeyed hidden text (attacker IBAN reaches the record). */
  compromisedExtraction: boolean;
}

export interface HealingConfig {
  /** Auto-heal at or above this similarity (default 0.80). */
  healThreshold: number;
  /** Ask a human between askThreshold and healThreshold (default 0.60). */
  askThreshold: number;
  /** The best candidate must beat the runner-up by this much to auto-heal. */
  minMargin: number;
}

export interface RunConfig {
  scenarioId: ScenarioId;
  seed: number;
  mode: EngineMode;
  policy: PolicyConfig;
  contract: ContractDef;
  chaos: { seed: number; types: ChaosType[] };
  security: SecurityToggles;
  healing: HealingConfig;
  fiscalWindow: { start: string; end: string };
  /** fileId -> date format chosen by a human (or set when forking). */
  dateOverrides: Record<string, DateFormat>;
  /** Scenario 3: run the brittle recorded script first so it can fail for real. */
  baselineFirst: boolean;
  /** Scenario 3: selector cache recorded on the portal before the weekend release. */
  warmSelectorCache: boolean;
  /** Operator name used by the scripted demo operator (Director Mode). */
  demoOperator?: string;
}

export interface InputFile {
  id: string;
  name: string;
  kind: "csv" | "json";
  text: string;
  sha256: string;
}

export interface InputPdf {
  id: string;
  name: string;
  sha256: string;
  /** Raw bytes as base64. Dropped from state after node 1 to keep checkpoints small. */
  bytesB64?: string;
}

export interface InputNote {
  id: string;
  name: string;
  text: string;
  sha256: string;
}

export interface ErpPurchaseOrder {
  po_number: string;
  vendor_id: string;
  customer_id: string;
  authorized_cents: number;
  cost_center: string;
  status: "OPEN" | "CLOSED";
  description: string;
}

export interface VendorMasterEntry {
  vendor_id: string;
  name: string;
  iban: string;
  country: string;
}

export interface LedgerEntry {
  postingNumber: string;
  vendor_id: string;
  po_number: string;
  invoice_number: string;
  amount_cents: number;
  iban: string;
  postedAt: string;
  overrideCode?: string;
}

export interface BatchInput {
  files: InputFile[];
  pdfs: InputPdf[];
  notes: InputNote[];
  erp: ErpPurchaseOrder[];
  vendorMaster: VendorMasterEntry[];
  /** Ledger snapshot read from the portal when the run started. */
  ledger: LedgerEntry[];
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export type Severity = "high" | "medium" | "low";

export interface RevealedChar {
  /** Offset in the original text (UTF-16 code units). */
  offset: number;
  length: number;
  codePoint: number;
  kind: "zero-width" | "bidi" | "tag" | "soft-hyphen" | "variation-selector" | "other-invisible";
  /** Visible chip text, e.g. "⟨U+E0053⟩" or "⟨ZWSP⟩". */
  label: string;
}

export interface DecodedPayload {
  kind: "base64" | "hex" | "unicode-tags";
  start: number;
  end: number;
  decoded: string;
}

export interface NormalizedText {
  original: string;
  /** NFKC, invisible characters removed, Unicode Tag text decoded inline. */
  normalized: string;
  revealed: RevealedChar[];
  invisibleCount: number;
  invisibleDensity: number;
  decodedPayloads: DecodedPayload[];
}

export interface SecurityFinding {
  id: string;
  ruleId: string;
  ruleName: string;
  category: "instruction-override" | "action-coercion" | "obfuscation" | "exfiltration" | "jailbreak";
  severity: Severity;
  message: string;
  /** Which text channel the finding came from (page text, annotation, CSV cell...). */
  channel: string;
  /** Offsets into the channel's normalized text. */
  start: number;
  end: number;
  excerpt: string;
  decodedFrom?: DecodedPayload["kind"];
}

export interface ScanResult {
  findings: SecurityFinding[];
  score: number;
  hostile: boolean;
  normalized: NormalizedText;
}

export interface SpotlightedText {
  nonce: string;
  open: string;
  close: string;
  marker: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface PdfTextChannel {
  channel: "page" | "annotation" | "metadata";
  page?: number;
  text: string;
}

export interface ExtractedInvoice {
  fields: Partial<InvoiceRecord>;
  /** All candidate raw values seen per field; more than one means ambiguity. */
  candidates: Partial<Record<CanonicalField, string[]>>;
  missing: CanonicalField[];
  surcharges: { label: string; cents: number }[];
  vendorName?: string;
  method: "deterministic" | "llm";
}

export interface IngestedDoc {
  id: string;
  name: string;
  kind: "csv" | "json" | "pdf" | "note";
  sha256: string;
  /** Extracted (PDF) or raw (CSV/note) text, as received. Always rendered as text. */
  text: string;
  channels?: PdfTextChannel[];
  /** Null when the scanner is switched off in the Security Playground. */
  scan: ScanResult | null;
  quarantined: boolean;
  quarantineReason?: string;
  spotlight?: SpotlightedText;
  invoice?: ExtractedInvoice;
}

// ---------------------------------------------------------------------------
// Drift + healing
// ---------------------------------------------------------------------------

export type DriftErrorCode =
  | "MISSING_REQUIRED_COLUMN"
  | "UNEXPECTED_COLUMN"
  | "DATE_FORMAT_DRIFT"
  | "AMBIGUOUS_DATE_FORMAT"
  | "CURRENCY_STRING_CONTAMINATION"
  | "PERCENT_STRING"
  | "TYPE_MISMATCH"
  | "DUPLICATE_KEY";

export interface DriftError {
  code: DriftErrorCode;
  column?: string;
  row?: number;
  sample?: string;
  detail?: string;
}

export interface QuarantinedRow {
  rowIndex: number;
  sha256: string;
  raw: Record<string, string>;
  reasons: string[];
}

export type ValueFamily =
  | "PO_ID"
  | "VENDOR_ID"
  | "CUSTOMER_ID"
  | "INVOICE_ID"
  | "ISO_DATE"
  | "DOTTED_DATE"
  | "SLASH_DATE"
  | "COMPACT_DATE"
  | "CURRENCY_STRING"
  | "DECIMAL"
  | "UNIT_DECIMAL"
  | "PERCENT"
  | "SMALL_INT"
  | "IBAN"
  | "TEXT"
  | "EMPTY";

export interface ColumnProfile {
  column: string;
  families: Partial<Record<ValueFamily, number>>;
  dominant: ValueFamily;
  uniqueness: number;
  emptyFraction: number;
  samples: string[];
}

export interface DriftReport {
  contractVersion: string;
  fileId: string;
  errors: DriftError[];
  quarantined: QuarantinedRow[];
  profiles: ColumnProfile[];
}

export type DateFormat = "DD.MM.YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "YYYYMMDD";

export type Normalizer =
  | { op: "trim" }
  | { op: "upper" }
  | { op: "lower" }
  | { op: "removeWhitespace" }
  | { op: "parseCurrency"; locale: "en-US" | "de-DE" }
  | { op: "parsePercent" }
  | { op: "parseDate"; format: DateFormat }
  | { op: "parseInt" }
  | { op: "regexExtract"; pattern: string; group: number };

export interface FieldMapping {
  /** Contract key (output column). */
  target: string;
  canonical?: CanonicalField;
  /** Source column name. */
  source: string;
  normalizers: Normalizer[];
  /** Combined matcher score 0..1. */
  score: number;
  nameScore: number;
  valueScore: number;
  distScore: number;
  /** Human-readable reasons, e.g. "token overlap: ref, client". */
  evidence: string[];
  /** Raw sample values that justified the mapping (for hover highlighting). */
  evidenceSamples: string[];
  proposedBy: "deterministic" | "llm" | "human";
}

export interface DateDecision {
  target: string;
  source: string;
  status: "decided" | "ambiguous" | "overridden";
  format?: DateFormat;
  candidates: DateFormat[];
  reason: string;
  samples: string[];
}

export interface TransformSpec {
  /** sha256 of the canonical JSON of the mappings. */
  id: string;
  contractVersion: string;
  mappings: FieldMapping[];
  unmappedSource: string[];
  unmappedTarget: string[];
  dateDecision?: DateDecision;
}

export type InvariantName =
  | "ROW_COUNT_CONSERVED"
  | "MONEY_SUM_CONSERVED"
  | "PRIMARY_KEY_VALID"
  | "DATES_IN_WINDOW"
  | "IDEMPOTENT";

export interface InvariantResult {
  name: InvariantName;
  passed: boolean;
  /** e.g. "sum in = 9,231,400 cents, sum out = 9,231,400 cents". */
  detail: string;
  offendingRows: number[];
  ms: number;
}

export interface RowError {
  rowIndex: number;
  field: string;
  message: string;
}

export interface HealedRecord {
  recordId: string;
  fileId: string;
  rowIndex: number;
  rawSha256: string;
  /** Output row keyed by contract keys. Money in cents, rates as fractions. */
  values: Record<string, string | number>;
  invoice: InvoiceRecord;
  idempotencyKey: string;
  mappingScoreMean: number;
  normalizerCount: number;
}

export interface FileHealResult {
  fileId: string;
  fileName: string;
  spec: TransformSpec;
  invariants: InvariantResult[];
  promoted: HealedRecord[];
  quarantined: QuarantinedRow[];
  rowErrors: RowError[];
  /** Rows waiting on a human date-format decision. */
  awaitingDecision: boolean;
}

// ---------------------------------------------------------------------------
// Reconciliation and policy
// ---------------------------------------------------------------------------

export interface FieldAgreement {
  field: CanonicalField;
  pdf?: string | number;
  csv?: string | number;
  erp?: string | number;
  agree: boolean;
  absDeltaCents?: number;
  relDelta?: number;
  note?: string;
}

export type PolicyHit =
  | { rule: "AMOUNT_DELTA_ABS"; deltaCents: number; limitCents: number }
  | { rule: "AMOUNT_DELTA_REL"; rel: number; limit: number }
  | { rule: "PAYEE_NOT_IN_VENDOR_MASTER"; iban: string }
  | { rule: "UNKNOWN_VENDOR"; vendor_id: string }
  | { rule: "LOW_CONFIDENCE"; confidence: number; threshold: number }
  | { rule: "SECURITY_FINDING"; findingId: string };

export interface Reconciliation {
  recordId: string;
  invoice_number: string;
  vendor_id: string;
  po_number: string;
  source: "csv" | "pdf" | "csv+pdf";
  pdfDocId?: string;
  fields: FieldAgreement[];
  /** Inputs to the calibrator. */
  features: Record<string, number>;
  /** Calibrated probability that the record is correct as-is. */
  confidence: number;
  /** Uncalibrated baseline score (fraction of agreeing fields). */
  heuristicScore: number;
  policyHits: PolicyHit[];
  surcharges: { label: string; cents: number }[];
  erp?: ErpPurchaseOrder;
  invoice: InvoiceRecord;
  idempotencyKey: string;
}

export type DecisionChoice =
  | "ENFORCE_PO"
  | "APPROVE_OVERRIDE"
  | "MANUAL_AUDIT"
  | "APPROVE_AS_IS"
  | "REJECT"
  | "READ_DMY"
  | "READ_MDY"
  | "ASK_CUSTOMER"
  | "PICK_CANDIDATE_1"
  | "PICK_CANDIDATE_2"
  | "PICK_CANDIDATE_3"
  | "ABORT";

export interface DecisionOption {
  choice: DecisionChoice;
  label: string;
  description: string;
  recommended?: boolean;
  shortcut: "1" | "2" | "3";
}

export interface PolicyEscalation {
  id: string;
  kind: "POLICY";
  recordId: string;
  invoice_number: string;
  vendor_id: string;
  hits: PolicyHit[];
  confidence: number;
  options: DecisionOption[];
}

export interface DateEscalation {
  id: string;
  kind: "AMBIGUOUS_DATE";
  fileId: string;
  fileName: string;
  column: string;
  samples: string[];
  interpretations: { format: DateFormat; example: string; reading: string }[];
  affectedRows: number[];
  options: DecisionOption[];
}

export interface SelectorEscalation {
  id: string;
  kind: "SELECTOR_CONFIRM";
  recordId?: string;
  targetKey: string;
  page: string;
  candidates: { nodeId: number; selector: string; label: string; similarity: number }[];
  options: DecisionOption[];
}

export type Escalation = PolicyEscalation | DateEscalation | SelectorEscalation;

export interface HumanDecision {
  escalationId: string;
  choice: DecisionChoice;
  /** Typed free text. A tamper-evident audit record, not a cryptographic identity. */
  operator: string;
  note?: string;
  at: string;
}

export interface ApprovedRecord {
  recordId: string;
  invoice: InvoiceRecord;
  idempotencyKey: string;
  approval: "auto" | "human";
  decisionId?: string;
  /** Bound from the audit entry of an APPROVE_OVERRIDE decision. Never from a model. */
  overrideCode?: string;
  costCenter: string;
  shortPayNote?: string;
}

// ---------------------------------------------------------------------------
// Browser agent
// ---------------------------------------------------------------------------

export type DistilledRole =
  | "textbox"
  | "combobox"
  | "button"
  | "checkbox"
  | "radio"
  | "link"
  | "tab"
  | "row"
  | "dialog"
  | "alert"
  | "status";

export interface Fingerprint {
  role: string;
  tag: string;
  inputType?: string;
  labelTokens: string[];
  ariaLabel?: string;
  placeholder?: string;
  nameTokens: string[];
  /** Text in the same table row / fieldset / tab. */
  neighborTokens: string[];
  /** Position among the interactive elements of its form. */
  formOrdinal: number;
  lastKnownSelector: string;
}

export interface DistilledNode {
  id: number;
  role: DistilledRole;
  label: string;
  value?: string;
  options?: string[];
  required?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** Label of the tab whose (hidden) panel holds this node. */
  inTab?: string;
  /** Inside the current <form>? Clicks outside the form are blocked by the guard. */
  inForm: boolean;
  /** Inside an open dialog? */
  inDialog: boolean;
  selector: string;
  fingerprint: Fingerprint;
}

export interface DistillResult {
  page: string;
  title: string;
  nodes: DistilledNode[];
  lines: string[];
  text: string;
  rawHtml: string;
  ms: number;
}

/** Fields a planned action may reference. Values always come from code. */
export type BindableField = CanonicalField | "cost_center" | "override_code";

// Value binding: the planner references record fields, never literal values.
export type PlannedAction =
  | { kind: "fill"; nodeId: number; valueRef: BindableField }
  | { kind: "select"; nodeId: number; valueRef: BindableField }
  | { kind: "click"; nodeId: number; purpose?: "tab" | "submit" | "dialog" | "navigate" | "search" }
  | { kind: "waitFor"; text: string };

export interface GuardCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface GuardVerdict {
  allowed: boolean;
  reasons: string[];
  checks: GuardCheck[];
}

/** Session bootstrap step (configuration, not planning): never produced by a planner or model. */
export interface LoginAction {
  kind: "login";
  field: "username" | "password" | "submit";
  nodeId: number;
}

export interface ExecutedAction {
  recordId?: string;
  planned: PlannedAction | LoginAction;
  /** Filled in by code from the validated, approved record. */
  boundValue?: string;
  selectorUsed: string;
  label?: string;
  page: string;
  healed?: { from: string; to: string; similarity: number };
  guard: GuardVerdict;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface SelectorCacheEntry {
  key: string;
  fingerprint: Fingerprint;
  recordedAt: string;
}

export interface HealAttempt {
  key: string;
  page: string;
  from: string;
  to?: string;
  similarity: number;
  runnerUp?: number;
  outcome: "cache-hit" | "healed" | "ask-human" | "failed" | "human-picked";
  candidates: { nodeId: number; selector: string; label: string; similarity: number }[];
}

export interface Posting {
  recordId: string;
  invoice_number: string;
  vendor_id: string;
  po_number: string;
  amount_cents: number;
  postingNumber: string;
  postedAt: string;
  iban: string;
  overrideCode?: string;
}

export interface BaselineResult {
  ok: boolean;
  steps: { selector: string; ok: boolean; error?: string }[];
  error?: string;
  ms: number;
}

// ---------------------------------------------------------------------------
// Graph, checkpoints, audit
// ---------------------------------------------------------------------------

export type NodeId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type RunStatus = "RUNNING" | "SUSPENDED_HITL" | "COMPLETED" | "FAILED";

export interface AuditEntry {
  seq: number;
  at: string;
  actor: "engine" | `human:${string}`;
  kind: string;
  data: unknown;
  prevHash: string;
  /** sha256(prevHash + canonicalJSON(entry without hash)) */
  hash: string;
}

export interface Node1Output {
  docs: IngestedDoc[];
}

export interface Node2Output {
  reports: DriftReport[];
}

export interface Node3Output {
  files: FileHealResult[];
  records: HealedRecord[];
}

export interface Node4Output {
  reconciliations: Reconciliation[];
}

export interface Node5Output {
  approved: ApprovedRecord[];
  escalations: Escalation[];
  manualAudit: { recordId: string; invoice_number: string; reason: string }[];
  rejected: { recordId: string; invoice_number: string; reason: string }[];
}

export interface Node6Output {
  page: string;
  nodeCount: number;
  rawTokens: number;
  distilledTokens: number;
  ratio: number;
  lines: string[];
  chaos: ChaosType[];
  baseline?: BaselineResult;
  ms: number;
}

export interface Node7Output {
  actions: ExecutedAction[];
  postings: Posting[];
  duplicatesPrevented: { recordId: string; invoice_number: string; postingNumber: string }[];
  heals: HealAttempt[];
  guardBlocks: number;
  failures: { recordId: string; invoice_number: string; reason: string }[];
  selectorCache: SelectorCacheEntry[];
  chaosReport: { type: ChaosType; observed: boolean; handled: boolean; detail: string }[];
  /** Records still to process when the run suspended mid-node (selector confirmation). */
  remaining: string[];
}

export interface RunSummary {
  status: RunStatus;
  recordsIn: number;
  recordsPromoted: number;
  recordsPosted: number;
  amountPostedCents: number;
  duplicatesPrevented: number;
  escalations: number;
  decisions: number;
  quarantinedDocs: number;
  quarantinedRows: number;
  selectorsHealed: number;
  guardBlocks: number;
  injectionFindings: number;
  manualAudit: number;
  paymentsToUnknownAccounts: number;
  compression?: { raw: number; distilled: number; ratio: number };
  nodeMs: Partial<Record<NodeId, number>>;
  totalEngineMs: number;
}

export interface Node8Output {
  summary: RunSummary;
  auditHead: string;
  auditValid: boolean;
}

export interface GraphState {
  version: 2;
  runId: string;
  parentRunId?: string;
  createdAt: string;
  config: RunConfig;
  input: BatchInput;
  /** Next node to run; 9 when finished. */
  cursor: NodeId | 9;
  status: RunStatus;
  n1?: Node1Output;
  n2?: Node2Output;
  n3?: Node3Output;
  n4?: Node4Output;
  n5?: Node5Output;
  n6?: Node6Output;
  n7?: Node7Output;
  n8?: Node8Output;
  /** Escalations waiting for a human. */
  pending: Escalation[];
  decisions: HumanDecision[];
  audit: AuditEntry[];
  /** Measured engine time per node (ms), excluding presentation pacing. */
  nodeMs: Partial<Record<NodeId, number>>;
  /** Cumulative engine time (ms); event timestamps continue from here. */
  engineMs: number;
  /** Next event sequence number (continues across nodes and resumes). */
  eventSeq: number;
  /** Set when this run was forked from another run's checkpoint. */
  forkedFrom?: { runId: string; checkpointId: string; fromNode: NodeId; changes: string[] };
  error?: { node: NodeId; message: string };
}

export interface Checkpoint {
  id: string;
  runId: string;
  atNode: NodeId;
  status: RunStatus;
  state: GraphState;
  stateSha256: string;
  /** HMAC-SHA256 from /api/checkpoint/sign; required to resume after HITL. */
  signature?: string;
  signedAt?: string;
  parentCheckpoint?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Events (rule T2: the UI renders only from these)
// ---------------------------------------------------------------------------

export type EventType =
  | "NODE_STARTED"
  | "NODE_FINISHED"
  | "DOC_QUARANTINED"
  | "INJECTION_FLAGGED"
  | "SPOTLIGHT_APPLIED"
  | "DRIFT_DETECTED"
  | "ROWS_QUARANTINED"
  | "MAPPING_SYNTHESIZED"
  | "INVARIANT_RESULT"
  | "ROWS_PROMOTED"
  | "RECONCILED"
  | "POLICY_HIT"
  | "RUN_SUSPENDED"
  | "HUMAN_DECISION"
  | "RUN_RESUMED"
  | "DOM_DISTILLED"
  | "BASELINE_RUN"
  | "ACTION_PLANNED"
  | "ACTION_EXECUTED"
  | "SELECTOR_HEALED"
  | "GUARD_BLOCKED"
  | "DUPLICATE_PREVENTED"
  | "POSTED"
  | "LLM_CALLED"
  | "AUDIT_COMMITTED"
  | "RUN_FAILED";

export interface EventPayloads {
  NODE_STARTED: { name: string };
  NODE_FINISHED: { name: string; summary: string; counts: Record<string, number> };
  DOC_QUARANTINED: { docId: string; name: string; reason: string; ruleIds: string[] };
  INJECTION_FLAGGED: { docId: string; name: string; findings: SecurityFinding[]; revealed: RevealedChar[]; score: number };
  SPOTLIGHT_APPLIED: { docId: string; nonce: string; marker: string; preview: string };
  DRIFT_DETECTED: { fileId: string; fileName: string; errors: DriftError[]; columns: string[] };
  ROWS_QUARANTINED: { fileId: string; rows: { rowIndex: number; sha256: string; reasons: string[] }[] };
  MAPPING_SYNTHESIZED: { fileId: string; specId: string; mappings: FieldMapping[]; unmappedSource: string[]; unmappedTarget: string[]; dateDecision?: DateDecision };
  INVARIANT_RESULT: { fileId: string; result: InvariantResult };
  ROWS_PROMOTED: { fileId: string; count: number; recordIds: string[] };
  RECONCILED: { recordId: string; invoice_number: string; confidence: number; agree: number; total: number; policyHits: PolicyHit[] };
  POLICY_HIT: { escalationId: string; kind: Escalation["kind"]; recordId?: string; hits: PolicyHit[] };
  RUN_SUSPENDED: { atNode: NodeId; escalations: number };
  HUMAN_DECISION: { decision: HumanDecision };
  RUN_RESUMED: { fromNode: NodeId; decisions: number };
  DOM_DISTILLED: { page: string; nodeCount: number; rawTokens: number; distilledTokens: number; ratio: number; lines: string[]; chaos: ChaosType[]; selectors?: string[] };
  BASELINE_RUN: BaselineResult;
  ACTION_PLANNED: { recordId: string; planner: "deterministic" | "llm" | "hijacked-stub"; actions: PlannedAction[]; rejected: { raw: unknown; reason: string }[] };
  ACTION_EXECUTED: { action: ExecutedAction };
  SELECTOR_HEALED: { key: string; from: string; to: string; similarity: number; runnerUp?: number };
  GUARD_BLOCKED: { action: ExecutedAction; reasons: string[] };
  DUPLICATE_PREVENTED: { recordId: string; invoice_number: string; postingNumber: string };
  POSTED: { posting: Posting };
  LLM_CALLED: { task: string; model: string; ok: boolean; fallback: boolean; reason?: string; ms: number };
  AUDIT_COMMITTED: { entries: number; head: string; valid: boolean };
  RUN_FAILED: { node: NodeId; message: string };
}

export interface EngineEvent<T extends EventType = EventType> {
  seq: number;
  runId: string;
  node: NodeId;
  /** ms since the run (or resume) started, from performance.now(). */
  at: number;
  /** Measured duration where it applies (node, action). */
  ms?: number;
  type: T;
  payload: EventPayloads[T];
}

export type AnyEngineEvent = { [K in EventType]: EngineEvent<K> }[EventType];
