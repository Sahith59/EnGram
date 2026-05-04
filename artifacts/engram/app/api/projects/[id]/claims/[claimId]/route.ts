/**
 * PATCH /api/projects/[id]/claims/[claimId]
 * Update a claim's status: mark as abandoned, superseded, or active.
 *
 * DELETE /api/projects/[id]/claims/[claimId]
 * Hard-delete a claim (admin use; prefer status updates for auditability).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type ClaimStatus = "active" | "superseded" | "abandoned" | "conflicted";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; claimId: string } }
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
  const status: ClaimStatus | undefined = body.status;

  if (!status || !["active", "superseded", "abandoned"].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of: active, superseded, abandoned" },
      { status: 400 }
    );
  }

  // Verify membership
  const { data: claim } = await supabase
    .from("project_claims")
    .select("id, team_id, project_id")
    .eq("id", params.claimId)
    .eq("project_id", params.id)
    .single();

  if (!claim) {
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("team_id", claim.team_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Update the claim status
  await admin
    .from("project_claims")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", params.claimId);

  // If marking as abandoned/superseded and it was conflicted, resolve related conflicts
  if (status === "abandoned" || status === "superseded") {
    await admin
      .from("claim_conflicts")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        winner_claim_id: status === "superseded" ? params.claimId : null,
      })
      .or(`claim_a_id.eq.${params.claimId},claim_b_id.eq.${params.claimId}`)
      .eq("resolved", false);
  }

  return NextResponse.json({ success: true, claimId: params.claimId, status });
}
