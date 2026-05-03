import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * POST /api/team/switch
 * body: { team_id: string }
 *
 * Changes the caller's active team. Must be a member of the target team.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { team_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const teamId = body.team_id?.trim();
  if (!teamId) {
    return NextResponse.json({ error: "team_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: ok, error } = await admin.rpc("switch_active_team", {
    p_user_id: user.id,
    p_team_id: teamId,
  });
  if (error) {
    console.error("[switch] rpc failed:", error);
    return NextResponse.json({ error: "Switch failed" }, { status: 500 });
  }
  if (!ok) {
    return NextResponse.json(
      { error: "You are not a member of that team" },
      { status: 403 }
    );
  }

  const { data: team } = await admin
    .from("teams")
    .select("id, name, slug")
    .eq("id", teamId)
    .single();

  return NextResponse.json({ success: true, team });
}
