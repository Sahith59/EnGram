import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * POST /api/team/leave
 * body: { team_id?: string }   (defaults to active team)
 *
 * Multi-team semantics:
 *  - You cannot leave your personal workspace.
 *  - Sole owners with other members must transfer ownership first.
 *  - Removes your team_members row.
 *  - If the team is now empty, deletes the team (and its invites).
 *  - If you left your active team, switches active to your personal team.
 *
 * Note: team-visibility captures you authored stay in the team (the team
 * keeps the shared knowledge). Your personal captures already live in
 * your personal team and are unaffected.
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

  let body: { team_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* body optional */
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile missing" }, { status: 400 });

  const targetTeamId = body.team_id?.trim() || profile.team_id;
  if (!targetTeamId) return NextResponse.json({ error: "No team to leave" }, { status: 400 });

  // Verify membership and load target team
  const [{ data: membership }, { data: team }] = await Promise.all([
    admin
      .from("team_members")
      .select("role")
      .eq("team_id", targetTeamId)
      .eq("user_id", user.id)
      .maybeSingle(),
    admin
      .from("teams")
      .select("id, name, personal_for")
      .eq("id", targetTeamId)
      .single(),
  ]);

  if (!membership || !team) {
    return NextResponse.json({ error: "Not a member of that team" }, { status: 404 });
  }

  // Block: cannot leave your personal workspace
  if (team.personal_for === user.id) {
    return NextResponse.json(
      { error: "Your personal workspace can't be left." },
      { status: 403 }
    );
  }

  // Block: sole owner with other members → must transfer ownership first
  if (membership.role === "owner") {
    const [{ count: otherOwners }, { count: otherMembers }] = await Promise.all([
      admin
        .from("team_members")
        .select("user_id", { count: "exact", head: true })
        .eq("team_id", targetTeamId)
        .eq("role", "owner")
        .neq("user_id", user.id),
      admin
        .from("team_members")
        .select("user_id", { count: "exact", head: true })
        .eq("team_id", targetTeamId)
        .neq("user_id", user.id),
    ]);
    if ((otherMembers ?? 0) > 0 && (otherOwners ?? 0) === 0) {
      return NextResponse.json(
        {
          error:
            "You're the only owner — promote another member to owner first, or remove the others.",
        },
        { status: 403 }
      );
    }
  }

  // Remove membership
  const { error: delErr } = await admin
    .from("team_members")
    .delete()
    .eq("team_id", targetTeamId)
    .eq("user_id", user.id);
  if (delErr) {
    console.error("[leave] member delete failed:", delErr);
    return NextResponse.json({ error: "Failed to leave" }, { status: 500 });
  }

  // If the team has zero members left, delete it (and its invites)
  let teamDeleted = false;
  const { count: remaining } = await admin
    .from("team_members")
    .select("user_id", { count: "exact", head: true })
    .eq("team_id", targetTeamId);
  if ((remaining ?? 0) === 0) {
    await admin.from("team_invites").delete().eq("team_id", targetTeamId);
    await admin.from("teams").delete().eq("id", targetTeamId);
    teamDeleted = true;
  }

  // If we left our active team, switch active to our personal team
  let switchedTo: { id: string; name: string } | null = null;
  if (profile.team_id === targetTeamId) {
    const { data: personal } = await admin
      .from("teams")
      .select("id, name")
      .eq("personal_for", user.id)
      .maybeSingle();
    if (personal) {
      await admin.rpc("switch_active_team", {
        p_user_id: user.id,
        p_team_id: personal.id,
      });
      switchedTo = personal;
    }
  }

  return NextResponse.json({ success: true, teamDeleted, switchedTo });
}
