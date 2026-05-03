import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getGithubToken, listUserRepos } from "@/lib/github";

/**
 * GET /api/github/repos
 * Returns:
 *  - repos: list of GitHub repos accessible with the connected PAT
 *  - indexed: list of repos already indexed in ENGRAM (from github_repos table)
 */
export async function GET() {
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

  const token = await getGithubToken(profile.team_id);
  if (!token) {
    return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });
  }

  // Fetch repos from GitHub API
  let githubRepos: Awaited<ReturnType<typeof listUserRepos>> = [];
  try {
    githubRepos = await listUserRepos(token);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "GitHub API error" },
      { status: 502 }
    );
  }

  // Fetch already-indexed repos from DB
  const admin = createAdminClient();
  const { data: indexedRepos } = await admin
    .from("github_repos")
    .select("id, repo_full_name, status, file_count, chunk_count, indexed_at, error_message")
    .eq("team_id", profile.team_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    repos: githubRepos.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      owner: r.owner.login,
      description: r.description,
      private: r.private,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
    })),
    indexed: indexedRepos ?? [],
  });
}
