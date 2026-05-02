import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/anthropic";
import { corsOptions, withCors, CORS_HEADERS } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function OPTIONS() {
  return corsOptions();
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return withCors(
      NextResponse.json({ error: "Supabase not configured" }, { status: 503 })
    );
  }
  const secret = request.headers.get("x-engram-secret");
  if (!secret || secret !== process.env.EXTENSION_SECRET) {
    return withCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  let body: {
    pairs: { role: string; content: string }[];
    tool: string;
    url: string;
    userId: string;
    teamId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return withCors(
      NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    );
  }

  const { pairs, tool, url, userId, teamId } = body;

  if (!pairs || !Array.isArray(pairs) || !tool || !userId) {
    return withCors(
      NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    );
  }

  const conversationText = pairs
    .map((p) => `${p.role.toUpperCase()}: ${p.content}`)
    .join("\n\n");

  let extraction: {
    title: string;
    summary: string;
    key_decisions: string;
    technologies: string[];
    context_md: string;
  };

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Analyze this AI conversation and extract structured information. Return ONLY valid JSON with these fields:
- title: string (concise title for what was built/decided, max 80 chars)
- summary: string (2-3 sentence summary of the outcome)
- key_decisions: string (1-3 key decisions made, as a paragraph)
- technologies: string[] (tech stack items mentioned, e.g. ["React", "Postgres"])
- context_md: string (full markdown document capturing the conversation context, decisions, and rationale for future reference)

Conversation:
${conversationText}

Source URL: ${url || "unknown"}`,
        },
      ],
    });

    const rawText =
      message.content[0].type === "text" ? message.content[0].text : "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    extraction = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch (err) {
    console.error("Claude extraction failed:", err);
    return withCors(
      NextResponse.json({ error: "AI extraction failed" }, { status: 500 })
    );
  }

  const supabase = await createClient();

  let resolvedTeamId = teamId;
  if (!resolvedTeamId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("team_id")
      .eq("id", userId)
      .single();
    resolvedTeamId = profile?.team_id ?? undefined;
  }

  if (!resolvedTeamId) {
    return withCors(
      NextResponse.json({ error: "User has no team" }, { status: 400 })
    );
  }

  const { data: snapshot, error } = await supabase
    .from("context_snapshots")
    .insert({
      team_id: resolvedTeamId,
      created_by: userId,
      title: extraction.title ?? "Untitled",
      summary: extraction.summary ?? null,
      ai_tool: tool as "chatgpt" | "claude" | "gemini" | "other",
      raw_conversation: pairs,
      tags: extraction.technologies ?? [],
      decision: extraction.key_decisions ?? null,
      rationale: extraction.context_md ?? null,
    })
    .select("id, title, summary")
    .single();

  if (error) {
    console.error("DB insert failed:", error);
    return withCors(
      NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 })
    );
  }

  return NextResponse.json(
    { success: true, id: snapshot.id, title: snapshot.title, summary: snapshot.summary },
    { status: 201, headers: CORS_HEADERS }
  );
}
