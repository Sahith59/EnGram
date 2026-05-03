import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/projects
 * List projects for the team, enriched with repo info + members + recent snapshots.
 */
export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();
  const { data: projects, error: pErr } = await admin
    .from("projects")
    .select("id, name, description, snapshot_count, created_at, updated_at, github_repo_id, created_by")
    .eq("team_id", profile.team_id)
    .order("updated_at", { ascending: false });

  if (pErr) {
    // Column doesn't exist yet (migration not applied) — fallback
    if (pErr.message.includes("github_repo_id") || pErr.message.includes("created_by")) {
      const { data: fallback } = await admin
        .from("projects")
        .select("id, name, description, snapshot_count, created_at, updated_at")
        .eq("team_id", profile.team_id)
        .order("updated_at", { ascending: false });
      return NextResponse.json({ projects: fallback ?? [], migration_needed: true });
    }
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }

  const enriched = await Promise.all(
    (projects ?? []).map(async (proj) => {
      const [repoRes, membersRes, snapsRes] = await Promise.all([
        proj.github_repo_id
          ? admin.from("github_repos")
              .select("id, repo_full_name, repo_name, owner_login, file_count, chunk_count, indexed_at, default_branch, is_private")
              .eq("id", proj.github_repo_id).single()
          : Promise.resolve({ data: null }),
        admin.from("project_members")
          .select("user_id, role")
          .eq("project_id", proj.id)
          .order("joined_at", { ascending: true }),
        admin.from("context_snapshots")
          .select("id, title, ai_tool, created_at, author_handle")
          .eq("project_id", proj.id)
          .order("created_at", { ascending: false }).limit(3),
      ]);

      const members = (membersRes as { data: { user_id: string; role: string }[] | null }).data ?? [];
      return {
        ...proj,
        repo: (repoRes as { data: unknown }).data ?? null,
        members,
        member_count: members.length,
        recent_snapshots: snapsRes.data ?? [],
        is_owner: members.some((m) => m.user_id === user.id && m.role === "owner"),
        is_member: members.some((m) => m.user_id === user.id),
      };
    })
  );

  return NextResponse.json({ projects: enriched });
}

/**
 * POST /api/projects
 * Create a project (optionally linked to a GitHub repo).
 * Auto-adds creator as project owner.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const name = (body.name as string)?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error: insErr } = await admin
    .from("projects")
    .insert({
      team_id: profile.team_id,
      name,
      description: body.description ?? null,
      github_repo_id: body.github_repo_id ?? null,
      created_by: user.id,
    })
    .select("id, name, description, snapshot_count, created_at, github_repo_id")
    .single();

  if (insErr || !data) return NextResponse.json({ error: insErr?.message ?? "Insert failed" }, { status: 500 });

  // Auto-add creator as project owner in project_members
  try {
    await admin.from("project_members").upsert({
      project_id: data.id,
      user_id: user.id,
      role: "owner",
    }, { onConflict: "project_id,user_id" });
  } catch { /* project_members table may not exist yet */ }

  return NextResponse.json({ project: data }, { status: 201 });
}
