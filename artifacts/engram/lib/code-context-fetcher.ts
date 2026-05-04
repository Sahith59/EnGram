/**
 * Code Context Fetcher — Phase 14 (F-09)
 *
 * Given a set of active claims and a linked GitHub repo, fetches the most
 * relevant code snippets from the indexed repo chunks. These "code anchors"
 * are included in the Full and Medium brief to eliminate the need to paste
 * code snippets manually when starting a new AI session.
 *
 * Strategy:
 *   1. Embed the top decisions + next_steps as a combined query
 *   2. Run search_github_chunks against the project's repo only
 *   3. Deduplicate by file_path, keep top N unique files
 *   4. Extract function signatures + first meaningful line (not raw dump)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";
import type { TrustyClaim } from "@/lib/brief-generator";

// Max unique files to include in brief (keep token budget tight)
const MAX_ANCHOR_FILES = 5;
const MAX_SNIPPET_CHARS = 400;
const CHUNK_SIMILARITY_THRESHOLD = 0.40;
const CHUNK_MATCH_COUNT = 12;

export interface CodeAnchor {
  file_path: string;
  language: string | null;
  snippet: string;       // trimmed, signature-focused excerpt
  similarity: number;
}

interface ChunkResult {
  id: string;
  repo_id: string;
  file_path: string;
  language: string | null;
  content: string;
  similarity: number;
}

/**
 * Fetch code anchors relevant to the project's top decisions and next steps.
 * Returns [] if the project has no linked repo or no indexed chunks.
 */
export async function fetchCodeContext(opts: {
  projectId: string;
  githubRepoId: string | null;
  teamId: string;
  claims: TrustyClaim[];
}): Promise<CodeAnchor[]> {
  const { githubRepoId, teamId, claims } = opts;
  if (!githubRepoId) return [];

  // Build the query text from top decisions + next_steps + technologies
  const priorityClaims = claims
    .filter((c) =>
      c.status === "active" &&
      (c.claim_type === "decision" ||
        c.claim_type === "next_step" ||
        c.claim_type === "technology")
    )
    .slice(0, 8);

  if (priorityClaims.length === 0) return [];

  const queryText = priorityClaims.map((c) => c.claim_text).join("\n");

  // Embed the combined claim text
  let embedding: number[] | null = null;
  try {
    const result = await embedText(queryText);
    embedding = result?.vector ?? null;
  } catch {
    console.warn("[code-context] embed failed");
    return [];
  }
  if (!embedding) return [];

  const admin = createAdminClient();

  // Search only in this project's repo
  const { data: chunks, error } = await admin.rpc("search_github_chunks", {
    query_embedding: embedding,
    team_id_filter: teamId,
    repo_id_filter: githubRepoId,
    match_count: CHUNK_MATCH_COUNT,
    match_threshold: CHUNK_SIMILARITY_THRESHOLD,
  });

  if (error) {
    console.warn("[code-context] search_github_chunks error:", error.message);
    return [];
  }
  if (!chunks || (chunks as ChunkResult[]).length === 0) return [];

  const rows = chunks as ChunkResult[];

  // Deduplicate by file_path, keep highest-similarity chunk per file
  const byFile = new Map<string, ChunkResult>();
  for (const row of rows) {
    const existing = byFile.get(row.file_path);
    if (!existing || row.similarity > existing.similarity) {
      byFile.set(row.file_path, row);
    }
  }

  // Sort by similarity desc, take top N files
  const topFiles = Array.from(byFile.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_ANCHOR_FILES);

  return topFiles.map((row) => ({
    file_path: row.file_path,
    language: row.language ?? null,
    snippet: extractSignatureSnippet(row.content),
    similarity: Math.round(row.similarity * 1000) / 1000,
  }));
}

/**
 * Extract only the first meaningful block from a chunk.
 * Prefers function signatures, class definitions, type aliases.
 * Falls back to trimmed first N characters.
 */
function extractSignatureSnippet(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  // Look for function/class/interface/type/export definitions
  const sigPatterns = [
    /^(export\s+)?(async\s+)?function\s+/,
    /^(export\s+)?(abstract\s+)?class\s+/,
    /^(export\s+)?interface\s+/,
    /^(export\s+)?type\s+\w+\s*=/,
    /^(export\s+)?const\s+\w+\s*[:=]/,
    /^(export\s+)?enum\s+/,
    /^def\s+/,         // Python
    /^class\s+/,       // Python
    /^func\s+/,        // Go
    /^pub\s+(async\s+)?fn\s+/, // Rust
    /^fn\s+/,          // Rust
  ];

  // Find signature lines and include following 3–5 lines as context
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const isSignature = sigPatterns.some((p) => p.test(lines[i].trim()));
    if (isSignature) {
      const block = lines.slice(i, i + 6).join("\n");
      return block.length > MAX_SNIPPET_CHARS
        ? block.slice(0, MAX_SNIPPET_CHARS) + "…"
        : block;
    }
  }

  // Fallback: first N chars of the chunk
  const raw = lines.slice(0, 8).join("\n");
  return raw.length > MAX_SNIPPET_CHARS
    ? raw.slice(0, MAX_SNIPPET_CHARS) + "…"
    : raw;
}
