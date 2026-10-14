"use client";
/** PortalDriver over the console's same-origin portal iframe. */
import { createDocumentDriver } from "@/engine/browser/document-driver";
import { PortalError, type PortalDriver } from "@/engine/browser/driver";

export const PORTAL_BASE = "/legacy/omnicorp/";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Navigate the iframe and wait until the page (and any script redirect) has settled. */
async function navigate(iframe: HTMLIFrameElement, url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      iframe.removeEventListener("load", onLoad);
      resolve();
    };
    const onLoad = () => setTimeout(finish, 20);
    iframe.addEventListener("load", onLoad);
    try {
      iframe.contentWindow!.location.href = url;
    } catch {
      iframe.src = url;
    }
    setTimeout(finish, 8000);
  });
  // Follow redirects the portal performs on load (for example, to the log-on page).
  let last = "";
  let stable = 0;
  for (let i = 0; i < 100 && stable < 3; i++) {
    const w = iframe.contentWindow;
    const href = w?.location.href ?? "";
    const ready = w?.document.readyState === "complete";
    if (ready && href === last) stable++;
    else stable = 0;
    last = href;
    await sleep(30);
  }
}

export function createIframeDriver(getIframe: () => HTMLIFrameElement | null): PortalDriver {
  return createDocumentDriver({
    kind: "iframe",
    getWindow: () => {
      const f = getIframe();
      if (!f?.contentWindow) throw new PortalError("The portal window is not loaded.", "UNREACHABLE");
      return f.contentWindow;
    },
    navigate: async (url) => {
      const f = getIframe();
      if (!f) throw new PortalError("The portal window is not loaded.", "UNREACHABLE");
      await navigate(f, url);
    },
    baseUrl: PORTAL_BASE,
    pollMs: 25,
  });
}

export function elementRect(iframe: HTMLIFrameElement, selector: string): DOMRect | null {
  try {
    const doc = iframe.contentDocument;
    const el = doc?.querySelector(selector);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    return el.getBoundingClientRect();
  } catch {
    return null;
  }
}
