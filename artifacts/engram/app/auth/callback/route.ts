import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
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
    return NextResponse.redirect(new URL(`/login?${params.toString()}`, url.origin));
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
          new URL(`/login?${params.toString()}`, url.origin)
        );
      }
    } catch (e) {
      const params = new URLSearchParams({
        error: "callback_failed",
        error_description: e instanceof Error ? e.message : "Auth callback failed",
      });
      return NextResponse.redirect(new URL(`/login?${params.toString()}`, url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
