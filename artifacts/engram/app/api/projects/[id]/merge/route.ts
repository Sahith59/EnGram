import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { updateCentroid } from "@/lib/clustering";

/**
 * POST /api/projects/[id]/merge
 * body: { targetProjectId: string }
 *
 * Merges the project at [id] INTO targetProjectId:
 *  - All snapshots in [id] get project_id = targetProjectId
 *  - The target centroid is recomputed as a weighted average
 *  - [id] is deleted
 */
export async function POST(
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

  const body = await request.json().catch(() => ({}));
  const { targetProjectId } = body as { targetProjectId?: string };
  if (!targetProjectId) {
    return NextResponse.json({ error: "targetProjectId is required" }, { status: 400 });
  }
  if (targetProjectId === params.id) {
    return NextResponse.json({ error: "Cannot merge a project with itself" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify both projects belong to this team
  const { data: projects } = await admin
    .from("projects")
    .select("id, name, centroid, snapshot_count")
    .in("id", [params.id, targetProjectId])
    .eq("team_id", profile.team_id);

  if (!projects || projects.length !== 2) {
    return NextResponse.json({ error: "One or both projects not found" }, { status: 404 });
  }

  const src = projects.find((p) => p.id === params.id)!;
  const tgt = projects.find((p) => p.id === targetProjectId)!;

  // Reassign all snapshots from src → tgt
  await admin
    .from("context_snapshots")
    .update({ project_id: targetProjectId })
    .eq("project_id", params.id);

  // Recompute target centroid as weighted blend of both centroids
  if (src.centroid && tgt.centroid) {
    const srcCount = src.snapshot_count ?? 0;
    const tgtCount = tgt.snapshot_count ?? 0;
    const totalCount = srcCount + tgtCount;
    if (totalCount > 0) {
      // Weighted average: each centroid represents the mean of its cluster
      const newCentroid = (src.centroid as unknown as number[]).map(
        (v, i) =>
          (v * srcCount + (tgt.centroid as unknown as number[])[i] * tgtCount) /
          totalCount
      );
      await admin
        .from("projects")
        .update({
          centroid: newCentroid as unknown as string,
          snapshot_count: totalCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetProjectId);
    }
  }

  // Delete source project
  await admin.from("projects").delete().eq("id", params.id);

  return NextResponse.json({
    ok: true,
    merged: { from: src.name, into: tgt.name },
  });
}
