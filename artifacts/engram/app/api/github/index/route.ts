import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getGithubToken, indexRepo, indexCommits } from "@/lib/github";

/**
 * POST /api/github/index
 * body: { repoFullName: string, defaultBranch?: string }
 *
 * Kicks off indexing of a GitHub repo.
 * NOTE: This runs synchronously in the request (no background job infra).
 * Large repos may take 30–90s. The client should show a loading state.
 *
 * Returns: { ok, fileCount, chunkCount, repoId }
 */
export async function POST(request: NextRequest) {
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
    return NextResponse.json({ error: "GitHub not connected. Add a PAT first." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const repoFullName = (body.repoFullName as string)?.trim();
  const defaultBranch = (body.defaultBranch as string)?.trim() || "main";
  if (!repoFullName) {
    return NextResponse.json({ error: "repoFullName is required" }, { status: 400 });
  }

  const [ownerLogin, repoName] = repoFullName.split("/");
  if (!ownerLogin || !repoName) {
    return NextResponse.json({ error: "Invalid repo format (expected owner/repo)" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Upsert a github_repos row and set status = 'indexing'
  const { data: repoRow, error: upsertErr } = await admin
    .from("github_repos")
    .upsert(
      {
        team_id: profile.team_id,
        user_id: user.id,
        repo_full_name: repoFullName,
        repo_name: repoName,
        owner_login: ownerLogin,
        default_branch: defaultBranch,
        status: "indexing",
        error_message: null,
      },
      { onConflict: "team_id,repo_full_name" }
    )
    .select("id")
    .single();

  if (upsertErr || !repoRow) {
    return NextResponse.json({ error: "Failed to create repo record" }, { status: 500 });
  }

  // Run indexing (synchronous — will take a while for large repos)
  try {
    // Index file contents + commit history in parallel
    const [{ fileCount, chunkCount }, commitChunks] = await Promise.all([
      indexRepo({
        repoId: repoRow.id,
        teamId: profile.team_id,
        repoFullName,
        defaultBranch,
        token,
      }),
      indexCommits({
        repoId: repoRow.id,
        teamId: profile.team_id,
        repoFullName,
        defaultBranch,
        token,
        maxCommits: 200,
      }),
    ]);

    const totalChunks = chunkCount + commitChunks;

    // Mark as indexed
    await admin
      .from("github_repos")
      .update({
        status: "indexed",
        file_count: fileCount,
        chunk_count: totalChunks,
        indexed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", repoRow.id);

    return NextResponse.json({
      ok: true,
      repoId: repoRow.id,
      fileCount,
      chunkCount: totalChunks,
      commitChunks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from("github_repos")
      .update({ status: "error", error_message: msg.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", repoRow.id);

    return NextResponse.json({ error: `Indexing failed: ${msg}` }, { status: 500 });
  }
}

/**
 * DELETE /api/github/index
 * body: { repoId: string }
 * Removes all indexed chunks + the repo record.
 */
export async function DELETE(request: NextRequest) {
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

  const body = await request.json().catch(() => ({}));
  const repoId = body.repoId as string;
  if (!repoId) return NextResponse.json({ error: "repoId required" }, { status: 400 });

  const admin = createAdminClient();
  // Cascades will delete github_chunks too
  await admin
    .from("github_repos")
    .delete()
    .eq("id", repoId)
    .eq("team_id", profile.team_id);

  return NextResponse.json({ ok: true });
}
