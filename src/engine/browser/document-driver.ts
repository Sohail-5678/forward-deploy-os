/**
 * PortalDriver over a live DOM Window: the console's same-origin iframe in the
 * browser, or a jsdom window in tests and benchmarks. Values are set with the
 * native value setter and real input/change events, like a person typing.
 */
import type { ChaosType, DistillResult, LedgerEntry } from "../types";
import { PortalError, CHAOS_STORAGE_KEY, LEDGER_STORAGE_KEY, pageFromUrl, type PortalDriver, type PortalPage, type ProbeResult, type WaitCondition } from "./driver";
import { describeElement, distillDocument } from "./dom-distiller";

export interface DocumentDriverOptions {
  kind: "iframe" | "jsdom";
  /** The portal window right now (it changes after navigation). */
  getWindow(): Window;
  /** Load a URL and resolve once the new document has run its scripts. */
  navigate(url: string): Promise<void>;
  /** e.g. "/legacy/omnicorp/" */
  baseUrl: string;
  /** Presentation hook: highlight the element before acting. */
  onFocus?(el: Element, label: string): Promise<void>;
  pollMs?: number;
}

/** Poll with the host's timer: the portal window may be replaced (and its timers dropped) mid-wait. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

export function createDocumentDriver(opts: DocumentDriverOptions): PortalDriver {
  const poll = opts.pollMs ?? 20;
  const win = () => opts.getWindow();
  const doc = () => win().document;

  function one(selector: string): Element {
    let list: NodeListOf<Element>;
    try {
      list = doc().querySelectorAll(selector);
    } catch {
      throw new PortalError(`invalid selector: ${selector}`, "SELECTOR_NOT_FOUND");
    }
    if (list.length === 0) throw new PortalError(`selector not found: ${selector}`, "SELECTOR_NOT_FOUND");
    if (list.length > 1) throw new PortalError(`selector is ambiguous (${list.length} matches): ${selector}`, "AMBIGUOUS_SELECTOR");
    return list[0];
  }

  function assertInteractable(el: Element, selector: string) {
    if ((el as HTMLInputElement).disabled) throw new PortalError(`element is disabled (is a dialog open?): ${selector}`, "UNREACHABLE");
  }

  async function focus(el: Element) {
    if (opts.onFocus) {
      const d = describeElement(el);
      await opts.onFocus(el, d?.label ?? "");
    }
  }

  function check(cond: WaitCondition): boolean {
    const w = win();
    try {
      switch (cond.kind) {
        case "page":
          return pageFromUrl(w.location.href) === cond.page && w.document.readyState === "complete";
        case "text":
          return (w.document.body?.textContent ?? "").includes(cond.text);
        case "selector":
          return !!w.document.querySelector(cond.selector);
        case "idle":
          return w.document.readyState === "complete" || w.document.readyState === "interactive";
      }
    } catch {
      return false;
    }
  }

  const driver: PortalDriver = {
    kind: opts.kind,
    async goto(page: PortalPage) {
      await opts.navigate(opts.baseUrl + page);
    },
    async currentPage() {
      return pageFromUrl(win().location.href);
    },
    async distill(): Promise<DistillResult> {
      return distillDocument(doc(), { page: pageFromUrl(win().location.href) });
    },
    async probe(selector: string): Promise<ProbeResult | null> {
      let list: NodeListOf<Element>;
      try {
        list = doc().querySelectorAll(selector);
      } catch {
        return null;
      }
      if (list.length !== 1) return null;
      const d = describeElement(list[0]);
      return d ? { fingerprint: d.fingerprint, label: d.label, role: d.role } : null;
    },
    async fill(selector: string, value: string) {
      const el = one(selector) as HTMLInputElement;
      assertInteractable(el, selector);
      await focus(el);
      const w = win() as Window & typeof globalThis;
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
      // Let the page's own timers run, as a real event-loop turn would.
      await sleep(0);
    },
    async select(selector: string, value: string) {
      const el = one(selector) as HTMLSelectElement;
      assertInteractable(el, selector);
      await focus(el);
      const w = win() as Window & typeof globalThis;
      const idx = Array.from(el.options).findIndex((o) => o.value === value || o.text.trim() === value);
      if (idx < 0) throw new PortalError(`option "${value}" not found in ${selector}`, "SELECTOR_NOT_FOUND");
      el.selectedIndex = idx;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
      el.dispatchEvent(new w.Event("change", { bubbles: true }));
      await sleep(0);
    },
    async click(selector: string) {
      const el = one(selector) as HTMLElement;
      assertInteractable(el, selector);
      await focus(el);
      el.click();
      await sleep(0);
    },
    async waitFor(cond: WaitCondition | WaitCondition[], timeoutMs = 8000) {
      const conds = Array.isArray(cond) ? cond : [cond];
      const start = Date.now();
      // Poll the live document; resolves as soon as any condition holds.
      for (;;) {
        if (conds.some(check)) return true;
        if (Date.now() - start > timeoutMs) return false;
        await sleep(poll);
      }
    },
    async setChaos(cfg) {
      const w = win();
      try {
        if (cfg && cfg.types.length) w.sessionStorage.setItem(CHAOS_STORAGE_KEY, JSON.stringify(cfg));
        else w.sessionStorage.removeItem(CHAOS_STORAGE_KEY);
        w.sessionStorage.removeItem("omnicorp.v42.interstitial");
      } catch {
        /* storage blocked */
      }
    },
    async portalInfo() {
      const chaos = (win() as unknown as { OmniChaos?: { active: boolean; types: ChaosType[]; applied: Record<string, unknown> } }).OmniChaos;
      return { chaos: chaos && chaos.active ? { types: chaos.types, applied: chaos.applied } : null };
    },
    async readLedger(): Promise<LedgerEntry[]> {
      try {
        const raw = win().localStorage.getItem(LEDGER_STORAGE_KEY);
        return raw ? (JSON.parse(raw) as LedgerEntry[]) : [];
      } catch {
        return [];
      }
    },
  };
  return driver;
}
