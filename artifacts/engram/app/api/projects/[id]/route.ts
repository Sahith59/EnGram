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
    .select("id, name, description, snapshot_count, created_at, updated_at")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();

  if (pErr || !project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: snapshots } = await admin
    .from("context_snapshots")
    .select(
      "id, title, summary, ai_tool, tags, decision, created_at, visibility, author_handle, created_by"
    )
    .eq("project_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ project, snapshots: snapshots ?? [] });
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
