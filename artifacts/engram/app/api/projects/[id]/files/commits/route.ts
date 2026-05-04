/**
 * GET /api/projects/[id]/files/commits?path=<file_path>
 * Given a file path, returns all commits that touched it and the AI
 * conversations that explain those changes (via semantic_links.linked_files).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path query param required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();

  // Verify project membership + get repo
  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) {
    return NextResponse.json({ file_path: filePath, commits: [] });
  }

  // Query semantic_links where linked_files contains the given path
  // PostgreSQL: linked_files @> ARRAY[path] checks if array contains element
  const { data: links } = await admin
    .from("semantic_links")
    .select("commit_sha, commit_message, committed_at, similarity, snapshot_id, is_manual, linked_files")
    .eq("repo_id", project.github_repo_id)
    .contains("linked_files", [filePath])
    .order("committed_at", { ascending: false });

  if (!links || links.length === 0) {
    return NextResponse.json({ file_path: filePath, commits: [] });
  }

  // Group by commit_sha
  const commitMap = new Map<string, {
    commit_sha: string;
    commit_message: string | null;
    committed_at: string | null;
    files_changed: number;
    snapshot_ids: string[];
    top_similarity: number;
  }>();

  for (const link of links) {
    const existing = commitMap.get(link.commit_sha);
    if (existing) {
      existing.snapshot_ids.push(link.snapshot_id);
      existing.top_similarity = Math.max(existing.top_similarity, link.similarity ?? 0);
    } else {
      commitMap.set(link.commit_sha, {
        commit_sha: link.commit_sha,
        commit_message: link.commit_message,
        committed_at: link.committed_at,
        files_changed: (link.linked_files ?? []).length,
        snapshot_ids: [link.snapshot_id],
        top_similarity: link.similarity ?? 0,
      });
    }
  }

  // Load snapshot titles for all snapshot_ids
  const allSnapshotIds = [...new Set(links.map((l) => l.snapshot_id))];
  const { data: snapshots } = await admin
    .from("context_snapshots")
    .select("id, title, summary, decision, created_at, ai_tool")
    .in("id", allSnapshotIds);
  const snapMap = new Map((snapshots ?? []).map((s) => [s.id, s]));

  const commits = Array.from(commitMap.values()).map((c) => ({
    ...c,
    sha_short: c.commit_sha.slice(0, 7),
    linked_conversations: c.snapshot_ids.map((sid) => snapMap.get(sid) ?? null).filter(Boolean),
  }));

  return NextResponse.json({
    file_path: filePath,
    commits,
  });
}
