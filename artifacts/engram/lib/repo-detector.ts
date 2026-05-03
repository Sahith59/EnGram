/**
 * Semantic Repo Detector
 *
 * Given a conversation embedding, searches ALL indexed GitHub repo chunks
 * for the team and aggregates similarity scores per repo. The repo with the
 * highest composite score (above threshold) wins — regardless of what tabs
 * are open in the browser. This is purely content-driven.
 *
 * Scoring formula per repo:
 *   score = 0.6 × topChunkScore + 0.4 × (avgChunkScore / globalAvg)
 *
 * "Confident" = winning repo scores ≥ 0.08 ahead of second-best.
 */

import { createAdminClient } from "@/lib/supabase/admin";

const REPO_DETECT_THRESHOLD = 0.35;
const CHUNK_MATCH_COUNT = 20;
const CHUNK_GATHER_THRESHOLD = 0.28;
const CONFIDENCE_GAP = 0.08;

export interface DetectedRepo {
  projectId: string;
  projectName: string;
  repoId: number;
  repoFullName: string;
  score: number;
  confident: boolean;
}

interface ChunkRow {
  repo_id: number;
  similarity: number;
}

export async function detectRepoFromConversation(opts: {
  embedding: number[];
  teamId: string;
  threshold?: number;
}): Promise<DetectedRepo | null> {
  const { embedding, teamId, threshold = REPO_DETECT_THRESHOLD } = opts;
  const admin = createAdminClient();

  try {
    // Search across ALL repos for this team (repo_id_filter = null → all repos)
    const { data: chunks, error } = await admin.rpc("search_github_chunks", {
      query_embedding: embedding,
      team_id_filter: teamId,
      repo_id_filter: null,
      match_count: CHUNK_MATCH_COUNT,
      match_threshold: CHUNK_GATHER_THRESHOLD,
    });

    if (error) {
      console.warn("[repo-detector] search_github_chunks error:", error.message);
      return null;
    }
    if (!chunks || (chunks as ChunkRow[]).length === 0) return null;

    const rows = chunks as ChunkRow[];

    // Aggregate scores per repo
    const repoStats = new Map<
      number,
      { total: number; count: number; topScore: number }
    >();
    for (const row of rows) {
      const s = repoStats.get(row.repo_id) ?? {
        total: 0,
        count: 0,
        topScore: 0,
      };
      repoStats.set(row.repo_id, {
        total: s.total + row.similarity,
        count: s.count + 1,
        topScore: Math.max(s.topScore, row.similarity),
      });
    }

    // Composite score per repo
    const maxCount = Math.max(...Array.from(repoStats.values()).map((s) => s.count));
    const ranked = Array.from(repoStats.entries())
      .map(([repoId, s]) => ({
        repoId,
        score: 0.6 * s.topScore + 0.4 * (s.total / Math.max(maxCount, 1)),
      }))
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0];
    if (!winner || winner.score < threshold) return null;

    const runnerUpScore = ranked[1]?.score ?? 0;
    const confident = winner.score - runnerUpScore >= CONFIDENCE_GAP;

    // Find the project linked to the winning repo
    const { data: project } = await admin
      .from("projects")
      .select("id, name")
      .eq("team_id", teamId)
      .eq("github_repo_id", winner.repoId)
      .maybeSingle();

    if (!project) {
      // Repo is indexed but no project workspace linked yet — skip routing,
      // let the existing clustering fallback create one.
      return null;
    }

    // Get repo full name for display
    const { data: repo } = await admin
      .from("github_repos")
      .select("id, full_name")
      .eq("id", winner.repoId)
      .maybeSingle();

    if (!repo) return null;

    return {
      projectId: project.id,
      projectName: project.name,
      repoId: repo.id,
      repoFullName: repo.full_name,
      score: winner.score,
      confident,
    };
  } catch (err) {
    console.warn("[repo-detector] unexpected error:", err);
    return null;
  }
}
