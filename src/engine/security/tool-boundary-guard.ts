/**
 * Layer 5: tool boundary guard (spec 10.2). Always on (rule S4): there is no
 * configuration flag for it anywhere in the engine. Every action is checked
 * against code-level policy before it touches the portal:
 *  - the action is a well-formed field reference (no literal values)
 *  - the target's role and label fit the field being written
 *  - the bound value is exactly what code derives from the approved record
 *  - a payee IBAN equals the vendor master IBAN for that vendor
 *  - an amount equals the approved amount
 *  - no clicks outside the current form (except allow-listed navigation and
 *    session dialogs), at most one submit per record (one retry only for an
 *    approved override after the portal asked for it)
 */
import type { ApprovedRecord, BindableField, DistilledNode, DistilledRole, GuardCheck, GuardVerdict, PlannedAction, VendorMasterEntry } from "../types";
import { plannedActionSchema } from "../schemas";
import { conceptTokens } from "../etl/tokens";
import { bindValue, BindingError } from "../browser/binder";
import { normalizeIban, isValidIban } from "../iban";
import { parseCurrencyCents } from "../etl/normalizers";

interface FieldExpectation {
  roles: DistilledRole[];
  /** The label must contain every token of at least one set. */
  concepts: string[][];
  /** The label must not contain any of these tokens. */
  forbidden?: string[];
}

export const FIELD_EXPECTATIONS: Readonly<Record<BindableField, FieldExpectation>> = {
  vendor_id: { roles: ["textbox"], concepts: [["vendor"]] },
  customer_id: { roles: ["textbox"], concepts: [["customer"]] },
  po_number: { roles: ["textbox"], concepts: [["purchase_order"]] },
  invoice_number: { roles: ["textbox"], concepts: [["invoice", "identifier"]], forbidden: ["purchase_order", "date", "amount"] },
  invoice_date: { roles: ["textbox"], concepts: [["date"]] },
  gross_amount_usd: { roles: ["textbox"], concepts: [["amount"]], forbidden: ["tax", "rate", "line"] },
  tax_rate: { roles: ["textbox"], concepts: [["tax"]] },
  line_items_count: { roles: ["textbox"], concepts: [["line"], ["item"]], forbidden: ["amount"] },
  payee_iban: { roles: ["textbox"], concepts: [["payee"], ["account"]], forbidden: ["cost", "ledger", "center"] },
  cost_center: { roles: ["combobox"], concepts: [["cost"], ["center"], ["ledger"]] },
  override_code: { roles: ["textbox"], concepts: [["override"]] },
};

const NAV_ALLOW: string[][] = [["purchase_order", "search"], ["invoice", "entry"], ["new", "invoice"]];
const SUBMIT_CONCEPTS: string[][] = [["post"]];
const SEARCH_CONCEPTS: string[][] = [["search"]];
const DIALOG_BUTTON_CONCEPTS: string[][] = [["continue"], ["stay", "signed"]];
const SESSION_DIALOG_CONCEPTS: string[][] = [["session"]];

export function labelFits(label: string, concepts: string[][], forbidden: string[] = []): boolean {
  const toks = new Set(conceptTokens(label));
  if (forbidden.some((f) => toks.has(f))) return false;
  return concepts.some((set) => set.every((t) => toks.has(t)));
}

export interface GuardContext {
  /** The approved record being posted; undefined for navigation-only steps. */
  record?: ApprovedRecord;
  vendorMaster: VendorMasterEntry[];
  /** Resolved target element, or undefined when the node id does not exist. */
  target?: DistilledNode;
  page: string;
  submitsSoFar: number;
  lastSubmitRejected: boolean;
  /** Label of the open dialog, if the target is inside one. */
  dialogLabel?: string;
}

export function guardAction(raw: unknown, boundValue: string | undefined, ctx: GuardContext): GuardVerdict {
  const checks: GuardCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

  const parsed = plannedActionSchema.safeParse(raw);
  add("schema", parsed.success, parsed.success ? "field reference only, no literal values" : `rejected: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  if (!parsed.success) return verdict(checks);
  const action: PlannedAction = parsed.data;

  if (action.kind === "waitFor") {
    add("read-only", true, "waiting has no side effects");
    return verdict(checks);
  }

  const target = ctx.target;
  add("target-exists", !!target, target ? `[${target.id}] ${target.role} "${target.label}"` : `node ${action.nodeId} is not on the current page`);
  if (!target) return verdict(checks);

  if (action.kind === "fill" || action.kind === "select") {
    const exp = FIELD_EXPECTATIONS[action.valueRef];
    add("role-matches-field", exp.roles.includes(target.role), `${action.valueRef} expects ${exp.roles.join("/")}, target is ${target.role}`);
    add("label-matches-field", labelFits(target.label, exp.concepts, exp.forbidden), `"${target.label}" ${labelFits(target.label, exp.concepts, exp.forbidden) ? "fits" : "does not fit"} ${action.valueRef}`);
    add("target-in-form", target.inForm, target.inForm ? "inside the current form" : "outside the current form");
    if (!ctx.record) {
      add("record-approved", false, "no approved record is bound to this action");
      return verdict(checks);
    }
    let expected: string | undefined;
    try {
      expected = bindValue(ctx.record, action.valueRef, { label: target.label, placeholder: target.fingerprint.placeholder });
      add("value-from-record", boundValue === expected, boundValue === expected ? "bound value equals the approved record" : "bound value differs from the approved record");
    } catch (e) {
      add("value-from-record", false, e instanceof BindingError ? e.message : "binding failed");
    }
    if (action.valueRef === "payee_iban") {
      const master = ctx.vendorMaster.find((v) => v.vendor_id === ctx.record!.invoice.vendor_id);
      const ok = !!master && !!boundValue && normalizeIban(boundValue) === normalizeIban(master.iban);
      add("payee-matches-vendor-master", ok, master ? (ok ? `IBAN equals vendor master for ${master.vendor_id}` : `IBAN does not equal the vendor master IBAN for ${master.vendor_id}`) : `${ctx.record.invoice.vendor_id} is not in the vendor master`);
    }
    if (action.valueRef === "gross_amount_usd") {
      const cents = boundValue ? parseCurrencyCents(boundValue, "en-US") : null;
      const ok = cents !== null && cents === ctx.record.invoice.gross_amount_cents;
      add("amount-matches-approved", ok, ok ? "amount equals the approved amount" : "amount differs from the approved amount");
    }
    if (action.valueRef === "override_code") {
      add("override-approved", !!ctx.record.overrideCode, ctx.record.overrideCode ? "override approved by a human decision" : "no human approved an override");
    }
    // Defense in depth: no IBAN-shaped value that is not the vendor's own may be typed anywhere.
    if (boundValue && isValidIban(boundValue) && action.valueRef !== "payee_iban") {
      add("no-stray-iban", false, "an IBAN may only go into the payee field");
    }
    return verdict(checks);
  }

  // Clicks
  const purpose = action.purpose;
  switch (purpose) {
    case "submit": {
      add("role-is-button", target.role === "button", `target is ${target.role}`);
      add("label-is-submit", labelFits(target.label, SUBMIT_CONCEPTS), `"${target.label}"`);
      add("target-in-form", target.inForm, target.inForm ? "inside the current form" : "outside the current form");
      add("record-approved", !!ctx.record, ctx.record ? `posting ${ctx.record.invoice.invoice_number}` : "no approved record");
      const retryOk = ctx.submitsSoFar === 1 && ctx.lastSubmitRejected && !!ctx.record?.overrideCode;
      const ok = ctx.submitsSoFar === 0 || retryOk;
      add("single-submit", ok, ok ? (retryOk ? "one retry after the portal requested an approved override" : "first submit for this record") : `already submitted ${ctx.submitsSoFar} time(s) for this record`);
      break;
    }
    case "tab":
      add("role-is-tab", target.role === "tab", `target is ${target.role}`);
      add("target-in-form", target.inForm, target.inForm ? "inside the current form" : "outside the current form");
      break;
    case "search":
      add("role-is-button", target.role === "button", `target is ${target.role}`);
      add("label-is-search", labelFits(target.label, SEARCH_CONCEPTS), `"${target.label}"`);
      add("target-in-form", target.inForm, target.inForm ? "inside the search form" : "outside the current form");
      break;
    case "dialog":
      add("target-in-dialog", target.inDialog, target.inDialog ? "inside an open dialog" : "not inside a dialog");
      add("dialog-is-session-notice", !!ctx.dialogLabel && labelFits(ctx.dialogLabel, SESSION_DIALOG_CONCEPTS), `dialog "${ctx.dialogLabel ?? ""}"`);
      add("button-is-continue", labelFits(target.label, DIALOG_BUTTON_CONCEPTS), `"${target.label}"`);
      break;
    case "navigate":
      add("role-is-link", target.role === "link", `target is ${target.role}`);
      add("navigation-allow-listed", labelFits(target.label, NAV_ALLOW), `"${target.label}"`);
      break;
    default:
      add("click-purpose", false, "clicks must declare a purpose (tab, submit, search, dialog or navigate)");
  }
  return verdict(checks);
}

/** Login is configuration, not planning: only the two login fields, only the printed demo values. */
export function guardLogin(target: DistilledNode | undefined, field: "username" | "password" | "submit", value: string | undefined, expected: string | undefined, page: string): GuardVerdict {
  const checks: GuardCheck[] = [];
  const add = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  add("login-page", /index\.html$|\/omnicorp\/?$/.test(page) || page === "index.html", `page ${page}`);
  add("target-exists", !!target, target ? `[${target.id}] ${target.role} "${target.label}"` : "login field not found");
  if (!target) return verdict(checks);
  if (field === "submit") {
    add("role-is-button", target.role === "button", target.role);
    add("label-is-logon", labelFits(target.label, [["logon"], ["log", "on"], ["user", "logon"]]) || /log\s*on|sign\s*in|login/i.test(target.label), `"${target.label}"`);
  } else {
    add("role-is-textbox", target.role === "textbox", target.role);
    add("label-matches", labelFits(target.label, field === "username" ? [["user"]] : [["password"]]), `"${target.label}"`);
    add("value-is-configured", value !== undefined && value === expected, "value equals the configured demo login");
  }
  return verdict(checks);
}

function verdict(checks: GuardCheck[]): GuardVerdict {
  const failed = checks.filter((c) => !c.passed);
  return { allowed: failed.length === 0, reasons: failed.map((c) => `${c.name}: ${c.detail}`), checks };
}
