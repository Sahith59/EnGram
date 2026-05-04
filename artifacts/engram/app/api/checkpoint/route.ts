/**
 * POST /api/checkpoint
 *
 * F-04: Mid-conversation cliff fix.
 * Called when the user hits "Save Checkpoint" before a context-limit reset.
 *
 * 1. Saves the current session as a snapshot (same pipeline as /api/capture).
 * 2. Synchronously generates a "Continuation Brief" — blending:
 *    a) A Claude-generated dense bullet summary of THIS session.
 *    b) Top active project claims from ENGRAM memory (persistent context).
 * 3. Returns the brief immediately so the popup can display and copy it.
 *
 * Designed for speed: total round-trip ≤ 4s (parallel summarise + brief fetch).
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildSnapshotEmbeddingInput, embedText } from "@/lib/embeddings";
import { hashConversation } from "@/lib/hash";
import {
  detectRepoFromGitHubUrl,
  detectRepoFromConversation,
  DetectedRepo,
} from "@/lib/repo-detector";
import Anthropic from "@anthropic-ai/sdk";
import { generateProjectBrief } from "@/lib/brief-generator";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  other: "an AI tool",
};

// ─── Session summariser ───────────────────────────────────────────────────────

async function summariseSession(conversationText: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-3-5-haiku-20241022",
    max_tokens: 500,
    system: `You summarise AI conversations for a developer resuming work in a new context window.
Output a dense bullet-list (4-8 bullets max):
- Key decisions made this session
- Approaches chosen or ruled out
- Concrete next steps identified
- Any constraints or blockers surfaced

Rules:
- Be specific. Include actual names/paths/values.
- Past tense for decisions, imperative for next steps.
- No preamble. Start immediately with the first bullet.
- Max 350 words.`,
    messages: [
      {
        role: "user",
        content: `Summarise this session:\n\n${conversationText.slice(0, 12000)}`,
      },
    ],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text.trim() : "";
}

// ─── Quick title extraction (lightweight — no tool_use) ───────────────────────

async function extractTitle(conversationText: string, tool: string): Promise<string> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 60,
      system: "Return ONLY a concise title (max 60 chars) for this conversation. No punctuation at end. No quotes.",
      messages: [{ role: "user", content: conversationText.slice(0, 3000) }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text.trim() : `${TOOL_LABEL[tool] ?? "AI"} Checkpoint`;
  } catch {
    return `${TOOL_LABEL[tool] ?? "AI"} Checkpoint`;
  }
}

// ─── Continuation brief builder ───────────────────────────────────────────────

function buildContinuationBrief({
  sessionSummary,
  projectName,
  projectBriefText,
  tool,
}: {
  sessionSummary: string;
  projectName: string | null;
  projectBriefText: string | null;
  tool: string;
}): string {
  const lines: string[] = [];

  lines.push("━━━ ENGRAM CONTINUATION BRIEF ━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("Paste this at the top of your new conversation to resume.");
  if (projectName) lines.push(`Project: ${projectName}`);
  lines.push("");

  lines.push("## THIS SESSION — What we just covered");
  lines.push(sessionSummary || "(session summary unavailable)");
  lines.push("");

  if (projectBriefText) {
    lines.push("## ENGRAM PROJECT MEMORY — Established context");
    lines.push(projectBriefText);
    lines.push("");
  }

  lines.push("━━━ Resume prompt ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(
    `I'm continuing work on${projectName ? ` ${projectName}` : " a project"} ` +
      `after hitting the context limit in ${TOOL_LABEL[tool] ?? "an AI tool"}. ` +
      `The brief above shows what we covered this session and my established ` +
      `project context from ENGRAM. Please read it carefully before we continue.`
  );
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = await request.json();
  const {
    pairs = [],
    tool = "other",
    url,
    teamId,
    userId: bodyUserId,
  } = body as {
    pairs: { role: string; content: string }[];
    tool: string;
    url?: string;
    teamId?: string;
    userId?: string;
  };

  // Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? bodyUserId;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Resolve team
  let resolvedTeamId = teamId ?? null;
  if (!resolvedTeamId) {
    const { data: tm } = await admin
      .from("team_members")
      .select("team_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    resolvedTeamId = tm?.team_id ?? null;
  }

  // Build conversation text
  const conversationText = pairs
    .map((p) => `${p.role}: ${p.content}`)
    .join("\n\n");

  if (!conversationText.trim()) {
    return NextResponse.json({ error: "No conversation content" }, { status: 400 });
  }

  // ── Parallel: title extraction + embedding ────────────────────────────────
  const [titleResult, embedResult] = await Promise.allSettled([
    extractTitle(conversationText, tool),
    (async () => {
      const r = await embedText(conversationText.slice(0, 8000));
      return r?.vector ?? null;
    })(),
  ]);

  const title = titleResult.status === "fulfilled"
    ? titleResult.value
    : `${TOOL_LABEL[tool] ?? "AI"} Checkpoint`;

  const embeddingVec: number[] | null = embedResult.status === "fulfilled"
    ? embedResult.value
    : null;

  // ── Repo detection ────────────────────────────────────────────────────────
  let detectedRepo: DetectedRepo | null = null;
  if (resolvedTeamId) {
    // Tier 1: URL mention in conversation
    detectedRepo = await detectRepoFromGitHubUrl({ pairs, teamId: resolvedTeamId });
    // Tier 2: Semantic similarity
    if (!detectedRepo && embeddingVec) {
      detectedRepo = await detectRepoFromConversation({
        embedding: embeddingVec,
        teamId: resolvedTeamId,
      });
    }
  }

  // ── Save snapshot ─────────────────────────────────────────────────────────
  const contentHash = hashConversation(pairs);

  const embeddingInput = buildSnapshotEmbeddingInput({
    title,
    summary: null,
    decision: null,
    tags: [],
  });
  const embedForStorage = await embedText(embeddingInput).then(r => r?.vector ?? null).catch(() => null);

  const corePayload = {
    team_id: resolvedTeamId,
    created_by: userId,
    title: `[Checkpoint] ${title}`,
    summary: null as string | null,
    decision: null as string | null,
    ai_tool: tool,
    source_url: url ?? null,
    tags: ["checkpoint"] as string[],
    content_hash: contentHash,
    content: conversationText,
    visibility: "personal" as const,
    project_id: detectedRepo?.projectId ?? null,
    ...(embedForStorage ? { embedding: JSON.stringify(embedForStorage) } : {}),
  };

  const { data: snapshot } = await admin
    .from("context_snapshots")
    .insert(corePayload)
    .select("id, title")
    .single();

  // ── Parallel: session summary + project brief ─────────────────────────────
  const [sessionSummaryResult, projectBriefResult] = await Promise.allSettled([
    summariseSession(conversationText),
    detectedRepo?.projectId
      ? generateProjectBrief(detectedRepo.projectId)
      : Promise.resolve(null),
  ]);

  const sessionSummary = sessionSummaryResult.status === "fulfilled"
    ? sessionSummaryResult.value
    : "";

  const projectBriefObj = projectBriefResult.status === "fulfilled"
    ? projectBriefResult.value
    : null;

  // Convert project brief to compact injection text
  let projectBriefText: string | null = null;
  if (projectBriefObj) {
    const { categories } = projectBriefObj;
    const sections: string[] = [];

    function addSection(
      label: string,
      claims: { claim_text: string; is_stale: boolean }[]
    ) {
      const active = claims.filter((c) => !c.is_stale).slice(0, 6);
      if (!active.length) return;
      sections.push(`### ${label}`);
      active.forEach((c) => sections.push(`- ${c.claim_text}`));
    }

    addSection("Decisions", categories.decision);
    addSection("Constraints", categories.constraint);
    addSection("Next Steps", categories.next_step);
    addSection("Technologies", categories.technology);

    if (sections.length) {
      projectBriefText = sections.join("\n");
    }
  }

  // ── Build continuation brief ──────────────────────────────────────────────
  const continuationBrief = buildContinuationBrief({
    sessionSummary,
    projectName: detectedRepo?.projectName ?? projectBriefObj?.project_name ?? null,
    projectBriefText,
    tool,
  });

  return NextResponse.json({
    ok: true,
    snapshot_id: snapshot?.id ?? null,
    continuation_brief: continuationBrief,
    token_estimate: Math.round(continuationBrief.length / 4),
    project_name: detectedRepo?.projectName ?? null,
    project_id: detectedRepo?.projectId ?? null,
    session_title: title,
    claim_count: projectBriefObj?.claim_count ?? 0,
  });
}
