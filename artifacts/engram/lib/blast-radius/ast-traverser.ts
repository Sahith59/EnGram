/**
 * ast-traverser.ts — Blast Radius Engine
 *
 * Given a (repo_id, file_path), uses the `traverse_ast_edges` recursive CTE
 * to perform a bidirectional BFS over the AST dependency graph:
 *
 *   reverse: files that depend on the target (will break if it changes)
 *   forward: files the target depends on (its own dependencies — context)
 *
 * Impact classification by hop distance:
 *   1 hop  → Direct
 *   2 hops → Transitive
 *   3+ hops → Indirect
 */

import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DEPTH = 5;

export type ImpactLevel = "Direct" | "Transitive" | "Indirect";
export type TraversalDirection = "reverse" | "forward";

export interface AffectedFile {
  file_path: string;
  impact_level: ImpactLevel;
  hops: number;
  edge_type: string;
  via_file: string;
  via_symbol: string | null;
  direction: TraversalDirection;
}

interface RpcRow {
  file_path:  string;
  hops:       number;
  edge_type:  string;
  via_file:   string;
  via_symbol: string | null;
  direction:  string;
}

function hopToImpact(hops: number): ImpactLevel {
  if (hops === 1) return "Direct";
  if (hops === 2) return "Transitive";
  return "Indirect";
}

/**
 * Traverse the dependency graph bidirectionally to find all files affected by
 * changing `startFile` in `repoId`.
 *
 * Returns:
 *   - files: AffectedFile[] sorted by direction (reverse first), then hops, then alpha
 *   - edgesTraversed: total rows returned by the RPC
 */
export async function traverseAstEdges(opts: {
  repoId:    string;
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
    direction:    (row.direction === "forward" ? "forward" : "reverse") as TraversalDirection,
  }));

  // Sort: reverse first (dependents = primary blast), then forward (dependencies = context)
  // Within each direction: hops ascending, then alphabetical
  files.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "reverse" ? -1 : 1;
    return a.hops - b.hops || a.file_path.localeCompare(b.file_path);
  });

  return { files, edgesTraversed: rows.length };
}
