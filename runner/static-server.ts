/**
 * Serves `public/` (the 2009 portal and the samples) on 127.0.0.1 so the
 * Playwright runner, the baseline script and the MCP server can drive the
 * portal without the Next.js app. Read-only, GET/HEAD only, loopback only,
 * and no path can resolve outside `public/`.
 */
import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd(), "public");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticPortal {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startStaticPortal(port = 0): Promise<StaticPortal> {
  const server: Server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = resolve(ROOT, "." + normalize(rel));
      if (file !== ROOT && !file.startsWith(ROOT + sep)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": body.byteLength,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  const actual = typeof addr === "object" && addr ? addr.port : port;
  return {
    baseUrl: `http://127.0.0.1:${actual}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

export const PUBLIC_ROOT = ROOT;
export const portalUrl = (base: string, page = "index.html") => `${base.replace(/\/$/, "")}/legacy/omnicorp/${page}`;
export const samplePath = (p: string) => join(ROOT, "samples", p);
