/**
 * Records the selector cache on the clean portal ("before the weekend
 * release"). Scenarios 3 and 5 start from this cache, so their broken
 * selectors have to be healed. Output: src/engine/data/selector-cache.v42.json
 */
import type { SelectorCacheEntry } from "../../src/engine/types";
import { createJsdomPortal } from "./jsdom-portal";
import { SelectorCache } from "../../src/engine/browser/selector-healer";
import { planDeterministic, INVOICE_FORM_FIELDS, findSubmit } from "../../src/engine/browser/planner";
import { labelFits } from "../../src/engine/security/tool-boundary-guard";

const RECORDED_AT = "2026-10-09T17:00:00.000Z";

/** Distilled snapshot of the clean invoice form (override row revealed), used by the guard suite. */
export async function recordInvoiceSnapshot() {
  const portal = await createJsdomPortal({ loggedIn: true });
  try {
    await portal.load("invoice-entry.html");
    portal.window().document.getElementById("row_override")?.removeAttribute("hidden");
    const snap = await portal.driver.distill();
    return { ...snap, rawHtml: "", ms: 0 };
  } finally {
    portal.close();
  }
}

export async function recordSelectorCache(): Promise<SelectorCacheEntry[]> {
  // Logged in, so later pages open directly; the log-on page still renders without a redirect.
  const portal = await createJsdomPortal({ loggedIn: true });
  const cache = new SelectorCache();
  try {
    let snap = await portal.driver.distill();
    const pick = (pred: (n: (typeof snap.nodes)[number]) => boolean) => snap.nodes.find(pred);
    const user = pick((n) => n.role === "textbox" && labelFits(n.label, [["user"]]));
    const pass = pick((n) => n.role === "textbox" && labelFits(n.label, [["password"]]));
    const logon = pick((n) => n.role === "button" && /log\s*on/i.test(n.label));
    if (!user || !pass || !logon) throw new Error("login page did not distill as expected");
    cache.set("index.html:username", user.fingerprint, RECORDED_AT);
    cache.set("index.html:password", pass.fingerprint, RECORDED_AT);
    cache.set("index.html:logon", logon.fingerprint, RECORDED_AT);

    await portal.load("po-search.html");
    snap = await portal.driver.distill();
    const box = pick((n) => n.role === "textbox" && labelFits(n.label, [["purchase_order"]]));
    const search = pick((n) => n.role === "button" && labelFits(n.label, [["search"]]));
    if (!box || !search) throw new Error("PO search page did not distill as expected");
    cache.set("po-search.html:po_number", box.fingerprint, RECORDED_AT);
    cache.set("po-search.html:search", search.fingerprint, RECORDED_AT);

    await portal.load("invoice-entry.html");
    // Reveal the override row so its field is recorded too (as after an over-PO error).
    const w = portal.window();
    w.document.getElementById("row_override")?.removeAttribute("hidden");
    snap = await portal.driver.distill();
    const plan = planDeterministic(snap, [...INVOICE_FORM_FIELDS, "override_code"], { submit: false });
    if (plan.missing.length) throw new Error(`invoice form fields missing: ${plan.missing.join(", ")}`);
    for (const [field, id] of Object.entries(plan.nodeFor)) {
      const node = snap.nodes.find((n) => n.id === id)!;
      cache.set(`invoice-entry.html:${field}`, node.fingerprint, RECORDED_AT);
    }
    const submit = findSubmit(snap);
    if (!submit) throw new Error("submit button not found");
    cache.set("invoice-entry.html:submit", submit.fingerprint, RECORDED_AT);
    return cache.entries();
  } finally {
    portal.close();
  }
}
