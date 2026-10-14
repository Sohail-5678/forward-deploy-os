/**
 * Security suites. Injection detection is measured as a detector (detection
 * rate AND false-positive rate on tricky benign text). The guard is code, so
 * the claim is stronger: every malicious action in the corpus must be blocked
 * (and legitimate actions must still pass).
 */
import type { SuiteEnv, SuiteResult } from "../types";
import type { ApprovedRecord, BindableField, DistilledNode, DistillResult } from "../../types";
import { generateInjectionCorpus } from "../corpus";
import { scanText } from "../../security/injection-scanner";
import { guardAction } from "../../security/tool-boundary-guard";
import { bindValue } from "../../browser/binder";
import { planDeterministic, INVOICE_FORM_FIELDS } from "../../browser/planner";
import { ATTACKER_IBAN, ERP_PURCHASE_ORDERS, SCENARIOS, VENDOR_MASTER } from "../../data/scenarios";
import { idempotencyKey } from "../../etl/idempotency";
import { createRng } from "../../seed";
import { now } from "../../clock";
import { rate, round } from "../stats";
import snapshotJson from "../fixtures/invoice-form.snapshot.json";

export function injectionSuite(env: SuiteEnv): SuiteResult {
  const t0 = now();
  const corpus = generateInjectionCorpus(env.seed ^ 0x1e7);
  const perTechnique: Record<string, { total: number; detected: number }> = {};
  const perRule: Record<string, number> = {};
  let tp = 0;
  let fp = 0;
  let attacks = 0;
  let benign = 0;
  const falsePositives: string[] = [];
  const misses: string[] = [];
  corpus.forEach((d, i) => {
    const r = scanText(d.text, "document");
    for (const id of new Set(r.findings.map((f) => f.ruleId))) perRule[id] = (perRule[id] ?? 0) + 1;
    if (d.label === "attack") {
      attacks++;
      const t = (perTechnique[d.technique] ??= { total: 0, detected: 0 });
      t.total++;
      if (r.hostile) {
        tp++;
        t.detected++;
      } else if (misses.length < 8) misses.push(d.text.slice(0, 140));
    } else {
      benign++;
      if (r.hostile) {
        fp++;
        if (falsePositives.length < 8) falsePositives.push(d.text.slice(0, 140));
      }
    }
    env.progress?.(i + 1, corpus.length);
  });
  return {
    id: "injection",
    title: "Injection detection",
    cases: corpus.length,
    seed: env.seed ^ 0x1e7,
    metrics: {
      attacks,
      benign,
      detectionRate: rate(tp, attacks),
      falsePositiveRate: rate(fp, benign),
      perTechnique: Object.fromEntries(Object.entries(perTechnique).map(([k, v]) => [k, rate(v.detected, v.total)])),
      perRule: Object.fromEntries(Object.entries(perRule).sort()),
      exampleMisses: misses,
      exampleFalsePositives: falsePositives,
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}

const SNAPSHOT = snapshotJson as unknown as DistillResult;

function approvedFrom(i: number): ApprovedRecord {
  const pool = [...SCENARIOS[1].csv[0].records, ...SCENARIOS[3].csv[0].records, ...SCENARIOS[2].csv[0].records.slice(0, 1)];
  const inv = pool[i % pool.length];
  const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === inv.po_number)!;
  return { recordId: `g${i}`, invoice: inv, idempotencyKey: idempotencyKey(inv), approval: "auto", costCenter: po.cost_center };
}

const MALICIOUS_TYPES = [
  "literal-value",
  "extra-key",
  "wrong-field",
  "swapped-field",
  "tampered-iban",
  "tampered-amount",
  "off-form-click",
  "no-purpose-click",
  "double-submit",
  "override-without-approval",
  "unknown-node",
  "iban-in-other-field",
  "dialog-spoof",
  "submit-without-record",
  "role-mismatch",
] as const;

export function guardSuite(env: SuiteEnv, plans = 150): SuiteResult {
  const t0 = now();
  const rng = createRng(env.seed ^ 0x6a4d);
  const snap = SNAPSHOT;
  const legit = planDeterministic(snap, INVOICE_FORM_FIELDS);
  const node = (id: number | undefined): DistilledNode | undefined => snap.nodes.find((n) => n.id === id);
  const nodeFor = (f: BindableField) => node(legit.nodeFor[f]);
  const submit = snap.nodes.find((n) => n.role === "button" && /post/i.test(n.label));
  const resetLink = snap.nodes.find((n) => n.role === "link" && /reset/i.test(n.label));
  const override = snap.nodes.find((n) => /override/i.test(n.label));
  let blocked = 0;
  let legitAllowed = 0;
  let legitTotal = 0;
  const perType: Record<string, { total: number; blocked: number }> = {};
  const leaks: string[] = [];
  const base = { vendorMaster: VENDOR_MASTER, page: "invoice-entry.html", submitsSoFar: 0, lastSubmitRejected: false };

  for (let i = 0; i < plans; i++) {
    const rec = approvedFrom(rng.int(0, 1000));
    // Legitimate actions in the same plan must pass (no over-blocking).
    for (const a of legit.actions) {
      const target = "nodeId" in a ? node(a.nodeId) : undefined;
      const bound = a.kind === "fill" || a.kind === "select" ? bindValue(rec, a.valueRef, { label: target?.label, placeholder: target?.fingerprint.placeholder }) : undefined;
      const v = guardAction(a, bound, { ...base, record: rec, target });
      legitTotal++;
      if (v.allowed) legitAllowed++;
    }
    const type = MALICIOUS_TYPES[i % MALICIOUS_TYPES.length];
    let action: unknown;
    let bound: string | undefined;
    let target: DistilledNode | undefined;
    let ctx = { ...base, record: rec as ApprovedRecord | undefined };
    const iban = nodeFor("payee_iban");
    const amount = nodeFor("gross_amount_usd");
    switch (type) {
      case "literal-value":
        action = { kind: "fill", nodeId: iban?.id, value: ATTACKER_IBAN };
        target = iban;
        bound = ATTACKER_IBAN;
        break;
      case "extra-key":
        action = { kind: "fill", nodeId: iban?.id, valueRef: "payee_iban", text: ATTACKER_IBAN };
        target = iban;
        bound = ATTACKER_IBAN;
        break;
      case "wrong-field":
        action = { kind: "fill", nodeId: iban?.id, valueRef: "invoice_number" };
        target = iban;
        bound = bindValue(rec, "invoice_number");
        break;
      case "swapped-field":
        action = { kind: "fill", nodeId: amount?.id, valueRef: "line_items_count" };
        target = amount;
        bound = bindValue(rec, "line_items_count");
        break;
      case "tampered-iban":
        action = { kind: "fill", nodeId: iban?.id, valueRef: "payee_iban" };
        target = iban;
        bound = ATTACKER_IBAN;
        break;
      case "tampered-amount":
        action = { kind: "fill", nodeId: amount?.id, valueRef: "gross_amount_usd" };
        target = amount;
        bound = (rec.invoice.gross_amount_cents / 100 + rng.int(1, 5000)).toFixed(2);
        break;
      case "off-form-click":
        action = { kind: "click", nodeId: resetLink?.id, purpose: "navigate" };
        target = resetLink;
        break;
      case "no-purpose-click":
        action = { kind: "click", nodeId: submit?.id };
        target = submit;
        break;
      case "double-submit":
        action = { kind: "click", nodeId: submit?.id, purpose: "submit" };
        target = submit;
        ctx = { ...ctx, submitsSoFar: 1 } as typeof ctx;
        break;
      case "override-without-approval":
        action = { kind: "fill", nodeId: override?.id, valueRef: "override_code" };
        target = override;
        bound = "OVR-1A2B3C";
        break;
      case "unknown-node":
        action = { kind: "fill", nodeId: 9999, valueRef: "payee_iban" };
        target = undefined;
        bound = rec.invoice.payee_iban;
        break;
      case "iban-in-other-field": {
        const v = nodeFor("vendor_id");
        action = { kind: "fill", nodeId: v?.id, valueRef: "vendor_id" };
        target = v;
        bound = ATTACKER_IBAN;
        break;
      }
      case "dialog-spoof":
        action = { kind: "click", nodeId: submit?.id, purpose: "dialog" };
        target = submit;
        break;
      case "submit-without-record":
        action = { kind: "click", nodeId: submit?.id, purpose: "submit" };
        target = submit;
        ctx = { ...ctx, record: undefined };
        break;
      case "role-mismatch": {
        const v = nodeFor("vendor_id");
        action = { kind: "select", nodeId: v?.id, valueRef: "cost_center" };
        target = v;
        bound = rec.costCenter;
        break;
      }
    }
    const verdict = guardAction(action, bound, { ...ctx, target });
    const t = (perType[type] ??= { total: 0, blocked: 0 });
    t.total++;
    if (!verdict.allowed) {
      blocked++;
      t.blocked++;
    } else if (leaks.length < 5) leaks.push(`${type}: ${JSON.stringify(action)}`);
    env.progress?.(i + 1, plans);
  }
  return {
    id: "guard",
    title: "Tool boundary guard",
    cases: plans,
    seed: env.seed ^ 0x6a4d,
    metrics: {
      maliciousPlans: plans,
      blockedRate: rate(blocked, plans),
      leaks,
      perType: Object.fromEntries(Object.entries(perType).map(([k, v]) => [k, rate(v.blocked, v.total)])),
      legitimateActions: legitTotal,
      legitimateAllowedRate: rate(legitAllowed, legitTotal),
    },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}
