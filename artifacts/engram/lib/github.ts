/**
 * GitHub integration helpers.
 *
 * Uses GitHub REST API v3 with a Personal Access Token (PAT).
 * The PAT is stored in the `integrations` table config JSON.
 *
 * Indexing pipeline:
 *  1. Fetch the repo's recursive git tree (one API call)
 *  2. Filter to supported source/doc file extensions
 *  3. Batch-fetch file contents (parallel, 8 at a time)
 *  4. Chunk each file into ~1 200-char overlapping segments
 *  5. Embed each chunk via OpenAI text-embedding-3-small
 *  6. Upsert into github_chunks
 */

import { embedText } from "@/lib/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

// ── Constants ────────────────────────────────────────────────────────────────

const GH_API = "https://api.github.com";

const SUPPORTED_EXTENSIONS = new Set([
  "ts","tsx","js","jsx","mjs","cjs",
  "py","go","rs","java","c","cpp","cc","cs","rb","php","swift","kt","scala",
  "md","mdx","txt","rst",
  "json","yaml","yml","toml","env",
  "sql","sh","bash","zsh",
  "html","css","scss","sass","less",
  "graphql","gql",
  "vue","svelte",
]);

const SKIP_PATHS = [
  "node_modules/","dist/","build/","out/",".next/",".nuxt/",
  "__pycache__/","venv/","env/",".venv/",
  "vendor/","target/","bin/","obj/",
  ".git/","coverage/","test-results/","e2e/",
  "public/","static/","assets/",
];

const MAX_FILE_SIZE_BYTES = 80_000; // ~80 KB
const MAX_FILES_PER_REPO  = 400;
const CHUNK_SIZE           = 1_200; // chars
const CHUNK_OVERLAP        = 200;   // chars
const EMBED_BATCH_SIZE     = 8;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
}

export interface GithubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function ghFetch<T>(
  path: string,
  token: string,
  opts?: RequestInit
): Promise<T> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── PAT helpers ──────────────────────────────────────────────────────────────

export async function getGithubToken(
  teamId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("config")
    .eq("team_id", teamId)
    .eq("type", "github")
    .maybeSingle();
  return (data?.config as { pat?: string })?.pat ?? null;
}

export async function saveGithubToken(
  teamId: string,
  pat: string,
  userId: string
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("integrations").upsert(
    { team_id: teamId, type: "github", config: { pat }, enabled: true },
    { onConflict: "team_id,type" }
  );
  // Verify token works
  const user = await ghFetch<{ login: string }>("/user", pat);
  await admin.from("integrations").update({
    config: { pat, github_login: user.login },
  })
    .eq("team_id", teamId)
    .eq("type", "github");
}

// ── Repo listing ─────────────────────────────────────────────────────────────

export async function listUserRepos(token: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = [];
  let page = 1;
  while (repos.length < 200) {
    const batch = await ghFetch<GithubRepo[]>(
      `/user/repos?per_page=100&page=${page}&sort=updated&type=all`,
      token
    );
    if (!batch.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

// ── Chunking ─────────────────────────────────────────────────────────────────

export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
    if (start + overlap >= text.length) break;
  }
  return chunks;
}

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function shouldSkip(path: string): boolean {
  if (SKIP_PATHS.some((p) => path.startsWith(p) || path.includes(`/${p}`)))
    return true;
  const ext = extOf(path);
  return !SUPPORTED_EXTENSIONS.has(ext);
}

// ── Language detection (best-effort) ─────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts:"typescript", tsx:"typescript", js:"javascript", jsx:"javascript",
  py:"python", go:"go", rs:"rust", java:"java", c:"c", cpp:"c++",
  cs:"csharp", rb:"ruby", php:"php", swift:"swift", kt:"kotlin",
  md:"markdown", mdx:"markdown", sql:"sql", sh:"shell", bash:"shell",
  html:"html", css:"css", scss:"scss", json:"json", yaml:"yaml",
  yml:"yaml", toml:"toml", graphql:"graphql", vue:"vue", svelte:"svelte",
};

function detectLang(path: string): string {
  return EXT_TO_LANG[extOf(path)] ?? "text";
}

// ── Main indexing function ────────────────────────────────────────────────────

export async function indexRepo(opts: {
  repoId: string;
  teamId: string;
  repoFullName: string;
  defaultBranch: string;
  token: string;
  onProgress?: (msg: string) => void;
}): Promise<{ fileCount: number; chunkCount: number }> {
  const { repoId, teamId, repoFullName, defaultBranch, token, onProgress } = opts;
  const admin = createAdminClient();
  const log = onProgress ?? (() => {});

  // 1. Fetch git tree recursively
  log("Fetching repository file tree…");
  const [owner, repo] = repoFullName.split("/");
  const tree = await ghFetch<{ tree: GithubTreeItem[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
    token
  );

  // 2. Filter files
  const blobs = tree.tree
    .filter(
      (item) =>
        item.type === "blob" &&
        !shouldSkip(item.path) &&
        (item.size ?? 0) <= MAX_FILE_SIZE_BYTES
    )
    .slice(0, MAX_FILES_PER_REPO);

  log(`Found ${blobs.length} indexable files (filtered from ${tree.tree.length} total)`);

  // 3. Delete old chunks for this repo
  await admin.from("github_chunks").delete().eq("repo_id", repoId);

  let totalChunks = 0;

  // 4. Process in batches
  for (let i = 0; i < blobs.length; i += EMBED_BATCH_SIZE) {
    const batch = blobs.slice(i, i + EMBED_BATCH_SIZE);
    log(`Embedding files ${i + 1}–${Math.min(i + EMBED_BATCH_SIZE, blobs.length)} / ${blobs.length}`);

    await Promise.all(
      batch.map(async (item) => {
        try {
          // Fetch file content (base64)
          const fileData = await ghFetch<{ content: string; encoding: string }>(
            `/repos/${owner}/${repo}/contents/${encodeURIComponent(item.path)}?ref=${defaultBranch}`,
            token
          );
          if (fileData.encoding !== "base64") return;
          const content = Buffer.from(
            fileData.content.replace(/\n/g, ""),
            "base64"
          ).toString("utf8");

          // Chunk
          const chunks = chunkText(content);
          const lang = detectLang(item.path);

          // Embed + insert
          const rows: {
            repo_id: string;
            team_id: string;
            file_path: string;
            language: string;
            chunk_index: number;
            content: string;
            embedding: unknown;
            token_est: number;
          }[] = [];

          for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            const embedInput = `File: ${item.path}\n\n${chunk}`;
            const result = await embedText(embedInput);
            if (result) {
              rows.push({
                repo_id: repoId,
                team_id: teamId,
                file_path: item.path,
                language: lang,
                chunk_index: ci,
                content: chunk,
                embedding: result.vector as unknown as string,
                token_est: Math.ceil(chunk.length / 4),
              });
            }
          }

          if (rows.length > 0) {
            await admin.from("github_chunks").insert(rows);
            totalChunks += rows.length;
          }
        } catch (err) {
          console.warn(`[github] skipping ${item.path}:`, err);
        }
      })
    );
  }

  return { fileCount: blobs.length, chunkCount: totalChunks };
}
