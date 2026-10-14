/**
 * Loads the real 2009 portal files (public/legacy/omnicorp) into jsdom with
 * their scripts running, carrying localStorage / sessionStorage across page
 * loads like a browser tab. Used by unit tests and `npm run bench`.
 * Only our own committed files are executed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole, requestInterceptor } from "jsdom";
import type { ChaosType, LedgerEntry } from "../../src/engine/types";
import { createDocumentDriver } from "../../src/engine/browser/document-driver";
import type { PortalDriver } from "../../src/engine/browser/driver";
import { CHAOS_STORAGE_KEY, LEDGER_STORAGE_KEY, SESSION_STORAGE_KEY, pageFromUrl } from "../../src/engine/browser/driver";

const ROOT = join(process.cwd(), "public", "legacy", "omnicorp");
const ORIGIN = "http://portal.test";
const BASE = "/legacy/omnicorp/";

const fileCache = new Map<string, string>();
function file(rel: string): string {
  let v = fileCache.get(rel);
  if (v === undefined) {
    v = readFileSync(join(ROOT, rel), "utf8");
    fileCache.set(rel, v);
  }
  return v;
}

const CONTENT_TYPES: Record<string, string> = { js: "application/javascript", css: "text/css", json: "application/json", html: "text/html" };

/** Serve only our own portal files; every other request is refused. */
const portalInterceptor = requestInterceptor((request: Request) => {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(BASE)) return Promise.resolve(new Response("blocked", { status: 403 }));
  const rel = path.slice(BASE.length);
  // jsdom does not render; skipping the stylesheet keeps getComputedStyle cheap.
  // Visibility in the portal is driven by the `hidden` attribute, which needs no CSS.
  if (rel.endsWith(".css")) return Promise.resolve(new Response("", { status: 200, headers: { "Content-Type": "text/css" } }));
  try {
    const body = file(rel);
    const ext = rel.split(".").pop() ?? "";
    return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": CONTENT_TYPES[ext] ?? "text/plain" } }));
  } catch {
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
});

export interface JsdomPortalOptions {
  chaos?: { seed: number; types: ChaosType[] };
  latencyScale?: number;
  ledger?: LedgerEntry[];
  loggedIn?: boolean;
  /** Called with each new window before its scripts run (tests can patch things). */
  beforeParse?: (w: Window) => void;
}

export interface JsdomPortal {
  driver: PortalDriver;
  window(): Window & typeof globalThis;
  load(page: string): Promise<void>;
  storage: { local: Map<string, string>; session: Map<string, string> };
  close(): void;
}

export async function createJsdomPortal(opts: JsdomPortalOptions = {}): Promise<JsdomPortal> {
  const erp = JSON.parse(file("data/erp.json"));
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  if (opts.ledger) local.set(LEDGER_STORAGE_KEY, JSON.stringify(opts.ledger));
  if (opts.chaos && opts.chaos.types.length) session.set(CHAOS_STORAGE_KEY, JSON.stringify(opts.chaos));
  if (opts.loggedIn) session.set(SESSION_STORAGE_KEY, "fde.demo");
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e: Error) => {
    if (!/Not implemented: (navigation|HTMLFormElement)/.test(e.message)) console.warn("[jsdom]", e.message);
  });

  let dom: JSDOM | null = null;
  let current: Promise<void> = Promise.resolve();
  let resolveCurrent: (() => void) | null = null;

  const save = () => {
    if (!dom) return;
    const w = dom.window;
    for (const [store, map] of [
      [w.localStorage, local],
      [w.sessionStorage, session],
    ] as const) {
      map.clear();
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)!;
        map.set(k, store.getItem(k)!);
      }
    }
  };

  const load = (url: string): Promise<void> => {
    save();
    const full = new URL(url, ORIGIN);
    const page = pageFromUrl(full.href);
    const html = file(page === "unknown" ? "index.html" : page);
    const old = dom;
    // A newer navigation replaces a pending one (like a browser tab).
    resolveCurrent?.();
    current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
      const next = new JSDOM(html, {
        url: full.href,
        runScripts: "dangerously",
        resources: { interceptors: [portalInterceptor] },
        pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(w) {
          for (const [k, v] of local) w.localStorage.setItem(k, v);
          for (const [k, v] of session) w.sessionStorage.setItem(k, v);
          const anyW = w as unknown as Record<string, unknown>;
          anyW.__OMNICORP_DATA__ = erp;
          anyW.__OMNICORP_NAVIGATE__ = (to: string) => {
            setTimeout(() => void load(to), 0);
          };
          if (opts.latencyScale !== undefined) anyW.__OMNICORP_LATENCY_SCALE__ = opts.latencyScale;
          opts.beforeParse?.(w as unknown as Window);
        },
      });
      dom = next;
      next.window.addEventListener("load", () => resolve());
      setTimeout(resolve, 5000);
    });
    old?.window.close();
    return current;
  };

  /** Wait until the latest navigation (including script-triggered redirects) has loaded. */
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      const p = current;
      await p;
      await new Promise((r) => setTimeout(r, 1));
      if (p === current) return;
    }
  };

  void load(`${BASE}index.html`);
  await settle();

  const driver = createDocumentDriver({
    kind: "jsdom",
    getWindow: () => dom!.window as unknown as Window,
    navigate: async (url) => {
      void load(url);
      await settle();
    },
    baseUrl: BASE,
    pollMs: 5,
  });

  return {
    driver,
    window: () => dom!.window as unknown as Window & typeof globalThis,
    load: async (page) => {
      void load(`${BASE}${page}`);
      await settle();
    },
    storage: { local, session },
    close: () => {
      save();
      dom?.window.close();
    },
  };
}
