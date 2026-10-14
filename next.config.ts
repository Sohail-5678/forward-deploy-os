import type { NextConfig } from "next";

/**
 * Static security headers. The per-request Content-Security-Policy (with a
 * script nonce) for app pages is set in `src/proxy.ts`. The legacy portal is
 * plain static HTML, so it gets a fixed CSP here, and it is the only route that
 * may be framed (by this same origin, for the console's split view).
 */
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const legacyCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: baseHeaders },
      {
        source: "/legacy/:path*",
        headers: [
          { key: "Content-Security-Policy", value: legacyCsp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Content-Security-Policy", value: apiCsp },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/samples/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/legacy/omnicorp", destination: "/legacy/omnicorp/index.html", permanent: false },
      { source: "/legacy", destination: "/legacy/omnicorp/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
