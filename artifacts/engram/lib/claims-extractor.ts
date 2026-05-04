/**
 * Claims Extractor — Phase 12: Trustworthy Brief Generation
 *
 * Extracts discrete, attributable claims from a captured conversation.
 * Every claim is:
 *   - Atomic (one statement per claim)
 *   - Sourced (tied to a specific snapshot_id)
 *   - Typed (decision / constraint / next_step / technology / dead_end / observation)
 *   - Verbatim where precision matters
 *
 * This is the foundation of trust: nothing gets injected into a brief
 * that doesn't trace back to a real captured conversation.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { embedText } from "@/lib/embeddings";
import { detectContradictions } from "@/lib/contradiction-detector";

export type ClaimType =
  | "decision"
  | "constraint"
  | "next_step"
  | "technology"
  | "dead_end"
  | "observation";

export interface ExtractedClaim {
  claim_text: string;
  claim_type: ClaimType;
  verbatim_evidence?: string; // direct quote from conversation if available
}

interface ClaimExtractionResult {
  claims: ExtractedClaim[];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function extractClaimsFromSnapshot(opts: {
  snapshotId: string;
  projectId: string;
  teamId: string;
  createdBy: string;
  conversationText: string;
  title: string;
  summary: string;
}): Promise<void> {
  const { snapshotId, projectId, teamId, createdBy, conversationText, title } =
    opts;
  const admin = createAdminClient();

  try {
    // Step 1 — Extract structured claims via Claude
    const rawClaims = await extractClaimsViaClaude(conversationText, title);
    if (!rawClaims.length) {
      console.log(`[claims] no claims extracted from snapshot ${snapshotId}`);
      return;
    }

    console.log(
      `[claims] extracted ${rawClaims.length} claims from snapshot ${snapshotId}`
    );

    // Step 2 — Check for existing claims from this snapshot (re-capture scenario)
    // Delete stale claims so we don't double-count when a conversation is updated.
    await admin
      .from("project_claims")
      .delete()
      .eq("snapshot_id", snapshotId)
      .eq("project_id", projectId);

    // Step 3 — For each claim: embed → contradiction check → upsert
    for (const raw of rawClaims) {
      try {
        await processOneClaim({
          raw,
          snapshotId,
          projectId,
          teamId,
          createdBy,
          admin,
        });
      } catch (err) {
        // One claim failing must never abort the rest
        console.warn(
          `[claims] failed to process claim "${raw.claim_text.slice(0, 60)}":`,
          err
        );
      }
    }

    // Step 4 — Reinforce claims that already exist in other snapshots of this project.
    // If the same concept appears again, bump reinforcement_count + last_seen_at.
    await reinforceExistingClaims({ projectId, snapshotId, rawClaims, admin });

    console.log(
      `[claims] finished processing snapshot ${snapshotId} → project ${projectId}`
    );
  } catch (err) {
    // Non-fatal: claims are enhancement, not core capture
    console.warn("[claims] extraction pipeline error:", err);
  }
}

// ── Claude extraction ─────────────────────────────────────────────────────────

async function extractClaimsViaClaude(
  conversationText: string,
  title: string
): Promise<ExtractedClaim[]> {
  const trimmed = conversationText.slice(0, 120_000);

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    tools: [
      {
        name: "save_claims",
        description:
          "Save structured, atomic claims extracted from the conversation. Each claim must be directly evidenced in the conversation — never inferred or invented.",
        input_schema: {
          type: "object" as const,
          properties: {
            claims: {
              type: "array",
              description:
                "Array of discrete, atomic claims. Each is one statement, not compound.",
              items: {
                type: "object",
                properties: {
                  claim_text: {
                    type: "string",
                    description:
                      "The claim, written as a clear declarative sentence. Max 200 chars. Quote verbatim where precision matters.",
                  },
                  claim_type: {
                    type: "string",
                    enum: [
                      "decision",
                      "constraint",
                      "next_step",
                      "technology",
                      "dead_end",
                      "observation",
                    ],
                    description:
                      "decision=concrete choice made; constraint=hard limit or non-goal; next_step=planned TODO; technology=tool/lib actively used; dead_end=tried and abandoned; observation=current factual state",
                  },
                  verbatim_evidence: {
                    type: "string",
                    description:
                      "Optional: a short direct quote from the conversation that proves this claim. Max 150 chars.",
                  },
                },
                required: ["claim_text", "claim_type"],
              },
            },
          },
          required: ["claims"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_claims" },
    messages: [
      {
        role: "user",
        content: `You are ENGRAM's claims extractor. Extract ONLY discrete, verifiable claims from this conversation.

STRICT RULES:
1. NEVER invent or infer claims. If something is not explicitly stated, skip it.
2. Each claim must be ATOMIC — one statement only. Split compound statements.
3. Be specific. Bad: "They discussed databases." Good: "PostgreSQL was chosen as the primary database."
4. For decisions, always include the WHY if stated. Quote exact words for critical names, paths, values.
5. Mark items as dead_end only if the conversation explicitly says something was tried and abandoned.
6. Skip pleasantries, meta-discussion, and clarifying questions that led nowhere.
7. Technologies: only list tools/frameworks/services being ACTIVELY USED, not those merely mentioned as alternatives.

CONVERSATION TITLE: ${title}

CONVERSATION:
${trimmed}

Call save_claims with every claim you can directly evidence from the text above.`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];

  const result = toolUse.input as ClaimExtractionResult;
  return (result.claims ?? []).filter(
    (c) => c.claim_text && c.claim_type
  ) as ExtractedClaim[];
}

// ── Process one claim: embed → contradiction check → insert ──────────────────

async function processOneClaim(opts: {
  raw: ExtractedClaim;
  snapshotId: string;
  projectId: string;
  teamId: string;
  createdBy: string;
  admin: ReturnType<typeof createAdminClient>;
}) {
  const { raw, snapshotId, projectId, teamId, createdBy, admin } = opts;

  // Embed the claim text for contradiction detection
  let embedding: number[] | null = null;
  try {
    const r = await embedText(raw.claim_text);
    embedding = r?.vector ?? null;
  } catch {
    // Continue without embedding — contradiction detection will be skipped
  }

  // Insert the claim first so we have an ID
  const { data: inserted, error: insertErr } = await admin
    .from("project_claims")
    .insert({
      project_id: projectId,
      snapshot_id: snapshotId,
      team_id: teamId,
      created_by: createdBy,
      claim_text: raw.claim_text,
      claim_type: raw.claim_type,
      status: "active",
      confidence_score: 1.0,
      reinforcement_count: 1,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      embedding: embedding as unknown as string | null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    console.warn("[claims] insert failed:", insertErr?.message);
    return;
  }

  // Contradiction detection — only if we have an embedding
  if (embedding) {
    try {
      const conflicts = await detectContradictions({
        newClaim: {
          id: inserted.id,
          text: raw.claim_text,
          type: raw.claim_type,
          embedding,
        },
        projectId,
      });

      // For each detected conflict, create a conflict record and mark both claims
      for (const conflict of conflicts) {
        // Mark both claims as conflicted
        await admin
          .from("project_claims")
          .update({ status: "conflicted", updated_at: new Date().toISOString() })
          .in("id", [inserted.id, conflict.existingClaimId]);

        // Insert conflict record (ignore duplicate constraint violations)
        await admin.from("claim_conflicts").upsert(
          {
            project_id: projectId,
            claim_a_id: inserted.id,
            claim_b_id: conflict.existingClaimId,
            resolved: false,
          },
          { onConflict: "claim_a_id,claim_b_id", ignoreDuplicates: true }
        );
      }
    } catch (err) {
      console.warn("[claims] contradiction detection failed:", err);
    }
  }
}

// ── Reinforcement: bump existing active claims that reappear ─────────────────

async function reinforceExistingClaims(opts: {
  projectId: string;
  snapshotId: string;
  rawClaims: ExtractedClaim[];
  admin: ReturnType<typeof createAdminClient>;
}) {
  const { projectId, rawClaims, admin } = opts;

  // Fetch existing active claims for this project (from other snapshots)
  const { data: existing } = await admin
    .from("project_claims")
    .select("id, claim_text, reinforcement_count")
    .eq("project_id", projectId)
    .eq("status", "active")
    .limit(200);

  if (!existing?.length) return;

  const now = new Date().toISOString();

  // Simple text-level reinforcement: if an existing claim's text is
  // substantially contained in the new claims, bump it.
  for (const existingClaim of existing) {
    const lowerExisting = existingClaim.claim_text.toLowerCase();
    const wasReinforced = rawClaims.some((raw) => {
      const lowerNew = raw.claim_text.toLowerCase();
      // Overlap check: key words from existing claim appear in new claim
      const existingWords = lowerExisting
        .split(/\s+/)
        .filter((w: string) => w.length > 5);
      if (!existingWords.length) return false;
      const matchCount = existingWords.filter((w: string) =>
        lowerNew.includes(w)
      ).length;
      return matchCount / existingWords.length > 0.6; // 60%+ word overlap
    });

    if (wasReinforced) {
      await admin
        .from("project_claims")
        .update({
          reinforcement_count: (existingClaim.reinforcement_count ?? 1) + 1,
          last_seen_at: now,
          updated_at: now,
        })
        .eq("id", existingClaim.id);
    }
  }
}
