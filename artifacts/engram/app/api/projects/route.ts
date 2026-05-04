import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const DORMANT_DAYS = 90;

/**
 * GET /api/projects
 * List projects for the team, enriched with repo info + members + recent snapshots.
 * Phase 13: adds is_archived, last_capture_at, is_dormant.
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

  // Try with is_archived column (Phase 13 migration), fall back gracefully
  let projects: Record<string, unknown>[] | null = null;
  let hasArchivedCol = false;
  let migration_needed = false;

  const { data: p1, error: pErr1 } = await admin
    .from("projects")
    .select("id, name, description, snapshot_count, created_at, updated_at, github_repo_id, created_by, is_archived")
    .eq("team_id", profile.team_id)
    .order("updated_at", { ascending: false });

  if (!pErr1) {
    projects = (p1 ?? []) as Record<string, unknown>[];
    hasArchivedCol = true;
  } else {
    // Try without is_archived (migration 0015 not applied yet)
    const { data: p2, error: pErr2 } = await admin
      .from("projects")
      .select("id, name, description, snapshot_count, created_at, updated_at, github_repo_id, created_by")
      .eq("team_id", profile.team_id)
      .order("updated_at", { ascending: false });

    if (pErr2) {
      // Try minimal fallback
      if (pErr2.message.includes("github_repo_id") || pErr2.message.includes("created_by")) {
        const { data: fallback } = await admin
          .from("projects")
          .select("id, name, description, snapshot_count, created_at, updated_at")
          .eq("team_id", profile.team_id)
          .order("updated_at", { ascending: false });
        return NextResponse.json({ projects: fallback ?? [], migration_needed: true });
      }
      return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
    }
    projects = (p2 ?? []) as Record<string, unknown>[];
    migration_needed = true; // 0015 not applied
  }

  const now = Date.now();

  const enriched = await Promise.all(
    (projects ?? []).map(async (proj) => {
      const [repoRes, membersRes, snapsRes] = await Promise.all([
        proj.github_repo_id
          ? admin.from("github_repos")
              .select("id, repo_full_name, repo_name, owner_login, file_count, chunk_count, indexed_at, default_branch, is_private")
              .eq("id", proj.github_repo_id as string).single()
          : Promise.resolve({ data: null }),
        admin.from("project_members")
          .select("user_id, role")
          .eq("project_id", proj.id as string)
          .order("joined_at", { ascending: true }),
        admin.from("context_snapshots")
          .select("id, title, ai_tool, created_at, author_handle")
          .eq("project_id", proj.id as string)
          .order("created_at", { ascending: false }).limit(3),
      ]);

      const members = (membersRes as { data: { user_id: string; role: string }[] | null }).data ?? [];
      const recentSnaps = snapsRes.data ?? [];
      const lastCaptureAt = recentSnaps[0]?.created_at ?? null;

      const isDormant = lastCaptureAt
        ? now - new Date(lastCaptureAt).getTime() > DORMANT_DAYS * 24 * 60 * 60 * 1000
        : (proj.snapshot_count as number) === 0;

      const isArchived = hasArchivedCol ? !!(proj.is_archived) : false;

      return {
        ...proj,
        is_archived: isArchived,
        last_capture_at: lastCaptureAt,
        is_dormant: isDormant,
        days_since_capture: lastCaptureAt
          ? Math.floor((now - new Date(lastCaptureAt).getTime()) / (24 * 60 * 60 * 1000))
          : null,
        repo: (repoRes as { data: unknown }).data ?? null,
        members,
        member_count: members.length,
        recent_snapshots: recentSnaps,
        is_owner: members.some((m) => m.user_id === user.id && m.role === "owner"),
        is_member: members.some((m) => m.user_id === user.id),
      };
    })
  );

  return NextResponse.json({ projects: enriched, migration_needed });
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
