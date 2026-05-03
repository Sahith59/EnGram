import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * POST /api/team/join
 * body: { code: string }
 *
 * Multi-team semantics: ADDS membership to the invite's team without
 * disturbing the caller's personal workspace or other team memberships.
 * The new team becomes the caller's active team.
 *
 * The atomic claim+insert lives in the redeem_team_invite RPC, so we
 * cannot over-claim past max_uses under concurrent joins.
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
  const { data: rows, error: redeemErr } = await admin.rpc("redeem_team_invite", {
    p_code: code,
    p_user_id: user.id,
  });
  if (redeemErr) {
    console.error("[join] redeem rpc failed:", redeemErr);
    return NextResponse.json({ error: "Failed to join" }, { status: 500 });
  }

  // RPC returns table(team_id uuid, already_member boolean) — empty if invalid/exhausted
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result?.team_id) {
    return NextResponse.json(
      { error: "Invite invalid, expired, revoked, or already used up." },
      { status: 400 }
    );
  }

  // Switch active team to the joined team (whether new join or already member)
  await admin.rpc("switch_active_team", {
    p_user_id: user.id,
    p_team_id: result.team_id,
  });

  const { data: team } = await admin
    .from("teams")
    .select("id, name, slug")
    .eq("id", result.team_id)
    .single();

  return NextResponse.json({
    success: true,
    team,
    alreadyMember: !!result.already_member,
  });
}
