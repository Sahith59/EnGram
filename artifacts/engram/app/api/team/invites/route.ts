import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/team/invites
 * Returns active (non-revoked, non-expired, not exhausted) invites
 * for the caller's team. Owners/admins only.
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
  if (!profile.role || !["owner", "admin"].includes(profile.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("team_invites")
    .select("id, code, created_at, expires_at, max_uses, use_count, revoked_at, created_by")
    .eq("team_id", profile.team_id)
    .order("created_at", { ascending: false });

  const now = Date.now();
  const invites = (rows ?? []).map((r) => {
    const expired = r.expires_at && new Date(r.expires_at).getTime() < now;
    const exhausted = r.use_count >= r.max_uses;
    const status = r.revoked_at
      ? "revoked"
      : expired
        ? "expired"
        : exhausted
          ? "exhausted"
          : "active";
    return { ...r, status };
  });

  return NextResponse.json({ invites });
}
