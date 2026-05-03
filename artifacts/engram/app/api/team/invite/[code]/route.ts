import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { validateInvite } from "@/lib/invites";

/**
 * GET /api/team/invite/[code]
 * Auth required. Returns a preview of what the caller would be joining
 * (team name + inviter handle), plus a validity flag with a human reason.
 *
 * Uses admin client to bypass RLS — the invitee isn't yet a member of
 * the target team and so can't read team_invites under normal RLS.
 */
export async function GET(
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

  const { code } = await ctx.params;
  if (!code || typeof code !== "string")
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("team_invites")
    .select("id, team_id, code, expires_at, max_uses, use_count, revoked_at, created_by")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  const validation = validateInvite(invite ?? undefined);

  if (!invite) {
    return NextResponse.json({ valid: false, reason: validation.reason });
  }

  const [{ data: team }, { data: inviter }, { data: existingMembership }] = await Promise.all([
    admin.from("teams").select("id, name, slug").eq("id", invite.team_id).single(),
    admin.from("profiles").select("email, full_name").eq("id", invite.created_by).maybeSingle(),
    admin
      .from("team_members")
      .select("team_id")
      .eq("team_id", invite.team_id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const alreadyMember = !!existingMembership;

  return NextResponse.json({
    valid: validation.valid && !alreadyMember,
    reason: alreadyMember
      ? "You are already a member of this team."
      : validation.reason,
    team: team ? { name: team.name, slug: team.slug } : null,
    inviter: inviter
      ? { handle: inviter.full_name || inviter.email?.split("@")[0] || "someone" }
      : null,
    expires_at: invite.expires_at,
    uses_remaining: Math.max(0, invite.max_uses - invite.use_count),
  });
}
