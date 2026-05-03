import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensureUserTeam } from "@/lib/team";
import { hashConversation, hashConversationIdentity } from "@/lib/hash";
import { buildSnapshotEmbeddingInput, embedText } from "@/lib/embeddings";

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
    mode?: "personal" | "team";
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
  // Default to 'personal' so existing extensions (which don't send mode) keep
  // working with the safest possible scope (private to the user).
  const visibility: "personal" | "team" =
    body.mode === "team" ? "team" : "personal";
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

  // ----- Dedup logic (two-tier, gracefully degrades if migration not applied) -----
  const contentHash = hashConversation(pairs);
  const identityHash = hashConversationIdentity(pairs);

  // Tier 1: exact content match → return as-is, zero work
  // Scoped to (team_id, created_by, visibility) so a personal capture and a
  // team capture of the same chat by the same user are distinct rows.
  let exact: { id: string; title: string; summary: string | null } | null = null;
  try {
    let q = admin
      .from("context_snapshots")
      .select("id, title, summary")
      .eq("team_id", resolvedTeamId)
      .eq("created_by", userId)
      .eq("content_hash", contentHash);
    // Try with visibility filter; if column missing, second try drops it.
    try {
      const r = await q.eq("visibility", visibility).order("created_at", { ascending: false }).limit(1).maybeSingle();
      exact = r.data;
    } catch {
      const r = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
      exact = r.data;
    }
  } catch {
    // content_hash column probably missing — skip tier 1.
  }

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
  type Sibling = {
    id: string;
    title: string;
    summary: string | null;
    raw_conversation: unknown;
    created_at: string;
  };
  let sibling: Sibling | null = null;
  try {
    const base = admin
      .from("context_snapshots")
      .select("id, title, summary, raw_conversation, created_at")
      .eq("team_id", resolvedTeamId)
      .eq("created_by", userId)
      .eq("identity_hash", identityHash);
    try {
      const r = await base.eq("visibility", visibility).order("created_at", { ascending: false }).limit(1).maybeSingle();
      sibling = (r.data as Sibling | null) ?? null;
    } catch {
      const r = await base.order("created_at", { ascending: false }).limit(1).maybeSingle();
      sibling = (r.data as Sibling | null) ?? null;
    }
  } catch {
    // identity_hash column doesn't exist — skip tier 2 dedup.
  }

  const willUpdateExisting = !!sibling;
  if (sibling) {
    const oldPairCount = Array.isArray(sibling.raw_conversation)
      ? sibling.raw_conversation.length
      : 0;
    if (oldPairCount >= pairs.length) {
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

  // Use tool_use to GUARANTEE structurally valid output. Anthropic enforces
  // the schema on the model side, so we never hit JSON.parse errors from
  // unescaped quotes, code fences, or truncated strings.
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16384,
      tools: [
        {
          name: "save_handoff_brief",
          description:
            "Save the structured handoff brief that captures everything another AI needs to continue this project without hallucinating.",
          input_schema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description:
                  "Concise project title, max 80 chars. What is this conversation actually about?",
              },
              summary: {
                type: "string",
                description: "2-4 sentence executive summary of the conversation.",
              },
              key_decisions: {
                type: "string",
                description:
                  "Paragraph listing every concrete decision made and WHY. Quote verbatim where precision matters. If none, write 'None.'",
              },
              technologies: {
                type: "array",
                items: { type: "string" },
                description:
                  "Every named tool, framework, library, language, service, or product mentioned.",
              },
              context_md: {
                type: "string",
                description:
                  "The full handoff brief in markdown. MUST follow this structure exactly with all 10 sections (use '_None._' for empty ones):\n\n# <Project Title>\n\n## 1. Project Goal\n## 2. Current State\n## 3. Key Decisions & Rationale\n## 4. Code, Schemas, & Artifacts (verbatim, fenced code blocks)\n## 5. Constraints & Non-Goals\n## 6. Open Questions / Unresolved\n## 7. Immediate Next Steps\n## 8. Verbatim Tail (last 2-3 exchanges, quoted)\n## 9. Glossary\n## 10. Verification Checkpoint (3-5 facts the next AI must echo back)",
              },
            },
            required: [
              "title",
              "summary",
              "key_decisions",
              "technologies",
              "context_md",
            ],
          },
        },
      ],
      tool_choice: { type: "tool", name: "save_handoff_brief" },
      messages: [
        {
          role: "user",
          content: `You are ENGRAM, a context-engineering system. Produce a HANDOFF BRIEF another AI can use to continue this project from a cold start WITHOUT hallucinating.

CRITICAL RULES:
1. NEVER invent facts. If something isn't in the conversation, write 'Not specified' or '_None._' for that section.
2. Quote verbatim where precision matters: code, file paths, names, exact requirements, error messages.
3. Preserve all code blocks exactly as written, in fenced code blocks with language tags.
4. Capture intent and constraints, not just what was done.
5. The context_md must contain ALL 10 sections defined in the tool schema, in order.

CONVERSATION TO ANALYZE:
${conversationText}

Source URL: ${url || "unknown"}
Captured: ${new Date().toISOString()}

Call the save_handoff_brief tool with the structured result.`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Model did not return a tool_use block");
    }
    extraction = toolUse.input as typeof extraction;
    // Defensive defaults — schema requires fields, but be safe
    extraction.title = extraction.title || "Untitled conversation";
    extraction.summary = extraction.summary || "";
    extraction.key_decisions = extraction.key_decisions || "";
    extraction.technologies = Array.isArray(extraction.technologies)
      ? extraction.technologies
      : [];
    extraction.context_md = extraction.context_md || "";
  } catch (err) {
    console.error("Claude extraction failed:", err);
    return withCors(
      NextResponse.json(
        {
          error: "AI extraction failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 500 }
      ),
      request
    );
  }

  // ----- Persist: UPDATE existing sibling, or INSERT new -----
  // Build payload with the optional dedup columns. If the migration hasn't
  // been applied to the DB, the columns won't exist and Supabase will return
  // PGRST204 — we then strip them and retry. This makes the system work
  // out-of-the-box without forcing the user to run SQL.
  const corePayload = {
    team_id: resolvedTeamId,
    created_by: userId,
    title: extraction.title ?? "Untitled",
    summary: extraction.summary ?? null,
    ai_tool: tool as "chatgpt" | "claude" | "gemini" | "other",
    raw_conversation: pairs,
    tags: extraction.technologies ?? [],
    decision: extraction.key_decisions ?? null,
    rationale: extraction.context_md ?? null,
  };
  // Resolve a friendly author handle for shared (team) snapshots so other
  // members can see who captured each one without exposing emails.
  let authorHandle: string | null = null;
  if (visibility === "team") {
    const { data: prof } = await admin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    authorHandle =
      prof?.full_name?.trim() ||
      (prof?.email ? prof.email.split("@")[0] : null) ||
      "anonymous";
  }

  // ----- Generate embedding (Phase 6) -----
  // Best-effort: if OPENAI_API_KEY is unset or the API fails, we still
  // persist the snapshot — embedding stays NULL and Ask falls back to
  // keyword retrieval for that row until backfill runs.
  let embeddingVec: number[] | null = null;
  try {
    const embedInput = buildSnapshotEmbeddingInput({
      title: extraction.title,
      summary: extraction.summary,
      decision: extraction.key_decisions,
      tags: extraction.technologies,
      rationale: extraction.context_md,
    });
    const r = await embedText(embedInput);
    embeddingVec = r?.vector ?? null;
  } catch (e) {
    console.warn(
      "[capture] embedding failed (continuing without):",
      e instanceof Error ? e.message : e
    );
  }

  const optionalDedupFields = {
    content_hash: contentHash,
    identity_hash: identityHash,
    source_url: url ?? null,
    visibility,
    author_handle: authorHandle,
    ...(embeddingVec ? { embedding: embeddingVec } : {}),
  };

  /**
   * Try a Supabase write with the optional dedup columns. If Supabase reports
   * PGRST204 (column missing), retry once without them.
   */
  async function writeWithFallback(
    op: (extra: Record<string, unknown>) => Promise<{
      data: { id: string; title: string; summary: string | null } | null;
      error: { code?: string; message?: string } | null;
    }>
  ) {
    const first = await op(optionalDedupFields);
    if (first.error?.code === "PGRST204") {
      console.warn(
        "[capture] Optional dedup columns missing — falling back. Apply migration 0003_conversation_identity.sql to enable proper dedup."
      );
      return op({});
    }
    return first;
  }

  if (willUpdateExisting && sibling) {
    const { data: updated, error: updateError } = await writeWithFallback(
      (extra) =>
        admin
          .from("context_snapshots")
          .update({ ...corePayload, ...extra, updated_at: new Date().toISOString() })
          .eq("id", sibling!.id)
          .select("id, title, summary")
          .single() as unknown as Promise<{
          data: { id: string; title: string; summary: string | null } | null;
          error: { code?: string; message?: string } | null;
        }>
    );

    if (updateError || !updated) {
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

  const { data: snapshot, error: insertError } = await writeWithFallback(
    (extra) =>
      admin
        .from("context_snapshots")
        .insert({ ...corePayload, ...extra })
        .select("id, title, summary")
        .single() as unknown as Promise<{
        data: { id: string; title: string; summary: string | null } | null;
        error: { code?: string; message?: string } | null;
      }>
  );

  if (insertError || !snapshot) {
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
