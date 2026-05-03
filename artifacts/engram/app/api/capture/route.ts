import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensureUserTeam } from "@/lib/team";
import { hashConversation, hashConversationIdentity } from "@/lib/hash";

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
  const sessionUser = sessionRes.data.user;
  let userId: string | null = sessionUser?.id ?? null;
  let userEmail: string | null = sessionUser?.email ?? null;
  let userMeta = sessionUser?.user_metadata as
    | { full_name?: string; avatar_url?: string }
    | undefined;

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

  // ----- Resolve team_id (auto-create personal workspace if missing) -----
  const admin = createAdminClient();
  let resolvedTeamId = teamId;
  if (!resolvedTeamId) {
    resolvedTeamId =
      (await ensureUserTeam({
        id: userId,
        email: userEmail,
        user_metadata: userMeta ?? null,
      })) ?? undefined;
  }
  if (!resolvedTeamId) {
    return withCors(
      NextResponse.json({ error: "Could not bootstrap workspace" }, { status: 500 }),
      request
    );
  }

  // ----- Dedup logic (two-tier) -----
  // 1. content_hash: exact-match → no-op (no LLM call, no DB write)
  // 2. identity_hash: same conversation, more content → UPDATE in place
  //
  // identity_hash is the hash of the first 1-2 messages, which doesn't
  // change as the conversation grows. This collapses follow-up captures
  // into the same row instead of creating duplicates.
  const contentHash = hashConversation(pairs);
  const identityHash = hashConversationIdentity(pairs);

  // Tier 1: exact content match → return as-is, zero work
  const { data: exact } = await admin
    .from("context_snapshots")
    .select("id, title, summary")
    .eq("team_id", resolvedTeamId)
    .eq("content_hash", contentHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (exact) {
    return withCors(
      NextResponse.json(
        {
          success: true,
          duplicate: true,
          id: exact.id,
          title: exact.title,
          summary: exact.summary,
          message: "Content unchanged — reused existing snapshot.",
        },
        { status: 200 }
      ),
      request
    );
  }

  // Tier 2: same conversation identity, possibly grown
  const { data: sibling } = await admin
    .from("context_snapshots")
    .select("id, title, summary, raw_conversation, created_at")
    .eq("team_id", resolvedTeamId)
    .eq("identity_hash", identityHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const willUpdateExisting = !!sibling;
  if (sibling) {
    const oldPairCount = Array.isArray(sibling.raw_conversation)
      ? sibling.raw_conversation.length
      : 0;
    if (oldPairCount >= pairs.length) {
      // Existing has equal-or-more content — return it, don't downgrade
      return withCors(
        NextResponse.json(
          {
            success: true,
            duplicate: true,
            id: sibling.id,
            title: sibling.title,
            summary: sibling.summary,
            message: "Existing snapshot already has this content.",
          },
          { status: 200 }
        ),
        request
      );
    }
    // Otherwise we'll re-run Claude on the full longer content and UPDATE.
  }

  // ----- Summarize via Claude -----
  const conversationText = pairs
    .map((p) => `${p.role.toUpperCase()}: ${p.content}`)
    .join("\n\n")
    .slice(0, 180_000); // ~150K chars for very long projects

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
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `You are ENGRAM, a context-engineering system. Your job is to produce a HANDOFF BRIEF that another AI (Claude, ChatGPT, Gemini) can use to continue this project from a cold start WITHOUT hallucinating.

CRITICAL RULES:
1. NEVER invent facts. If something isn't in the conversation, omit it.
2. Quote verbatim where precision matters (code, file paths, names, exact requirements, error messages).
3. Preserve all code blocks exactly as written, in fenced code blocks with language tags.
4. Capture intent and constraints, not just what was done.

Return ONLY valid JSON (no commentary, no markdown fences) with these fields:
- title: string (concise, max 80 chars — what is this project actually about?)
- summary: string (2-4 sentence executive summary)
- key_decisions: string (paragraph listing the concrete decisions made and WHY)
- technologies: string[] (every named tool, framework, library, language, service)
- context_md: string (the full handoff brief — markdown, can be long, structured as below)

The context_md MUST follow this structure:

# <Project Title>

## 1. Project Goal
What is the user actually trying to build/decide/solve? In their own words where possible.

## 2. Current State
What has been built/decided/agreed so far? Be concrete.

## 3. Key Decisions & Rationale
Numbered list. Each decision: what was chosen, what alternatives were rejected, why.

## 4. Code, Schemas, & Artifacts
All code blocks, SQL, configs, file structures discussed — verbatim. Use fenced blocks with language tags. If long, include the most recent/relevant version.

## 5. Constraints & Non-Goals
Hard requirements, things explicitly ruled out, dependencies, deadlines.

## 6. Open Questions / Unresolved
Anything left dangling, blocked, or pending the user's decision.

## 7. Immediate Next Steps
What was the user about to do next? What were they asking when this snapshot was taken?

## 8. Verbatim Tail
The last 2-3 exchanges, verbatim, so the receiving AI has ground-truth recent context. Use:
> **USER:** ...
> **ASSISTANT:** ...

## 9. Glossary
Project-specific terms, codenames, custom abbreviations the user has used.

## 10. Verification Checkpoint
3-5 specific facts the receiving AI MUST acknowledge before generating new work, e.g. "Confirm the database is Postgres with pgvector enabled" — these prevent silent drift.

If a section has no content, write "_None._" — do not omit the section.

CONVERSATION TO ANALYZE:
${conversationText}

Source URL: ${url || "unknown"}
Captured: ${new Date().toISOString()}`,
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

  // ----- Persist: UPDATE existing sibling, or INSERT new -----
  const payload = {
    team_id: resolvedTeamId,
    created_by: userId,
    title: extraction.title ?? "Untitled",
    summary: extraction.summary ?? null,
    ai_tool: tool as "chatgpt" | "claude" | "gemini" | "other",
    raw_conversation: pairs,
    tags: extraction.technologies ?? [],
    decision: extraction.key_decisions ?? null,
    rationale: extraction.context_md ?? null,
    content_hash: contentHash,
    identity_hash: identityHash,
    source_url: url ?? null,
  };

  if (willUpdateExisting && sibling) {
    const { data: updated, error: updateError } = await admin
      .from("context_snapshots")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", sibling.id)
      .select("id, title, summary")
      .single();

    if (updateError) {
      console.error("DB update failed:", updateError);
      return withCors(
        NextResponse.json({ error: "Failed to update snapshot" }, { status: 500 }),
        request
      );
    }

    return withCors(
      NextResponse.json(
        {
          success: true,
          updated: true,
          id: updated.id,
          title: updated.title,
          summary: updated.summary,
          message: "Existing snapshot updated with new conversation content.",
        },
        { status: 200 }
      ),
      request
    );
  }

  const { data: snapshot, error: insertError } = await admin
    .from("context_snapshots")
    .insert(payload)
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
