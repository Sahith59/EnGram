/**
 * ast-traverser.ts — Blast Radius Engine Phase C
 *
 * Given a (repo_id, file_path), uses the `traverse_ast_edges` recursive CTE
 * to find every file that transitively depends on the target file.
 * Classifies each as Direct (1 hop), Transitive (2 hops), or Indirect (3+).
 */

import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DEPTH = 5;

export type ImpactLevel = "Direct" | "Transitive" | "Indirect";

export interface AffectedFile {
  file_path: string;
  impact_level: ImpactLevel;
  hops: number;
  edge_type: string;
  via_file: string;
  via_symbol: string | null;
}

interface RpcRow {
  file_path: string;
  hops: number;
  edge_type: string;
  via_file: string;
  via_symbol: string | null;
}

function hopToImpact(hops: number): ImpactLevel {
  if (hops === 1) return "Direct";
  if (hops === 2) return "Transitive";
  return "Indirect";
}

/**
 * Traverse the dependency graph to find all files affected by changing
 * `startFile` in `repoId`. Uses server-side recursive CTE for efficiency.
 *
 * Returns affected files sorted by hops ascending (closest first),
 * capped at MAX_DEPTH. Does not include the start file itself.
 */
export async function traverseAstEdges(opts: {
  repoId: string;
  startFile: string;
}): Promise<{ files: AffectedFile[]; edgesTraversed: number }> {
  const { repoId, startFile } = opts;
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("traverse_ast_edges", {
    p_repo_id:    repoId,
    p_start_file: startFile,
    p_max_depth:  MAX_DEPTH,
  });

  if (error) {
    console.warn("[ast-traverser] RPC error:", error.message);
    return { files: [], edgesTraversed: 0 };
  }

  const rows = (data ?? []) as RpcRow[];

  const files: AffectedFile[] = rows.map((row) => ({
    file_path:    row.file_path,
    impact_level: hopToImpact(row.hops),
    hops:         row.hops,
    edge_type:    row.edge_type,
    via_file:     row.via_file,
    via_symbol:   row.via_symbol ?? null,
  }));

  // Sort by hops, then alphabetically
  files.sort((a, b) => a.hops - b.hops || a.file_path.localeCompare(b.file_path));

  return { files, edgesTraversed: rows.length };
}
