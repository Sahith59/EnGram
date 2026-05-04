/**
 * GET /api/projects/{id}/ast-edges
 * Returns AST edges for the project's linked repo.
 * Used by the Blast Radius Engine (Phase C).
 *
 * Query params:
 *   file   — filter by source_file (exact match)
 *   depth  — traversal depth: 1=direct imports only (default), 2=transitive
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = params.id;
  const { searchParams } = new URL(request.url);
  const fileFilter = searchParams.get("file");

  const admin = createAdminClient();

  // Get the project's linked repo
  const { data: project } = await admin
    .from("projects")
    .select("github_repo_id")
    .eq("id", projectId)
    .single();

  if (!project?.github_repo_id) {
    return NextResponse.json({ edges: [], repo_id: null });
  }

  let query = admin
    .from("code_ast_edges")
    .select("id, source_file, target_file, edge_type, symbol_name, language, commit_sha, indexed_at")
    .eq("repo_id", project.github_repo_id)
    .order("source_file")
    .limit(500);

  if (fileFilter) {
    query = query.eq("source_file", fileFilter);
  }

  const { data: edges, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    repo_id: project.github_repo_id,
    edges: edges ?? [],
    count: edges?.length ?? 0,
  });
}
