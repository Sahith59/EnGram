/**
 * intent-retriever.ts — Blast Radius Engine Phase C
 *
 * Given a list of affected file paths + the change description, retrieves:
 *   1. AI conversations linked to commits that touched those files (via semantic_links)
 *   2. AI conversations semantically similar to the change description
 *
 * Deduplicates, ranks, and returns the top 5 most relevant snapshots with
 * their key decision quotes.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";

const MAX_SNAPSHOTS = 5;
const EMBED_THRESHOLD = 0.38;

export interface IntentSnapshot {
  id: string;
  title: string;
  summary: string | null;
  decision: string | null;
  created_at: string;
  ai_tool: string;
  relevance_score: number;
  source: "commit_link" | "semantic_search" | "both";
}

/**
 * Retrieve the AI conversations most relevant to a blast radius analysis.
 *
 * Strategy:
 *   1. Find commits that touched any of the affected files via semantic_links
 *   2. Load those linked conversation snapshots
 *   3. Embed the change description and vector-search context_snapshots
 *   4. Merge, deduplicate, score, and return top MAX_SNAPSHOTS
 */
export async function retrieveIntent(opts: {
  repoId: string;
  projectId: string;
  teamId: string;
  affectedFiles: string[];
  targetFile: string;
  changeDescription: string;
}): Promise<{ snapshots: IntentSnapshot[]; linksFound: number }> {
  const { repoId, projectId, teamId, affectedFiles, targetFile, changeDescription } = opts;
  const admin = createAdminClient();

  // All files relevant to the query (the file being changed + its dependents)
  const allFiles = [targetFile, ...affectedFiles.slice(0, 30)];

  // ── 1. Commit-linked snapshots (via semantic_links.linked_files) ──────────
  const { data: commitLinks } = await admin
    .from("semantic_links")
    .select("snapshot_id, similarity, commit_sha")
    .eq("repo_id", repoId)
    .filter("linked_files", "cs", `{${allFiles.map((f) => `"${f}"`).join(",")}}`)
    .order("similarity", { ascending: false })
    .limit(30);

  const commitSnapshotIds = [
    ...new Set((commitLinks ?? []).map((l) => l.snapshot_id)),
  ].slice(0, 15);

  const linkScoreMap = new Map<string, number>();
  for (const link of commitLinks ?? []) {
    const existing = linkScoreMap.get(link.snapshot_id) ?? 0;
    linkScoreMap.set(link.snapshot_id, Math.max(existing, link.similarity ?? 0));
  }

  // ── 2. Semantic search for change description ─────────────────────────────
  const embedResult = await embedText(
    `${changeDescription}\n\nFile: ${targetFile}`
  ).catch(() => null);

  let semanticIds: string[] = [];
  const semanticScoreMap = new Map<string, number>();

  if (embedResult?.vector) {
    let semanticMatches: { id: string; similarity: number }[] | null = null;
    try {
      const { data } = await admin.rpc("search_context_snapshots", {
        query_embedding:   embedResult.vector,
        team_id_filter:    teamId,
        project_id_filter: projectId,
        match_count:       10,
        match_threshold:   EMBED_THRESHOLD,
      });
      semanticMatches = data as { id: string; similarity: number }[] | null;
    } catch { /* no semantic matches */ }

    for (const m of (semanticMatches ?? [])) {
      semanticIds.push(m.id);
      semanticScoreMap.set(m.id, m.similarity ?? 0);
    }
  }

  // ── 3. Load snapshot details ──────────────────────────────────────────────
  const allSnapshotIds = [...new Set([...commitSnapshotIds, ...semanticIds])];
  if (allSnapshotIds.length === 0) {
    return { snapshots: [], linksFound: 0 };
  }

  const { data: snapshots } = await admin
    .from("context_snapshots")
    .select("id, title, summary, decision, created_at, ai_tool")
    .eq("project_id", projectId)
    .in("id", allSnapshotIds);

  // ── 4. Score and rank ─────────────────────────────────────────────────────
  const scored: IntentSnapshot[] = (snapshots ?? []).map((snap) => {
    const fromCommit = linkScoreMap.get(snap.id) ?? 0;
    const fromSemantic = semanticScoreMap.get(snap.id) ?? 0;
    // Combined score: commit link weighted 0.6, semantic 0.4
    const relevance = Math.max(
      fromCommit > 0 && fromSemantic > 0
        ? 0.6 * fromCommit + 0.4 * fromSemantic
        : fromCommit || fromSemantic,
      0
    );

    const source: IntentSnapshot["source"] =
      fromCommit > 0 && fromSemantic > 0
        ? "both"
        : fromCommit > 0
        ? "commit_link"
        : "semantic_search";

    return {
      id:              snap.id,
      title:           snap.title,
      summary:         snap.summary ?? null,
      decision:        snap.decision ?? null,
      created_at:      snap.created_at,
      ai_tool:         snap.ai_tool,
      relevance_score: Math.round(relevance * 1000) / 1000,
      source,
    };
  });

  scored.sort((a, b) => b.relevance_score - a.relevance_score);

  return {
    snapshots: scored.slice(0, MAX_SNAPSHOTS),
    linksFound: commitSnapshotIds.length,
  };
}
