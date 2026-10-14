/**
 * DOM distiller (spec 8.5). Works on any Document: the console's iframe, jsdom
 * in tests, and `page.evaluate` in Playwright (bundled as an IIFE by
 * scripts/build-distiller.ts). Keeps only interactive or labeling elements,
 * computes accessible names, drops styles, scripts and layout wrappers, and
 * prints one numbered line per node:
 *   [12] textbox "Vendor ID" value="" required
 */
import type { DistilledNode, DistilledRole, DistillResult, Fingerprint } from "../types";
import { conceptTokens } from "../etl/tokens";

export interface DistillOptions {
  page?: string;
  maxNodes?: number;
  /** Include rows of data tables (read-before-write needs them). */
  includeRows?: boolean;
}

const INTERACTIVE = "input, select, textarea, button, a[href], [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=textbox], [role=combobox], [role=dialog], [role=alertdialog], [role=alert], [role=status], dialog[open]";

export function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch.codePointAt(0)!.toString(16)} `).replace(/^(\d)/, "\\3$1 ");
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function cleanLabel(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[*:]+\s*$/, "").trim().slice(0, 120);
}

/** Per-distillation memo: computed styles are expensive (especially in jsdom). */
let styleMemo: WeakMap<Element, boolean> | null = null;

function styleHidden(el: Element): boolean {
  const memo = styleMemo?.get(el);
  if (memo !== undefined) return memo;
  const r = computeStyleHidden(el);
  styleMemo?.set(el, r);
  return r;
}

function computeStyleHidden(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  const inline = (el as HTMLElement).style;
  if (inline && (inline.display === "none" || inline.visibility === "hidden")) return true;
  if (view && typeof view.getComputedStyle === "function") {
    try {
      const cs = view.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Returns "visible", "hidden", or the tab label if hidden only by an inactive tab panel. */
function visibility(el: Element): { state: "visible" } | { state: "hidden" } | { state: "tab"; tab: string } {
  let cur: Element | null = el;
  let inTab: string | undefined;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    const hiddenAttr = cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true";
    const isPanel = cur.getAttribute("role") === "tabpanel";
    if (isPanel && (hiddenAttr || styleHidden(cur))) {
      const tab = tabForPanel(cur);
      if (!tab) return { state: "hidden" };
      inTab = cleanLabel(text(tab));
    } else if (hiddenAttr || styleHidden(cur)) {
      return { state: "hidden" };
    }
    if (cur.tagName === "INPUT" && (cur as HTMLInputElement).type === "hidden") return { state: "hidden" };
    cur = cur.parentElement;
  }
  return inTab ? { state: "tab", tab: inTab } : { state: "visible" };
}

function tabForPanel(panel: Element): Element | null {
  const doc = panel.ownerDocument;
  const labelledBy = panel.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = doc.getElementById(labelledBy);
    if (t) return t;
  }
  if (panel.id) {
    const t = doc.querySelector(`[role=tab][aria-controls="${panel.id.replace(/"/g, '\\"')}"]`);
    if (t) return t;
  }
  return null;
}

export function roleOf(el: Element): DistilledRole | null {
  const explicit = el.getAttribute("role");
  if (explicit) {
    if (explicit === "alertdialog") return "dialog";
    if (["button", "link", "tab", "checkbox", "radio", "textbox", "combobox", "dialog", "alert", "status"].includes(explicit)) return explicit as DistilledRole;
    return null;
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "dialog") return "dialog";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "submit" || t === "button" || t === "reset" || t === "image") return "button";
    if (t === "hidden") return null;
    return "textbox";
  }
  return null;
}

/** Simplified accessible-name computation. */
export function accessibleName(el: Element): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const name = labelledBy
      .split(/\s+/)
      .map((id) => text(doc.getElementById(id)))
      .filter(Boolean)
      .join(" ");
    if (name) return cleanLabel(name);
  }
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return cleanLabel(aria);
  const tag = el.tagName.toLowerCase();
  const role = roleOf(el);
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const input = el as HTMLInputElement;
    const t = (input.type || "").toLowerCase();
    if (t === "submit" || t === "button" || t === "reset") return cleanLabel(input.value || t);
    if (el.id) {
      const lab = doc.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`);
      if (lab && text(lab)) return cleanLabel(text(lab));
    }
    const wrap = el.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true) as Element;
      clone.querySelectorAll("input, select, textarea").forEach((c) => c.remove());
      if (text(clone)) return cleanLabel(text(clone));
    }
    const ph = el.getAttribute("placeholder");
    // A placeholder that is only a format hint (MM/DD/YYYY) is not a name.
    const cell = el.closest("td, th");
    if (cell) {
      let prev = cell.previousElementSibling;
      while (prev && !text(prev)) prev = prev.previousElementSibling;
      if (prev && text(prev)) return cleanLabel(text(prev));
    }
    if (ph && /[a-z]{3,}/i.test(ph)) return cleanLabel(ph);
    const title = el.getAttribute("title");
    if (title) return cleanLabel(title);
    return "";
  }
  if (role === "dialog") {
    const h = el.querySelector("h1, h2, h3, h4, strong, .title");
    return cleanLabel(text(h) || text(el).slice(0, 60));
  }
  if (role === "alert" || role === "status") return text(el).slice(0, 200);
  const own = text(el) || (el as HTMLInputElement).value || el.getAttribute("title") || "";
  return cleanLabel(own);
}

function neighborText(el: Element, label: string): string {
  const parts: string[] = [];
  const row = el.closest("tr");
  if (row) parts.push(text(row));
  const fs = el.closest("fieldset");
  const legend = fs?.querySelector("legend");
  if (legend) parts.push(text(legend));
  const panel = el.closest("[role=tabpanel]");
  if (panel) {
    const tab = tabForPanel(panel);
    if (tab) parts.push(text(tab));
  }
  const joined = parts.join(" ");
  return label ? joined.replace(label, " ") : joined;
}

function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const sel = `#${cssEscape(el.id)}`;
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* fall through */
    }
  }
  const name = el.getAttribute("name");
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
    if (doc.querySelectorAll(sel).length === 1) return sel;
  }
  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.tagName !== "HTML") {
    if (cur.id && cur !== el) {
      const sel = `#${cssEscape(cur.id)}`;
      if (doc.querySelectorAll(sel).length === 1) {
        path.unshift(sel);
        return path.join(" > ");
      }
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) break;
    const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
    const idx = same.indexOf(cur) + 1;
    path.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
    cur = parent;
  }
  return path.join(" > ");
}

let interactiveMemo: Map<Element | Document, Element[]> | null = null;

function interactiveIn(scope: Element | Document): Element[] {
  const hit = interactiveMemo?.get(scope);
  if (hit) return hit;
  const list = Array.from(scope.querySelectorAll("input:not([type=hidden]), select, textarea, button, a[href], [role=tab], [role=button]"));
  interactiveMemo?.set(scope, list);
  return list;
}

export function fingerprintOf(el: Element, label: string, role: string, selector: string): Fingerprint {
  const form = el.closest("form") ?? el.ownerDocument.body;
  const ordinal = interactiveIn(form).indexOf(el);
  const input = el as HTMLInputElement;
  const fp: Fingerprint = {
    role,
    tag: el.tagName.toLowerCase(),
    labelTokens: conceptTokens(label),
    nameTokens: conceptTokens(`${el.getAttribute("name") ?? ""} ${el.id ?? ""}`),
    neighborTokens: conceptTokens(neighborText(el, label)).slice(0, 24),
    formOrdinal: ordinal,
    lastKnownSelector: selector,
  };
  if (el.tagName === "INPUT") fp.inputType = (input.type || "text").toLowerCase();
  const aria = el.getAttribute("aria-label");
  if (aria) fp.ariaLabel = aria;
  const ph = el.getAttribute("placeholder");
  if (ph) fp.placeholder = ph;
  return fp;
}

export interface DescribedElement {
  role: DistilledRole;
  label: string;
  selector: string;
  fingerprint: Fingerprint;
}

/** Describe one element the way the distiller would (used by selector probes). */
export function describeElement(el: Element): DescribedElement | null {
  const role = roleOf(el);
  if (!role) return null;
  const label = accessibleName(el);
  const selector = uniqueSelector(el);
  return { role, label, selector, fingerprint: fingerprintOf(el, label, role, selector) };
}

function isDataRow(tr: Element): boolean {
  const cells = tr.querySelectorAll(":scope > td, :scope > th");
  if (cells.length < 2) return false;
  if (tr.querySelector("input, select, textarea, button, a[href], table")) return false;
  const t = text(tr);
  return t.length > 0 && t.length <= 300 && !!tr.closest("table") && tr.querySelectorAll(":scope > td").length >= 2;
}

function quote(s: string): string {
  return JSON.stringify(s);
}

export function formatLine(n: DistilledNode): string {
  const bits = [`[${n.id}] ${n.role} ${quote(n.label)}`];
  if (n.role === "textbox") bits.push(`value=${quote(n.value ?? "")}`);
  if (n.role === "combobox") {
    if (n.options) bits.push(`options=[${n.options.map(quote).join(",")}]`);
    if (n.value) bits.push(`value=${quote(n.value)}`);
  }
  if (n.role === "checkbox" || n.role === "radio") bits.push(n.selected ? "checked" : "unchecked");
  if (n.role === "tab") bits.push(n.selected ? "selected" : "");
  if (n.required) bits.push("required");
  if (n.disabled) bits.push("disabled");
  if (n.inTab) bits.push(`(tab ${quote(n.inTab)})`);
  if (n.inDialog && n.role !== "dialog") bits.push("(in dialog)");
  return bits.filter(Boolean).join(" ");
}

export function distillDocument(doc: Document, opts: DistillOptions = {}): DistillResult {
  styleMemo = new WeakMap();
  interactiveMemo = new Map();
  try {
    return distillInner(doc, opts);
  } finally {
    styleMemo = null;
    interactiveMemo = null;
  }
}

function distillInner(doc: Document, opts: DistillOptions): DistillResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const maxNodes = opts.maxNodes ?? 400;
  const nodes: DistilledNode[] = [];
  const seen = new Set<Element>();
  const candidates: Element[] = [];
  for (const el of Array.from(doc.querySelectorAll(INTERACTIVE))) candidates.push(el);
  if (opts.includeRows !== false) for (const tr of Array.from(doc.querySelectorAll("tr"))) if (isDataRow(tr)) candidates.push(tr);
  // Document order.
  candidates.sort((a, b) => (a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1));

  for (const el of candidates) {
    if (seen.has(el) || nodes.length >= maxNodes) continue;
    seen.add(el);
    const isRow = el.tagName === "TR";
    const role: DistilledRole | null = isRow ? "row" : roleOf(el);
    if (!role) continue;
    const vis = visibility(el);
    if (vis.state === "hidden") continue;
    if ((role === "alert" || role === "status") && !text(el)) continue;
    const label = isRow
      ? Array.from(el.querySelectorAll(":scope > td, :scope > th"))
          .map((c) => text(c))
          .join(" | ")
          .slice(0, 240)
      : accessibleName(el);
    const selector = uniqueSelector(el);
    const dialog = el.closest("[role=dialog], [role=alertdialog], dialog");
    const node: DistilledNode = {
      id: nodes.length + 1,
      role,
      label,
      inForm: !!el.closest("form"),
      inDialog: !!dialog,
      selector,
      fingerprint: fingerprintOf(el, label, role, selector),
    };
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const input = el as HTMLInputElement;
      if (role === "checkbox" || role === "radio") node.selected = input.checked;
      else node.value = input.value ?? "";
      if (input.required || el.getAttribute("aria-required") === "true") node.required = true;
      if (input.disabled) node.disabled = true;
    } else if (el.tagName === "SELECT") {
      const sel = el as HTMLSelectElement;
      node.options = Array.from(sel.options)
        .map((o) => o.text.trim())
        .filter((o) => o && !/^-+\s*select\s*-+$/i.test(o))
        .slice(0, 30);
      const chosen = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex]?.text.trim() : "";
      if (chosen && !/^-+\s*select\s*-+$/i.test(chosen)) node.value = chosen;
      if (sel.required) node.required = true;
      if (sel.disabled) node.disabled = true;
    } else if (role === "tab") {
      node.selected = el.getAttribute("aria-selected") === "true";
    } else if (el.tagName === "BUTTON" && (el as HTMLButtonElement).disabled) {
      node.disabled = true;
    }
    if (vis.state === "tab") node.inTab = vis.tab;
    nodes.push(node);
  }
  const lines = nodes.map(formatLine);
  const rawHtml = doc.documentElement ? doc.documentElement.outerHTML : "";
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    page: opts.page ?? "unknown",
    title: doc.title,
    nodes,
    lines,
    text: lines.join("\n"),
    rawHtml,
    ms: Math.round((t1 - t0) * 1000) / 1000,
  };
}
