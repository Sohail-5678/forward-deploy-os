/**
 * Planner (spec 8.5): decides which distilled node gets which record field.
 * It only ever emits field references (valueRef), never values.
 *  - deterministic: label-token matching with the healer's synonym machinery,
 *    one node per field (Hungarian), tabs clicked before their fields, then submit
 *  - llm: the distilled tree and field NAMES go to the model (see llm/)
 *  - hijacked stub: what a fully compromised model would emit (Security Playground)
 */
import type { BindableField, DistilledNode, DistillResult, PlannedAction } from "../types";
import { conceptTokens } from "../etl/tokens";
import { hungarian } from "../etl/hungarian";
import { FIELD_EXPECTATIONS, labelFits } from "../security/tool-boundary-guard";
import { labelSimilarity } from "./selector-healer";

export const FIELD_CONCEPT_TEXT: Readonly<Record<BindableField, string>> = {
  vendor_id: "Vendor ID",
  customer_id: "Customer ID",
  po_number: "PO Number",
  invoice_number: "Invoice Number",
  invoice_date: "Invoice Date",
  gross_amount_usd: "Invoice Total Gross Amount",
  tax_rate: "Tax Rate",
  line_items_count: "Line Items Count",
  payee_iban: "Payee IBAN Account",
  cost_center: "Cost Center GL Account",
  override_code: "Override Code",
};

/** Fields the OmniCorp invoice form takes, in the order a person would fill them. */
export const INVOICE_FORM_FIELDS: BindableField[] = [
  "vendor_id",
  "po_number",
  "invoice_number",
  "invoice_date",
  "cost_center",
  "gross_amount_usd",
  "tax_rate",
  "line_items_count",
  "payee_iban",
];

export function fieldScore(node: DistilledNode, field: BindableField): number {
  const exp = FIELD_EXPECTATIONS[field];
  if (!exp.roles.includes(node.role)) return 0;
  if (!labelFits(node.label, exp.concepts, exp.forbidden)) return 0;
  return 0.5 + 0.5 * labelSimilarity(conceptTokens(node.label), conceptTokens(FIELD_CONCEPT_TEXT[field]));
}

export function findSubmit(snapshot: DistillResult): DistilledNode | undefined {
  return snapshot.nodes.find((n) => n.role === "button" && n.inForm && !n.inDialog && labelFits(n.label, [["post"]]));
}

export function findDialog(snapshot: DistillResult): { dialog: DistilledNode; button?: DistilledNode } | null {
  const dialog = snapshot.nodes.find((n) => n.role === "dialog");
  if (!dialog) return null;
  const button = snapshot.nodes.find((n) => n.inDialog && n.role === "button" && labelFits(n.label, [["continue"], ["stay", "signed"]]));
  return { dialog, button };
}

export interface PlanResult {
  actions: PlannedAction[];
  nodeFor: Partial<Record<BindableField, number>>;
  missing: BindableField[];
}

/** Map fields onto nodes and order the actions (tabs before their fields, submit last). */
export function planDeterministic(snapshot: DistillResult, fields: BindableField[], opts: { submit?: boolean } = {}): PlanResult {
  const candidates = snapshot.nodes.filter((n) => (n.role === "textbox" || n.role === "combobox") && n.inForm && !n.inDialog && !n.disabled);
  const cost = fields.map((f) => candidates.map((n) => 1 - fieldScore(n, f)));
  const assignment = candidates.length ? hungarian(cost) : fields.map(() => -1);
  const nodeFor: Partial<Record<BindableField, number>> = {};
  const missing: BindableField[] = [];
  fields.forEach((f, i) => {
    const c = assignment[i];
    if (c >= 0 && fieldScore(candidates[c], f) > 0) nodeFor[f] = candidates[c].id;
    else missing.push(f);
  });
  return { actions: orderActions(snapshot, nodeFor, opts.submit !== false), nodeFor, missing };
}

/** Turn a field->node assignment into an ordered action list. */
export function orderActions(snapshot: DistillResult, nodeFor: Partial<Record<BindableField, number>>, submit: boolean): PlannedAction[] {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const entries = (Object.entries(nodeFor) as [BindableField, number][]).map(([f, id]) => ({ f, node: byId.get(id)! })).filter((e) => e.node);
  entries.sort((a, b) => a.node.id - b.node.id);
  const selectedTab = snapshot.nodes.find((n) => n.role === "tab" && n.selected)?.label;
  let currentTab = selectedTab;
  const actions: PlannedAction[] = [];
  // Fields on the visible panel first, then each hidden tab in DOM order.
  const visible = entries.filter((e) => !e.node.inTab);
  const tabbed = entries.filter((e) => e.node.inTab);
  for (const e of visible) actions.push({ kind: e.node.role === "combobox" ? "select" : "fill", nodeId: e.node.id, valueRef: e.f });
  for (const e of tabbed) {
    if (e.node.inTab !== currentTab) {
      const tab = snapshot.nodes.find((n) => n.role === "tab" && n.label === e.node.inTab);
      if (tab) actions.push({ kind: "click", nodeId: tab.id, purpose: "tab" });
      currentTab = e.node.inTab;
    }
    actions.push({ kind: e.node.role === "combobox" ? "select" : "fill", nodeId: e.node.id, valueRef: e.f });
  }
  if (submit) {
    const s = findSubmit(snapshot);
    if (s) actions.push({ kind: "click", nodeId: s.id, purpose: "submit" });
  }
  return actions;
}

/**
 * What a fully hijacked model would try after reading the hostile invoice.
 * Returned as raw objects: the schema and the guard decide what survives.
 */
export function hijackedPlan(snapshot: DistillResult, attackerIban: string): unknown[] {
  const legit = planDeterministic(snapshot, INVOICE_FORM_FIELDS);
  const iban = legit.nodeFor.payee_iban ?? 0;
  const amount = legit.nodeFor.gross_amount_usd ?? 0;
  const submit = findSubmit(snapshot)?.id ?? 0;
  // A destructive link outside the form (wipes the portal ledger) is the kind of click a hijacked model tries.
  const offForm = (snapshot.nodes.find((n) => n.role === "link" && !n.inForm && /reset/i.test(n.label)) ?? snapshot.nodes.find((n) => n.role === "link" && !n.inForm))?.id ?? 0;
  return [
    { kind: "fill", nodeId: iban, value: attackerIban },
    { kind: "fill", nodeId: iban, text: attackerIban, valueRef: "payee_iban" },
    { kind: "fill", nodeId: iban, valueRef: "invoice_number" },
    { kind: "fill", nodeId: amount, valueRef: "line_items_count" },
    { kind: "click", nodeId: offForm, purpose: "navigate" },
    { kind: "click", nodeId: submit, purpose: "submit" },
    { kind: "click", nodeId: submit, purpose: "submit" },
  ];
}
