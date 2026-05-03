import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the public-facing origin of this request. When running behind a
 * proxy (Replit dev, Vercel, etc.) `request.url` reports the *internal*
 * origin (often http://localhost:3000), which would cause the browser to
 * follow our redirect to a host it can't reach. Prefer, in order:
 *   1. NEXT_PUBLIC_SITE_URL if explicitly configured
 *   2. The X-Forwarded-Proto + X-Forwarded-Host headers from the proxy
 *   3. Whatever request.url says (last resort)
 */
function resolvePublicOrigin(request: NextRequest, fallback: string): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ??
    (forwardedHost?.includes("localhost") ? "http" : "https");
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return fallback;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicOrigin = resolvePublicOrigin(request, url.origin);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorCode = url.searchParams.get("error_code");
  const errorDescription = url.searchParams.get("error_description");

  const rawNext = url.searchParams.get("next") ?? "/dashboard";
  // Only allow relative same-origin redirects to prevent open-redirect attacks
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  // OAuth provider returned an error — bounce to /login with a friendly message
  if (error || errorCode) {
    const params = new URLSearchParams();
    if (error) params.set("error", error);
    if (errorCode) params.set("error_code", errorCode);
    if (errorDescription) params.set("error_description", errorDescription);
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, publicOrigin));
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        const params = new URLSearchParams({
          error: "exchange_failed",
          error_description: exchangeError.message,
        });
        return NextResponse.redirect(
          new URL(`/login?${params.toString()}`, publicOrigin)
        );
      }
    } catch (e) {
      const params = new URLSearchParams({
        error: "callback_failed",
        error_description: e instanceof Error ? e.message : "Auth callback failed",
      });
      return NextResponse.redirect(new URL(`/login?${params.toString()}`, publicOrigin));
    }
  }

  return NextResponse.redirect(new URL(next, publicOrigin));
}
