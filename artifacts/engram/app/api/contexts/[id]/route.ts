import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
