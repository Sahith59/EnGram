/**
 * GET /api/oauth/github/callback
 * Handles the GitHub App installation callback.
 *
 * GitHub redirects here after the user installs/authorizes the GitHub App,
 * passing installation_id and optionally setup_action + state.
 *
 * CSRF protection: when our initiation route sets a state cookie, the
 * callback MUST present a matching state param. If the cookie is present
 * but state is absent (or mismatched), the request is rejected.
 *
 * Required env vars:
 *   GITHUB_APP_ID          — numeric GitHub App ID
 *   GITHUB_APP_PRIVATE_KEY — RSA private key PEM
 *   GITHUB_APP_NAME        — app slug (for display)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const GH_API = "https://api.github.com";

// ── JWT generation ─────────────────────────────────────────────────────────────

function generateGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,   // 60s in the past to allow for clock skew
    exp: now + 600,  // 10 minutes (GitHub's maximum)
    iss: appId,
  })).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

// ── Installation token exchange ────────────────────────────────────────────────

async function getInstallationAccessToken(
  appId: string,
  privateKey: string,
  installationId: string
): Promise<{ token: string; expiresAt: string } | null> {
  try {
    const jwt = generateGitHubAppJwt(appId, privateKey);
    const res = await fetch(
      `${GH_API}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) {
      console.error("[oauth/github/callback] installation token exchange failed:", await res.text());
      return null;
    }
    const data = await res.json() as { token?: string; expires_at?: string };
    if (!data.token) return null;
    return { token: data.token, expiresAt: data.expires_at ?? "" };
  } catch (err) {
    console.error("[oauth/github/callback] token exchange error:", err);
    return null;
  }
}

// ── Installation metadata ──────────────────────────────────────────────────────

async function getInstallationMetadata(
  jwt: string,
  installationId: string
): Promise<{ accountLogin: string; accountType: string } | null> {
  try {
    const res = await fetch(`${GH_API}/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { account?: { login?: string; type?: string } };
    return {
      accountLogin: data.account?.login ?? "",
      accountType: data.account?.type ?? "User",
    };
  } catch {
    return null;
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");  // "install" | "update" | "delete"
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=github_denied`);
  }

  // ── Strict CSRF state validation ──────────────────────────────────────────
  // The initiation route always sets a gh_oauth_state cookie. If the cookie is
  // present, the state param in the callback MUST be present and must match.
  // If neither is present (e.g., a direct GitHub webhook redirect), allow through.
  const savedState = request.cookies.get("gh_oauth_state")?.value;
  if (savedState) {
    // We initiated this flow: state param is required and must match
    if (!state || state !== savedState) {
      return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=invalid_state`);
    }
  }
  // If no cookie and no state: direct redirect from GitHub (GitHub App webhook
  // flows can omit state). Allow but note the reduced CSRF protection.

  if (!installationId) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=no_installation_id`);
  }

  // Handle uninstall
  if (setupAction === "delete") {
    const supabase = await createClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      const admin = createAdminClient();
      const { data: profile } = await supabase
        .from("profiles").select("team_id").eq("id", authUser.id).single();
      if (profile?.team_id) {
        await admin.from("github_oauth_tokens")
          .delete()
          .eq("team_id", profile.team_id)
          .eq("provider", "github");
      }
    }
    const response = NextResponse.redirect(`${appUrl}/settings?tab=integrations&disconnected=github`);
    response.cookies.delete("gh_oauth_state");
    return response;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=not_configured`);
  }

  // Exchange installation_id for an installation access token
  const tokenResult = await getInstallationAccessToken(appId, privateKey, installationId);
  if (!tokenResult) {
    return NextResponse.redirect(`${appUrl}/settings?tab=integrations&error=token_exchange`);
  }

  // Fetch installation metadata (account login)
  const jwt = generateGitHubAppJwt(appId, privateKey);
  const meta = await getInstallationMetadata(jwt, installationId);

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

  // Store installation metadata + encrypted short-lived token
  const admin = createAdminClient();
  await admin.from("github_oauth_tokens").upsert(
    {
      team_id: profile.team_id,
      provider: "github",
      installation_id: installationId,
      access_token_enc: encryptToken(tokenResult.token),
      token_scope: "installation",
      provider_login: meta?.accountLogin ?? "",
      expires_at: tokenResult.expiresAt || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,provider" }
  );

  const response = NextResponse.redirect(`${appUrl}/settings?tab=integrations&connected=github`);
  response.cookies.delete("gh_oauth_state");
  return response;
}
