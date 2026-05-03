import type { NextRequest } from "next/server";

/**
 * Resolve the public origin a request actually came in on.
 *
 * Next.js's `req.nextUrl.origin` can return "http://localhost:3000" when
 * the dev server binds to localhost but the user reaches it through a
 * proxy (e.g. Replit's `*.replit.dev`). For anything we hand back to the
 * browser to be re-shared (invite links, OAuth callbacks, share URLs),
 * we need the host the user actually typed.
 *
 * Order of trust:
 *   1. NEXT_PUBLIC_APP_URL (explicit override)
 *   2. x-forwarded-host + x-forwarded-proto (set by proxies)
 *   3. host header (direct request)
 *   4. req.nextUrl.origin (last-resort fallback)
 */
export function getPublicOrigin(req: NextRequest): string {
  const override = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (override) return override.replace(/\/+$/, "");

  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;

  const host = req.headers.get("host");
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";
    return `${proto}://${host}`;
  }

  return req.nextUrl.origin;
}
