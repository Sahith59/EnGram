import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { saveGithubToken, getGithubToken } from "@/lib/github";

/**
 * GET /api/github/connect
 * Returns whether GitHub is connected for this team.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = await import("@/lib/supabase/admin").then(m => m.createAdminClient());
  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("team_id", profile.team_id)
    .eq("type", "github")
    .maybeSingle();
  const config = integration?.config as { pat?: string; github_login?: string } | null;
  return NextResponse.json({
    connected: !!config?.pat,
    login: config?.github_login ?? null,
  });
}

/**
 * POST /api/github/connect
 * body: { pat: string }
 * Validates and saves a GitHub Personal Access Token.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const pat = (body.pat as string)?.trim();
  if (!pat) return NextResponse.json({ error: "pat is required" }, { status: 400 });

  try {
    await saveGithubToken(profile.team_id, pat, user.id);
    // Return the github_login that saveGithubToken stored
    const admin2 = await import("@/lib/supabase/admin").then(m => m.createAdminClient());
    const { data: integration } = await admin2
      .from("integrations")
      .select("config")
      .eq("team_id", profile.team_id)
      .eq("type", "github")
      .maybeSingle();
    const cfg = integration?.config as { github_login?: string } | null;
    return NextResponse.json({ ok: true, login: cfg?.github_login ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect GitHub" },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/github/connect
 * Disconnects GitHub by removing the integration row.
 */
export async function DELETE() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  await admin
    .from("integrations")
    .delete()
    .eq("team_id", profile.team_id)
    .eq("type", "github");

  return NextResponse.json({ ok: true });
}
