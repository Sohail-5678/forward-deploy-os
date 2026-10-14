/**
 * Browser-agent suites (need a DOM): distillation compression and task
 * success, selector healing per chaos type against the recorded CSS-id
 * baseline (wrong-element rate must be 0), and idempotent replays.
 */
import type { SuiteEnv, SuiteResult, PortalHandle } from "../types";
import type { ApprovedRecord, ChaosType, DistillResult, LedgerEntry, SelectorCacheEntry } from "../../types";
import type { PortalPage } from "../../browser/driver";
import { createRng } from "../../seed";
import { now, fixedClock } from "../../clock";
import { percentile, rate, round } from "../stats";
import { planDeterministic, INVOICE_FORM_FIELDS } from "../../browser/planner";
import { bindValue } from "../../browser/binder";
import { confirmedBySelector, fingerprintSimilarity, healAgainst, SelectorCache } from "../../browser/selector-healer";
import { DEFAULT_HEALING } from "../../config";
import { ERP_PURCHASE_ORDERS, SCENARIOS, VENDOR_MASTER, ATTACKER_IBAN } from "../../data/scenarios";
import { idempotencyKey } from "../../etl/idempotency";
import { PortalExecutor } from "../../browser/executor";
import { distillDocument } from "../../browser/dom-distiller";
import { FIXTURE_PAGES } from "../fixtures/pages";
import recordedCache from "../../data/selector-cache.v42.json";

const PAGES: PortalPage[] = ["index.html", "po-search.html", "invoice-entry.html", "confirmation.html"];
const STATIC_CHAOS: ChaosType[] = ["ids", "labels", "reorder", "nesting", "strip-labels"];
export const ALL_CHAOS: ChaosType[] = ["ids", "labels", "reorder", "nesting", "interstitial", "latency", "strip-labels"];

const TRUTH_IDS: Record<string, string> = {
  vendor_id: "vendor_id",
  po_number: "po_number",
  invoice_number: "invoice_number",
  invoice_date: "invoice_date",
  cost_center: "cost_center",
  gross_amount_usd: "gross_amount",
  tax_rate: "tax_rate",
  line_items_count: "line_items",
  payee_iban: "payee_iban",
};

function testRecord(): ApprovedRecord {
  const inv = SCENARIOS[3].csv[0].records[1];
  const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === inv.po_number)!;
  return { recordId: "bench", invoice: inv, idempotencyKey: idempotencyKey(inv), approval: "auto", costCenter: po.cost_center };
}

function truthElement(doc: Document, truth: string): HTMLInputElement | HTMLSelectElement | null {
  for (const el of Array.from(doc.querySelectorAll("input, select"))) {
    const t = (el as unknown as { __omniTruth?: string }).__omniTruth ?? el.id;
    if (t === truth) return el as HTMLInputElement;
  }
  return null;
}

/** Act only on the distilled tree, then check every value landed in the right element. */
async function taskSuccess(h: PortalHandle, snap: DistillResult): Promise<boolean> {
  const rec = testRecord();
  const plan = planDeterministic(snap, INVOICE_FORM_FIELDS, { submit: false });
  if (plan.missing.length) return false;
  for (const a of plan.actions) {
    const node = "nodeId" in a ? snap.nodes.find((n) => n.id === a.nodeId) : undefined;
    if (!node) return false;
    if (a.kind === "click") await h.driver.click(node.selector);
    else if (a.kind === "fill" || a.kind === "select") {
      const v = bindValue(rec, a.valueRef, { label: node.label, placeholder: node.fingerprint.placeholder });
      if (a.kind === "select") await h.driver.select(node.selector, v);
      else await h.driver.fill(node.selector, v);
    }
  }
  const doc = h.document();
  return Object.entries(TRUTH_IDS).every(([field, truth]) => {
    const el = truthElement(doc, truth);
    const expected = bindValue(rec, field as keyof typeof TRUTH_IDS as never);
    return !!el && el.value === expected;
  });
}

export async function distillationSuite(env: SuiteEnv, seeds = 50): Promise<SuiteResult> {
  if (!env.portal) throw new Error("distillation suite needs a portal factory");
  const t0 = now();
  const rng = createRng(env.seed ^ 0xd157);
  const perPage: Record<string, { raw: number[]; distilled: number[]; ratio: number[] }> = {};
  const distillMs: number[] = [];
  let tasks = 0;
  let taskOk = 0;
  const total = seeds * PAGES.length;
  let done = 0;
  for (let s = 0; s < seeds; s++) {
    const r = rng.fork(`seed-${s}`);
    const types = STATIC_CHAOS.filter(() => r.bool(0.5));
    for (const page of PAGES) {
      const h = await env.portal.open({ page, chaos: types.length ? { seed: env.seed + s, types } : undefined, loggedIn: true });
      try {
        const snap = await h.driver.distill();
        distillMs.push(snap.ms);
        const raw = env.countTokens(snap.rawHtml);
        const dis = env.countTokens(snap.text);
        const p = (perPage[page] ??= { raw: [], distilled: [], ratio: [] });
        p.raw.push(raw);
        p.distilled.push(dis);
        p.ratio.push(raw / Math.max(1, dis));
        if (page === "invoice-entry.html") {
          tasks++;
          if (await taskSuccess(h, snap)) taskOk++;
        }
      } finally {
        h.close();
      }
      env.progress?.(++done, total + FIXTURE_PAGES.length);
    }
  }
  const fixtures: Record<string, { title: string; rawTokens: number; distilledTokens: number; ratio: number; nodes: number }> = {};
  for (const f of FIXTURE_PAGES) {
    const doc = await parseFixture(env, f.html());
    if (doc) {
      const snap = distillDocument(doc, { page: f.id });
      const raw = env.countTokens(snap.rawHtml);
      const dis = env.countTokens(snap.text);
      fixtures[f.id] = { title: f.title, rawTokens: raw, distilledTokens: dis, ratio: round(raw / Math.max(1, dis), 1), nodes: snap.nodes.length };
    }
    env.progress?.(++done, total + FIXTURE_PAGES.length);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const pages = Object.fromEntries(
    Object.entries(perPage).map(([k, v]) => [k, { rawTokens: Math.round(mean(v.raw)), distilledTokens: Math.round(mean(v.distilled)), ratio: round(mean(v.ratio), 1), minRatio: round(Math.min(...v.ratio), 1) }]),
  );
  const allRatios = Object.values(perPage).flatMap((v) => v.ratio);
  const inv = perPage["invoice-entry.html"];
  return {
    id: "distillation",
    title: "DOM distillation",
    cases: total + Object.keys(fixtures).length,
    seed: env.seed ^ 0xd157,
    baseline: "raw HTML",
    metrics: {
      tokenizer: "o200k (gpt-tokenizer), used as a proxy",
      portalPages: pages,
      medianRatio: round(percentile(allRatios, 50), 1),
      invoiceFormRatio: inv ? round(mean(inv.ratio), 1) : 0,
      fixtures,
      taskSuccessRate: rate(taskOk, tasks),
      tasks,
    },
    timing: { distillP50Ms: round(percentile(distillMs, 50), 2), distillP95Ms: round(percentile(distillMs, 95), 2) },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}

async function parseFixture(env: SuiteEnv, html: string): Promise<Document | null> {
  const f = env.portal as unknown as { parseHtml?: (html: string) => Document };
  return f.parseHtml ? f.parseHtml(html) : null;
}

export async function selectorSuite(env: SuiteEnv, seeds = 50): Promise<SuiteResult> {
  if (!env.portal) throw new Error("selector suite needs a portal factory");
  const t0 = now();
  const entries = (recordedCache.entries as SelectorCacheEntry[]).filter((e) => e.key.startsWith("invoice-entry.html:") && !e.key.endsWith(":override_code"));
  const perType: Record<string, { total: number; intact: number; healed: number; ask: number; failed: number; wrong: number; baseline: number }> = {};
  const healMs: number[] = [];
  // The 7 single chaos types (spec), plus every static change at once as a harder extra row.
  const COMBINED: ChaosType[] = ["ids", "labels", "reorder", "nesting", "strip-labels"];
  const rows: [string, ChaosType[]][] = [...ALL_CHAOS.map((t) => [t, [t]] as [string, ChaosType[]]), ["combined", COMBINED]];
  const totalRuns = rows.length * seeds;
  let done = 0;
  for (const [type, types] of rows) {
    const st = (perType[type] = { total: 0, intact: 0, healed: 0, ask: 0, failed: 0, wrong: 0, baseline: 0 });
    for (let s = 0; s < seeds; s++) {
      const h = await env.portal.open({ page: "invoice-entry.html", chaos: { seed: env.seed + 1000 + s, types }, loggedIn: true });
      try {
        const snap = await h.driver.distill();
        for (const e of entries) {
          st.total++;
          const sel = e.fingerprint.lastKnownSelector;
          const expected = sel.replace(/^#/, "");
          const probe = await h.driver.probe(sel);
          if (probe && h.truthOf(sel) === expected) st.baseline++;
          const t1 = now();
          if (probe && fingerprintSimilarity(e.fingerprint, probe.fingerprint) >= DEFAULT_HEALING.healThreshold) {
            healMs.push(now() - t1);
            if (h.truthOf(sel) === expected) st.intact++;
            else st.wrong++;
            continue;
          }
          const d = healAgainst(e.fingerprint, snap, DEFAULT_HEALING);
          healMs.push(now() - t1);
          if (d.outcome === "ask-human" && confirmedBySelector(d, sel, !!probe, DEFAULT_HEALING)) {
            if (h.truthOf(sel) === expected) st.healed++;
            else st.wrong++;
          } else if (d.outcome === "healed" && d.node) {
            if (h.truthOf(d.node.selector) === expected) st.healed++;
            else st.wrong++;
          } else if (d.outcome === "ask-human") st.ask++;
          else st.failed++;
        }
      } finally {
        h.close();
      }
      env.progress?.(++done, totalRuns);
    }
  }
  // Headline metrics cover the 7 single chaos types; "combined" is reported on its own.
  const singles = Object.entries(perType).filter(([k]) => k !== "combined").map(([, v]) => v);
  const sum = (k: keyof (typeof perType)[string]) => singles.reduce((a, v) => a + v[k], 0);
  const total = sum("total");
  const comb = perType["combined"];
  return {
    id: "selectors",
    title: "Selector healing",
    cases: ALL_CHAOS.length * seeds,
    seed: env.seed + 1000,
    baseline: "recorded CSS-id selectors",
    metrics: {
      chaosTypes: ALL_CHAOS.length,
      targetsPerPage: entries.length,
      healRate: rate(sum("intact") + sum("healed"), total),
      wrongElementRate: rate(sum("wrong"), total),
      wrongElements: sum("wrong"),
      humanEscalationRate: rate(sum("ask"), total),
      failRate: rate(sum("failed"), total),
      baselineSuccessRate: rate(sum("baseline"), total),
      perType: Object.fromEntries(
        Object.entries(perType).map(([k, v]) => [
          k,
          { healRate: rate(v.intact + v.healed, v.total), healedFromFingerprint: rate(v.healed, v.total), humanEscalationRate: rate(v.ask, v.total), failRate: rate(v.failed, v.total), wrongElementRate: rate(v.wrong, v.total), baselineSuccessRate: rate(v.baseline, v.total) },
        ]),
      ),
      combined: comb ? { types: COMBINED, healRate: rate(comb.intact + comb.healed, comb.total), humanEscalationRate: rate(comb.ask, comb.total), failRate: rate(comb.failed, comb.total), wrongElementRate: rate(comb.wrong, comb.total), baselineSuccessRate: rate(comb.baseline, comb.total) } : null,
      thresholds: { heal: DEFAULT_HEALING.healThreshold, ask: DEFAULT_HEALING.askThreshold, minMargin: DEFAULT_HEALING.minMargin },
    },
    timing: { healP50Ms: round(percentile(healMs, 50), 3), healP95Ms: round(percentile(healMs, 95), 3) },
    ms: round(now() - t0, 1),
    environment: "node",
  };
}

export async function idempotencySuite(env: SuiteEnv, batches = 50): Promise<SuiteResult> {
  if (!env.portal?.session) throw new Error("idempotency suite needs a portal session");
  const t0 = now();
  const rng = createRng(env.seed ^ 0x1de);
  const open = ERP_PURCHASE_ORDERS.filter((p) => p.status === "OPEN");
  const session = await env.portal.session({ ledger: [] });
  const cache = new SelectorCache();
  let records = 0;
  let posted = 0;
  let prevented = 0;
  let failed = 0;
  try {
    for (let b = 0; b < batches; b++) {
      const r = rng.fork(`batch-${b}`);
      const n = r.int(1, 3);
      const pos = r.shuffle(open).slice(0, n);
      const batch: ApprovedRecord[] = pos.map((po, k) => {
        const vendor = VENDOR_MASTER.find((v) => v.vendor_id === po.vendor_id)!;
        const inv = {
          vendor_id: po.vendor_id,
          customer_id: po.customer_id,
          po_number: po.po_number,
          invoice_number: `INV-IDEM-${b}-${k}`,
          invoice_date: `2026-10-${String(r.int(1, 14)).padStart(2, "0")}`,
          gross_amount_cents: Math.max(100, po.authorized_cents - r.int(0, 50000)),
          tax_rate: 0.0825,
          line_items_count: r.int(1, 9),
          payee_iban: vendor.iban,
        };
        return { recordId: `idem-${b}-${k}`, invoice: inv, idempotencyKey: idempotencyKey(inv), approval: "auto", costCenter: po.cost_center };
      });
      for (let pass = 0; pass < 2; pass++) {
        const exec = new PortalExecutor({
          driver: session.driver,
          cache,
          healing: DEFAULT_HEALING,
          vendorMaster: VENDOR_MASTER,
          clock: fixedClock(),
          emit: () => undefined,
          planner: "deterministic",
          useCache: true,
          attackerIban: ATTACKER_IBAN,
          selectorPicks: {},
        });
        for (const rec of batch) {
          if (pass === 0) records++;
          const res = await exec.processRecord(rec);
          if (res.outcome.kind === "posted") posted++;
          else if (res.outcome.kind === "duplicate") prevented++;
          else failed++;
        }
      }
      env.progress?.(b + 1, batches);
    }
    const ledger: LedgerEntry[] = await session.driver.readLedger();
    const counts = new Map<string, number>();
    for (const e of ledger) counts.set(`${e.vendor_id}|${e.invoice_number}`, (counts.get(`${e.vendor_id}|${e.invoice_number}`) ?? 0) + 1);
    const duplicates = [...counts.values()].reduce((s, c) => s + Math.max(0, c - 1), 0);
    return {
      id: "idempotency",
      title: "Idempotent replays",
      cases: batches,
      seed: env.seed ^ 0x1de,
      metrics: { batches, records, postedFirstPass: posted, duplicatesPrevented: prevented, duplicatePostings: duplicates, failures: failed },
      ms: round(now() - t0, 1),
      environment: "node",
    };
  } finally {
    session.close();
  }
}
