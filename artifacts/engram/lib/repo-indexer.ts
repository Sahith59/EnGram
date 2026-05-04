/**
 * repo-indexer.ts — Incremental file re-indexer for AST edges.
 *
 * Called by webhook handlers when files change. For each changed file:
 *   1. Fetch file content from GitHub/GitLab API
 *   2. Parse AST edges (imports, calls, inheritance)
 *   3. Delete old edges for this (repo_id, source_file)
 *   4. Insert new edges
 *   5. Update github_chunks with ast_node_type + ast_parent
 *   6. Update github_repos.last_indexed_commit
 *
 * GitHub access: supports GitHub App installation tokens (preferred)
 * and legacy PAT/OAuth user tokens.
 *
 * Gracefully skips unsupported file types and API errors.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { parseAstEdges, analyzeFileStructure } from "@/lib/ast-parser";
import { decryptToken, isEncrypted, parseGitHubPrivateKey } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const GH_API = "https://api.github.com";
const GL_API = "https://gitlab.com/api/v4";

// ── GitHub App JWT + Installation Token ───────────────────────────────────────

/**
 * Generate a signed JWT for GitHub App authentication.
 * Uses RS256 with the app's PEM private key.
 * JWT is valid for 10 minutes (GitHub's maximum).
 */
function generateGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,      // issued 60s ago to allow for clock skew
    exp: now + 600,     // expires in 10 minutes
    iss: appId,
  })).toString("base64url");

  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

/**
 * Exchange a GitHub App JWT + installation_id for an installation access token.
 * Installation tokens are valid for 1 hour.
 */
async function getInstallationAccessToken(
  appId: string,
  privateKey: string,
  installationId: string
): Promise<string | null> {
  try {
    const jwt = generateGitHubAppJwt(appId, privateKey);
    const res = await fetch(
      `${GH_API}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!res.ok) {
      console.error("[repo-indexer] installation token request failed:", await res.text());
      return null;
    }
    const data = await res.json() as { token?: string };
    return data.token ?? null;
  } catch (err) {
    console.error("[repo-indexer] getInstallationAccessToken error:", err);
    return null;
  }
}

// ── Token retrieval ───────────────────────────────────────────────────────────

export async function getOAuthToken(teamId: string, provider: "github" | "gitlab"): Promise<string | null> {
  const admin = createAdminClient();

  const { data: oauthRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc, installation_id, provider")
    .eq("team_id", teamId)
    .eq("provider", provider)
    .maybeSingle();

  if (oauthRow) {
    // GitHub App installation flow: generate fresh installation token from installation_id
    if (provider === "github" && oauthRow.installation_id) {
      const appId = process.env.GITHUB_APP_ID;
      const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
      if (appId && privateKeyRaw) {
        const token = await getInstallationAccessToken(appId, parseGitHubPrivateKey(privateKeyRaw), oauthRow.installation_id);
        if (token) return token;
      }
    }

    // OAuth user token fallback (stored encrypted)
    if (oauthRow.access_token_enc) {
      try {
        const raw = oauthRow.access_token_enc;
        return isEncrypted(raw) ? decryptToken(raw) : raw;
      } catch {
        return null;
      }
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
    const data = await res.json() as { encoding?: string; content?: string };
    if (data.encoding !== "base64" || !data.content) return null;
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

// ── AST parent resolution ─────────────────────────────────────────────────────

/**
 * For each chunk in github_chunks belonging to a file, determine the
 * ast_node_type and ast_parent based on the file's parsed structure.
 *
 * Strategy:
 *  - Parse the full file to extract top-level class names and node type.
 *  - Fetch existing chunks for the file from the DB.
 *  - For each chunk, analyze its content to determine if it's a method/member
 *    of a top-level class. If so, set ast_parent = that class name.
 *  - Top-level declarations (functions, classes) get ast_parent = null.
 */
async function updateChunkAstInfo(
  admin: ReturnType<typeof createAdminClient>,
  repoId: string,
  filePath: string,
  fileContent: string
): Promise<void> {
  const { topLevelClasses, nodeType } = await analyzeFileStructure(fileContent, filePath);

  // Fetch chunks for this file so we can update them individually
  const { data: chunks } = await admin
    .from("github_chunks")
    .select("id, content")
    .eq("repo_id", repoId)
    .eq("file_path", filePath);

  if (!chunks?.length) return;

  for (const chunk of chunks) {
    const chunkContent: string = (chunk as { id: string; content: string }).content ?? "";
    const chunkId: string = (chunk as { id: string; content: string }).id;

    // Determine chunk's node type from its own content
    const { nodeType: chunkNodeType } = await analyzeFileStructure(chunkContent, filePath);

    // Determine ast_parent:
    // If the chunk looks like a class member (method body, indented pattern)
    // and there are top-level classes in the file, set the first class as parent.
    let astParent: string | null = null;
    if (topLevelClasses.length > 0) {
      const trimmed = chunkContent.trim();
      const looksLikeMember =
        // Method-like patterns (indented function/arrow in TS)
        /^\s{2,}(public|private|protected|static|async|get|set)\s+/.test(chunkContent) ||
        // Python method (indented def)
        /^\s{4,}def\s+/.test(chunkContent) ||
        // Go method receiver: func (r ReceiverType)
        /^func\s*\([^)]+\)\s+\w+/.test(trimmed) ||
        // Java method body inside class (heuristic: doesn't start with class/interface)
        (!(/^(class|interface|enum)\s+/.test(trimmed)) &&
          chunkNodeType === "function" &&
          nodeType === "class");

      if (looksLikeMember) {
        astParent = topLevelClasses[0];
      }
    }

    await admin
      .from("github_chunks")
      .update({
        ast_node_type: chunkNodeType ?? nodeType,
        ast_parent: astParent,
      })
      .eq("id", chunkId);
  }
}

// ── Core indexer ──────────────────────────────────────────────────────────────

export interface RepoIndexEvent {
  repoId: string;
  teamId: string;
  repoFullName: string;
  provider: "github" | "gitlab";
  commitSha: string;
  commitMessage?: string;   // first line of the triggering commit message
  commitTimestamp?: string; // ISO timestamp of the commit author date
  changedFiles: string[];
}

export async function indexChangedFiles(event: RepoIndexEvent): Promise<{
  edgesAdded: number;
  filesProcessed: number;
}> {
  const { repoId, teamId, repoFullName, provider, commitSha, commitMessage, commitTimestamp, changedFiles } = event;
  const admin = createAdminClient();

  const token = await getOAuthToken(teamId, provider);
  if (!token) {
    console.warn(`[repo-indexer] no ${provider} token for team ${teamId}`);
    return { edgesAdded: 0, filesProcessed: 0 };
  }

  let edgesAdded = 0;
  let filesProcessed = 0;

  for (const filePath of changedFiles.slice(0, 50)) {
    try {
      const content = provider === "github"
        ? await fetchGitHubFile(token, repoFullName, filePath, commitSha)
        : await fetchGitLabFile(token, repoFullName, filePath, commitSha);

      if (!content) continue;

      // Parse AST edges (imports + calls + inheritance)
      const edges = await parseAstEdges(filePath, content);

      // Atomic incremental re-index: delete old → insert new
      await admin
        .from("code_ast_edges")
        .delete()
        .eq("repo_id", repoId)
        .eq("source_file", filePath);

      if (edges.length > 0) {
        const rows = edges.map((e) => ({
          repo_id: repoId,
          source_file: e.source_file,
          target_file: e.target_file,
          edge_type: e.edge_type,
          symbol_name: e.symbol_name,
          language: e.language,
          commit_sha: commitSha,
          commit_message: commitMessage ?? null,
          commit_timestamp: commitTimestamp ?? null,
        }));
        await admin.from("code_ast_edges").insert(rows);
        edgesAdded += rows.length;
      }

      // Update github_chunks with ast_node_type + ast_parent per chunk
      await updateChunkAstInfo(admin, repoId, filePath, content);

      filesProcessed++;
    } catch (err) {
      console.warn(`[repo-indexer] error indexing ${filePath}:`, err);
    }
  }

  // Record the commit SHA and timestamp we indexed up to
  const indexedAt = new Date().toISOString();
  await admin
    .from("github_repos")
    .update({
      last_indexed_commit: commitSha,
      indexed_at: indexedAt,
      updated_at: indexedAt,
    })
    .eq("id", repoId);

  console.log(
    `[repo-indexer] ${repoFullName}@${commitSha.slice(0, 8)}: ` +
    `${filesProcessed} files, ${edgesAdded} edges`
  );

  return { edgesAdded, filesProcessed };
}
