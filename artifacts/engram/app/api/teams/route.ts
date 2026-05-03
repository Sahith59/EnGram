import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/teams
 * Returns every team the caller is a member of, with role, member count,
 * personal flag, and active flag.
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

  const admin = createAdminClient();
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    admin.from("profiles").select("team_id").eq("id", user.id).single(),
    admin
      .from("team_members")
      .select("team_id, role, joined_at, teams(id, name, slug, personal_for)")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: true }),
  ]);

  const activeTeamId = profile?.team_id ?? null;
  const teamIds = (memberships ?? []).map((m) => m.team_id);

  // Fetch member counts in one round trip
  const counts: Record<string, number> = {};
  if (teamIds.length > 0) {
    const { data: countRows } = await admin
      .from("team_members")
      .select("team_id")
      .in("team_id", teamIds);
    for (const r of countRows ?? []) {
      counts[r.team_id] = (counts[r.team_id] ?? 0) + 1;
    }
  }

  const teams = (memberships ?? [])
    .map((m) => {
      const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
      if (!t) return null;
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        role: m.role,
        memberCount: counts[t.id] ?? 1,
        isPersonal: t.personal_for === user.id,
        isActive: t.id === activeTeamId,
        joinedAt: m.joined_at,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    // Personal first, then alphabetical by name
    .sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return NextResponse.json({ teams, activeTeamId });
}

/**
 * POST /api/teams
 * body: { name: string }
 *
 * Creates a fresh shared team. Caller becomes owner. The new team
 * becomes the caller's active team. Existing captures stay where they are.
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

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name || name.length < 2 || name.length > 60) {
    return NextResponse.json({ error: "Team name must be 2–60 characters" }, { status: 400 });
  }

  const admin = createAdminClient();
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "team";
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: team, error: teamErr } = await admin
    .from("teams")
    .insert({ name, slug })
    .select("id, name, slug")
    .single();
  if (teamErr || !team) {
    console.error("[teams create] insert failed:", teamErr);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }

  // Add caller as owner member
  const { error: memberErr } = await admin
    .from("team_members")
    .insert({ team_id: team.id, user_id: user.id, role: "owner" });
  if (memberErr) {
    console.error("[teams create] member insert failed:", memberErr);
    await admin.from("teams").delete().eq("id", team.id); // rollback
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }

  // Switch caller's active team to the new team
  await admin.rpc("switch_active_team", { p_user_id: user.id, p_team_id: team.id });

  return NextResponse.json({ team: { ...team, role: "owner", isPersonal: false, isActive: true, memberCount: 1 } });
}
