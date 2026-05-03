import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const MAX_BULK = 100;

/**
 * POST /api/contexts/bulk-visibility
 * body: { ids: string[], visibility: "personal" | "team" }
 *
 * Only updates rows the caller created. Promotion to team also moves
 * team_id to the caller's active team (matches the per-row PATCH).
 *
 * Returns { updated, skipped, total } so the UI can give honest feedback
 * (e.g. "12 updated, 2 skipped — you can only change your own captures").
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

  let body: { ids?: unknown; visibility?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  if (ids.length > MAX_BULK) {
    return NextResponse.json(
      { error: `Bulk limit is ${MAX_BULK} ids per request` },
      { status: 400 }
    );
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

  const update: Record<string, string> = { visibility: next };
  if (next === "team") update.team_id = profile.team_id;

  // Only update rows the caller owns. Anything they don't own is reported as skipped.
  const { data: updated, error } = await admin
    .from("context_snapshots")
    .update(update)
    .in("id", ids)
    .eq("created_by", user.id)
    .select("id");

  if (error) {
    console.error("[bulk-visibility] update failed:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  const updatedIds = new Set((updated ?? []).map((r) => r.id));
  const skipped = ids.filter((id) => !updatedIds.has(id));

  return NextResponse.json({
    updated: updatedIds.size,
    skipped,
    total: ids.length,
    visibility: next,
  });
}
