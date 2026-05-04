/**
 * GET /api/projects/{id}/routing-stats
 * Returns routing stats for a project (F-14: adaptive threshold).
 *
 * POST /api/projects/{id}/routing-stats/calibrate
 * Manually reset the threshold to the default (owner only).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { DEFAULT_THRESHOLD } from "@/lib/routing-threshold";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const projectId = params.id;

  // Verify user is a member of this project's team
  const { data: project } = await admin
    .from("projects")
    .select("id, name, team_id, github_repo_id")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: profile } = await admin
    .from("profiles").select("team_id").eq("id", user.id).single();
  if (profile?.team_id !== project.team_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get routing stats (may not exist yet if migration 0016 not applied)
  let stats = null;
  try {
    const { data } = await admin
      .from("project_routing_stats")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    stats = data;
  } catch {
    // Migration not applied yet
  }

  const hitRate = stats
    ? stats.routing_attempts > 0
      ? Math.round((stats.routing_hits / stats.routing_attempts) * 100)
      : null
    : null;

  return NextResponse.json({
    project_id: projectId,
    project_name: project.name,
    has_repo: !!project.github_repo_id,
    stats: stats ?? {
      routing_attempts: 0,
      routing_hits: 0,
      avg_similarity: null,
      threshold_override: DEFAULT_THRESHOLD,
      last_calibrated_at: null,
    },
    hit_rate_pct: hitRate,
    default_threshold: DEFAULT_THRESHOLD,
    effective_threshold: stats?.threshold_override ?? DEFAULT_THRESHOLD,
    migration_needed: stats === null && !project.github_repo_id
      ? false
      : stats === null,
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const projectId = params.id;

  // Verify owner role
  const { data: member } = await admin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const now = new Date().toISOString();
  await admin
    .from("project_routing_stats")
    .update({
      threshold_override: DEFAULT_THRESHOLD,
      last_calibrated_at: now,
      updated_at: now,
    })
    .eq("project_id", projectId);

  return NextResponse.json({ ok: true, threshold_override: DEFAULT_THRESHOLD });
}
