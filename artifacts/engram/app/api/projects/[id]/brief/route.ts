/**
 * GET /api/projects/[id]/brief
 * Returns the trustworthy structured brief for a project.
 * Includes claims grouped by type, staleness flags, conflicts, and
 * injection-ready markdown at three token sizes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { generateProjectBrief } from "@/lib/brief-generator";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the user belongs to the project's team
  const { data: proj } = await supabase
    .from("projects")
    .select("id, team_id")
    .eq("id", params.id)
    .single();

  if (!proj) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("team_id", proj.team_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const brief = await generateProjectBrief(params.id);
  if (!brief) {
    return NextResponse.json({ error: "Brief generation failed" }, { status: 500 });
  }

  return NextResponse.json(brief, {
    headers: { "Cache-Control": "no-store" },
  });
}
