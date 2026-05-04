/**
 * GET /api/projects/[id]/commits/[sha]/diff
 *
 * Returns the file diffs for a specific commit from GitHub/GitLab.
 * Each file includes: filename, status, additions, deletions, patch (unified diff text).
 * Cached for 1 hour (diffs are immutable once pushed).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { decryptToken, isEncrypted } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const GH_API = "https://api.github.com";
const GL_API = "https://gitlab.com/api/v4";

// ── GitHub token helpers (mirrors commits/route.ts) ───────────────────────────

function generateGitHubAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(privateKey).toString("base64url")}`;
}

async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string | null> {
  try {
    const jwt = generateGitHubAppJwt(appId, privateKey);
    const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { token?: string }).token ?? null;
  } catch { return null; }
}

async function getGitHubToken(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (appId && privateKeyRaw) {
    const { data: tokenRow } = await admin.from("github_oauth_tokens").select("installation_id")
      .eq("team_id", teamId).eq("provider", "github").maybeSingle();
    if (tokenRow?.installation_id) {
      const token = await getInstallationToken(appId, privateKeyRaw.replace(/\\n/g, "\n"), tokenRow.installation_id);
      if (token) return token;
    }
  }
  const { data: tokenRow } = await admin.from("github_oauth_tokens").select("access_token_enc")
    .eq("team_id", teamId).eq("provider", "github").maybeSingle();
  if (!tokenRow?.access_token_enc) return null;
  try {
    const raw = tokenRow.access_token_enc;
    return isEncrypted(raw) ? await decryptToken(raw) : raw;
  } catch { return null; }
}

async function getGitLabToken(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  const { data: tokenRow } = await admin.from("github_oauth_tokens").select("access_token_enc")
    .eq("team_id", teamId).eq("provider", "gitlab").maybeSingle();
  if (!tokenRow?.access_token_enc) return null;
  try {
    const raw = tokenRow.access_token_enc;
    return isEncrypted(raw) ? await decryptToken(raw) : raw;
  } catch { return null; }
}

// ── Diff fetchers ─────────────────────────────────────────────────────────────

export interface DiffFile {
  filename:  string;
  status:    string;
  additions: number;
  deletions: number;
  patch:     string | null;
}

async function fetchGitHubDiff(repoFullName: string, sha: string, token: string | null): Promise<DiffFile[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${GH_API}/repos/${repoFullName}/commits/${sha}`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as {
    files?: Array<{
      filename:  string;
      status:    string;
      additions: number;
      deletions: number;
      patch?:    string;
    }>;
  };
  return (data.files ?? []).map((f) => ({
    filename:  f.filename,
    status:    f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch:     f.patch ?? null,
  }));
}

async function fetchGitLabDiff(repoFullName: string, sha: string, token: string): Promise<DiffFile[]> {
  const encodedPath = encodeURIComponent(repoFullName);
  const res = await fetch(`${GL_API}/projects/${encodedPath}/repository/commits/${sha}/diff`, {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (!res.ok) return [];
  const data = await res.json() as Array<{
    new_path:    string;
    old_path:    string;
    new_file:    boolean;
    deleted_file: boolean;
    renamed_file: boolean;
    diff:        string;
  }>;
  return data.map((f) => {
    const additions = (f.diff.match(/^\+[^+]/gm) ?? []).length;
    const deletions  = (f.diff.match(/^-[^-]/gm) ?? []).length;
    const status = f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified";
    return { filename: f.new_path, status, additions, deletions, patch: f.diff || null };
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; sha: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("team_id").eq("id", user.id).single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return NextResponse.json({ files: [] });

  const { data: repo } = await admin.from("github_repos")
    .select("repo_full_name, oauth_provider")
    .eq("id", project.github_repo_id)
    .single();
  if (!repo) return NextResponse.json({ files: [] });

  const provider = (repo.oauth_provider ?? "github") as "github" | "gitlab";
  let files: DiffFile[] = [];

  try {
    if (provider === "gitlab") {
      const token = await getGitLabToken(admin, profile.team_id);
      if (token) files = await fetchGitLabDiff(repo.repo_full_name, params.sha, token);
    } else {
      const token = await getGitHubToken(admin, profile.team_id);
      // null token = unauthenticated — works for public repos (60 req/hr rate limit)
      files = await fetchGitHubDiff(repo.repo_full_name, params.sha, token);
    }
  } catch (err) {
    console.warn("[diff] fetch error:", err);
  }

  return NextResponse.json(
    { files, sha: params.sha, repo_full_name: repo.repo_full_name },
    { headers: { "Cache-Control": "private, max-age=3600" } }
  );
}
