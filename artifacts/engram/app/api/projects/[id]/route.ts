import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/projects/[id]
 * Full project detail: metadata + all snapshots in timeline order.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

  const admin = createAdminClient();
  const { data: project, error: pErr } = await admin
    .from("projects")
    .select("id, name, description, snapshot_count, created_at, updated_at, github_repo_id, created_by")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();

  if (pErr || !project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [snapsRes, repoRes, membersRes] = await Promise.all([
    admin
      .from("context_snapshots")
      .select("id, title, summary, ai_tool, tags, decision, created_at, visibility, author_handle, created_by")
      .eq("project_id", params.id)
      .order("created_at", { ascending: true }),
    project.github_repo_id
      ? admin.from("github_repos")
          .select("id, repo_full_name, repo_name, owner_login, file_count, chunk_count, indexed_at, default_branch, is_private, last_indexed_commit, provider")
          .eq("id", project.github_repo_id).single()
      : Promise.resolve({ data: null }),
    admin.from("project_members")
      .select("id, user_id, role, joined_at")
      .eq("project_id", params.id)
      .order("joined_at", { ascending: true }),
  ]);

  // Enrich members with profile info
  const rawMembers = (membersRes.data ?? []) as { id: string; user_id: string; role: string; joined_at: string }[];
  let members: unknown[] = rawMembers;
  if (rawMembers.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, display_name, avatar_url, email")
      .in("id", rawMembers.map((m) => m.user_id));
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
    members = rawMembers.map((m) => ({
      ...m,
      profile: profileMap.get(m.user_id) ?? null,
      is_self: m.user_id === user.id,
    }));
  }

  const myMembership = rawMembers.find((m) => m.user_id === user.id);

  return NextResponse.json({
    project: {
      ...project,
      repo: (repoRes as { data: unknown }).data ?? null,
      member_count: rawMembers.length,
      is_owner: myMembership?.role === "owner",
      is_member: !!myMembership,
    },
    snapshots: snapsRes.data ?? [],
    members,
  });
}

/**
 * PATCH /api/projects/[id]
 * Rename project or update description.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name) updates.name = (body.name as string).trim().slice(0, 100);
  if (body.description !== undefined) updates.description = body.description;

  const admin = createAdminClient();
  const { data, error: upErr } = await admin
    .from("projects")
    .update(updates)
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .select("id, name, description")
    .single();

  if (upErr || !data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json({ project: data });
}

/**
 * DELETE /api/projects/[id]
 * Deletes a project. Snapshots get project_id = NULL (not deleted).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });
  if (!["owner", "admin"].includes(profile.role ?? "")) {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const admin = createAdminClient();
  await admin
    .from("context_snapshots")
    .update({ project_id: null })
    .eq("project_id", params.id);
  await admin.from("projects").delete().eq("id", params.id).eq("team_id", profile.team_id);
  return NextResponse.json({ ok: true });
}
