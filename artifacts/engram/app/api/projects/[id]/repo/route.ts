/**
 * DELETE /api/projects/[id]/repo
 * Unlinks the code repository from a project (sets github_repo_id = null).
 * Only the project owner may do this.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface RouteParams { params: { id: string } }

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = params.id;

  // Verify caller is the project owner
  const { data: membership } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .single();

  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("projects")
    .update({ github_repo_id: null, updated_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    console.error("[DELETE /api/projects/[id]/repo]", error);
    return NextResponse.json({ error: "Failed to disconnect repository" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
