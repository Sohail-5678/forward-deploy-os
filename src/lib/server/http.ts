import "server-only";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { rateLimit } from "./rate-limit";

/**
 * Shared API route wrapper: same-origin check for browsers, rate limit,
 * 2 MB body cap (read as a stream, not trusted from Content-Length), Zod
 * validation, and JSON errors as { error: { code, message } } with a request
 * id. Stack traces never reach the client.
 */

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, code: string, message: string, requestId: string, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message, requestId } }, { status, headers: { "x-request-id": requestId, ...headers } });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 64);
  return (req.headers.get("x-real-ip") ?? "local").slice(0, 64);
}

async function readBody(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function sameOriginOk(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export interface RouteContext {
  req: Request;
  ip: string;
  requestId: string;
}

export interface RouteOptions<T> {
  name: string;
  schema?: ZodType<T>;
  limit: { max: number; windowMs?: number };
  maxBytes?: number;
  /** Require browser calls to come from this site (default true for POST). */
  sameOrigin?: boolean;
}

export function apiRoute<T>(opts: RouteOptions<T>, handler: (body: T, ctx: RouteContext) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const requestId = randomUUID();
    const ip = clientIp(req);
    try {
      if ((opts.sameOrigin ?? req.method !== "GET") && !sameOriginOk(req)) throw new ApiError(403, "CROSS_ORIGIN", "Cross-site requests are not allowed.");
      const limit = await rateLimit(`${opts.name}:${ip}`, opts.limit.max, opts.limit.windowMs ?? 60_000);
      if (!limit.allowed) {
        const retry = Math.max(1, Math.ceil(limit.resetMs / 1000));
        throw new ApiError(429, "RATE_LIMITED", `Too many requests. Try again in ${retry} s.`, { "retry-after": String(retry) });
      }
      let body = undefined as T;
      if (opts.schema) {
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send JSON (content-type: application/json).");
        const text = await readBody(req, opts.maxBytes ?? MAX_BODY_BYTES);
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
        }
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new ApiError(400, "INVALID_REQUEST", `Invalid request at ${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`);
        }
        body = parsed.data;
      }
      const res = await handler(body, { req, ip, requestId });
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e.status, e.code, e.message, requestId, e.headers);
      console.error(`[api:${opts.name}] ${requestId}`, e instanceof Error ? e.message : e);
      return errorResponse(500, "INTERNAL", "Something went wrong. Use the request id when reporting it.", requestId);
    }
  };
}
