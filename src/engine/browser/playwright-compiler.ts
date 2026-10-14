/**
 * Exports the current run as standalone Playwright scripts (TypeScript and
 * Python). Locators: role and label first, then fingerprint scoring in the
 * page (same synonym table as the engine). Each record gets read-before-write
 * on the PO search page, retries with backoff, and session-dialog handling.
 * Values are the approved, bound values from this run; no model output.
 */
import type { ApprovedRecord, BindableField, SelectorCacheEntry } from "../types";
import { bindValue } from "./binder";
import { SYNONYMS } from "../etl/tokens";
import { PORTAL_DEMO_LOGIN } from "../config";

export interface CompileInput {
  records: ApprovedRecord[];
  cache: SelectorCacheEntry[];
  runId: string;
  generatedAt: string;
}

const FIELD_ORDER: { field: BindableField; tab: "Header" | "Amounts" | "Payment"; label: string }[] = [
  { field: "vendor_id", tab: "Header", label: "vendor\\s*(id|no\\.?)|supplier\\s*id" },
  { field: "po_number", tab: "Header", label: "^(po\\s*(number|no\\.?)|purchase\\s*order)" },
  { field: "invoice_number", tab: "Header", label: "invoice\\s*(number|no\\.?)|inv\\.?\\s*reference" },
  { field: "invoice_date", tab: "Header", label: "invoice\\s*date|date\\s*of\\s*invoice|inv\\.?\\s*date" },
  { field: "cost_center", tab: "Header", label: "cost\\s*(center|centre|ctr)" },
  { field: "gross_amount_usd", tab: "Amounts", label: "invoice\\s*(total|amount)|total\\s*amt" },
  { field: "tax_rate", tab: "Amounts", label: "tax\\s*(rate|pct)|vat" },
  { field: "line_items_count", tab: "Amounts", label: "line\\s*items?|no\\.?\\s*of\\s*lines|item\\s*count" },
  { field: "payee_iban", tab: "Payment", label: "payee\\s*iban|beneficiary\\s*account|remit-?to\\s*iban" },
];

function recordsPayload(records: ApprovedRecord[]) {
  return records.map((r) => ({
    recordId: r.recordId,
    invoice: r.invoice.invoice_number,
    vendor: r.invoice.vendor_id,
    po: r.invoice.po_number,
    amountCents: r.invoice.gross_amount_cents,
    overrideCode: r.overrideCode ?? null,
    values: Object.fromEntries(FIELD_ORDER.map((f) => [f.field, bindValue(r, f.field, { placeholder: "MM/DD/YYYY" })])),
  }));
}

function fingerprints(cache: SelectorCacheEntry[]) {
  return Object.fromEntries(
    cache.map((e) => [e.key, { role: e.fingerprint.role, inputType: e.fingerprint.inputType ?? null, labelTokens: e.fingerprint.labelTokens, neighborTokens: e.fingerprint.neighborTokens, formOrdinal: e.fingerprint.formOrdinal, lastKnownSelector: e.fingerprint.lastKnownSelector }]),
  );
}

/** In-page scorer shared by both scripts (plain JS evaluated in the browser). */
const IN_PAGE_HEALER = `(args) => {
  const { fp, synonyms } = args;
  const split = (s) => s.normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9#%]+/).filter(Boolean);
  const stop = new Set(["the","of","for","to","in","on","at","a","an","and","or","field","fld","col","column","enter","please","your","s","btn"]);
  const concept = (s) => { const t = split(s); const out = []; for (let i = 0; i < t.length; i++) { const j = t[i] + (t[i+1] || ""); if (t[i+1] && synonyms[j]) { out.push(synonyms[j]); i++; continue; } if (stop.has(t[i]) || /^\\d+$/.test(t[i]) || t[i].length === 1) continue; out.push(synonyms[t[i]] || t[i]); } return [...new Set(out)]; };
  const jac = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size && !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };
  const cont = (a, b) => { if (!a.length || !b.length) return 0; const B = new Set(b); const n = new Set(a.filter((x) => B.has(x))).size; return n / Math.min(new Set(a).size, B.size); };
  const nameOf = (el) => { if (el.id) { const l = document.querySelector('label[for="' + el.id + '"]'); if (l) return l.textContent; } const td = el.closest("td"); if (td) { let p = td.previousElementSibling; while (p && !p.textContent.trim()) p = p.previousElementSibling; if (p) return p.textContent; } return el.getAttribute("aria-label") || el.textContent || el.value || ""; };
  const roleOf = (el) => el.tagName === "SELECT" ? "combobox" : el.tagName === "BUTTON" || (el.tagName === "INPUT" && /submit|button/.test(el.type)) ? "button" : "textbox";
  const cands = [...document.querySelectorAll("input:not([type=hidden]), select, textarea, button")];
  const form = cands.filter((el) => el.closest("form"));
  let best = null, second = 0;
  for (const el of cands) {
    const label = concept(nameOf(el));
    const row = el.closest("tr");
    const neighbor = row ? concept(row.textContent.replace(nameOf(el), " ")) : [];
    const comps = [[0.35, 0.5 * jac(fp.labelTokens, label) + 0.5 * cont(fp.labelTokens, label)]];
    if (fp.neighborTokens.length && neighbor.length) comps.push([0.2, jac(fp.neighborTokens, neighbor)]);
    comps.push([0.15, roleOf(el) === fp.role ? 1 : 0]);
    comps.push([0.1, (el.tagName === "INPUT" ? el.type : el.tagName.toLowerCase()) === (fp.inputType || (fp.role === "combobox" ? "select" : fp.role === "button" ? "button" : "text")) ? 1 : 0]);
    comps.push([0.1, Math.max(0, 1 - Math.abs(form.indexOf(el) - fp.formOrdinal) / 5)]);
    const w = comps.reduce((s, c) => s + c[0], 0);
    let score = comps.reduce((s, c) => s + c[0] * c[1], 0) / w;
    if (roleOf(el) !== fp.role) score *= 0.3;
    if (!best || score > best.score) { second = best ? best.score : second; best = { el, score }; } else if (score > second) second = score;
  }
  if (!best || best.score < 0.8 || best.score - second < 0.05) return null;
  const path = []; let cur = best.el;
  while (cur && cur.tagName !== "HTML") { const p = cur.parentElement; if (!p) break; const same = [...p.children].filter((c) => c.tagName === cur.tagName); path.unshift(cur.tagName.toLowerCase() + ":nth-of-type(" + (same.indexOf(cur) + 1) + ")"); cur = p; }
  return { selector: path.join(" > "), score: Math.round(best.score * 1000) / 1000 };
}`;

export function compileTypeScript(input: CompileInput): string {
  return `/**
 * Generated by ForwardDeploy OS for run ${input.runId} on ${input.generatedAt}.
 * Posts ${input.records.length} approved record(s) into the OmniCorp portal.
 *   npm i -D playwright && npx playwright install chromium
 *   BASE_URL=http://localhost:3000 npx tsx forwarddeploy-run.ts
 * Optional: CHAOS_SEED=20261014 CHAOS_TYPES=ids,labels,nesting,interstitial
 * Values below are the approved, bound values from the run (no model output).
 */
import { chromium, type Page, type Locator } from "playwright";
import { createHash } from "node:crypto";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\\/$/, "") + "/legacy/omnicorp/";
const LOGIN = { username: ${JSON.stringify(PORTAL_DEMO_LOGIN.username)}, password: ${JSON.stringify(PORTAL_DEMO_LOGIN.password)} };
const RECORDS = ${JSON.stringify(recordsPayload(input.records), null, 2)};
const FIELDS = ${JSON.stringify(FIELD_ORDER.map((f) => ({ ...f })), null, 2)};
const FINGERPRINTS: Record<string, unknown> = ${JSON.stringify(fingerprints(input.cache), null, 2)};
const SYNONYMS = ${JSON.stringify(SYNONYMS)};
// Kept as source text: a transpiler (tsx, esbuild) must not rewrite code that runs inside the page.
const HEAL_SOURCE = ${JSON.stringify(IN_PAGE_HEALER)};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (r: (typeof RECORDS)[number]) => createHash("sha256").update(\`\${r.vendor}|\${r.po}|\${r.invoice}|\${r.amountCents}\`).digest("hex");

async function dismissDialog(page: Page) {
  const dlg = page.getByRole("dialog");
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.getByRole("button", { name: /continue|stay signed/i }).click();
    console.log("  session dialog dismissed");
  }
}

/** Role/label locator first; fingerprint scoring in the page as the healing fallback. */
async function locate(page: Page, labelRe: RegExp, fpKey: string): Promise<Locator> {
  const byLabel = page.getByLabel(labelRe);
  if ((await byLabel.count()) === 1) return byLabel;
  const fp = FINGERPRINTS[fpKey];
  if (!fp) throw new Error(\`no locator and no fingerprint for \${fpKey}\`);
  const healed = (await page.evaluate(\`(\${HEAL_SOURCE})(\${JSON.stringify({ fp, synonyms: SYNONYMS })})\`)) as { selector: string; score: number } | null;
  if (!healed) throw new Error(\`could not heal \${fpKey} with enough confidence; a human must check the page\`);
  console.log(\`  healed \${fpKey} (\${healed.score})\`);
  return page.locator(healed.selector);
}

async function ensureLoggedIn(page: Page) {
  if (!page.url().includes("index.html")) return;
  await (await locate(page, /user\\s*(name|id)|username/i, "index.html:username")).fill(LOGIN.username);
  await (await locate(page, /password/i, "index.html:password")).fill(LOGIN.password);
  await page.getByRole("button", { name: /log\\s*on|sign\\s*in|login/i }).click();
  await page.waitForURL(/po-search|invoice-entry/);
}

async function open(page: Page, file: string) {
  await page.goto(BASE + file);
  await ensureLoggedIn(page);
  if (!page.url().includes(file)) await page.goto(BASE + file);
  await dismissDialog(page);
}

async function alreadyPosted(page: Page, r: (typeof RECORDS)[number]): Promise<string | null> {
  await open(page, "po-search.html");
  await (await locate(page, /po\\s*(number|no\\.?)|purchase\\s*order/i, "po-search.html:po_number")).fill(r.po);
  await dismissDialog(page);
  await page.getByRole("button", { name: /search|find|lookup/i }).click();
  await page.getByText(/purchase order found/i).waitFor();
  await dismissDialog(page);
  const row = page.getByRole("row").filter({ hasText: r.invoice });
  if ((await row.count()) === 0) return null;
  const cells = await row.first().locator("td").allTextContents();
  const cents = Math.round(Number(cells[1].replace(/,/g, "")) * 100);
  const theirs = createHash("sha256").update(\`\${r.vendor}|\${r.po}|\${cells[0]}|\${cents}\`).digest("hex");
  if (theirs === key(r)) return cells[2];
  throw new Error(\`\${r.invoice} is already posted as \${cells[2]} with a different amount\`);
}

async function postRecord(page: Page, r: (typeof RECORDS)[number]) {
  const dup = await alreadyPosted(page, r);
  if (dup) return \`DUPLICATE_PREVENTED \${r.invoice} (already \${dup})\`;
  await open(page, "invoice-entry.html");
  let tab = "Header";
  for (const f of FIELDS) {
    await dismissDialog(page);
    if (f.tab !== tab) {
      await page.getByRole("tab", { name: f.tab }).click();
      tab = f.tab;
    }
    const el = await locate(page, new RegExp(f.label, "i"), \`invoice-entry.html:\${f.field}\`);
    const value = (r.values as Record<string, string>)[f.field];
    if (f.field === "cost_center") await el.selectOption(value);
    else await el.fill(value);
  }
  await dismissDialog(page);
  await page.getByRole("button", { name: /post to general ledger|submit to gl|post invoice/i }).click();
  const outcome = await Promise.race([
    page.waitForURL(/confirmation\\.html/).then(() => "posted"),
    page.getByRole("alert").filter({ hasText: /ERR-/ }).waitFor().then(() => "error"),
  ]);
  if (outcome === "error") {
    const text = (await page.getByRole("alert").textContent()) ?? "";
    if (/ERR-4471/.test(text) && r.overrideCode) {
      await (await locate(page, /override/i, "invoice-entry.html:override_code")).fill(r.overrideCode);
      await page.getByRole("button", { name: /post to general ledger|submit to gl|post invoice/i }).click();
      await page.waitForURL(/confirmation\\.html/);
    } else throw new Error(text.trim());
  }
  const status = (await page.getByRole("status").first().textContent()) ?? "";
  return \`POSTED \${r.invoice} as \${/GL-\\d{4}-\\d{6}/.exec(status)?.[0] ?? "?"} (key \${key(r).slice(0, 12)})\`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const chaos = process.env.CHAOS_SEED ? \`?chaos=\${process.env.CHAOS_SEED}&types=\${process.env.CHAOS_TYPES ?? "ids,labels"}\` : "?chaos=off";
  await page.goto(BASE + "index.html" + chaos);
  let failures = 0;
  for (const r of RECORDS) {
    for (let attempt = 0; ; attempt++) {
      try {
        console.log(await postRecord(page, r));
        break;
      } catch (e) {
        if (attempt >= 2) {
          failures++;
          console.log(\`FAILED \${r.invoice}: \${e instanceof Error ? e.message : e}\`);
          break;
        }
        await sleep(500 * 2 ** attempt);
      }
    }
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
}

main();
`;
}

export function compilePython(input: CompileInput): string {
  const pyJson = (v: unknown) => JSON.stringify(v, null, 2).replace(/\bnull\b/g, "None").replace(/\btrue\b/g, "True").replace(/\bfalse\b/g, "False");
  return `"""
Generated by ForwardDeploy OS for run ${input.runId} on ${input.generatedAt}.
Posts ${input.records.length} approved record(s) into the OmniCorp portal.
  pip install playwright && playwright install chromium
  BASE_URL=http://localhost:3000 python forwarddeploy_run.py
Optional: CHAOS_SEED=20261014 CHAOS_TYPES=ids,labels,nesting,interstitial
Values below are the approved, bound values from the run (no model output).
"""
import hashlib
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000").rstrip("/") + "/legacy/omnicorp/"
LOGIN = {"username": ${JSON.stringify(PORTAL_DEMO_LOGIN.username)}, "password": ${JSON.stringify(PORTAL_DEMO_LOGIN.password)}}
RECORDS = ${pyJson(recordsPayload(input.records))}
FIELDS = ${pyJson(FIELD_ORDER)}
FINGERPRINTS = json.loads(${JSON.stringify(JSON.stringify(fingerprints(input.cache)))})
SYNONYMS = json.loads(${JSON.stringify(JSON.stringify(SYNONYMS))})
HEAL = ${JSON.stringify(IN_PAGE_HEALER)}


def key(r):
    return hashlib.sha256(f"{r['vendor']}|{r['po']}|{r['invoice']}|{r['amountCents']}".encode()).hexdigest()


def dismiss_dialog(page):
    dlg = page.get_by_role("dialog")
    if dlg.count() and dlg.is_visible():
        dlg.get_by_role("button", name=re.compile(r"continue|stay signed", re.I)).click()
        print("  session dialog dismissed")


def locate(page, label_re, fp_key):
    by_label = page.get_by_label(re.compile(label_re, re.I))
    if by_label.count() == 1:
        return by_label
    fp = FINGERPRINTS.get(fp_key)
    if not fp:
        raise RuntimeError(f"no locator and no fingerprint for {fp_key}")
    healed = page.evaluate(HEAL, {"fp": fp, "synonyms": SYNONYMS})
    if not healed:
        raise RuntimeError(f"could not heal {fp_key} with enough confidence; a human must check the page")
    print(f"  healed {fp_key} ({healed['score']})")
    return page.locator(healed["selector"])


def ensure_logged_in(page):
    if "index.html" not in page.url:
        return
    locate(page, r"user\\s*(name|id)|username", "index.html:username").fill(LOGIN["username"])
    locate(page, r"password", "index.html:password").fill(LOGIN["password"])
    page.get_by_role("button", name=re.compile(r"log\\s*on|sign\\s*in|login", re.I)).click()
    page.wait_for_url(re.compile(r"po-search|invoice-entry"))


def open_page(page, name):
    page.goto(BASE + name)
    ensure_logged_in(page)
    if name not in page.url:
        page.goto(BASE + name)
    dismiss_dialog(page)


def already_posted(page, r):
    open_page(page, "po-search.html")
    locate(page, r"po\\s*(number|no\\.?)|purchase\\s*order", "po-search.html:po_number").fill(r["po"])
    dismiss_dialog(page)
    page.get_by_role("button", name=re.compile(r"search|find|lookup", re.I)).click()
    page.get_by_text(re.compile(r"purchase order found", re.I)).wait_for()
    dismiss_dialog(page)
    row = page.get_by_role("row").filter(has_text=r["invoice"])
    if row.count() == 0:
        return None
    cells = row.first.locator("td").all_text_contents()
    cents = round(float(cells[1].replace(",", "")) * 100)
    theirs = hashlib.sha256(f"{r['vendor']}|{r['po']}|{cells[0]}|{cents}".encode()).hexdigest()
    if theirs == key(r):
        return cells[2]
    raise RuntimeError(f"{r['invoice']} is already posted as {cells[2]} with a different amount")


def post_record(page, r):
    dup = already_posted(page, r)
    if dup:
        return f"DUPLICATE_PREVENTED {r['invoice']} (already {dup})"
    open_page(page, "invoice-entry.html")
    tab = "Header"
    for f in FIELDS:
        dismiss_dialog(page)
        if f["tab"] != tab:
            page.get_by_role("tab", name=f["tab"]).click()
            tab = f["tab"]
        el = locate(page, f["label"], f"invoice-entry.html:{f['field']}")
        value = r["values"][f["field"]]
        if f["field"] == "cost_center":
            el.select_option(value)
        else:
            el.fill(value)
    dismiss_dialog(page)
    submit = re.compile(r"post to general ledger|submit to gl|post invoice", re.I)
    page.get_by_role("button", name=submit).click()
    deadline = time.time() + 12
    while time.time() < deadline:
        if "confirmation.html" in page.url:
            break
        alert = page.get_by_role("alert").filter(has_text=re.compile("ERR-"))
        if alert.count() and alert.is_visible():
            text = alert.text_content() or ""
            if "ERR-4471" in text and r["overrideCode"]:
                locate(page, r"override", "invoice-entry.html:override_code").fill(r["overrideCode"])
                page.get_by_role("button", name=submit).click()
                page.wait_for_url(re.compile(r"confirmation\\.html"))
                break
            raise RuntimeError(text.strip())
        time.sleep(0.1)
    status = page.get_by_role("status").first.text_content() or ""
    m = re.search(r"GL-\\d{4}-\\d{6}", status)
    return f"POSTED {r['invoice']} as {m.group(0) if m else '?'} (key {key(r)[:12]})"


def main():
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        seed = os.environ.get("CHAOS_SEED")
        chaos = f"?chaos={seed}&types={os.environ.get('CHAOS_TYPES', 'ids,labels')}" if seed else "?chaos=off"
        page.goto(BASE + "index.html" + chaos)
        for r in RECORDS:
            for attempt in range(3):
                try:
                    print(post_record(page, r))
                    break
                except Exception as e:
                    if attempt == 2:
                        failures += 1
                        print(f"FAILED {r['invoice']}: {e}")
                    else:
                        time.sleep(0.5 * 2 ** attempt)
        browser.close()
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
`;
}

export const MCP_SETUP = {
  claudeCode: "claude mcp add forwarddeploy-os -- npx tsx mcp-server/server.ts",
  claudeDesktop: JSON.stringify({ mcpServers: { "forwarddeploy-os": { command: "npx", args: ["tsx", "mcp-server/server.ts"], cwd: "/absolute/path/to/forward-deploy-os" } } }, null, 2),
};
