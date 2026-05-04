/**
 * repo-indexer.ts — Incremental file re-indexer for AST edges.
 *
 * Called by webhook handlers when files change. For each changed file:
 *   1. Fetch file content from GitHub/GitLab API
 *   2. Parse AST edges
 *   3. Delete old edges for this (repo_id, source_file)
 *   4. Insert new edges
 *   5. Update github_chunks with ast_node_type + ast_parent
 *   6. Update github_repos.last_indexed_commit
 *
 * Gracefully skips unsupported file types and API errors.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { parseAstEdges, detectNodeType } from "@/lib/ast-parser";
import { decryptToken, isEncrypted } from "@/lib/oauth-crypto";

const GH_API = "https://api.github.com";
const GL_API = "https://gitlab.com/api/v4";

// ── Token retrieval ───────────────────────────────────────────────────────────

export async function getOAuthToken(teamId: string, provider: "github" | "gitlab"): Promise<string | null> {
  const admin = createAdminClient();

  // Try new OAuth tokens table first
  const { data: oauthRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc")
    .eq("team_id", teamId)
    .eq("provider", provider)
    .maybeSingle();

  if (oauthRow?.access_token_enc) {
    try {
      const raw = oauthRow.access_token_enc;
      return isEncrypted(raw) ? decryptToken(raw) : raw;
    } catch {
      return null;
    }
  }

  // Fall back to PAT from legacy integrations table (GitHub only)
  if (provider === "github") {
    const { data: integration } = await admin
      .from("integrations")
      .select("config")
      .eq("team_id", teamId)
      .eq("type", "github")
      .maybeSingle();
    return (integration?.config as { pat?: string })?.pat ?? null;
  }

  return null;
}

// ── GitHub file fetcher ───────────────────────────────────────────────────────

async function fetchGitHubFile(
  token: string,
  repoFullName: string,
  filePath: string,
  ref: string
): Promise<string | null> {
  try {
    const [owner, repo] = repoFullName.split("/");
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${ref}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding !== "base64") return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

// ── GitLab file fetcher ───────────────────────────────────────────────────────

async function fetchGitLabFile(
  token: string,
  projectId: string,
  filePath: string,
  ref: string
): Promise<string | null> {
  try {
    const encodedPath = encodeURIComponent(filePath);
    const url = `${GL_API}/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}/raw?ref=${ref}`;
    const res = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Core indexer ──────────────────────────────────────────────────────────────

export interface RepoIndexEvent {
  repoId: string;
  teamId: string;
  repoFullName: string;
  provider: "github" | "gitlab";
  commitSha: string;
  changedFiles: string[];
}

export async function indexChangedFiles(event: RepoIndexEvent): Promise<{
  edgesAdded: number;
  filesProcessed: number;
}> {
  const { repoId, teamId, repoFullName, provider, commitSha, changedFiles } = event;
  const admin = createAdminClient();

  const token = await getOAuthToken(teamId, provider);
  if (!token) {
    console.warn(`[repo-indexer] no ${provider} token for team ${teamId}`);
    return { edgesAdded: 0, filesProcessed: 0 };
  }

  let edgesAdded = 0;
  let filesProcessed = 0;

  for (const filePath of changedFiles.slice(0, 50)) { // cap at 50 files per push
    try {
      // Fetch file content
      const content = provider === "github"
        ? await fetchGitHubFile(token, repoFullName, filePath, commitSha)
        : await fetchGitLabFile(token, repoFullName, filePath, commitSha);

      if (!content) continue;

      // Parse AST edges
      const edges = parseAstEdges(filePath, content);

      // Delete old edges for this file (incremental re-index)
      await admin
        .from("code_ast_edges")
        .delete()
        .eq("repo_id", repoId)
        .eq("source_file", filePath);

      // Insert new edges
      if (edges.length > 0) {
        const rows = edges.map((e) => ({
          repo_id: repoId,
          source_file: e.source_file,
          target_file: e.target_file,
          edge_type: e.edge_type,
          symbol_name: e.symbol_name,
          language: e.language,
          commit_sha: commitSha,
        }));
        await admin.from("code_ast_edges").insert(rows);
        edgesAdded += rows.length;
      }

      // Update github_chunks with ast_node_type for this file's chunks
      const nodeType = detectNodeType(content, filePath);
      if (nodeType) {
        await admin
          .from("github_chunks")
          .update({ ast_node_type: nodeType })
          .eq("repo_id", repoId)
          .eq("file_path", filePath);
      }

      filesProcessed++;
    } catch (err) {
      console.warn(`[repo-indexer] error indexing ${filePath}:`, err);
    }
  }

  // Update last_indexed_commit on the repo
  await admin
    .from("github_repos")
    .update({ last_indexed_commit: commitSha, updated_at: new Date().toISOString() })
    .eq("id", repoId);

  console.log(
    `[repo-indexer] ${repoFullName}@${commitSha.slice(0, 8)}: ` +
    `${filesProcessed} files, ${edgesAdded} edges`
  );

  return { edgesAdded, filesProcessed };
}
