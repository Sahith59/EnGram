/**
 * GET /api/oauth/status
 * Returns OAuth connection status for GitHub and GitLab.
 *
 * `has_github_app` is true when the GitHub App env vars are configured
 * (GITHUB_APP_ID + GITHUB_APP_NAME + GITHUB_APP_PRIVATE_KEY).
 *
 * `has_gitlab_app` is true when GitLab OAuth env vars are set
 * (GITLAB_CLIENT_ID + GITLAB_CLIENT_SECRET).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();
  const { data: tokens } = await admin
    .from("github_oauth_tokens")
    .select("provider, provider_login, token_scope, installation_id, created_at")
    .eq("team_id", profile.team_id);

  const github = tokens?.find((t) => t.provider === "github");
  const gitlab = tokens?.find((t) => t.provider === "gitlab");

  // Also check legacy PAT for GitHub
  const { data: legacyIntegration } = await admin
    .from("integrations")
    .select("config")
    .eq("team_id", profile.team_id)
    .eq("type", "github")
    .maybeSingle();
  const legacyConfig = legacyIntegration?.config as { pat?: string; github_login?: string } | null;

  return NextResponse.json({
    github: github
      ? {
          connected: true,
          login: github.provider_login,
          via: github.installation_id ? "github_app" : "oauth",
          installation_id: github.installation_id ?? null,
        }
      : legacyConfig?.pat
        ? { connected: true, login: legacyConfig.github_login ?? null, via: "pat" }
        : { connected: false },
    gitlab: gitlab
      ? { connected: true, login: gitlab.provider_login, via: "oauth" }
      : { connected: false },
    // GitHub App: requires all three env vars to be set
    has_github_app: !!(
      process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_NAME &&
      process.env.GITHUB_APP_PRIVATE_KEY
    ),
    // GitLab OAuth: requires client ID + secret
    has_gitlab_app: !!(process.env.GITLAB_CLIENT_ID && process.env.GITLAB_CLIENT_SECRET),
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider") as "github" | "gitlab" | null;
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();
  await admin
    .from("github_oauth_tokens")
    .delete()
    .eq("team_id", profile.team_id)
    .eq("provider", provider);

  return NextResponse.json({ ok: true });
}
