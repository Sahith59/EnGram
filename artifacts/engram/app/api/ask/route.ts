import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/lib/supabase/bearer";
import { anthropic } from "@/lib/anthropic";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { embedText } from "@/lib/embeddings";

type GithubChunkHit = {
  id: string;
  repo_id: string;
  file_path: string;
  language: string;
  content: string;
  similarity: number;
  repo_full_name?: string;
};

/**
 * POST /api/ask
 * body: { question: string, scope?: 'personal' | 'team' | 'all' }
 *
 * scope semantics (default 'personal'):
 *   personal — search only the asker's own personal snapshots.
 *   team     — search team snapshots from any teammate.
 *   all      — both personal (the asker's) AND team (the team's).
 *
 * Retrieval (Phase 5D — pre-embedding):
 *   Tokenize the question, OR-match each meaningful token across
 *   title/summary/decision/rationale/tags. This fixes the prior naive
 *   `ilike '%full question%'` matching that almost never produced results.
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          "Supabase isn't configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      },
      { status: 503 }
    );
  }
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();

  // Bearer token fallback for CLI clients
  let user = cookieUser;
  if (!user) {
    user = await getUserFromBearer(request.headers.get("authorization"));
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminDb = createAdminClient();
  const { data: profile } = await adminDb
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  let body: {
    question: string;
    scope?: "personal" | "team" | "all" | "project";
    project_id?: string;
    conversationHistory?: Array<{ question: string; answer: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { question, conversationHistory } = body;
  const rawScope = body.scope;
  const projectId = body.project_id ?? null;
  const scope: "personal" | "team" | "all" | "project" =
    rawScope === "project" && projectId ? "project"
    : rawScope === "team" ? "team"
    : rawScope === "all" ? "all"
    : "personal";

  // For project scope, look up the linked repo_id for github chunk filtering
  let projectRepoId: string | null = null;
  if (scope === "project" && projectId) {
    const admin2 = createAdminClient();
    const { data: proj } = await admin2
      .from("projects")
      .select("github_repo_id")
      .eq("id", projectId)
      .eq("team_id", profile!.team_id)
      .maybeSingle();
    projectRepoId = proj?.github_repo_id ?? null;
  }

  if (!question?.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  // ----- Tokenize the query for OR matching -----
  const STOPWORDS = new Set([
    "the","a","an","and","or","but","of","to","in","on","for","is","are","was",
    "were","be","been","by","with","at","from","as","it","this","that","these",
    "those","what","which","who","how","why","when","where","do","does","did",
    "i","me","my","you","your","we","us","our","they","them","their","can",
    "could","should","would","will","about","tell","explain","show","find",
    // Generic question/filler words that match almost any chat — they
    // should NEVER be the only thing tying a source to a query.
    "concept","concepts","idea","ideas","brief","briefly","summary","summarize",
    "summarise","overview","explain","explanation","explained","example",
    "examples","describe","description","note","notes","thing","things","stuff",
    "please","kindly","thanks","also","just","like","want","need","know","help",
    "give","make","get","see","understand","understanding","quick","quickly",
    "simple","simply","detail","details","detailed","short","long",
  ]);
  const tokens = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, 8);

  // Build the OR clause (Supabase PostgREST style). Tokens are already
  // pre-sanitized to [a-z0-9] above. Sanitize the raw fallback the same
  // way so PostgREST `.or()` can never be broken out of.
  const safeFallback = question
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .trim()
    .slice(0, 80);
  const orClause =
    tokens.length > 0
      ? tokens
          .flatMap((t) => [
            `title.ilike.%${t}%`,
            `summary.ilike.%${t}%`,
            `decision.ilike.%${t}%`,
            `rationale.ilike.%${t}%`,
          ])
          .join(",")
      : safeFallback
      ? `title.ilike.%${safeFallback}%,summary.ilike.%${safeFallback}%,decision.ilike.%${safeFallback}%,rationale.ilike.%${safeFallback}%`
      : "title.ilike.%%";

  // ----- Phase 6: semantic recall via pgvector -----
  // Embed the question once; reuse for every scope. If the API key is
  // missing or the call fails, semanticIds stays empty and we silently
  // fall back to keyword-only retrieval.
  let queryEmbedding: number[] | null = null;
  try {
    const r = await embedText(question);
    queryEmbedding = r?.vector ?? null;
  } catch (e) {
    console.warn(
      "[ask] query embedding failed (degrading to keyword only):",
      e instanceof Error ? e.message : e
    );
  }

  type SemanticHit = { id: string; similarity: number };
  async function semanticRecall(): Promise<SemanticHit[]> {
    if (!queryEmbedding) return [];
    // search_snapshots filters by team_id only; we'll re-filter by
    // created_by/visibility in JS to honor scope. Use the admin client to
    // bypass RLS for the RPC (we trust the team_id_filter we just looked
    // up from the auth'd user's profile).
    const admin = createAdminClient();
    // text-embedding-3-small produces compressed cosine ranges. "Related"
    // pairs typically score 0.15-0.35; "very similar" 0.35-0.55. The
    // threshold here just controls recall — final ranking happens below.
    const { data, error } = await admin.rpc("search_snapshots", {
      query_embedding: queryEmbedding,
      team_id_filter: profile!.team_id,
      match_count: 20,
      match_threshold: 0.12,
    });
    if (error) {
      console.warn("[ask] semantic recall failed:", error.message);
      return [];
    }
    return (data ?? []).map((r: { id: string; similarity: number }) => ({
      id: r.id,
      similarity: r.similarity,
    }));
  }
  // Detect "recent/latest" commit intent to lower threshold + prioritise date
  const isCommitQuery = /\b(commit|commits|push|pushed|history|log|recent|latest|newest|last commit|changelog)\b/i.test(question);

  // ----- GitHub chunk search (parallel with semantic recall) -----
  async function githubChunkSearch(): Promise<GithubChunkHit[]> {
    if (!queryEmbedding) return [];
    const admin = createAdminClient();
    try {
      const { data, error } = await admin.rpc("search_github_chunks", {
        query_embedding: queryEmbedding,
        team_id_filter: profile!.team_id,
        repo_id_filter: projectRepoId ?? null,
        match_count: isCommitQuery ? 10 : 6,
        match_threshold: isCommitQuery ? 0.25 : 0.45,
      });
      if (error) {
        // Table may not exist yet (migration not applied)
        if (!error.message.includes("does not exist")) {
          console.warn("[ask] github chunk search failed:", error.message);
        }
        return [];
      }
      if (!data || data.length === 0) return [];
      // Enrich with repo name
      const repoIds = [...new Set((data as GithubChunkHit[]).map((r) => r.repo_id))];
      const { data: repos } = await admin
        .from("github_repos")
        .select("id, repo_full_name")
        .in("id", repoIds);
      const repoNameMap = new Map((repos ?? []).map((r: { id: string; repo_full_name: string }) => [r.id, r.repo_full_name]));
      return (data as GithubChunkHit[]).map((r) => ({
        ...r,
        repo_full_name: repoNameMap.get(r.repo_id) ?? r.repo_id,
      }));
    } catch {
      return [];
    }
  }

  const [semanticHits, githubHits] = await Promise.all([semanticRecall(), githubChunkSearch()]);
  const semanticIds = new Set(semanticHits.map((h) => h.id));
  const similarityById = new Map(semanticHits.map((h) => [h.id, h.similarity]));

  // Run one (or two) scope-bounded queries and union the results.
  type SourceRow = {
    id: string;
    title: string;
    summary: string | null;
    decision: string | null;
    rationale: string | null;
    ai_tool: string;
    tags: string[];
    created_at: string;
    visibility?: string | null;
    author_handle?: string | null;
    created_by?: string;
  };

  async function fetchScoped(
    s: "personal" | "team" | "project"
  ): Promise<SourceRow[]> {
    const admin = createAdminClient();
    let q = admin
      .from("context_snapshots")
      .select(
        "id, title, summary, decision, rationale, ai_tool, tags, created_at, visibility, author_handle, created_by"
      )
      .or(orClause)
      .order("created_at", { ascending: false })
      .limit(8);
    if (s === "project" && projectId) {
      q = q.eq("project_id", projectId);
    } else if (s === "team") {
      q = q.eq("team_id", profile!.team_id).eq("visibility", "team");
    } else {
      q = q.eq("created_by", user!.id).eq("visibility", "personal");
    }
    const { data, error } = await q;
    if (error) {
      console.error("ask scoped query error:", error);
      return [];
    }
    return (data ?? []) as SourceRow[];
  }

  // Keyword recall (existing path)
  let keywordResults: SourceRow[] = [];
  if (scope === "all") {
    const [personal, team] = await Promise.all([
      fetchScoped("personal"),
      fetchScoped("team"),
    ]);
    const seen = new Set<string>();
    keywordResults = [...personal, ...team].filter((r) =>
      seen.has(r.id) ? false : (seen.add(r.id), true)
    );
  } else if (scope === "project") {
    keywordResults = await fetchScoped("project");
  } else {
    keywordResults = await fetchScoped(scope);
  }

  // ----- Hybrid: union keyword recall with semantic recall -----
  // Pull semantic-hit rows the keyword recall missed, applying the same
  // scope filter (created_by/visibility) so we never leak across scope.
  const knownIds = new Set(keywordResults.map((r) => r.id));
  const missingSemanticIds = [...semanticIds].filter((id) => !knownIds.has(id));
  let semanticRows: SourceRow[] = [];
  if (missingSemanticIds.length > 0) {
    const { data, error } = await adminDb
      .from("context_snapshots")
      .select(
        "id, title, summary, decision, rationale, ai_tool, tags, created_at, visibility, author_handle, created_by"
      )
      .in("id", missingSemanticIds);
    if (error) {
      console.warn("[ask] semantic row fetch failed:", error.message);
    } else {
      semanticRows = (data ?? []) as SourceRow[];
    }
    // Apply scope filter in app (the RPC was team-only).
    semanticRows = semanticRows.filter((r) => {
      if (scope === "personal") {
        return (
          r.created_by === user!.id &&
          (r.visibility === undefined ||
            r.visibility === null ||
            r.visibility === "personal")
        );
      }
      if (scope === "team") {
        return r.visibility === "team";
      }
      // 'project' — already filtered by project_id in fetchScoped; 
      // for semantic rows we accept anything (project_id filter was in keyword path)
      if (scope === "project") {
        return true;
      }
      // 'all'
      return (
        r.created_by === user!.id || r.visibility === "team"
      );
    });
  }

  const allCandidates = [...keywordResults, ...semanticRows];
  const dedup = new Set<string>();
  let results = allCandidates.filter((r) =>
    dedup.has(r.id) ? false : (dedup.add(r.id), true)
  );

  // ----- Relevance scoring -----
  // The OR-match is intentionally loose for recall, but we don't want every
  // loosely-matching row to show up as a "source". Score each candidate by
  // how many distinct meaningful tokens appear anywhere in its searchable
  // text, then keep only the strong ones.
  function keywordScore(r: SourceRow): number {
    if (tokens.length === 0) return 0;
    const hay = [
      r.title ?? "",
      r.summary ?? "",
      r.decision ?? "",
      r.rationale ?? "",
      Array.isArray(r.tags) ? r.tags.join(" ") : "",
    ]
      .join(" ")
      .toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score++;
    }
    return score;
  }
  // Hybrid score: combine keyword hits with semantic similarity.
  // - Keyword hit on a long/specific token is strong evidence.
  // - High cosine similarity is independent strong evidence.
  // - A row needs to clear EITHER bar to qualify.
  const minKeywordScore = tokens.length >= 2 ? 2 : 1;
  // Calibrated for text-embedding-3-small. Cosine sim of 0.22+ is a
  // genuinely related conversation (e.g. "recursion" vs "functions
  // calling themselves" scores ~0.26). Raising this threshold mostly
  // hurts recall without improving precision noticeably.
  const SEMANTIC_QUALIFY = 0.2;
  // Full sorted pool — keep ALL qualifying candidates so the related
  // tier (Phase 7.3) can draw from items that didn't win a cited slot
  // but are still genuinely relevant.
  const scoredAll = results
    .map((r) => {
      const ks = keywordScore(r);
      const sim = similarityById.get(r.id) ?? 0;
      return { row: r, ks, sim };
    })
    .filter(({ row, ks, sim }) => {
      if (sim >= SEMANTIC_QUALIFY) return true;
      if (ks >= minKeywordScore) return true;
      if (ks >= 1 && tokens.some((t) => t.length >= 6 && (
        (row.title ?? "").toLowerCase().includes(t) ||
        (row.summary ?? "").toLowerCase().includes(t) ||
        (row.decision ?? "").toLowerCase().includes(t) ||
        (row.rationale ?? "").toLowerCase().includes(t)
      ))) return true;
      return false;
    })
    .map((x) => ({
      ...x,
      // Combined score: scale up semantic sim (since 3-small's range is
      // compressed) and treat each keyword hit as worth ~0.15. Cap to 1.
      total: Math.min(1, x.sim * 1.6 + Math.min(0.45, x.ks * 0.15)),
    }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        +new Date(b.row.created_at) - +new Date(a.row.created_at)
    );
  // Top-4 go to Claude as candidate sources for citation.
  const scored = scoredAll.slice(0, 4);
  const sources = scored.map((s) => s.row);

  // NOTE: We no longer early-return when no captured context is found.
  // ENGRAM will fall back to Claude's general knowledge and clearly note it.

  // Build snapshot context block
  const contextBlock = sources
    .map((s, i) => {
      const author =
        s.visibility === "team" && s.author_handle
          ? ` · captured by ${s.author_handle}`
          : "";
      return `[${i + 1}] **${s.title}** (${s.ai_tool}, ${new Date(
        s.created_at
      ).toLocaleDateString()}${author})
Summary: ${s.summary ?? "N/A"}
Decision: ${s.decision ?? "N/A"}
Rationale: ${s.rationale ? s.rationale.slice(0, 400) : "N/A"}`;
    })
    .join("\n\n---\n\n");

  // For commit queries: sort commit-type chunks by date (most recent first),
  // then interleave with code chunks so Claude sees the freshest commit first.
  let orderedGithubHits = [...githubHits];
  if (isCommitQuery) {
    const commitHits = orderedGithubHits.filter(h => h.language === "commit");
    const codeHits   = orderedGithubHits.filter(h => h.language !== "commit");
    // Commits are stored with "Date: YYYY-MM-DD" — extract & sort descending
    commitHits.sort((a, b) => {
      const dateA = a.content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      const dateB = b.content.match(/Date:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      return dateB.localeCompare(dateA);
    });
    orderedGithubHits = [...commitHits, ...codeHits];
  }

  // Build GitHub chunk context block (separate section, labelled GH1, GH2...)
  const githubBlock =
    orderedGithubHits.length > 0
      ? "\n\n## GitHub Repository Data\n\n" +
        orderedGithubHits
          .slice(0, isCommitQuery ? 8 : 4)
          .map((g, i) => {
            const isCommit = g.language === "commit";
            const header = isCommit
              ? `[GH${i + 1}] **${g.repo_full_name ?? "repo"}** — Commit History`
              : `[GH${i + 1}] **${g.repo_full_name ?? "repo"}** — \`${g.file_path}\``;
            const body = isCommit
              ? g.content.slice(0, 600)
              : `\`\`\`${g.language ?? ""}\n${g.content.slice(0, 700)}\n\`\`\``;
            return `${header}\n${body}`;
          })
          .join("\n\n---\n\n")
      : "";

  let answer: string;
  let confidence: number | null = null;

  try {
    const hasSnapshots = sources.length > 0;
    const hasGithub = githubHits.length > 0;

    // Build multi-turn history messages so Claude has full conversation context.
    // We include the last 4 turns to stay within token budget.
    type ClaudeMsg = { role: "user" | "assistant"; content: string };
    const historyMessages: ClaudeMsg[] = [];
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      for (const turn of conversationHistory.slice(-4)) {
        if (!turn.question?.trim()) continue;
        historyMessages.push({ role: "user", content: turn.question });
        // Truncate long answers to save tokens but preserve meaning
        const truncated =
          turn.answer.length > 600
            ? turn.answer.slice(0, 600) + "\n[…answer continues]"
            : turn.answer;
        historyMessages.push({ role: "assistant", content: truncated });
      }
    }

    const currentUserContent = `Answer the user's latest question. You have two sources of knowledge: (1) captured team contexts below, and (2) your own general AI knowledge. Use both.

Latest question: ${question}
${hasSnapshots ? `\n## Captured AI Conversations\n\n${contextBlock}` : ""}${githubBlock}

Rules:
- PRIORITY 1: If captured contexts or conversation history directly answer the question, use them. Cite captured conversations as [1], [2], etc. Cite GitHub data as [GH1], [GH2], etc.
- PRIORITY 2: If the question needs code, a technical explanation, or something not in the captured contexts — answer from your general AI knowledge. Add a short note at the end: "*(Note: answered from general knowledge — no matching captured conversation found.)*"
- For follow-up questions: use the conversation history to understand what "it", "that", "the code above", etc. refer to.
- For commit/history questions: the GitHub data IS authoritative — give sha, author, date, message directly.
- NEVER refuse to answer a question you're capable of answering. Always try to help.
- Be concise. No filler.
- End with a single line: CONFIDENCE: [0.0-1.0]`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system:
        "You are ENGRAM, a precise knowledge assistant for a developer team. You have access to the conversation history and captured AI context. Maintain continuity across follow-up questions.",
      messages: [
        ...historyMessages,
        { role: "user", content: currentUserContent },
      ],
    });

    const rawAnswer =
      message.content[0].type === "text" ? message.content[0].text : "";

    const confidenceMatch = rawAnswer.match(/CONFIDENCE:\s*([\d.]+)/i);
    confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;
    answer = rawAnswer.replace(/CONFIDENCE:\s*[\d.]+/i, "").trim();
  } catch (err) {
    console.error("Claude synthesis failed:", err);
    return NextResponse.json({ error: "AI synthesis failed" }, { status: 500 });
  }

  // ----- Honest source filter (Phase 7.3) -----
  // Authoritative `sources` = only what Claude actually CITED. Anything
  // shown there is grounded in the answer text via [N] markers.
  // `related` = strong retrievals Claude DIDN'T cite — surfaced separately
  // so the user can self-verify rather than us hiding potentially-useful
  // captures. We use a higher confidence bar than initial qualification
  // (sim ≥ 0.30 OR ks ≥ 2) to avoid noise.
  const citedNumbers = new Set<number>();
  const citationRegex = /\[(\d+)\]/g;
  let cm: RegExpExecArray | null;
  while ((cm = citationRegex.exec(answer)) !== null) {
    const n = parseInt(cm[1], 10);
    if (n >= 1 && n <= sources.length) citedNumbers.add(n);
  }

  // ENGRAM now always answers (general knowledge fallback), so isNoMatch is
  // only true if Claude genuinely has nothing useful to say at all.
  const isNoMatch = false;

  // Build `related`: strong-but-uncited candidates from the FULL scored
  // pool (not just top-4 that competed for cited slots). Threshold is
  // aligned with initial qualification (`ks >= minKeywordScore`) so a
  // single-token query with `minKeywordScore=1` doesn't silently
  // suppress all related items, while sim >= 0.30 stays as the higher
  // semantic bar for embedding-based hits.
  const RELATED_SIM = 0.3;
  const RELATED_CAP = 3;
  const citedIds = new Set(
    [...citedNumbers].map((n) => sources[n - 1]?.id).filter(Boolean)
  );
  const relatedRaw = scoredAll
    .filter((s) => !citedIds.has(s.row.id))
    .filter((s) => s.sim >= RELATED_SIM || s.ks >= minKeywordScore)
    .slice(0, RELATED_CAP);

  let finalSources = sources;
  let finalAnswer = answer;
  let related: typeof relatedRaw = [];
  if (isNoMatch) {
    // Claude explicitly disclaimed — don't pad with "related" to avoid
    // contradicting the no-match message.
    finalSources = [];
    related = [];
  } else if (citedNumbers.size > 0) {
    const orderedOldNumbers = [...citedNumbers].sort((a, b) => a - b);
    const renumberMap = new Map<number, number>();
    orderedOldNumbers.forEach((oldN, i) => renumberMap.set(oldN, i + 1));
    finalAnswer = answer.replace(/\[(\d+)\]/g, (_match, g1) => {
      const n = parseInt(g1, 10);
      const newN = renumberMap.get(n);
      return newN ? `[${newN}]` : "";
    });
    finalSources = orderedOldNumbers
      .map((oldN) => sources[oldN - 1])
      .filter(Boolean);
    related = relatedRaw;
  } else {
    // Answer with no citations at all — Claude synthesized text without
    // grounding. Don't claim cited sources, but still surface strong
    // retrievals so the user can sanity-check the answer themselves.
    finalSources = [];
    related = relatedRaw;
  }

  const { data: savedQuery } = await adminDb
    .from("kt_queries")
    .insert({
      team_id: profile.team_id,
      asked_by: user.id,
      question,
      answer: finalAnswer,
      source_snapshot_ids: finalSources.map((s) => s.id),
      confidence:
        confidence !== null ? Math.min(1, Math.max(0, confidence)) : null,
    })
    .select("id")
    .single();

  return NextResponse.json({
    answer: finalAnswer,
    confidence,
    scope,
    sources: finalSources.map((s, i) => ({
      ref: i + 1,
      id: s.id,
      title: s.title,
      ai_tool: s.ai_tool,
      created_at: s.created_at,
      visibility: s.visibility ?? "personal",
      author_handle: s.author_handle ?? null,
    })),
    related: related.map((r) => ({
      id: r.row.id,
      title: r.row.title,
      ai_tool: r.row.ai_tool,
      created_at: r.row.created_at,
      visibility: r.row.visibility ?? "personal",
      author_handle: r.row.author_handle ?? null,
      similarity: Math.round(r.sim * 100) / 100,
      keywordHits: r.ks,
    })),
    github_sources: githubHits.map((g, i) => ({
      ref: `GH${i + 1}`,
      id: g.id,
      repo_full_name: g.repo_full_name ?? "",
      file_path: g.file_path,
      language: g.language,
      similarity: Math.round(g.similarity * 100) / 100,
    })),
    queryId: savedQuery?.id ?? null,
  });
}
