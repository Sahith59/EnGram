/**
 * GET /api/oauth/github/callback
 * Handles the GitHub OAuth callback.
 * Exchanges code for access token and stores it encrypted.
 *
 * Required env vars:
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/oauth-crypto";

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const GH_API = "https://api.github.com";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=github_denied`);
  }

  // Validate CSRF state
  const savedState = request.cookies.get("gh_oauth_state")?.value;
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=no_code`);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=not_configured`);
  }

  // Exchange code for access token
  let accessToken: string;
  let scope: string;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await res.json() as { access_token?: string; scope?: string; error?: string };
    if (!data.access_token) throw new Error(data.error ?? "No access_token in response");
    accessToken = data.access_token;
    scope = data.scope ?? "";
  } catch (err) {
    console.error("[oauth/github] token exchange failed:", err);
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=token_exchange`);
  }

  // Get GitHub user info
  let login = "";
  try {
    const res = await fetch(`${GH_API}/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    const user = await res.json() as { login?: string };
    login = user.login ?? "";
  } catch { /* non-fatal */ }

  // Get the ENGRAM user's team
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=unauthorized`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", authUser.id)
    .single();
  if (!profile?.team_id) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=no_team`);
  }

  // Store encrypted token
  const admin = createAdminClient();
  await admin.from("github_oauth_tokens").upsert(
    {
      team_id: profile.team_id,
      provider: "github",
      access_token_enc: encryptToken(accessToken),
      token_scope: scope,
      provider_login: login,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,provider" }
  );

  // Clear the CSRF cookie and redirect to settings
  const response = NextResponse.redirect(`${appUrl}/settings?tab=integrations&connected=github`);
  response.cookies.delete("gh_oauth_state");
  return response;
}
