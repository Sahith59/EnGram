import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * POST /api/capture/reassign
 * Moves a captured snapshot to a different project.
 * Used by the extension popup "Wrong repo?" one-click correction.
 *
 * Body: { snapshotId: string, projectId: string }
 * Returns: { ok: true, project: { id, name } }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return withCors(
      NextResponse.json({ error: "Supabase not configured" }, { status: 503 }),
      request
    );
  }

  let body: { snapshotId?: string; projectId?: string };
  try {
    body = await request.json();
  } catch {
    return withCors(
      NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
      request
    );
  }

  const { snapshotId, projectId } = body;
  if (!snapshotId || !projectId) {
    return withCors(
      NextResponse.json({ error: "Missing snapshotId or projectId" }, { status: 400 }),
      request
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return withCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      request
    );
  }

  const admin = createAdminClient();

  // Verify ownership: the snapshot must belong to this user's team
  const { data: snapshot } = await admin
    .from("context_snapshots")
    .select("id, team_id, created_by")
    .eq("id", snapshotId)
    .maybeSingle();

  if (!snapshot) {
    return withCors(
      NextResponse.json({ error: "Snapshot not found" }, { status: 404 }),
      request
    );
  }

  // Verify the user is a member of the snapshot's team
  const { data: membership } = await admin
    .from("team_members")
    .select("team_id")
    .eq("team_id", snapshot.team_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return withCors(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      request
    );
  }

  // Verify the target project belongs to the same team
  const { data: project } = await admin
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("team_id", snapshot.team_id)
    .maybeSingle();

  if (!project) {
    return withCors(
      NextResponse.json({ error: "Project not found or not in your team" }, { status: 404 }),
      request
    );
  }

  // Move the snapshot
  const { error: updateErr } = await admin
    .from("context_snapshots")
    .update({ project_id: projectId, updated_at: new Date().toISOString() })
    .eq("id", snapshotId);

  if (updateErr) {
    console.error("[reassign] update failed:", updateErr);
    return withCors(
      NextResponse.json({ error: "Failed to reassign snapshot" }, { status: 500 }),
      request
    );
  }

  return withCors(
    NextResponse.json({ ok: true, project: { id: project.id, name: project.name } }),
    request
  );
}
