import { NextResponse, NextRequest } from "next/server";

/**
 * Build CORS headers that work with credentialed requests from the Chrome
 * extension. The browser refuses `Access-Control-Allow-Origin: *` whenever
 * `credentials: 'include'` is used, so we echo the request Origin back when
 * present and fall back to `*` for opaque/serverless callers.
 */
export function buildCorsHeaders(request?: NextRequest | Request): Record<string, string> {
  const origin = request?.headers?.get("origin") ?? null;
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-engram-secret",
    "Vary": "Origin",
  };
}

// Backwards-compat constant (no request context — *no* credentials allowed).
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-engram-secret",
};

export function corsOptions(request?: NextRequest | Request) {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders(request) });
}

export function withCors(
  response: NextResponse,
  request?: NextRequest | Request
): NextResponse {
  Object.entries(buildCorsHeaders(request)).forEach(([k, v]) =>
    response.headers.set(k, v)
  );
  return response;
}
