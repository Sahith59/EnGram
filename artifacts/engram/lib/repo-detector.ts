/**
 * Repo Detector — three-tier routing engine
 *
 * Tier 1: GitHub URL mention (score = 1.0, always confident)
 *   If the conversation text contains a github.com/owner/repo URL that
 *   matches an indexed repo, route there immediately. Handles the case
 *   where a developer pastes a repo link in ChatGPT and asks about it.
 *
 * Tier 2: Semantic chunk similarity (score = 0.35–1.0)
 *   Embed the conversation → search ALL indexed repo chunks → aggregate
 *   scores per repo → route to highest scorer above threshold. Purely
 *   content-driven, zero browser-tab dependency.
 *
 * Tier 3: (handled in capture route) centroid clustering fallback
 *
 * "Confident" = winning repo leads second place by ≥ 0.08.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getProjectThreshold, recordRoutingDecision } from "@/lib/routing-threshold";

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
  method: "url_mention" | "semantic";
}

interface ChunkRow {
  repo_id: number;
  similarity: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract all github.com/owner/repo slugs from free text. */
function extractGitHubSlugs(text: string): string[] {
  const re = /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/gi;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Normalise: strip .git suffix, lowercase for comparison
    const slug = `${m[1]}/${m[2].replace(/\.git$/i, "")}`.toLowerCase();
    found.add(slug);
  }
  return Array.from(found);
}

/** Look up a project linked to a repo by full name (case-insensitive). */
async function findProjectForRepo(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  repoFullNameLower: string
): Promise<{ projectId: string; projectName: string; repoId: number; repoFullName: string } | null> {
  // Find the repo (ilike for case-insensitive match)
  const { data: repo } = await admin
    .from("github_repos")
    .select("id, repo_full_name")
    .eq("team_id", teamId)
    .ilike("repo_full_name", repoFullNameLower)
    .maybeSingle();

  if (!repo) return null;

  // Find the project linked to this repo (skip archived projects — F-13)
  const { data: project } = await admin
    .from("projects")
    .select("id, name, is_archived")
    .eq("team_id", teamId)
    .eq("github_repo_id", repo.id)
    .maybeSingle();

  if (!project) return null;
  // Don't route to archived projects
  if ((project as Record<string, unknown>).is_archived === true) return null;

  return {
    projectId: project.id,
    projectName: project.name,
    repoId: repo.id,
    repoFullName: repo.repo_full_name,
  };
}

// ── Tier 1: GitHub URL mention ────────────────────────────────────────────────

/**
 * Scan conversation pairs for github.com/owner/repo URLs.
 * If any match an indexed + project-linked repo, return it immediately
 * with score=1.0 and confident=true — no threshold, no ambiguity.
 */
export async function detectRepoFromGitHubUrl(opts: {
  pairs: { role: string; content: string }[];
  teamId: string;
}): Promise<DetectedRepo | null> {
  const { pairs, teamId } = opts;
  const admin = createAdminClient();

  // Collect all text from the conversation
  const fullText = pairs.map((p) => p.content).join("\n");
  const slugs = extractGitHubSlugs(fullText);
  if (slugs.length === 0) return null;

  // Try each slug — first match wins
  for (const slug of slugs) {
    const match = await findProjectForRepo(admin, teamId, slug);
    if (match) {
      console.log(
        `[repo-detector] URL mention → "${match.repoFullName}" (slug: ${slug})`
      );
      return {
        ...match,
        score: 1.0,
        confident: true,
        method: "url_mention",
      };
    }
  }

  return null;
}

// ── Tier 2: Semantic chunk similarity ────────────────────────────────────────

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

    // Find the project linked to the winning repo candidate (skip archived — F-13)
    // Do this BEFORE threshold check so we can look up the per-project threshold (F-14)
    const topCandidate = ranked[0];
    if (!topCandidate) return null;

    const { data: project } = await admin
      .from("projects")
      .select("id, name, is_archived")
      .eq("team_id", teamId)
      .eq("github_repo_id", topCandidate.repoId)
      .maybeSingle();

    if (!project) return null;
    if ((project as Record<string, unknown>).is_archived === true) return null;

    // F-14: Get the adaptive per-project threshold (falls back to 0.35 if not yet calibrated)
    let effectiveThreshold = threshold;
    try {
      effectiveThreshold = await getProjectThreshold(project.id, topCandidate.repoId);
    } catch {
      // Non-fatal — use the default threshold
    }

    // Record this routing attempt for future calibration (best-effort, non-blocking)
    recordRoutingDecision({
      projectId: project.id,
      repoId: topCandidate.repoId,
      similarity: topCandidate.score,
      routed: topCandidate.score >= effectiveThreshold,
    }).catch(() => {});

    if (topCandidate.score < effectiveThreshold) return null;

    const winner = topCandidate;
    const runnerUpScore = ranked[1]?.score ?? 0;
    const confident = winner.score - runnerUpScore >= CONFIDENCE_GAP;

    // Get repo info for display — use correct column name: repo_full_name
    const { data: repo } = await admin
      .from("github_repos")
      .select("id, repo_full_name")
      .eq("id", winner.repoId)
      .maybeSingle();

    if (!repo) return null;

    console.log(
      `[repo-detector] semantic → "${repo.repo_full_name}" ` +
        `score=${winner.score.toFixed(3)} threshold=${effectiveThreshold} confident=${confident}`
    );

    return {
      projectId: project.id,
      projectName: project.name,
      repoId: repo.id,
      repoFullName: repo.repo_full_name,
      score: winner.score,
      confident,
      method: "semantic",
    };
  } catch (err) {
    console.warn("[repo-detector] unexpected error:", err);
    return null;
  }
}
