import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * POST /api/team/invite/[code]/revoke
 * Owner/admin marks an invite as revoked. Idempotent.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id)
    return NextResponse.json({ error: "No team" }, { status: 400 });
  if (!profile.role || !["owner", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { code } = await ctx.params;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("team_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("code", code.trim().toUpperCase())
    .eq("team_id", profile.team_id) // scope to caller's team
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[invite revoke] failed:", error);
    return NextResponse.json({ error: "Revoke failed" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
