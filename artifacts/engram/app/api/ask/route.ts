import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";
import { isSupabaseConfigured } from "@/lib/supabase/config";

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
      // Graceful fallback if migration not applied
      if (/visibility|author_handle/i.test(error.message ?? "")) {
        const legacy = await supabase
          .from("context_snapshots")
          .select(
            "id, title, summary, decision, rationale, ai_tool, tags, created_at, created_by"
          )
          .eq("team_id", profile!.team_id)
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

  let results: SourceRow[] = [];
  if (scope === "all") {
    const [personal, team] = await Promise.all([
      fetchScoped("personal"),
      fetchScoped("team"),
    ]);
    // De-dup by id, keep the first occurrence
    const seen = new Set<string>();
    results = [...personal, ...team]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
      .slice(0, 12);
  } else {
    results = await fetchScoped(scope);
  }

  const sources = results;

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
          content: `You are a knowledge assistant. Based on the following captured AI conversation contexts, answer the question.

Question: ${question}

Relevant contexts:
${contextBlock}

Instructions:
- Answer directly and specifically based on the provided contexts
- Cite sources using [1], [2], etc.
- If the contexts don't fully answer the question, say so honestly
- Be concise (2-4 paragraphs max)
- End with: CONFIDENCE: [0.0-1.0] (your confidence that this answer is correct based on the sources)`,
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

  const { data: savedQuery } = await supabase
    .from("kt_queries")
    .insert({
      team_id: profile.team_id,
      asked_by: user.id,
      question,
      answer,
      source_snapshot_ids: sources.map((s) => s.id),
      confidence:
        confidence !== null ? Math.min(1, Math.max(0, confidence)) : null,
    })
    .select("id")
    .single();

  return NextResponse.json({
    answer,
    confidence,
    scope,
    sources: sources.map((s, i) => ({
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
