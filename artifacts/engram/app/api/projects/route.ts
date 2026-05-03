import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/projects
 * List all projects for the authenticated user's team.
 * Returns projects with their snapshot count and latest snapshot title.
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

  const admin = createAdminClient();
  const { data: projects, error: pErr } = await admin
    .from("projects")
    .select("id, name, description, snapshot_count, created_at, updated_at")
    .eq("team_id", profile.team_id)
    .order("updated_at", { ascending: false });

  if (pErr) {
    console.error("[projects GET]", pErr);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }

  // For each project, fetch the 3 most recent snapshot titles
  const enriched = await Promise.all(
    (projects ?? []).map(async (proj) => {
      const { data: snaps } = await admin
        .from("context_snapshots")
        .select("id, title, ai_tool, created_at")
        .eq("project_id", proj.id)
        .order("created_at", { ascending: false })
        .limit(3);
      return { ...proj, recent_snapshots: snaps ?? [] };
    })
  );

  return NextResponse.json({ projects: enriched });
}

/**
 * POST /api/projects
 * Manually create a project.
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

  const body = await request.json().catch(() => ({}));
  const name = (body.name as string)?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error: insErr } = await admin
    .from("projects")
    .insert({ team_id: profile.team_id, name, description: body.description ?? null })
    .select("id, name, description, snapshot_count, created_at")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ project: data }, { status: 201 });
}
