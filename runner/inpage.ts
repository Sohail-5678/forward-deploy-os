/**
 * Entry point bundled (esbuild, IIFE) and injected into every portal page the
 * Playwright runner opens. It exposes the engine's own distiller, so the
 * runner reads the page exactly like the console and the tests do.
 */
import { describeElement, distillDocument } from "../src/engine/browser/dom-distiller";
import { pageFromUrl } from "../src/engine/browser/driver";

declare global {
  interface Window {
    __FDOS__?: {
      distill(): ReturnType<typeof distillDocument>;
      probe(selector: string): { fingerprint: unknown; label: string; role: string } | null;
    };
  }
}

window.__FDOS__ = {
  distill: () => distillDocument(document, { page: pageFromUrl(location.href) }),
  probe(selector: string) {
    let list: NodeListOf<Element>;
    try {
      list = document.querySelectorAll(selector);
    } catch {
      return null;
    }
    if (list.length !== 1) return null;
    const d = describeElement(list[0]);
    return d ? { fingerprint: d.fingerprint, label: d.label, role: d.role } : null;
  },
};
