import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getGithubToken, getRepoContributors } from "@/lib/github";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/github/contributors?repo=owner/repo
 *
 * Returns GitHub contributors for an indexed repo, annotated with whether
 * each contributor is already a team member (by matching email or github_login).
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const repo = request.nextUrl.searchParams.get("repo");
  if (!repo) return NextResponse.json({ error: "repo param required" }, { status: 400 });

  const token = await getGithubToken(profile.team_id);
  if (!token) return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });

  // Fetch contributors from GitHub
  const contributors = await getRepoContributors(token, repo);

  // Get current team members so we can mark already-joined ones
  const admin = createAdminClient();
  const { data: members } = await admin
    .from("profiles")
    .select("id, display_name, github_login, avatar_url")
    .eq("team_id", profile.team_id);

  const teamGithubLogins = new Set(
    (members ?? []).map((m: { github_login?: string }) => m.github_login?.toLowerCase()).filter(Boolean)
  );

  const enriched = contributors.map((c) => ({
    login: c.login,
    avatar_url: c.avatar_url,
    html_url: c.html_url,
    contributions: c.contributions,
    already_member: teamGithubLogins.has(c.login.toLowerCase()),
    is_self: false, // will be set client-side
  }));

  return NextResponse.json({ contributors: enriched, repo });
}
