/**
 * POST /api/projects/[id]/conflicts/[conflictId]/resolve
 * Resolves a claim conflict by choosing a winner claim.
 * The losing claim is marked as superseded.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; conflictId: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { winner_claim_id } = body as { winner_claim_id?: string };

  if (!winner_claim_id) {
    return NextResponse.json({ error: "winner_claim_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the conflict
  const { data: conflict } = await admin
    .from("claim_conflicts")
    .select("id, project_id, claim_a_id, claim_b_id, resolved")
    .eq("id", params.conflictId)
    .eq("project_id", params.id)
    .single();

  if (!conflict) {
    return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
  }
  if (conflict.resolved) {
    return NextResponse.json({ error: "Conflict already resolved" }, { status: 409 });
  }

  // Winner must be one of the two claims in the conflict
  if (
    winner_claim_id !== conflict.claim_a_id &&
    winner_claim_id !== conflict.claim_b_id
  ) {
    return NextResponse.json(
      { error: "winner_claim_id must be one of the two conflicting claims" },
      { status: 400 }
    );
  }

  const loser_claim_id =
    winner_claim_id === conflict.claim_a_id
      ? conflict.claim_b_id
      : conflict.claim_a_id;

  const now = new Date().toISOString();

  // Mark winner as active (clear conflicted status)
  await admin
    .from("project_claims")
    .update({ status: "active", updated_at: now })
    .eq("id", winner_claim_id);

  // Mark loser as superseded
  await admin
    .from("project_claims")
    .update({
      status: "superseded",
      superseded_by: winner_claim_id,
      updated_at: now,
    })
    .eq("id", loser_claim_id);

  // Mark conflict as resolved
  await admin
    .from("claim_conflicts")
    .update({
      resolved: true,
      resolved_at: now,
      resolved_by: user.id,
      winner_claim_id,
    })
    .eq("id", params.conflictId);

  return NextResponse.json({ success: true, winner_claim_id, loser_claim_id });
}
