/**
 * GET /api/oauth/gitlab/callback
 * Handles the GitLab OAuth callback.
 *
 * Required env vars:
 *   GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/oauth-crypto";

const TOKEN_URL = "https://gitlab.com/oauth/token";
const GL_API = "https://gitlab.com/api/v4";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=gitlab_denied`);
  }

  const savedState = request.cookies.get("gl_oauth_state")?.value;
  if (!state || state !== savedState) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=no_code`);
  }

  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=not_configured`);
  }

  let accessToken: string;
  let scope: string;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${appUrl}/api/oauth/gitlab/callback`,
      }).toString(),
    });
    const data = await res.json() as { access_token?: string; scope?: string; error?: string };
    if (!data.access_token) throw new Error(data.error ?? "No access_token");
    accessToken = data.access_token;
    scope = data.scope ?? "";
  } catch (err) {
    console.error("[oauth/gitlab] token exchange failed:", err);
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=token_exchange`);
  }

  let username = "";
  try {
    const res = await fetch(`${GL_API}/user`, {
      headers: { "PRIVATE-TOKEN": accessToken },
    });
    const user = await res.json() as { username?: string };
    username = user.username ?? "";
  } catch { /* non-fatal */ }

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

  const admin = createAdminClient();
  await admin.from("github_oauth_tokens").upsert(
    {
      team_id: profile.team_id,
      provider: "gitlab",
      access_token_enc: encryptToken(accessToken),
      token_scope: scope,
      provider_login: username,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,provider" }
  );

  const response = NextResponse.redirect(`${appUrl}/settings?tab=integrations&connected=gitlab`);
  response.cookies.delete("gl_oauth_state");
  return response;
}
