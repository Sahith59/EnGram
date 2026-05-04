/**
 * GET /api/oauth/github
 * Initiates the GitHub OAuth flow.
 * Redirects to GitHub's authorization page.
 *
 * Required env vars:
 *   GITHUB_CLIENT_ID — GitHub OAuth App client ID
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // CSRF state token stored in a short-lived cookie
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "repo,read:user",
    state,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/oauth/github/callback`,
  });

  const response = NextResponse.redirect(`${GITHUB_AUTHORIZE}?${params}`);
  response.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return response;
}
