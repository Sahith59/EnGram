/**
 * commit-linker.ts — Semantic Link Engine
 *
 * Given a git commit (SHA, message, changed files), embeds it and finds AI
 * conversations captured in the 4 hours BEFORE the commit. This is
 * "forward-only" linking: conversations that led up to the commit.
 *
 * The commit embedding blends: commit message + changed file paths + first
 * 500 lines of the unified diff (fetched from GitHub/GitLab via stored token).
 *
 * Matches above 0.40 similarity are stored as `semantic_links`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";
import { decryptToken, isEncrypted } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const LINK_THRESHOLD = 0.40;
const PRE_COMMIT_WINDOW_HOURS = 4;
const MAX_DIFF_LINES = 500;

const GH_API = "https://api.github.com";
const GL_API = "https://gitlab.com/api/v4";

export interface CommitLinkInput {
  repoId: string;
  teamId: string;
  commitSha: string;
  commitMessage: string | undefined;
  commitTimestamp: string | undefined;
  changedFiles: string[];
  provider?: "github" | "gitlab";
}

interface SnapshotMatch {
  id: string;
  title: string;
  similarity: number;
}

// ── GitHub App JWT + Installation Token ───────────────────────────────────────

function generateJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(privateKey).toString("base64url")}`;
}

async function getGitHubToken(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string
): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (appId && rawKey) {
    const { data: row } = await admin
      .from("github_oauth_tokens")
      .select("installation_id")
      .eq("team_id", teamId)
      .eq("provider", "github")
      .maybeSingle();
    if (row?.installation_id) {
      try {
        const jwt = generateJwt(appId, rawKey.replace(/\\n/g, "\n"));
        const res = await fetch(`${GH_API}/app/installations/${row.installation_id}/access_tokens`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (res.ok) {
          const d = await res.json() as { token?: string };
          if (d.token) return d.token;
        }
      } catch { /* fall through */ }
    }
  }
  const { data: tokenRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc")
    .eq("team_id", teamId)
    .eq("provider", "github")
    .maybeSingle();
  const raw = tokenRow?.access_token_enc;
  if (!raw || raw === "") return null;
  try { return isEncrypted(raw) ? await decryptToken(raw) : raw; }
  catch { return null; }
}

async function getGitLabToken(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string
): Promise<string | null> {
  const { data: tokenRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc")
    .eq("team_id", teamId)
    .eq("provider", "gitlab")
    .maybeSingle();
  const raw = tokenRow?.access_token_enc;
  if (!raw || raw === "") return null;
  try { return isEncrypted(raw) ? await decryptToken(raw) : raw; }
  catch { return null; }
}

// ── Diff fetcher ───────────────────────────────────────────────────────────────

/**
 * Fetch the unified diff for a commit and truncate to the first MAX_DIFF_LINES lines.
 * Returns null silently on any failure — diff is supplemental context only.
 */
async function fetchCommitDiff(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  repoFullName: string,
  commitSha: string,
  provider: "github" | "gitlab"
): Promise<string | null> {
  try {
    if (provider === "gitlab") {
      const token = await getGitLabToken(admin, teamId);
      if (!token) return null;
      const encodedPath = encodeURIComponent(repoFullName);
      const res = await fetch(
        `${GL_API}/projects/${encodedPath}/repository/commits/${commitSha}/diff`,
        { headers: { "PRIVATE-TOKEN": token } }
      );
      if (!res.ok) return null;
      const patches = await res.json() as Array<{ diff?: string }>;
      const combined = patches.map((p) => p.diff ?? "").join("\n");
      return combined.split("\n").slice(0, MAX_DIFF_LINES).join("\n");
    } else {
      const token = await getGitHubToken(admin, teamId);
      if (!token) return null;
      const res = await fetch(`${GH_API}/repos/${repoFullName}/commits/${commitSha}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3.diff",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) return null;
      const diff = await res.text();
      return diff.split("\n").slice(0, MAX_DIFF_LINES).join("\n");
    }
  } catch {
    return null;
  }
}

// ── Embedding input builder ────────────────────────────────────────────────────

function buildEmbeddingInput(
  commitMessage: string | undefined,
  changedFiles: string[],
  diff: string | null
): string {
  const parts: string[] = [];
  if (commitMessage) parts.push(`Commit: ${commitMessage.slice(0, 300)}`);
  if (changedFiles.length > 0) {
    parts.push(`Changed files:\n${changedFiles.slice(0, 50).join("\n")}`);
  }
  if (diff) {
    parts.push(`Unified diff (first ${MAX_DIFF_LINES} lines):\n${diff}`);
  }
  return parts.join("\n\n").trim();
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Link a commit to AI conversations captured in the 4 hours BEFORE the commit.
 * Stores matches as semantic_links rows with is_manual=false.
 * Safe to call in background — never throws.
 */
export async function linkCommitToConversations(
  input: CommitLinkInput
): Promise<{ linked: number; skipped: string }> {
  const admin = createAdminClient();

  // ── 1. Resolve project + repo_full_name ───────────────────────────────────
  const { data: repoRow } = await admin
    .from("github_repos")
    .select("id, repo_full_name, provider")
    .eq("id", input.repoId)
    .maybeSingle();
  if (!repoRow) return { linked: 0, skipped: "repo_not_found" };

  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("github_repo_id", input.repoId)
    .eq("team_id", input.teamId)
    .maybeSingle();
  if (!project) return { linked: 0, skipped: "no_project_linked" };

  const provider = (input.provider ?? repoRow.provider ?? "github") as "github" | "gitlab";

  // ── 2. Fetch unified diff (best-effort) ───────────────────────────────────
  const diff = await fetchCommitDiff(
    admin, input.teamId, repoRow.repo_full_name, input.commitSha, provider
  );

  // ── 3. Build embedding ────────────────────────────────────────────────────
  const embeddingText = buildEmbeddingInput(input.commitMessage, input.changedFiles, diff);
  if (!embeddingText) return { linked: 0, skipped: "empty_embedding_input" };

  const embedResult = await embedText(embeddingText);
  if (!embedResult) return { linked: 0, skipped: "embedding_unavailable" };

  // ── 4. PRE-COMMIT window: [commit_time - 4h, commit_time] ─────────────────
  //    Only conversations captured BEFORE the commit are considered.
  //    This reflects the intent: conversations that led up to the code change.
  const commitTime = input.commitTimestamp ? new Date(input.commitTimestamp) : new Date();
  const windowStart = new Date(commitTime.getTime() - PRE_COMMIT_WINDOW_HOURS * 60 * 60 * 1000);
  const windowEnd   = commitTime; // not after the commit

  // ── 5. Vector similarity search scoped to project + time window ───────────
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
  if (rows.length === 0) return { linked: 0, skipped: "no_matches" };

  // ── 6. Upsert semantic_links ──────────────────────────────────────────────
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
    .upsert(links, { onConflict: "commit_sha,snapshot_id", ignoreDuplicates: true });

  if (insertError) {
    console.warn("[commit-linker] insert error:", insertError.message);
    return { linked: 0, skipped: "insert_error" };
  }

  console.log(
    `[commit-linker] linked ${rows.length} conversation(s) to ${input.commitSha.slice(0, 7)} ` +
    `(project: ${project.id}, diff: ${diff ? `${diff.split("\n").length}L` : "none"})`
  );

  return { linked: rows.length, skipped: "" };
}
