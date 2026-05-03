import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/team
 * Returns the caller's current team + member roster + role.
 */
export async function GET() {
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

  const admin = createAdminClient();
  const [{ data: team }, { data: members }] = await Promise.all([
    admin.from("teams").select("id, name, slug, created_at").eq("id", profile.team_id).single(),
    admin
      .from("profiles")
      .select("id, email, full_name, avatar_url, role")
      .eq("team_id", profile.team_id)
      .order("role", { ascending: true }),
  ]);

  return NextResponse.json({
    team,
    role: profile.role ?? "member",
    members: members ?? [],
    memberCount: members?.length ?? 0,
  });
}
