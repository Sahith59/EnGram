/**
 * GET /api/oauth/status
 * Returns OAuth connection status for GitHub and GitLab.
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
    .select("provider, provider_login, token_scope, created_at")
    .eq("team_id", profile.team_id);

  const github = tokens?.find((t) => t.provider === "github");
  const gitlab = tokens?.find((t) => t.provider === "gitlab");

  // Also check legacy PAT
  const { data: legacyIntegration } = await admin
    .from("integrations")
    .select("config")
    .eq("team_id", profile.team_id)
    .eq("type", "github")
    .maybeSingle();
  const legacyConfig = legacyIntegration?.config as { pat?: string; github_login?: string } | null;

  return NextResponse.json({
    github: github
      ? { connected: true, login: github.provider_login, via: "oauth" }
      : legacyConfig?.pat
        ? { connected: true, login: legacyConfig.github_login ?? null, via: "pat" }
        : { connected: false },
    gitlab: gitlab
      ? { connected: true, login: gitlab.provider_login, via: "oauth" }
      : { connected: false },
    has_github_app: !!process.env.GITHUB_CLIENT_ID,
    has_gitlab_app: !!process.env.GITLAB_CLIENT_ID,
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
