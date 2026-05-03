import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { generateInviteCode } from "@/lib/invites";
import { getPublicOrigin } from "@/lib/origin";

/**
 * POST /api/team/invite
 * body: { max_uses?: number, expires_in_hours?: number }
 *
 * Owner/admin only. Generates a fresh invite code for the caller's team.
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id)
    return NextResponse.json({ error: "No team" }, { status: 400 });
  if (!profile.role || !["owner", "admin"].includes(profile.role))
    return NextResponse.json(
      { error: "Only owners or admins can create invites" },
      { status: 403 }
    );

  let body: { max_uses?: number; expires_in_hours?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const maxUses = Math.max(1, Math.min(100, body.max_uses ?? 5));
  const expiresInHours =
    body.expires_in_hours === undefined
      ? 24 * 7 // default 7 days
      : Math.max(1, Math.min(24 * 30, body.expires_in_hours));
  const expiresAt = new Date(
    Date.now() + expiresInHours * 60 * 60 * 1000
  ).toISOString();

  const code = generateInviteCode(10);

  const admin = createAdminClient();
  const { data: invite, error } = await admin
    .from("team_invites")
    .insert({
      team_id: profile.team_id,
      code,
      created_by: user.id,
      expires_at: expiresAt,
      max_uses: maxUses,
    })
    .select("id, code, expires_at, max_uses, use_count, created_at")
    .single();

  if (error || !invite) {
    console.error("[invite create] failed:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }

  const origin = getPublicOrigin(req);
  return NextResponse.json({
    invite,
    url: `${origin}/team/join/${invite.code}`,
  });
}
