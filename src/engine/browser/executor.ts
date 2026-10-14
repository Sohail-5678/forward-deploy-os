/**
 * Portal executor (spec 8.5 / 8.6): for one approved record,
 *   read-before-write on the PO search page (idempotency) ->
 *   distill the invoice form -> plan (cache + heal, or semantic planner, LLM or hijacked stub) ->
 *   bind values from the approved record -> tool boundary guard -> act -> wait for the portal.
 * Session dialogs are detected in the distilled tree and dismissed. Nothing is
 * ever clicked on a guess: low-similarity heals go to a human.
 */
import type {
  ApprovedRecord,
  BindableField,
  DistilledNode,
  DistillResult,
  EventPayloads,
  EventType,
  ExecutedAction,
  GuardVerdict,
  HealAttempt,
  HealingConfig,
  LoginAction,
  PlannedAction,
  Posting,
  SelectorEscalation,
  VendorMasterEntry,
} from "../types";
import type { Clock } from "../clock";
import { now } from "../clock";
import { PortalError, type PortalDriver, type PortalPage } from "./driver";
import { bindLogin, bindValue, BindingError } from "./binder";
import { confirmedBySelector, fingerprintSimilarity, healAgainst, SelectorCache, type HealDecision } from "./selector-healer";
import { fieldScore, findDialog, findSubmit, hijackedPlan, INVOICE_FORM_FIELDS, orderActions, planDeterministic } from "./planner";
import { guardAction, guardLogin, labelFits } from "../security/tool-boundary-guard";
import { plannedActionSchema } from "../schemas";
import { idempotencyKey } from "../etl/idempotency";
import { parseCurrencyCents } from "../etl/normalizers";
import { PORTAL_DEMO_LOGIN } from "../config";

type Emit = <T extends EventType>(type: T, payload: EventPayloads[T], ms?: number) => void;

export interface ExecutorContext {
  driver: PortalDriver;
  cache: SelectorCache;
  healing: HealingConfig;
  vendorMaster: VendorMasterEntry[];
  clock: Clock;
  emit: Emit;
  planner: "deterministic" | "llm" | "hijacked";
  /** Returns raw planned actions from the LLM, or null to fall back to deterministic. */
  llmPlan?: (lines: string[], fields: BindableField[], page: string) => Promise<unknown[] | null>;
  /** Use cached selectors (recorded earlier) and heal them when they break. */
  useCache: boolean;
  attackerIban: string;
  /** escalationId -> candidate index chosen by a human. */
  selectorPicks: Record<string, number>;
  /** Presentation pacing (cursor animation); excluded from measured action time. */
  pace?: (selector: string, label: string, kind: string) => Promise<void>;
  /** Optional token counter for DOM_DISTILLED events. */
  countTokens?: (text: string) => number;
  maxActionsPerRecord?: number;
  signal?: AbortSignal;
}

export type RecordOutcome =
  | { kind: "posted"; posting: Posting }
  | { kind: "duplicate"; postingNumber: string }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "ask-human"; escalation: SelectorEscalation };

export interface RecordResult {
  outcome: RecordOutcome;
  actions: ExecutedAction[];
  heals: HealAttempt[];
  dialogsDismissed: number;
  slowestWaitMs: number;
}

class StopRecord extends Error {
  constructor(readonly outcome: RecordOutcome) {
    super(outcome.kind);
  }
}

const SUBMIT_KEY = "invoice-entry.html:submit";

export class PortalExecutor {
  private actions: ExecutedAction[] = [];
  private heals: HealAttempt[] = [];
  private dialogsDismissed = 0;
  private slowestWaitMs = 0;
  private submits = 0;
  private lastSubmitRejected = false;
  private retryReason: "override" | "session-notice" | undefined;
  private record?: ApprovedRecord;

  constructor(private readonly ctx: ExecutorContext) {}

  private get d() {
    return this.ctx.driver;
  }

  private aborted() {
    if (this.ctx.signal?.aborted) throw new StopRecord({ kind: "failed", reason: "run stopped by the operator" });
  }

  async distill(emit = false): Promise<DistillResult> {
    const snap = await this.d.distill();
    if (emit) {
      const raw = this.ctx.countTokens ? this.ctx.countTokens(snap.rawHtml) : Math.round(snap.rawHtml.length / 4);
      const dis = this.ctx.countTokens ? this.ctx.countTokens(snap.text) : Math.round(snap.text.length / 4);
      this.ctx.emit("DOM_DISTILLED", { page: snap.page, nodeCount: snap.nodes.length, rawTokens: raw, distilledTokens: dis, ratio: dis ? Math.round((raw / dis) * 10) / 10 : 0, lines: snap.lines, chaos: [] }, snap.ms);
    }
    return snap;
  }

  private async wait(cond: Parameters<PortalDriver["waitFor"]>[0], timeoutMs = 10000): Promise<boolean> {
    const t0 = now();
    const ok = await this.d.waitFor(cond, timeoutMs);
    this.slowestWaitMs = Math.max(this.slowestWaitMs, now() - t0);
    return ok;
  }

  private async open(page: PortalPage): Promise<DistillResult> {
    this.aborted();
    await this.d.goto(page);
    if ((await this.d.currentPage()) === "index.html" && page !== "index.html") {
      await this.login();
      await this.d.goto(page);
    }
    if (!(await this.wait({ kind: "page", page }, 8000))) throw new StopRecord({ kind: "failed", reason: `portal did not open ${page}` });
    let snap = await this.distill(true);
    snap = await this.handleDialog(snap);
    return snap;
  }

  /** Detect a session dialog in the distilled tree and dismiss it through the guard. */
  private async handleDialog(snap: DistillResult): Promise<DistillResult> {
    const found = findDialog(snap);
    if (!found) return snap;
    if (!found.button) throw new StopRecord({ kind: "failed", reason: `unexpected dialog "${found.dialog.label}" with no Continue button` });
    this.ctx.emit("DOM_DISTILLED", { page: snap.page, nodeCount: snap.nodes.length, rawTokens: 0, distilledTokens: 0, ratio: 0, lines: snap.lines, chaos: ["interstitial"] }, snap.ms);
    const action: PlannedAction = { kind: "click", nodeId: found.button.id, purpose: "dialog" };
    await this.perform(action, found.button, undefined, { dialogLabel: found.dialog.label });
    this.dialogsDismissed++;
    await this.wait({ kind: "idle" }, 2000);
    return this.distill();
  }

  private async login(): Promise<void> {
    let snap = await this.distill(true);
    const user = await this.resolveSimple(snap, "index.html:username", (n) => n.role === "textbox" && labelFits(n.label, [["user"]]));
    const pass = await this.resolveSimple(snap, "index.html:password", (n) => n.role === "textbox" && labelFits(n.label, [["password"]]));
    const btn = await this.resolveSimple(snap, "index.html:logon", (n) => n.role === "button" && /log\s*on|sign\s*in|login/i.test(n.label));
    const steps: [DistilledNode | undefined, "username" | "password" | "submit"][] = [
      [user, "username"],
      [pass, "password"],
      [btn, "submit"],
    ];
    for (const [node, field] of steps) {
      const value = field === "submit" ? undefined : bindLogin(field);
      const verdict = guardLogin(node, field, value, field === "submit" ? undefined : PORTAL_DEMO_LOGIN[field], "index.html");
      const planned: LoginAction = { kind: "login", field, nodeId: node?.id ?? -1 };
      const shown = field === "password" ? "••••••" : value;
      if (!verdict.allowed || !node) {
        this.blocked(planned, node, verdict, shown);
        throw new StopRecord({ kind: "blocked", reason: `login blocked: ${verdict.reasons.join("; ")}` });
      }
      if (this.ctx.pace) await this.ctx.pace(node.selector, node.label, field === "submit" ? "click" : "fill");
      const tAct = now();
      if (field === "submit") await this.d.click(node.selector);
      else await this.d.fill(node.selector, value!);
      this.record_action({ planned, boundValue: shown, selectorUsed: node.selector, label: node.label, page: "index.html", guard: verdict, ok: true, ms: round(now() - tAct) }, true);
    }
    // The portal returns to the page that asked for the log on (or PO Search).
    const landed = await this.wait(
      [
        { kind: "page", page: "po-search.html" },
        { kind: "page", page: "invoice-entry.html" },
        { kind: "page", page: "confirmation.html" },
      ],
      8000,
    );
    if (!landed && (await this.d.currentPage()) === "index.html") throw new StopRecord({ kind: "failed", reason: "portal log on failed" });
    snap = await this.distill();
    void snap;
  }

  private record_action(a: ExecutedAction, emit = true) {
    this.actions.push(a);
    if (emit) this.ctx.emit("ACTION_EXECUTED", { action: a }, a.ms);
  }

  private blocked(planned: PlannedAction | LoginAction, node: DistilledNode | undefined, guard: GuardVerdict, boundValue?: string) {
    const a: ExecutedAction = {
      recordId: this.record?.recordId,
      planned,
      boundValue,
      selectorUsed: node?.selector ?? "",
      label: node?.label,
      page: "",
      guard,
      ok: false,
      error: "blocked by the tool boundary guard",
      ms: 0,
    };
    this.actions.push(a);
    this.ctx.emit("GUARD_BLOCKED", { action: a, reasons: guard.reasons });
  }

  /** Resolve a target through the selector cache (probe, then heal), or a semantic fallback. */
  private async resolveCached(snap: DistillResult, key: string, semantic: (n: DistilledNode) => boolean): Promise<{ node?: DistilledNode; ask?: HealDecision }> {
    const entry = this.ctx.useCache ? this.ctx.cache.get(key) : undefined;
    if (!entry) {
      const node = snap.nodes.find(semantic);
      if (node) this.ctx.cache.set(key, node.fingerprint, this.ctx.clock.iso());
      return { node };
    }
    const from = entry.fingerprint.lastKnownSelector;
    const probe = await this.d.probe(from);
    if (probe) {
      const sim = fingerprintSimilarity(entry.fingerprint, probe.fingerprint);
      if (sim >= this.ctx.healing.healThreshold) {
        const node = snap.nodes.find((n) => n.selector === from) ?? snap.nodes.find((n) => n.label === probe.label && n.role === probe.role);
        if (node) {
          this.heals.push({ key, page: snap.page, from, to: from, similarity: sim, outcome: "cache-hit", candidates: [] });
          return { node };
        }
      }
    }
    const escalationId = `esc_sel_${key}`;
    const pick = this.ctx.selectorPicks[escalationId];
    const decision = healAgainst(entry.fingerprint, snap, this.ctx.healing);
    if (pick !== undefined) {
      const cand = decision.candidates[pick];
      const node = cand ? snap.nodes.find((n) => n.selector === cand.selector) : undefined;
      if (node) {
        this.ctx.cache.set(key, node.fingerprint, this.ctx.clock.iso());
        this.heals.push({ key, page: snap.page, from, to: node.selector, similarity: cand.similarity, runnerUp: decision.runnerUp, outcome: "human-picked", candidates: decision.candidates });
        this.ctx.emit("SELECTOR_HEALED", { key, from, to: node.selector, similarity: cand.similarity, runnerUp: decision.runnerUp });
        return { node };
      }
    }
    if (decision.outcome === "ask-human" && confirmedBySelector(decision, from, !!probe, this.ctx.healing)) {
      const node = snap.nodes.find((n) => n.selector === from);
      if (node && semantic(node)) {
        this.ctx.cache.set(key, node.fingerprint, this.ctx.clock.iso());
        this.heals.push({ key, page: snap.page, from, to: from, similarity: decision.similarity, runnerUp: decision.runnerUp, outcome: "healed", candidates: decision.candidates });
        this.ctx.emit("SELECTOR_HEALED", { key, from, to: from, similarity: decision.similarity, runnerUp: decision.runnerUp });
        return { node };
      }
    }
    // A heal must also make sense semantically; otherwise ask instead of acting.
    if (decision.outcome === "healed" && decision.node && !semantic(decision.node)) decision.outcome = "ask-human";
    if (decision.outcome === "healed" && decision.node) {
      this.ctx.cache.set(key, decision.node.fingerprint, this.ctx.clock.iso());
      this.heals.push({ key, page: snap.page, from, to: decision.node.selector, similarity: decision.similarity, runnerUp: decision.runnerUp, outcome: "healed", candidates: decision.candidates });
      this.ctx.emit("SELECTOR_HEALED", { key, from, to: decision.node.selector, similarity: decision.similarity, runnerUp: decision.runnerUp });
      return { node: decision.node };
    }
    this.heals.push({ key, page: snap.page, from, similarity: decision.similarity, runnerUp: decision.runnerUp, outcome: decision.outcome === "ask-human" ? "ask-human" : "failed", candidates: decision.candidates });
    return { ask: decision };
  }

  private async resolveSimple(snap: DistillResult, key: string, semantic: (n: DistilledNode) => boolean): Promise<DistilledNode | undefined> {
    const r = await this.resolveCached(snap, key, semantic);
    if (r.node) return r.node;
    if (r.ask) this.escalate(snap, key, r.ask);
    return undefined;
  }

  private escalate(snap: DistillResult, key: string, decision: HealDecision): never {
    if (decision.outcome === "failed" || decision.candidates.length === 0 || decision.similarity < this.ctx.healing.askThreshold) {
      throw new StopRecord({ kind: "failed", reason: `could not find "${key.split(":")[1]}" on ${snap.page} (best similarity ${decision.similarity.toFixed(2)}, below ${this.ctx.healing.askThreshold}); not clicking a guess` });
    }
    const escalation: SelectorEscalation = {
      id: `esc_sel_${key}`,
      kind: "SELECTOR_CONFIRM",
      recordId: this.record?.recordId,
      targetKey: key,
      page: snap.page,
      candidates: decision.candidates,
      options: [
        ...decision.candidates.slice(0, 3).map((c, i) => ({
          choice: (["PICK_CANDIDATE_1", "PICK_CANDIDATE_2", "PICK_CANDIDATE_3"] as const)[i],
          label: `Use "${c.label}" (${c.similarity.toFixed(2)})`,
          description: c.selector,
          recommended: i === 0,
          shortcut: (["1", "2", "3"] as const)[i],
        })),
      ],
    };
    if (escalation.options.length < 3) escalation.options.push({ choice: "ABORT", label: "Stop this record", description: "Post nothing for this record.", shortcut: (["1", "2", "3"] as const)[escalation.options.length] });
    throw new StopRecord({ kind: "ask-human", escalation });
  }

  /** Run one action through binding, the guard and the driver. */
  private async perform(action: PlannedAction, node: DistilledNode | undefined, recordForBinding: ApprovedRecord | undefined, extra: { dialogLabel?: string } = {}): Promise<void> {
    this.aborted();
    let bound: string | undefined;
    if (action.kind === "fill" || action.kind === "select") {
      try {
        bound = recordForBinding ? bindValue(recordForBinding, action.valueRef, { label: node?.label, placeholder: node?.fingerprint.placeholder }) : undefined;
      } catch (e) {
        bound = undefined;
        if (!(e instanceof BindingError)) throw e;
      }
    }
    const live = node ? await this.d.probe(node.selector) : null;
    const target: DistilledNode | undefined = node && live ? { ...node, role: live.role as DistilledNode["role"], label: live.label } : undefined;
    const verdict = guardAction(action, bound, {
      record: recordForBinding,
      vendorMaster: this.ctx.vendorMaster,
      target,
      page: await this.d.currentPage(),
      submitsSoFar: this.submits,
      lastSubmitRejected: this.lastSubmitRejected,
      dialogLabel: extra.dialogLabel,
    });
    if (action.kind === "click" && action.purpose === "submit" && this.retryReason === "session-notice" && this.submits === 1 && this.lastSubmitRejected) {
      // A submit the portal refused because of its own session notice never reached validation.
      const single = verdict.checks.find((c) => c.name === "single-submit");
      if (single && !single.passed) {
        single.passed = true;
        single.detail = "retry after the portal's session notice (the first submit never reached validation)";
        verdict.allowed = verdict.checks.every((c) => c.passed);
        verdict.reasons = verdict.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
      }
    }
    if (!verdict.allowed || !target) {
      this.blocked(action, target ?? node, verdict, bound);
      throw new StopRecord({ kind: "blocked", reason: verdict.reasons.join("; ") || "target not found" });
    }
    if (this.ctx.pace) await this.ctx.pace(target.selector, target.label, action.kind);
    const t0 = now();
    const run = async () => {
      if (action.kind === "fill") await this.d.fill(target.selector, bound!);
      else if (action.kind === "select") await this.d.select(target.selector, bound!);
      else if (action.kind === "click") await this.d.click(target.selector);
    };
    try {
      await run();
    } catch (e) {
      if (e instanceof PortalError && e.code === "UNREACHABLE" && action.kind !== "click") {
        // A dialog may have disabled the form mid-action.
        const snap = await this.distill();
        await this.handleDialog(snap);
        await run();
      } else if (e instanceof PortalError && e.code === "UNREACHABLE" && action.kind === "click" && action.purpose !== "dialog") {
        const snap = await this.distill();
        await this.handleDialog(snap);
        await run();
      } else if (e instanceof PortalError) {
        throw new StopRecord({ kind: "failed", reason: e.message });
      } else throw e;
    }
    if (action.kind === "click" && action.purpose === "submit") this.submits++;
    this.record_action({
      recordId: recordForBinding?.recordId,
      planned: action,
      boundValue: bound,
      selectorUsed: target.selector,
      label: target.label,
      page: await this.d.currentPage(),
      guard: verdict,
      ok: true,
      ms: round(now() - t0),
    });
  }

  /** Read-before-write: check the PO's posted invoices for this record's idempotency key. */
  private async readBeforeWrite(rec: ApprovedRecord): Promise<{ duplicate?: string }> {
    let snap = await this.open("po-search.html");
    const box = await this.resolveSimple(snap, "po-search.html:po_number", (n) => n.role === "textbox" && n.inForm && labelFits(n.label, [["purchase_order"]]));
    if (!box) throw new StopRecord({ kind: "failed", reason: "PO search box not found" });
    await this.perform({ kind: "fill", nodeId: box.id, valueRef: "po_number" }, box, rec);
    snap = await this.handleDialog(await this.distill());
    const btn = await this.resolveSimple(snap, "po-search.html:search", (n) => n.role === "button" && n.inForm && labelFits(n.label, [["search"]]));
    if (!btn) throw new StopRecord({ kind: "failed", reason: "PO search button not found" });
    await this.perform({ kind: "click", nodeId: btn.id, purpose: "search" }, btn, rec);
    const found = await this.wait([{ kind: "text", text: "purchase order found" }], 10000);
    if (!found) throw new StopRecord({ kind: "failed", reason: "PO search timed out" });
    // Give the page a beat to settle, then look again (a session notice may have opened).
    await this.wait({ kind: "idle" }, 500);
    snap = await this.handleDialog(await this.distill(true));
    const status = snap.nodes.find((n) => n.role === "status" && /purchase order found/i.test(n.label));
    if (status && /^No purchase order/i.test(status.label)) throw new StopRecord({ kind: "failed", reason: `${rec.invoice.po_number} not found in the portal` });
    const rows = snap.nodes.filter((n) => n.role === "row").map((n) => n.label.split(" | "));
    const header = rows.find((r) => r[0] === rec.invoice.po_number);
    const vendor = header?.[1] ?? rec.invoice.vendor_id;
    for (const r of rows) {
      if (r[0]?.toUpperCase() !== rec.invoice.invoice_number.toUpperCase() || !/^GL-/.test(r[2] ?? "")) continue;
      const cents = parseCurrencyCents(r[1] ?? "", "en-US") ?? -1;
      const key = idempotencyKey({ vendor_id: vendor, po_number: rec.invoice.po_number, invoice_number: r[0], gross_amount_cents: cents });
      if (key === rec.idempotencyKey) return { duplicate: r[2] };
      throw new StopRecord({ kind: "failed", reason: `${rec.invoice.invoice_number} is already posted as ${r[2]} with a different amount; needs a human` });
    }
    return {};
  }

  private async planInvoice(snap: DistillResult, rec: ApprovedRecord): Promise<PlannedAction[]> {
    const fields = INVOICE_FORM_FIELDS;
    const planner = this.ctx.planner;
    if (planner === "hijacked" || planner === "llm") {
      let raw: unknown[] | null;
      const t0 = now();
      if (planner === "hijacked") raw = hijackedPlan(snap, this.ctx.attackerIban);
      else raw = this.ctx.llmPlan ? await this.ctx.llmPlan(snap.lines, fields, snap.page) : null;
      if (raw) {
        const actions: PlannedAction[] = [];
        const rejected: { raw: unknown; reason: string }[] = [];
        for (const r of raw) {
          const p = plannedActionSchema.safeParse(r);
          if (p.success) actions.push(p.data);
          else rejected.push({ raw: r, reason: `value binding: ${p.error.issues.map((i) => i.message).join("; ")}` });
        }
        this.ctx.emit("ACTION_PLANNED", { recordId: rec.recordId, planner: planner === "hijacked" ? "hijacked-stub" : "llm", actions, rejected }, round(now() - t0));
        return actions;
      }
    }
    // Deterministic: cached selectors first (healed when broken), semantic planner otherwise.
    const nodeFor: Partial<Record<BindableField, number>> = {};
    const t0 = now();
    const plan = planDeterministic(snap, fields, { submit: false });
    for (const f of fields) {
      const semantic = (n: DistilledNode) => fieldScore(n, f) > 0 && n.inForm;
      const key = `invoice-entry.html:${f}`;
      if (this.ctx.useCache && this.ctx.cache.get(key)) {
        const r = await this.resolveCached(snap, key, semantic);
        if (r.node) nodeFor[f] = r.node.id;
        else if (r.ask) this.escalate(snap, key, r.ask);
      } else if (plan.nodeFor[f] !== undefined) {
        nodeFor[f] = plan.nodeFor[f];
        const node = snap.nodes.find((n) => n.id === plan.nodeFor[f]);
        if (node) this.ctx.cache.set(key, node.fingerprint, this.ctx.clock.iso());
      }
    }
    const missing = fields.filter((f) => nodeFor[f] === undefined && (f !== "cost_center" || plan.nodeFor[f] !== undefined));
    if (missing.length) throw new StopRecord({ kind: "failed", reason: `portal form changed: could not find ${missing.join(", ")}` });
    const actions = orderActions(snap, nodeFor, false);
    const submit = await this.resolveCached(snap, SUBMIT_KEY, (n) => n.role === "button" && n.inForm && labelFits(n.label, [["post"]]));
    if (submit.ask) this.escalate(snap, SUBMIT_KEY, submit.ask);
    const s = submit.node ?? findSubmit(snap);
    if (!s) throw new StopRecord({ kind: "failed", reason: "submit button not found" });
    actions.push({ kind: "click", nodeId: s.id, purpose: "submit" });
    this.ctx.emit("ACTION_PLANNED", { recordId: rec.recordId, planner: "deterministic", actions, rejected: [] }, round(now() - t0));
    return actions;
  }

  private async submitAndConfirm(rec: ApprovedRecord): Promise<Posting> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await this.wait([{ kind: "page", page: "confirmation.html" }, { kind: "text", text: "ERR-" }], 12000);
      if (!ok) throw new StopRecord({ kind: "failed", reason: "portal did not respond to the submit" });
      if ((await this.d.currentPage()) === "confirmation.html") {
        await this.wait({ kind: "text", text: "Posting number" }, 5000);
        const snap = await this.distill(true);
        const status = snap.nodes.find((n) => n.role === "status" && /GL-\d{4}-\d{6}/.test(n.label));
        const postingNumber = /GL-\d{4}-\d{6}/.exec(status?.label ?? "")?.[0];
        if (!postingNumber) throw new StopRecord({ kind: "failed", reason: "confirmation page had no posting number" });
        const ledger = await this.d.readLedger();
        const entry = ledger.find((e) => e.postingNumber === postingNumber);
        return {
          recordId: rec.recordId,
          invoice_number: rec.invoice.invoice_number,
          vendor_id: rec.invoice.vendor_id,
          po_number: rec.invoice.po_number,
          amount_cents: entry?.amount_cents ?? rec.invoice.gross_amount_cents,
          postingNumber,
          postedAt: entry?.postedAt ?? this.ctx.clock.iso(),
          iban: entry?.iban ?? rec.invoice.payee_iban,
          overrideCode: entry?.overrideCode,
        };
      }
      // Portal error banner.
      let snap = await this.handleDialog(await this.distill(true));
      const alert = snap.nodes.find((n) => n.role === "alert" && /ERR-\d{4}/.test(n.label));
      const text = alert?.label ?? "unknown portal error";
      this.lastSubmitRejected = true;
      if (/ERR-0020/.test(text)) {
        this.retryReason = "session-notice";
        snap = await this.handleDialog(snap);
        const submit = findSubmit(snap);
        if (!submit) throw new StopRecord({ kind: "failed", reason: "submit button not found after the session notice" });
        await this.perform({ kind: "click", nodeId: submit.id, purpose: "submit" }, submit, rec);
        continue;
      }
      if (/ERR-4471/.test(text)) {
        if (!rec.overrideCode) throw new StopRecord({ kind: "failed", reason: `${text} (no human approved an override)` });
        this.retryReason = "override";
        snap = await this.handleDialog(snap);
        const field = await this.resolveCached(snap, "invoice-entry.html:override_code", (n) => fieldScore(n, "override_code") > 0);
        const node = field.node ?? snap.nodes.find((n) => fieldScore(n, "override_code") > 0);
        if (!node) throw new StopRecord({ kind: "failed", reason: "override code field not found" });
        if (node.inTab) {
          const tab = snap.nodes.find((n) => n.role === "tab" && n.label === node.inTab);
          if (tab) await this.perform({ kind: "click", nodeId: tab.id, purpose: "tab" }, tab, rec);
        }
        await this.perform({ kind: "fill", nodeId: node.id, valueRef: "override_code" }, node, rec);
        const submit = findSubmit(await this.distill());
        if (!submit) throw new StopRecord({ kind: "failed", reason: "submit button not found" });
        await this.perform({ kind: "click", nodeId: submit.id, purpose: "submit" }, submit, rec);
        continue;
      }
      throw new StopRecord({ kind: "failed", reason: `portal rejected the invoice: ${text}` });
    }
    throw new StopRecord({ kind: "failed", reason: "too many portal retries" });
  }

  /** Open a page (logging on if needed), dismiss any session dialog, and return its distillation. */
  async inspect(page: PortalPage): Promise<DistillResult> {
    this.actions = [];
    this.heals = [];
    try {
      return await this.open(page);
    } catch (e) {
      if (e instanceof StopRecord) throw new Error(e.outcome.kind === "failed" || e.outcome.kind === "blocked" ? e.outcome.reason : `portal needs a human: ${e.outcome.kind}`);
      throw e;
    }
  }

  setSelectorPicks(picks: Record<string, number>): void {
    this.ctx.selectorPicks = picks;
  }

  async processRecord(rec: ApprovedRecord): Promise<RecordResult> {
    this.actions = [];
    this.heals = [];
    this.dialogsDismissed = 0;
    this.slowestWaitMs = 0;
    this.submits = 0;
    this.lastSubmitRejected = false;
    this.retryReason = undefined;
    this.record = rec;
    const max = this.ctx.maxActionsPerRecord ?? 60;
    let outcome: RecordOutcome;
    try {
      const rbw = await this.readBeforeWrite(rec);
      if (rbw.duplicate) {
        this.ctx.emit("DUPLICATE_PREVENTED", { recordId: rec.recordId, invoice_number: rec.invoice.invoice_number, postingNumber: rbw.duplicate });
        outcome = { kind: "duplicate", postingNumber: rbw.duplicate };
      } else {
        const planSnap = await this.open("invoice-entry.html");
        const plan = await this.planInvoice(planSnap, rec);
        if (plan.length > max) throw new StopRecord({ kind: "blocked", reason: `plan has ${plan.length} actions; limit is ${max}` });
        for (const action of plan) {
          // Re-distill before each step: a session dialog can appear at any time.
          await this.handleDialog(await this.distill());
          const nodeId = "nodeId" in action ? action.nodeId : -1;
          // Node ids refer to the planning snapshot; selectors stay valid while the page is loaded.
          const planned = planSnap.nodes.find((n) => n.id === nodeId);
          await this.perform(action, planned, rec);
          if (this.actions.length > max) throw new StopRecord({ kind: "blocked", reason: `more than ${max} actions for one record` });
        }
        const posting = await this.submitAndConfirm(rec);
        this.ctx.emit("POSTED", { posting });
        outcome = { kind: "posted", posting };
      }
    } catch (e) {
      if (e instanceof StopRecord) outcome = e.outcome;
      else outcome = { kind: "failed", reason: e instanceof Error ? e.message : String(e) };
    }
    return { outcome, actions: this.actions, heals: this.heals, dialogsDismissed: this.dialogsDismissed, slowestWaitMs: this.slowestWaitMs };
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
