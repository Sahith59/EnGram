/**
 * POST   /api/projects/[id]/commits/[sha]/links
 * DELETE /api/projects/[id]/commits/[sha]/links?snapshot_id=xxx
 *
 * Manual link/unlink of a conversation snapshot to a commit.
 * Manual links are never overwritten by the automatic linker (is_manual=true).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sha: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
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

  let body: { snapshot_id: string; commit_message?: string; committed_at?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.snapshot_id) {
    return NextResponse.json({ error: "snapshot_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify project + repo membership
  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify snapshot belongs to the project's team
  const { data: snapshot } = await admin
    .from("context_snapshots")
    .select("id")
    .eq("id", body.snapshot_id)
    .eq("team_id", profile.team_id)
    .maybeSingle();
  if (!snapshot) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  // Check if an auto-link already exists — if so, only promote it to manual.
  // This preserves the computed similarity and linked_files from the auto-linker.
  const { data: existing } = await admin
    .from("semantic_links")
    .select("id")
    .eq("repo_id", project.github_repo_id)
    .eq("commit_sha", params.sha)
    .eq("snapshot_id", body.snapshot_id)
    .maybeSingle();

  if (existing) {
    // Row exists (auto-link) — just mark it as also manually confirmed
    const { error: updateErr } = await admin
      .from("semantic_links")
      .update({ is_manual: true })
      .eq("id", existing.id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    // No existing link — insert a fresh manual link
    const { error: insertErr } = await admin
      .from("semantic_links")
      .insert({
        repo_id:        project.github_repo_id,
        commit_sha:     params.sha,
        snapshot_id:    body.snapshot_id,
        similarity:     1.0,
        linked_files:   [],
        commit_message: body.commit_message ?? null,
        committed_at:   body.committed_at ?? null,
        is_manual:      true,
      });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; sha: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
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

  const snapshotId = request.nextUrl.searchParams.get("snapshot_id");
  if (!snapshotId) return NextResponse.json({ error: "snapshot_id required" }, { status: 400 });

  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await admin
    .from("semantic_links")
    .delete()
    .eq("repo_id", project.github_repo_id)
    .eq("commit_sha", params.sha)
    .eq("snapshot_id", snapshotId);

  return NextResponse.json({ ok: true });
}
