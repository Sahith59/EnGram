/**
 * GET /api/projects/[id]/commits
 * Returns recent commits for the project's linked repo, fetching from
 * GitHub/GitLab API (with 5-minute server-side cache via headers).
 * For each commit, includes the count and IDs of linked semantic_links.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { decryptToken, isEncrypted, parseGitHubPrivateKey } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const GH_API = "https://api.github.com";
const GL_API = "https://gitlab.com/api/v4";

// ── GitHub App token helpers (mirrors repo-indexer.ts) ────────────────────────

function generateGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string | null> {
  try {
    const jwt = generateGitHubAppJwt(appId, privateKey);
    const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { token?: string };
    return data.token ?? null;
  } catch { return null; }
}

async function getGitHubToken(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (appId && privateKeyRaw) {
    const { data: tokenRow } = await admin
      .from("github_oauth_tokens")
      .select("installation_id")
      .eq("team_id", teamId)
      .eq("provider", "github")
      .maybeSingle();
    if (tokenRow?.installation_id) {
      const privateKey = parseGitHubPrivateKey(privateKeyRaw);
      const token = await getInstallationToken(appId, privateKey, tokenRow.installation_id);
      if (token) return token;
    }
  }
  const { data: tokenRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc")
    .eq("team_id", teamId)
    .eq("provider", "github")
    .maybeSingle();
  if (tokenRow?.access_token_enc) {
    const raw = tokenRow.access_token_enc;
    if (raw) {
      try { return isEncrypted(raw) ? await decryptToken(raw) : raw; } catch { /* fall through */ }
    }
  }
  // Fallback: legacy PAT stored in integrations table
  const { data: integration } = await admin
    .from("integrations")
    .select("config")
    .eq("team_id", teamId)
    .eq("type", "github")
    .maybeSingle();
  const pat = (integration?.config as { pat?: string } | null)?.pat;
  return pat ?? null;
}

async function getGitLabToken(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  const { data: tokenRow } = await admin
    .from("github_oauth_tokens")
    .select("access_token_enc")
    .eq("team_id", teamId)
    .eq("provider", "gitlab")
    .maybeSingle();
  if (!tokenRow?.access_token_enc) return null;
  const raw = tokenRow.access_token_enc;
  if (!raw || raw === "") return null;
  try {
    return isEncrypted(raw) ? await decryptToken(raw) : raw;
  } catch { return null; }
}

// ── Commit fetchers ────────────────────────────────────────────────────────────

interface RawCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  files_changed: number;
}

async function fetchGitHubCommits(repoFullName: string, branch: string, token: string | null): Promise<RawCommit[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `${GH_API}/repos/${repoFullName}/commits?sha=${branch}&per_page=30`,
    { headers }
  );
  if (!res.ok) {
    console.warn(`[commits] GitHub API ${res.status} for ${repoFullName}`);
    return [];
  }
  const data = await res.json() as Array<{
    sha: string;
    commit: { message: string; author?: { name?: string; date?: string } };
    stats?: { total?: number };
  }>;
  return data.map((c) => ({
    sha: c.sha,
    message: (c.commit.message ?? "").split("\n")[0].slice(0, 120),
    author: c.commit.author?.name ?? "Unknown",
    timestamp: c.commit.author?.date ?? "",
    files_changed: 0,
  }));
}

async function fetchGitLabCommits(repoFullName: string, branch: string, token: string): Promise<RawCommit[]> {
  const encodedPath = encodeURIComponent(repoFullName);
  const res = await fetch(
    `${GL_API}/projects/${encodedPath}/repository/commits?ref_name=${branch}&per_page=30`,
    {
      headers: { "PRIVATE-TOKEN": token },
    }
  );
  if (!res.ok) return [];
  const data = await res.json() as Array<{
    id: string;
    title: string;
    author_name: string;
    committed_date: string;
  }>;
  return data.map((c) => ({
    sha: c.id,
    message: (c.title ?? "").slice(0, 120),
    author: c.author_name ?? "Unknown",
    timestamp: c.committed_date ?? "",
    files_changed: 0,
  }));
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();

  // Verify project membership + get repo info
  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) {
    return NextResponse.json({ commits: [] });
  }

  const { data: repo } = await admin
    .from("github_repos")
    .select("id, repo_full_name, default_branch, oauth_provider, is_private")
    .eq("id", project.github_repo_id)
    .single();
  if (!repo) return NextResponse.json({ commits: [] });

  const branch = repo.default_branch ?? "main";
  const provider = ((repo.oauth_provider ?? "github") as "github" | "gitlab");

  // Fetch commits from provider.
  // For public repos, GitHub allows unauthenticated requests (60 req/hr limit).
  // We always attempt the fetch; token improves rate limits and enables private repos.
  let rawCommits: RawCommit[] = [];
  let hasToken = false;
  try {
    if (provider === "gitlab") {
      const token = await getGitLabToken(admin, profile.team_id);
      hasToken = !!token;
      if (token) rawCommits = await fetchGitLabCommits(repo.repo_full_name, branch, token);
    } else {
      const token = await getGitHubToken(admin, profile.team_id);
      hasToken = !!token;
      // Pass token (may be null) — fetchGitHubCommits handles unauthenticated calls for public repos
      rawCommits = await fetchGitHubCommits(repo.repo_full_name, branch, token);
    }
  } catch (err) {
    console.warn("[commits] provider fetch error:", err);
  }

  if (rawCommits.length === 0) {
    return NextResponse.json(
      { commits: [], repo_full_name: repo.repo_full_name, provider, has_token: hasToken, is_private: repo.is_private ?? false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Load semantic_links for all SHAs — include linked_files for files_changed count
  const shas = rawCommits.map((c) => c.sha);
  const { data: links } = await admin
    .from("semantic_links")
    .select("commit_sha, snapshot_id, similarity, linked_files")
    .eq("repo_id", repo.id)
    .in("commit_sha", shas);

  const linkMap = new Map<string, {
    count: number; snapshot_ids: string[]; top_similarity: number; files_changed: number;
  }>();
  for (const link of (links ?? [])) {
    const existing = linkMap.get(link.commit_sha) ?? {
      count: 0, snapshot_ids: [], top_similarity: 0, files_changed: 0,
    };
    existing.count++;
    existing.snapshot_ids.push(link.snapshot_id);
    existing.top_similarity = Math.max(existing.top_similarity, link.similarity ?? 0);
    // Use linked_files.length from first link as the files-changed count
    if (existing.files_changed === 0 && Array.isArray(link.linked_files)) {
      existing.files_changed = link.linked_files.length;
    }
    linkMap.set(link.commit_sha, existing);
  }

  const commits = rawCommits.map((c) => ({
    ...c,
    sha_short: c.sha.slice(0, 7),
    linked_conversations: linkMap.get(c.sha)?.count ?? 0,
    linked_snapshot_ids: linkMap.get(c.sha)?.snapshot_ids ?? [],
    top_similarity: linkMap.get(c.sha)?.top_similarity ?? 0,
    files_changed: linkMap.get(c.sha)?.files_changed ?? c.files_changed,
  }));

  return NextResponse.json(
    { commits, repo_full_name: repo.repo_full_name, provider, has_token: hasToken, is_private: repo.is_private ?? false },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
