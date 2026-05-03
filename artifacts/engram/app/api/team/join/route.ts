import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { validateInvite } from "@/lib/invites";

/**
 * POST /api/team/join
 * body: { code: string }
 *
 * Consumes an invite, moves the caller's snapshots from their old team
 * to the new team, deletes the old (now-empty) team, increments the
 * invite use_count.
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

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const code = body.code?.trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("team_invites")
    .select("id, team_id, code, expires_at, max_uses, use_count, revoked_at")
    .eq("code", code)
    .maybeSingle();

  const v = validateInvite(invite ?? undefined);
  if (!v.valid || !invite) {
    return NextResponse.json(
      { error: v.reason ?? "Invite invalid" },
      { status: 400 }
    );
  }

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!callerProfile)
    return NextResponse.json({ error: "Profile missing" }, { status: 400 });

  if (callerProfile.team_id === invite.team_id) {
    return NextResponse.json(
      { error: "You are already a member of this team." },
      { status: 400 }
    );
  }

  const oldTeamId = callerProfile.team_id;

  // 0. Atomically claim a use slot via Postgres RPC. The function does the
  // validity check + use_count increment in one statement — concurrent
  // callers race for the slot at the DB level, so we cannot over-claim
  // past max_uses. Returns null if revoked/expired/exhausted in the
  // moment between the earlier preview check and the actual claim.
  const { data: claimedTeamId, error: claimErr } = await admin.rpc(
    "claim_team_invite",
    { p_code: code }
  );
  if (claimErr) {
    console.error("[join] claim_team_invite rpc failed:", claimErr);
    return NextResponse.json({ error: "Failed to claim invite" }, { status: 500 });
  }
  if (!claimedTeamId) {
    return NextResponse.json(
      { error: "This invite was just used up by someone else. Ask for a new link." },
      { status: 409 }
    );
  }

  // 1. Move caller's snapshots to the new team (preserve visibility).
  if (oldTeamId) {
    await admin
      .from("context_snapshots")
      .update({ team_id: invite.team_id })
      .eq("created_by", user.id)
      .eq("team_id", oldTeamId);
  }

  // 2. Switch caller's profile to the new team as a member.
  const { error: profErr } = await admin
    .from("profiles")
    .update({ team_id: invite.team_id, role: "member" })
    .eq("id", user.id);
  if (profErr) {
    console.error("[join] profile update failed:", profErr);
    return NextResponse.json({ error: "Failed to join" }, { status: 500 });
  }

  // 3. Delete the old (now-empty) team if no other members & no snapshots.
  if (oldTeamId) {
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
      // Cascade-clean any orphaned invites/queries first
      await admin.from("team_invites").delete().eq("team_id", oldTeamId);
      await admin.from("teams").delete().eq("id", oldTeamId);
    }
  }

  // (use_count was atomically claimed at step 0)

  const { data: newTeam } = await admin
    .from("teams")
    .select("id, name, slug")
    .eq("id", invite.team_id)
    .single();

  return NextResponse.json({
    success: true,
    team: newTeam,
  });
}
