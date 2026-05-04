/**
 * Contradiction Detector — Phase 12: Trustworthy Brief Generation
 *
 * Given a newly extracted claim + its embedding, finds semantically similar
 * existing claims in the same project and checks whether they conflict.
 *
 * Two-step approach:
 *   1. Vector similarity search (fast, cheap) — candidates must score > 0.80
 *   2. Claude binary classification (precise) — "do these two claims contradict?"
 *
 * This is deliberately strict: better to miss a contradiction than to
 * incorrectly flag two non-conflicting claims and confuse the user.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import type { ClaimType } from "@/lib/claims-extractor";

export interface ConflictResult {
  existingClaimId: string;
  existingClaimText: string;
  reason: string;
}

interface NearestClaimRow {
  id: string;
  claim_text: string;
  claim_type: string;
  status: string;
  similarity: number;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function detectContradictions(opts: {
  newClaim: {
    id: string;
    text: string;
    type: ClaimType;
    embedding: number[];
  };
  projectId: string;
}): Promise<ConflictResult[]> {
  const { newClaim, projectId } = opts;
  const admin = createAdminClient();

  // Step 1 — Find semantically similar claims via pgvector
  const { data: candidates, error } = await admin.rpc("find_nearest_claims", {
    query_embedding: newClaim.embedding,
    project_id_filter: projectId,
    match_threshold: 0.80,
    match_count: 5,
  });

  if (error) {
    console.warn("[contradiction] find_nearest_claims RPC failed:", error.message);
    return [];
  }

  if (!candidates?.length) return [];

  // Filter: skip if the candidate IS the new claim itself (shouldn't happen, but safe)
  const others = (candidates as NearestClaimRow[]).filter(
    (c) => c.id !== newClaim.id
  );
  if (!others.length) return [];

  // Step 2 — For each candidate, ask Claude if there's a real contradiction
  const conflicts: ConflictResult[] = [];

  for (const candidate of others) {
    try {
      const result = await classifyContradiction(newClaim.text, candidate);
      if (result.contradicts) {
        conflicts.push({
          existingClaimId: candidate.id,
          existingClaimText: candidate.claim_text,
          reason: result.reason,
        });
      }
    } catch (err) {
      console.warn(
        "[contradiction] classification failed for candidate",
        candidate.id,
        err
      );
    }
  }

  return conflicts;
}

// ── Claude binary classifier ──────────────────────────────────────────────────

interface ClassificationResult {
  contradicts: boolean;
  reason: string;
}

async function classifyContradiction(
  newClaimText: string,
  candidate: NearestClaimRow
): Promise<ClassificationResult> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    tools: [
      {
        name: "contradiction_result",
        description: "Report whether two claims contradict each other.",
        input_schema: {
          type: "object" as const,
          properties: {
            contradicts: {
              type: "boolean",
              description:
                "true ONLY if the two claims are genuinely mutually exclusive — one cannot be true if the other is true. false if they are compatible, complementary, or about different aspects.",
            },
            reason: {
              type: "string",
              description:
                "One sentence explaining WHY they contradict (or don't). Max 120 chars.",
            },
          },
          required: ["contradicts", "reason"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "contradiction_result" },
    messages: [
      {
        role: "user",
        content: `Do these two project claims DIRECTLY CONTRADICT each other?

Be conservative: only answer true if one claim makes the other impossible or false.
"Use Redis for caching" vs "Do not use Redis" → contradicts.
"Use PostgreSQL" vs "Use Redis for caching" → does NOT contradict (different purposes).
"Authentication via GitHub OAuth" vs "Authentication via email/password" → contradicts (two auth strategies for the same flow).

CLAIM A (new): ${newClaimText}

CLAIM B (existing): ${candidate.claim_text}

Call contradiction_result with your verdict.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { contradicts: false, reason: "classification unavailable" };
  }

  const result = toolUse.input as ClassificationResult;
  return {
    contradicts: result.contradicts === true,
    reason: result.reason ?? "",
  };
}
