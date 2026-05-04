/**
 * commit-linker.ts — Semantic Link Engine
 *
 * Given a git commit (SHA, message, changed files, diff summary), embeds
 * it and finds AI conversations captured within ±4 hours. Matches above
 * similarity 0.40 are stored as `semantic_links`.
 *
 * Also finds the project linked to the repo so we can scope the snapshot
 * search to the correct project.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";

const LINK_THRESHOLD = 0.40;
const WINDOW_HOURS = 4;

export interface CommitLinkInput {
  repoId: string;
  teamId: string;
  commitSha: string;
  commitMessage: string | undefined;
  commitTimestamp: string | undefined;
  changedFiles: string[];
  diffSummary?: string;
}

interface SnapshotMatch {
  id: string;
  title: string;
  similarity: number;
}

/**
 * Build the text string we embed to represent a commit.
 * Blends commit message + changed paths + (optional) diff excerpt.
 */
function buildCommitEmbeddingInput(input: CommitLinkInput): string {
  const parts: string[] = [];

  if (input.commitMessage) {
    parts.push(`Commit: ${input.commitMessage.slice(0, 300)}`);
  }

  if (input.changedFiles.length > 0) {
    const fileSample = input.changedFiles.slice(0, 50).join("\n");
    parts.push(`Changed files:\n${fileSample}`);
  }

  if (input.diffSummary) {
    parts.push(`Diff summary:\n${input.diffSummary.slice(0, 2000)}`);
  }

  return parts.join("\n\n").trim();
}

/**
 * Link a commit to relevant AI conversations captured near its timestamp.
 * Stores matches as semantic_links rows.
 * Safe to call in background — logs errors, never throws.
 */
export async function linkCommitToConversations(
  input: CommitLinkInput
): Promise<{ linked: number; skipped: string }> {
  const admin = createAdminClient();

  // ── 1. Find the project linked to this repo ───────────────────────────────
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("github_repo_id", input.repoId)
    .eq("team_id", input.teamId)
    .maybeSingle();

  if (!project) {
    return { linked: 0, skipped: "no_project_linked" };
  }

  // ── 2. Build embedding input ──────────────────────────────────────────────
  const embeddingText = buildCommitEmbeddingInput(input);
  if (!embeddingText) {
    return { linked: 0, skipped: "empty_embedding_input" };
  }

  const embedResult = await embedText(embeddingText);
  if (!embedResult) {
    return { linked: 0, skipped: "embedding_unavailable" };
  }

  // ── 3. Compute time window around commit timestamp ────────────────────────
  const commitTime = input.commitTimestamp
    ? new Date(input.commitTimestamp)
    : new Date();

  const windowStart = new Date(commitTime.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const windowEnd   = new Date(commitTime.getTime() + WINDOW_HOURS * 60 * 60 * 1000);

  // ── 4. Search snapshots via vector similarity + time filter ───────────────
  const { data: matches, error } = await admin.rpc("search_snapshots_near_commit", {
    query_embedding:   embedResult.vector,
    team_id_filter:    input.teamId,
    project_id_filter: project.id,
    window_start:      windowStart.toISOString(),
    window_end:        windowEnd.toISOString(),
    match_count:       20,
    match_threshold:   LINK_THRESHOLD,
  });

  if (error) {
    console.warn("[commit-linker] search_snapshots_near_commit error:", error.message);
    return { linked: 0, skipped: "rpc_error" };
  }

  const rows = (matches ?? []) as SnapshotMatch[];
  if (rows.length === 0) {
    return { linked: 0, skipped: "no_matches" };
  }

  // ── 5. Upsert semantic_links (skip duplicates via ON CONFLICT DO NOTHING) ─
  const links = rows.map((row) => ({
    repo_id:        input.repoId,
    commit_sha:     input.commitSha,
    snapshot_id:    row.id,
    similarity:     row.similarity,
    linked_files:   input.changedFiles.slice(0, 100),
    commit_message: input.commitMessage?.slice(0, 500) ?? null,
    committed_at:   input.commitTimestamp ?? null,
    is_manual:      false,
  }));

  const { error: insertError } = await admin
    .from("semantic_links")
    .upsert(links, {
      onConflict: "commit_sha,snapshot_id",
      ignoreDuplicates: true,
    });

  if (insertError) {
    console.warn("[commit-linker] insert error:", insertError.message);
    return { linked: 0, skipped: "insert_error" };
  }

  console.log(
    `[commit-linker] linked ${rows.length} conversations to ${input.commitSha.slice(0, 7)} ` +
    `(project: ${project.id})`
  );

  return { linked: rows.length, skipped: "" };
}
