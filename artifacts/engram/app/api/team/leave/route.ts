import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * POST /api/team/leave
 *
 * The caller leaves their current team. Their snapshots move to a fresh
 * personal workspace. Owners with other members must transfer ownership
 * first (not yet implemented — they get 403).
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("team_id, role, email, full_name")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id)
    return NextResponse.json({ error: "No team to leave" }, { status: 400 });

  const oldTeamId = profile.team_id;

  // Block owners with other members from leaving outright.
  if (profile.role === "owner") {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("team_id", oldTeamId)
      .neq("id", user.id);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "You're the owner — remove or transfer ownership before leaving.",
        },
        { status: 403 }
      );
    }
  }

  // Spin up a fresh personal workspace for the caller.
  const handle = (profile.email ? profile.email.split("@")[0] : "personal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "personal";
  const slug = `${handle}-${user.id.slice(0, 8)}-${Date.now().toString(36).slice(-4)}`;
  const { data: newTeam, error: teamErr } = await admin
    .from("teams")
    .insert({ name: `${handle}'s workspace`, slug })
    .select("id, name, slug")
    .single();
  if (teamErr || !newTeam) {
    console.error("[leave] new team creation failed:", teamErr);
    return NextResponse.json({ error: "Failed to leave" }, { status: 500 });
  }

  // Move caller's snapshots to the new personal team.
  await admin
    .from("context_snapshots")
    .update({ team_id: newTeam.id })
    .eq("created_by", user.id)
    .eq("team_id", oldTeamId);

  // Switch profile.
  await admin
    .from("profiles")
    .update({ team_id: newTeam.id, role: "owner" })
    .eq("id", user.id);

  // Clean up old team if it's now empty (no other members AND no snapshots).
  const [{ count: remainingMembers }, { count: remainingSnaps }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("team_id", oldTeamId),
      admin
        .from("context_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("team_id", oldTeamId),
    ]);
  if ((remainingMembers ?? 0) === 0 && (remainingSnaps ?? 0) === 0) {
    await admin.from("team_invites").delete().eq("team_id", oldTeamId);
    await admin.from("teams").delete().eq("id", oldTeamId);
  }

  return NextResponse.json({ success: true, team: newTeam });
}
