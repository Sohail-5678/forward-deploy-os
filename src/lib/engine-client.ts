"use client";
/**
 * Main-thread client for the engine worker: request/response RPC, streamed
 * events, and the host side of the portal driver bridge.
 */
import type { PortalDriver } from "@/engine/browser/driver";
import { PortalError } from "@/engine/browser/driver";
import type { MainToWorker, WorkerRequest, WorkerResponse, WorkerStream } from "./worker-protocol";

/** The only driver methods the worker may call on the main thread. */
const DRIVER_METHODS = new Set(["goto", "currentPage", "distill", "probe", "fill", "select", "click", "waitFor", "readLedger", "setChaos", "portalInfo"]);

export interface DriverHost {
  driver: PortalDriver;
  pace(selector: string, label: string, kind: string): Promise<void>;
}

export class EngineClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(m: WorkerStream) => void>();
  private host: DriverHost | null = null;

  constructor() {
    this.worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module", name: "forwarddeploy-engine" });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse | WorkerStream>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new Error(ev.message || "engine worker crashed"));
      this.pending.clear();
    };
  }

  request<T>(req: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, ...req } as MainToWorker, transfer);
    });
  }

  onStream(fn: (m: WorkerStream) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setDriverHost(host: DriverHost | null) {
    this.host = host;
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("The engine was stopped."));
    this.pending.clear();
  }

  private onMessage(m: WorkerResponse | WorkerStream) {
    if (m.type === "response") {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
      return;
    }
    if (m.type === "driver-call") {
      void this.serveDriver(m.callId, m.method, m.args);
      return;
    }
    for (const l of this.listeners) l(m);
  }

  private async serveDriver(callId: number, method: string, args: unknown[]) {
    const reply = (msg: MainToWorker) => this.worker.postMessage(msg);
    if (!this.host) {
      reply({ type: "driver-result", callId, ok: false, error: { message: "The portal window is not attached.", code: "UNREACHABLE" } });
      return;
    }
    try {
      let result: unknown;
      if (method === "pace") result = await this.host.pace(args[0] as string, args[1] as string, args[2] as string);
      else {
        if (!DRIVER_METHODS.has(method)) throw new Error(`unknown driver method ${method}`);
        const fn = (this.host.driver as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
        if (typeof fn !== "function") throw new Error(`unknown driver method ${method}`);
        result = await fn.apply(this.host.driver, args);
      }
      reply({ type: "driver-result", callId, ok: true, result });
    } catch (e) {
      const code = e instanceof PortalError ? e.code : undefined;
      reply({ type: "driver-result", callId, ok: false, error: { message: e instanceof Error ? e.message : String(e), code } });
    }
  }
}
