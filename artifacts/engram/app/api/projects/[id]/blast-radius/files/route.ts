/**
 * GET /api/projects/[id]/blast-radius/files?q=<query>
 *
 * Returns distinct file paths from the project's indexed AST edges.
 * Used for autocomplete in the Blast Radius file path input.
 * Optionally filters by a case-insensitive substring query.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ files: [] });

  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return NextResponse.json({ files: [] });

  // Pull distinct source_files + target_files from AST edges
  let query = admin
    .from("code_ast_edges")
    .select("source_file")
    .eq("repo_id", project.github_repo_id)
    .limit(500);

  if (q) {
    query = query.ilike("source_file", `%${q}%`);
  }

  const { data: srcRows } = await query;

  let query2 = admin
    .from("code_ast_edges")
    .select("target_file")
    .eq("repo_id", project.github_repo_id)
    .limit(500);

  if (q) {
    query2 = query2.ilike("target_file", `%${q}%`);
  }

  const { data: tgtRows } = await query2;

  const all = new Set<string>();
  for (const r of srcRows ?? []) if (r.source_file) all.add(r.source_file);
  for (const r of tgtRows ?? []) if (r.target_file) all.add(r.target_file);

  const files = Array.from(all).sort().slice(0, 50);
  return NextResponse.json({ files });
}
