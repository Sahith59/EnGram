import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/contexts/[id]
 * Privacy rules:
 *   - Personal rows: only the creator can see anything.
 *   - Team rows: any team member can read the brief (title/summary/decision/
 *     rationale/tags + author_handle). raw_conversation is REDACTED for
 *     anyone who isn't the original author.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  // RLS will already block disallowed rows, but we re-check application-side
  // so we can branch on visibility for redaction.
  const { data, error } = await supabase
    .from("context_snapshots")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = data as Record<string, unknown> & {
    created_by: string;
    team_id: string;
    visibility?: string | null;
  };
  const visibility = (row.visibility as string | undefined) ?? "personal";
  const isCreator = row.created_by === user.id;
  const isSameTeam = row.team_id === profile.team_id;

  // Defensive auth check (RLS should have caught these already)
  if (visibility === "personal" && !isCreator) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (visibility === "team" && !isSameTeam) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Redact raw_conversation for team rows when the viewer isn't the author.
  // Everyone else still gets title/summary/decision/rationale/etc.
  if (visibility === "team" && !isCreator) {
    const { raw_conversation: _omit, ...safe } = row;
    return NextResponse.json({
      data: { ...safe, raw_conversation: null, redacted: true },
    });
  }

  return NextResponse.json({ data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("context_snapshots")
    .delete()
    .eq("id", params.id)
    .eq("created_by", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Delete failed or not authorized" },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/contexts/[id]/visibility (sent as PATCH /api/contexts/[id])
 * body: { visibility: "personal" | "team" }
 *
 * Only the creator can change a capture's visibility.
 *  - personal → team: also moves the row's team_id to the caller's active
 *    team, so it becomes shared with whoever they're collaborating with now.
 *  - team → personal: just flips visibility; team_id is left as-is for
 *    historical traceability (RLS for personal rows ignores team_id).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const next = body.visibility;
  if (next !== "personal" && next !== "team") {
    return NextResponse.json(
      { error: "visibility must be 'personal' or 'team'" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) {
    return NextResponse.json({ error: "No active team" }, { status: 400 });
  }

  // Only the creator can change visibility
  const { data: row } = await admin
    .from("context_snapshots")
    .select("id, created_by, visibility, team_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.created_by !== user.id) {
    return NextResponse.json(
      { error: "Only the original author can change visibility" },
      { status: 403 }
    );
  }

  if (row.visibility === next && (next === "personal" || row.team_id === profile.team_id)) {
    // No-op (already in target state)
    return NextResponse.json({ success: true, unchanged: true, visibility: next });
  }

  const update: Record<string, string> = { visibility: next };
  if (next === "team") {
    // Promote into the user's currently-active team
    update.team_id = profile.team_id;
  }

  const { error: updErr } = await admin
    .from("context_snapshots")
    .update(update)
    .eq("id", params.id)
    .eq("created_by", user.id);
  if (updErr) {
    console.error("[contexts PATCH] update failed:", updErr);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, visibility: next });
}
