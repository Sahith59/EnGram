import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";

export async function POST(request: NextRequest) {
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

  let body: { question: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { question } = body;
  if (!question?.trim()) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const searchTerms = question
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join(" | ");

  const { data: results } = await supabase
    .from("context_snapshots")
    .select("id, title, summary, decision, rationale, ai_tool, tags, created_at")
    .eq("team_id", profile.team_id)
    .or(
      `title.ilike.%${question}%,summary.ilike.%${question}%,decision.ilike.%${question}%,rationale.ilike.%${question}%`
    )
    .order("created_at", { ascending: false })
    .limit(8);

  const sources = results ?? [];

  if (sources.length === 0) {
    return NextResponse.json({
      answer:
        "No relevant context snapshots found for your question. Try capturing more AI conversations first.",
      sources: [],
      queryId: null,
    });
  }

  const contextBlock = sources
    .map(
      (s, i) => `[${i + 1}] **${s.title}** (${s.ai_tool}, ${new Date(s.created_at).toLocaleDateString()})
Summary: ${s.summary ?? "N/A"}
Decision: ${s.decision ?? "N/A"}
Rationale: ${s.rationale ? s.rationale.slice(0, 400) : "N/A"}`
    )
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
          content: `You are a knowledge assistant for a software team. Based on the following captured AI conversation contexts, answer the team's question.

Question: ${question}

Relevant contexts:
${contextBlock}

Instructions:
- Answer directly and specifically based on the provided contexts
- Cite sources using [1], [2], etc.
- If the contexts don't fully answer the question, say so
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
      confidence: confidence !== null ? Math.min(1, Math.max(0, confidence)) : null,
    })
    .select("id")
    .single();

  return NextResponse.json({
    answer,
    sources: sources.map((s, i) => ({
      ref: i + 1,
      id: s.id,
      title: s.title,
      ai_tool: s.ai_tool,
      created_at: s.created_at,
    })),
    queryId: savedQuery?.id ?? null,
  });
}
