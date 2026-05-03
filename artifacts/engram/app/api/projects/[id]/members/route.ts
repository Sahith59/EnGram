import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type Params = { params: { id: string } };

/**
 * GET /api/projects/[id]/members
 * Returns all members of a project with their profile info.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Verify caller is a team member (can see this project)
  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const { data: project } = await admin.from("projects").select("id, team_id").eq("id", params.id).single();
  if (!project || project.team_id !== profile.team_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: members } = await admin
    .from("project_members")
    .select("id, user_id, role, joined_at, invited_by")
    .eq("project_id", params.id)
    .order("joined_at", { ascending: true });

  if (!members?.length) return NextResponse.json({ members: [] });

  // Enrich with profile info
  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, email, avatar_url, display_name")
    .in("id", userIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const enriched = members.map((m) => ({
    ...m,
    profile: profileMap.get(m.user_id) ?? null,
    is_self: m.user_id === user.id,
  }));

  return NextResponse.json({ members: enriched });
}

/**
 * POST /api/projects/[id]/members
 * Adds a user directly to the project (by user_id) or creates an invite link.
 * body: { user_id?: string, generate_invite?: boolean }
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, team_id").eq("id", params.id).single();
  if (!project || project.team_id !== profile.team_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only project owners can add members
  const { data: myMembership } = await admin
    .from("project_members")
    .select("role")
    .eq("project_id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!myMembership || myMembership.role !== "owner") {
    return NextResponse.json({ error: "Only project owners can manage members" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Option A: direct add by user_id
  if (body.user_id) {
    const { error: insErr } = await admin.from("project_members").upsert({
      project_id: params.id,
      user_id: body.user_id,
      role: body.role ?? "member",
      invited_by: user.id,
    }, { onConflict: "project_id,user_id" });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Option B: generate a team invite link (uses existing invite system)
  // The invite link grants access to the team; project membership is granted
  // separately by the owner after the user joins the team.
  if (body.generate_invite) {
    const { generateInviteCode } = await import("@/lib/invites");
    const { getPublicOrigin } = await import("@/lib/origin");
    const code = generateInviteCode(10);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invite } = await admin.from("team_invites").insert({
      team_id: profile.team_id,
      code,
      max_uses: 1,
      expires_at: expiresAt,
      created_by: user.id,
    }).select("code").single();

    if (!invite) return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });

    const origin = getPublicOrigin(req);
    return NextResponse.json({
      ok: true,
      invite_url: `${origin}/join/${invite.code}`,
      code: invite.code,
    });
  }

  return NextResponse.json({ error: "Provide user_id or generate_invite" }, { status: 400 });
}

/**
 * DELETE /api/projects/[id]/members?user_id=xxx
 * Removes a member from the project.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const targetUserId = req.nextUrl.searchParams.get("user_id");
  if (!targetUserId) return NextResponse.json({ error: "user_id required" }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();
  const { data: project } = await admin.from("projects").select("id, team_id").eq("id", params.id).single();
  if (!project || project.team_id !== profile.team_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only owners can remove members, or a member can remove themselves
  const { data: myMembership } = await admin
    .from("project_members").select("role").eq("project_id", params.id).eq("user_id", user.id).maybeSingle();
  if (!myMembership) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  if (myMembership.role !== "owner" && targetUserId !== user.id) {
    return NextResponse.json({ error: "Only owners can remove other members" }, { status: 403 });
  }

  await admin.from("project_members").delete().eq("project_id", params.id).eq("user_id", targetUserId);
  return NextResponse.json({ ok: true });
}
