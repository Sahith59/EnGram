import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { embedText } from "@/lib/embeddings";

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  let body: { question: string; scope?: "personal" | "team" | "all" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { question } = body;
  const scope: "personal" | "team" | "all" =
    body.scope === "team" ? "team" : body.scope === "all" ? "all" : "personal";

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
  const semanticHits = await semanticRecall();
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
    s: "personal" | "team"
  ): Promise<SourceRow[]> {
    let q = supabase
      .from("context_snapshots")
      .select(
        "id, title, summary, decision, rationale, ai_tool, tags, created_at, visibility, author_handle, created_by"
      )
      .or(orClause)
      .order("created_at", { ascending: false })
      .limit(8);
    if (s === "team") {
      q = q.eq("team_id", profile!.team_id).eq("visibility", "team");
    } else {
      q = q.eq("created_by", user!.id).eq("visibility", "personal");
    }
    const { data, error } = await q;
    if (error) {
      // Graceful fallback if migration not applied:
      // - team scope is "not unlocked yet" → return empty.
      // - personal scope → search the asker's own captures.
      if (/visibility|author_handle/i.test(error.message ?? "")) {
        if (s === "team") return [];
        const legacy = await supabase
          .from("context_snapshots")
          .select(
            "id, title, summary, decision, rationale, ai_tool, tags, created_at, created_by"
          )
          .eq("team_id", profile!.team_id)
          .eq("created_by", user!.id)
          .or(orClause)
          .order("created_at", { ascending: false })
          .limit(8);
        return (legacy.data ?? []) as SourceRow[];
      }
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
    let q = supabase
      .from("context_snapshots")
      .select(
        "id, title, summary, decision, rationale, ai_tool, tags, created_at, visibility, author_handle, created_by"
      )
      .in("id", missingSemanticIds);
    const { data, error } = await q;
    if (error && /visibility|author_handle/i.test(error.message ?? "")) {
      const legacy = await supabase
        .from("context_snapshots")
        .select(
          "id, title, summary, decision, rationale, ai_tool, tags, created_at, created_by"
        )
        .in("id", missingSemanticIds);
      semanticRows = (legacy.data ?? []) as SourceRow[];
    } else if (!error) {
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
  const scored = results
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
    )
    .slice(0, 4);
  const sources = scored.map((s) => s.row);

  if (sources.length === 0) {
    const hint =
      scope === "team"
        ? "No matching team snapshots found. Try Personal scope, or capture some chats in Team mode first."
        : scope === "personal"
        ? "No matching personal snapshots found. Try a broader question, or switch to Team scope."
        : "No matching snapshots found. Capture more AI conversations and try again.";
    return NextResponse.json({
      answer: hint,
      sources: [],
      queryId: null,
      scope,
    });
  }

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

  let answer: string;
  let confidence: number | null = null;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are a precise knowledge assistant. Answer the user's question using ONLY the captured contexts that are actually relevant to the question.

Question: ${question}

Candidate contexts (some may be irrelevant — IGNORE any that don't substantively answer the question):
${contextBlock}

Strict rules:
- Use a context ONLY if its content directly addresses the question. If it merely mentions a related word but is about a different topic, DO NOT cite it.
- Cite the contexts you actually use with [1], [2], etc. matching the numbering above.
- DO NOT cite a context just to pad the answer. Better to cite one source well than four loosely.
- If NONE of the contexts answer the question, respond exactly with: "I don't have a captured conversation that answers this. Try rephrasing, or capture a chat on this topic."
- Be concise (2-4 paragraphs max). No filler.
- End with a single line: CONFIDENCE: [0.0-1.0]`,
        },
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

  // ----- Honest source filter -----
  // Only return sources that Claude actually CITED in the answer. Anything
  // we fetched but the model didn't use was off-topic noise; showing it as
  // a "source" would lie to the user. Renumber [N] markers in the answer
  // so the displayed citations stay 1..K with no gaps.
  const citedNumbers = new Set<number>();
  const citationRegex = /\[(\d+)\]/g;
  let cm: RegExpExecArray | null;
  while ((cm = citationRegex.exec(answer)) !== null) {
    const n = parseInt(cm[1], 10);
    if (n >= 1 && n <= sources.length) citedNumbers.add(n);
  }

  // If the model produced a real answer with no citations (e.g. the
  // "I don't have a captured conversation..." escape hatch), drop all
  // sources. Otherwise keep only the cited ones.
  const isNoMatch = /^i don'?t have a captured conversation/i.test(answer.trim());

  let finalSources = sources;
  let finalAnswer = answer;
  if (isNoMatch) {
    finalSources = [];
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
  } else {
    // No citations at all — be honest and return zero sources rather than
    // implying the answer was grounded in something specific.
    finalSources = [];
  }

  const { data: savedQuery } = await supabase
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
    queryId: savedQuery?.id ?? null,
  });
}
