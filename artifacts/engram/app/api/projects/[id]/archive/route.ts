/**
 * POST /api/projects/{id}/archive   → archive the project (is_archived = true)
 * POST /api/projects/{id}/unarchive → restore it (is_archived = false)
 *
 * F-13: Archived projects are excluded from routing, brief generation,
 * and the default projects list. They're still accessible via direct URL.
 *
 * Only the project owner or team admin can archive.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

async function handler(
  _request: NextRequest,
  { params }: { params: { id: string } },
  archive: boolean
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params.id;
  const admin = createAdminClient();

  // Verify user is project owner or team admin
  const { data: member } = await admin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Only project owners can archive projects" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("projects")
    .update({ is_archived: archive, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id, name, is_archived")
    .single();

  if (error) {
    // Column may not exist yet if migration 0015 hasn't been applied
    if (error.message.includes("is_archived")) {
      return NextResponse.json(
        { error: "Run migration 0015 in Supabase SQL Editor first", migration_needed: true },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    project: data,
    action: archive ? "archived" : "unarchived",
  });
}

export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  return handler(request, context, true);
}

export async function DELETE(
  request: NextRequest,
  context: { params: { id: string } }
) {
  return handler(request, context, false);
}
