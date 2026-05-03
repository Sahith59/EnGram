import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * POST /api/capture
 * Two auth modes supported:
 *  1. Session cookie (preferred — extension uses credentials: 'include').
 *  2. Shared secret + explicit userId in body (legacy / for testing).
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return withCors(
      NextResponse.json({ error: "Supabase not configured" }, { status: 503 }),
      request
    );
  }

  // ----- Parse body first so we can fall back to secret-based auth -----
  let body: {
    pairs: { role: string; content: string }[];
    tool: string;
    url: string;
    userId?: string;
    teamId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return withCors(
      NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
      request
    );
  }

  // ----- Resolve identity -----
  const supabase = await createClient();
  const sessionRes = await supabase.auth.getUser();
  let userId: string | null = sessionRes.data.user?.id ?? null;

  if (!userId) {
    // Fallback: shared-secret + explicit userId
    const secret = request.headers.get("x-engram-secret");
    if (!secret || secret !== process.env.EXTENSION_SECRET) {
      return withCors(
        NextResponse.json(
          { error: "Unauthorized. Sign into the ENGRAM dashboard in this browser." },
          { status: 401 }
        ),
        request
      );
    }
    if (!body.userId) {
      return withCors(
        NextResponse.json({ error: "Missing userId" }, { status: 400 }),
        request
      );
    }
    userId = body.userId;
  }

  const { pairs, tool, url, teamId } = body;
  if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !tool) {
    return withCors(
      NextResponse.json({ error: "Missing required fields" }, { status: 400 }),
      request
    );
  }

  // ----- Resolve team_id -----
  const admin = createAdminClient();
  let resolvedTeamId = teamId;
  if (!resolvedTeamId) {
    const { data: profile } = await admin
      .from("profiles")
      .select("team_id")
      .eq("id", userId)
      .maybeSingle();
    resolvedTeamId = profile?.team_id ?? undefined;
  }
  if (!resolvedTeamId) {
    return withCors(
      NextResponse.json({ error: "User has no team" }, { status: 400 }),
      request
    );
  }

  // ----- Summarize via Claude -----
  const conversationText = pairs
    .map((p) => `${p.role.toUpperCase()}: ${p.content}`)
    .join("\n\n")
    .slice(0, 60_000); // cap to keep prompts bounded

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
      NextResponse.json({ error: "AI extraction failed" }, { status: 500 }),
      request
    );
  }

  // ----- Insert snapshot (use admin to bypass RLS scoping headaches) -----
  const { data: snapshot, error: insertError } = await admin
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

  if (insertError) {
    console.error("DB insert failed:", insertError);
    return withCors(
      NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 }),
      request
    );
  }

  return withCors(
    NextResponse.json(
      {
        success: true,
        id: snapshot.id,
        title: snapshot.title,
        summary: snapshot.summary,
      },
      { status: 201 }
    ),
    request
  );
}
