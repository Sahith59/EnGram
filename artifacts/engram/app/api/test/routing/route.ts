import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";
import { detectRepoFromConversation } from "@/lib/repo-detector";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/test/routing?conversation=<text>
 *
 * Developer test endpoint — shows exactly how the semantic router would
 * classify a given conversation against all indexed repos.
 *
 * Returns the full scoring breakdown per repo so you can see WHY a
 * particular repo won (or lost). Remove this endpoint before going to prod.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "No team found" }, { status: 400 });
  }

  const teamId = profile.team_id;
  const conversation =
    request.nextUrl.searchParams.get("conversation") ||
    "How do I implement authentication middleware in this project?";

  // 1. Embed the test conversation
  let embedding: number[] | null = null;
  try {
    const r = await embedText(conversation);
    embedding = r?.vector ?? null;
  } catch (e) {
    return NextResponse.json({
      error: "Embedding failed",
      detail: e instanceof Error ? e.message : String(e),
    }, { status: 500 });
  }

  if (!embedding) {
    return NextResponse.json({ error: "Could not generate embedding (check OPENAI_API_KEY)" }, { status: 500 });
  }

  // 2. Run raw chunk search across all repos (full breakdown)
  const admin = createAdminClient();
  const { data: chunks, error: chunkErr } = await admin.rpc("search_github_chunks", {
    query_embedding: embedding,
    team_id_filter: teamId,
    repo_id_filter: null,
    match_count: 20,
    match_threshold: 0.20, // lower than production so we see all signal
  });

  if (chunkErr) {
    return NextResponse.json({
      error: "search_github_chunks failed",
      detail: chunkErr.message,
      hint: "Make sure you have indexed at least one GitHub repo and the search_github_chunks RPC exists.",
    }, { status: 500 });
  }

  // 3. Per-repo score breakdown
  type RepoStats = { total: number; count: number; topScore: number; samples: string[] };
  const repoStats = new Map<number, RepoStats>();
  for (const chunk of (chunks ?? [])) {
    const s = repoStats.get(chunk.repo_id) ?? { total: 0, count: 0, topScore: 0, samples: [] };
    repoStats.set(chunk.repo_id, {
      total: s.total + chunk.similarity,
      count: s.count + 1,
      topScore: Math.max(s.topScore, chunk.similarity),
      samples: s.samples.length < 2
        ? [...s.samples, chunk.file_path ?? chunk.content?.slice(0, 60) ?? ""]
        : s.samples,
    });
  }

  const maxCount = Math.max(1, ...Array.from(repoStats.values()).map((s) => s.count));

  // Get repo names for display
  const repoIds = Array.from(repoStats.keys());
  const { data: repos } = repoIds.length > 0
    ? await admin
        .from("github_repos")
        .select("id, repo_full_name, file_count, chunk_count")
        .in("id", repoIds)
    : { data: [] };

  const repoMap = new Map((repos ?? []).map((r) => [r.id, r]));

  const breakdown = Array.from(repoStats.entries())
    .map(([repoId, s]) => {
      const score = 0.6 * s.topScore + 0.4 * (s.total / maxCount);
      const repo = repoMap.get(repoId);
      return {
        repo_id: repoId,
        repo: repo?.repo_full_name ?? `repo-${repoId}`,
        file_count: repo?.file_count ?? 0,
        chunk_count: repo?.chunk_count ?? 0,
        composite_score: Math.round(score * 1000) / 1000,
        top_chunk_score: Math.round(s.topScore * 1000) / 1000,
        chunks_matched: s.count,
        sample_files: s.samples,
      };
    })
    .sort((a, b) => b.composite_score - a.composite_score);

  // 4. Run the real router to get the final verdict
  const detected = await detectRepoFromConversation({ embedding, teamId });

  // 5. Also list all indexed repos so you know what's available
  const { data: allRepos } = await admin
    .from("github_repos")
    .select("id, repo_full_name, file_count, chunk_count, indexed_at")
    .eq("team_id", teamId)
    .order("indexed_at", { ascending: false });

  // 6. Check how many projects are linked to repos
  const { data: linkedProjects } = await admin
    .from("projects")
    .select("id, name, github_repo_id")
    .eq("team_id", teamId)
    .not("github_repo_id", "is", null);

  return NextResponse.json({
    test_conversation: conversation,
    embedding_dimensions: embedding.length,
    indexed_repos: (allRepos ?? []).map((r) => ({
      repo: r.repo_full_name,
      files: r.file_count,
      chunks: r.chunk_count,
      indexed_at: r.indexed_at,
    })),
    linked_projects: (linkedProjects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      repo_id: p.github_repo_id,
    })),
    total_chunks_matched: chunks?.length ?? 0,
    repo_score_breakdown: breakdown,
    router_verdict: detected
      ? {
          winner: detected.repoFullName,
          project: detected.projectName,
          project_id: detected.projectId,
          score: Math.round(detected.score * 1000) / 1000,
          confident: detected.confident,
          routing_threshold: 0.35,
          passed_threshold: detected.score >= 0.35,
        }
      : {
          winner: null,
          reason:
            breakdown.length === 0
              ? "No indexed repos matched (index a GitHub repo first)"
              : breakdown[0]?.composite_score < 0.35
              ? `Best score ${breakdown[0]?.composite_score} is below threshold 0.35 — conversation is too generic`
              : "Best repo has no linked project workspace",
          top_score: breakdown[0]?.composite_score ?? 0,
          routing_threshold: 0.35,
        },
  });
}
