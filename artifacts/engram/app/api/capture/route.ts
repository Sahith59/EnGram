import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensureUserTeam } from "@/lib/team";
import { hashConversation, hashConversationIdentity } from "@/lib/hash";
import { buildSnapshotEmbeddingInput, embedText } from "@/lib/embeddings";
import { assignSnapshotToProject } from "@/lib/clustering";
import { detectRepoFromConversation, DetectedRepo } from "@/lib/repo-detector";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * POST /api/capture
 * Two auth modes supported:
 *  1. Session cookie (preferred — extension uses credentials: 'include').
 *  2. Shared secret + explicit userId in body (legacy / for testing).
 *
 * Routing priority:
 *  1. Semantic repo match — embed conversation → search all indexed repo
 *     chunks → highest-scoring repo's project wins (content-driven, no tab
 *     detection needed, works with unlimited GitHub tabs open).
 *  2. Embedding centroid clustering — fallback for generic conversations that
 *     don't clearly match any indexed codebase.
 *
 * Response includes detectedProject so the extension popup can show
 * "Saved to: repo-name" with a "Wrong repo?" one-click correction.
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
  const visibility: "personal" | "team" =
    body.mode === "team" ? "team" : "personal";
  if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !tool) {
    return withCors(
      NextResponse.json({ error: "Missing required fields" }, { status: 400 }),
      request
    );
  }

  // ----- Resolve team_id -----
  const admin = createAdminClient();
  let resolvedTeamId = teamId;

  if (resolvedTeamId) {
    const { data: membership } = await admin
      .from("team_members")
      .select("team_id")
      .eq("team_id", resolvedTeamId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) {
      return withCors(
        NextResponse.json(
          { error: "Not a member of the requested team" },
          { status: 403 }
        ),
        request
      );
    }
  }

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

  // ----- Dedup: Tier 1 exact content match -----
  const contentHash = hashConversation(pairs);
  const identityHash = hashConversationIdentity(pairs);

  let exact: { id: string; title: string; summary: string | null } | null = null;
  try {
    const r = await admin
      .from("context_snapshots")
      .select("id, title, summary")
      .eq("team_id", resolvedTeamId)
      .eq("created_by", userId)
      .eq("visibility", visibility)
      .eq("content_hash", contentHash)
      .order("created_at", { ascending: false })
      .limit(1);
    exact = r.data?.[0] ?? null;
  } catch {
    // content_hash column missing — fall through
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

  // ----- Dedup: Tier 1.5 same source URL -----
  type Sibling = {
    id: string;
    title: string;
    summary: string | null;
    raw_conversation: unknown;
    created_at: string;
  };
  let urlMatch: Sibling | null = null;
  if (url) {
    try {
      const r = await admin
        .from("context_snapshots")
        .select("id, title, summary, raw_conversation, created_at")
        .eq("team_id", resolvedTeamId)
        .eq("created_by", userId)
        .eq("visibility", visibility)
        .eq("source_url", url)
        .order("created_at", { ascending: false })
        .limit(1);
      urlMatch = (r.data?.[0] as Sibling | undefined) ?? null;
    } catch {
      // source_url column missing — skip
    }
  }
  if (urlMatch) {
    const oldPairCount = Array.isArray(urlMatch.raw_conversation)
      ? urlMatch.raw_conversation.length
      : 0;
    if (oldPairCount >= pairs.length) {
      return withCors(
        NextResponse.json(
          {
            success: true,
            duplicate: true,
            id: urlMatch.id,
            title: urlMatch.title,
            summary: urlMatch.summary,
            message: "Same conversation URL — reused existing snapshot.",
          },
          { status: 200 }
        ),
        request
      );
    }
  }

  // ----- Dedup: Tier 2 same identity -----
  let sibling: Sibling | null = urlMatch;
  if (!sibling) {
    try {
      const r = await admin
        .from("context_snapshots")
        .select("id, title, summary, raw_conversation, created_at")
        .eq("team_id", resolvedTeamId)
        .eq("created_by", userId)
        .eq("visibility", visibility)
        .eq("identity_hash", identityHash)
        .order("created_at", { ascending: false })
        .limit(1);
      sibling = (r.data?.[0] as Sibling | undefined) ?? null;
    } catch {
      // identity_hash doesn't exist — skip tier 2
    }
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
    .slice(0, 180_000);

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

  // ----- Generate embedding -----
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

  // ----- Semantic repo detection (runs in parallel with author lookup) -----
  // This is the "Content Wins" router: match the conversation against every
  // indexed repo's code chunks. The highest-scoring repo's project wins.
  // No tab detection — purely content-driven, handles unlimited open tabs.
  let detectedRepo: DetectedRepo | null = null;
  let authorHandle: string | null = null;

  const [detectionResult, authorResult] = await Promise.allSettled([
    embeddingVec
      ? detectRepoFromConversation({
          embedding: embeddingVec,
          teamId: resolvedTeamId,
        })
      : Promise.resolve(null),
    visibility === "team"
      ? admin
          .from("profiles")
          .select("full_name, email")
          .eq("id", userId)
          .maybeSingle()
      : Promise.resolve(null),
  ]);

  if (detectionResult.status === "fulfilled") {
    detectedRepo = detectionResult.value;
    if (detectedRepo) {
      console.log(
        `[capture] semantic routing → project "${detectedRepo.projectName}" ` +
          `(${detectedRepo.repoFullName}) score=${detectedRepo.score.toFixed(3)} ` +
          `confident=${detectedRepo.confident}`
      );
    }
  } else {
    console.warn("[capture] repo detection failed:", detectionResult.reason);
  }

  if (authorResult.status === "fulfilled" && authorResult.value) {
    const prof = (authorResult.value as { data?: { full_name?: string; email?: string } | null })
      ?.data;
    authorHandle =
      prof?.full_name?.trim() ||
      (prof?.email ? prof.email.split("@")[0] : null) ||
      "anonymous";
  }

  // ----- Build write payload -----
  const corePayload: Record<string, unknown> = {
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

  // If semantic routing found a project, bake it in immediately —
  // no need for the fire-and-forget clustering step.
  if (detectedRepo) {
    corePayload.project_id = detectedRepo.projectId;
  }

  const optionalDedupFields = {
    content_hash: contentHash,
    identity_hash: identityHash,
    source_url: url ?? null,
    visibility,
    author_handle: authorHandle,
    ...(embeddingVec ? { embedding: embeddingVec } : {}),
  };

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

  // ----- UPDATE existing sibling -----
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

    // If no semantic match, fall back to centroid clustering asynchronously
    if (!detectedRepo && embeddingVec && resolvedTeamId) {
      Promise.resolve().then(() =>
        assignSnapshotToProject({
          snapshotId: updated.id,
          teamId: resolvedTeamId!,
          embedding: embeddingVec!,
          title: extraction.title,
          summary: extraction.summary,
        }).catch((e) =>
          console.warn("[capture] clustering fire-and-forget error:", e)
        )
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
          detectedProject: detectedRepo
            ? {
                id: detectedRepo.projectId,
                name: detectedRepo.projectName,
                repo: detectedRepo.repoFullName,
                score: detectedRepo.score,
                confident: detectedRepo.confident,
              }
            : null,
        },
        { status: 200 }
      ),
      request
    );
  }

  // ----- INSERT new snapshot -----
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

  // Unique-violation race: look up winner
  if (insertError && insertError.code === "23505") {
    const winnerQ = await admin
      .from("context_snapshots")
      .select("id, title, summary")
      .eq("team_id", resolvedTeamId)
      .eq("created_by", userId)
      .eq("visibility", visibility)
      .or(
        url
          ? `content_hash.eq.${contentHash},source_url.eq.${url}`
          : `content_hash.eq.${contentHash}`
      )
      .order("created_at", { ascending: false })
      .limit(1);
    const winner = winnerQ.data?.[0];
    if (winner) {
      return withCors(
        NextResponse.json(
          {
            success: true,
            duplicate: true,
            id: winner.id,
            title: winner.title,
            summary: winner.summary,
            message: "Concurrent capture deduplicated — reused existing snapshot.",
          },
          { status: 200 }
        ),
        request
      );
    }
  }

  if (insertError || !snapshot) {
    console.error("DB insert failed:", insertError);
    return withCors(
      NextResponse.json({ error: "Failed to save snapshot" }, { status: 500 }),
      request
    );
  }

  // If no semantic match, fall back to centroid clustering asynchronously
  if (!detectedRepo && embeddingVec && resolvedTeamId && snapshot) {
    Promise.resolve().then(() =>
      assignSnapshotToProject({
        snapshotId: snapshot.id,
        teamId: resolvedTeamId!,
        embedding: embeddingVec!,
        title: extraction.title,
        summary: extraction.summary,
      }).catch((e) =>
        console.warn("[capture] clustering fire-and-forget error:", e)
      )
    );
  }

  return withCors(
    NextResponse.json(
      {
        success: true,
        id: snapshot.id,
        title: snapshot.title,
        summary: snapshot.summary,
        detectedProject: detectedRepo
          ? {
              id: detectedRepo.projectId,
              name: detectedRepo.projectName,
              repo: detectedRepo.repoFullName,
              score: detectedRepo.score,
              confident: detectedRepo.confident,
            }
          : null,
      },
      { status: 201 }
    ),
    request
  );
}
