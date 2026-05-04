/**
 * POST /api/projects/[id]/ast-reindex
 * Manually triggers a full AST re-index for the project's linked repo.
 *
 * Fetches the full git tree from GitHub, filters to supported source files,
 * and runs the AST edge + chunk annotation pipeline on all of them.
 * This is the same work that would happen automatically on the next push
 * via the webhook — useful when the webhook hasn't been triggered yet.
 *
 * Runs synchronously for repos ≤ 50 files, background otherwise.
 * Returns immediately with a job status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { indexChangedFiles } from "@/lib/repo-indexer";
import { parseGitHubPrivateKey } from "@/lib/oauth-crypto";
import { createSign } from "crypto";

const GH_API = "https://api.github.com";

const SUPPORTED_EXTENSIONS = new Set([
  "ts","tsx","js","jsx","mjs","cjs",
  "py","go","rs","java","c","cpp","cc","cs","rb","php","swift","kt","scala",
]);

const SKIP_PATHS = [
  "node_modules/","dist/","build/","out/",".next/",".nuxt/",
  "__pycache__/","venv/","env/",".venv/",
  "vendor/","target/","bin/","obj/",".git/","coverage/",
];

function shouldSkip(path: string) {
  return SKIP_PATHS.some((p) => path.startsWith(p));
}

function ext(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

function generateJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(privateKey).toString("base64url")}`;
}

async function getGitHubToken(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<string | null> {
  // 1. GitHub App installation token (preferred)
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (appId && rawKey) {
    const { data: tokenRow } = await admin.from("github_oauth_tokens")
      .select("installation_id").eq("team_id", teamId).eq("provider", "github").maybeSingle();
    if (tokenRow?.installation_id) {
      try {
        const jwt = generateJwt(appId, parseGitHubPrivateKey(rawKey));
        const res = await fetch(`${GH_API}/app/installations/${tokenRow.installation_id}/access_tokens`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (res.ok) return ((await res.json()) as { token?: string }).token ?? null;
      } catch { /* fall through */ }
    }
  }
  // 2. Stored encrypted token
  const { data: tokenRow } = await admin.from("github_oauth_tokens")
    .select("access_token_enc").eq("team_id", teamId).eq("provider", "github").maybeSingle();
  if (tokenRow?.access_token_enc) {
    return tokenRow.access_token_enc;
  }
  // 3. Legacy PAT from integrations table
  const { data: integration } = await admin.from("integrations")
    .select("config").eq("team_id", teamId).eq("type", "github").maybeSingle();
  return (integration?.config as { pat?: string } | null)?.pat ?? null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
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
    .select("id, github_repo_id").eq("id", params.id).eq("team_id", profile.team_id).single();
  if (!project?.github_repo_id) return NextResponse.json({ error: "No repo linked" }, { status: 404 });

  const { data: repo } = await admin.from("github_repos")
    .select("id, repo_full_name, default_branch, oauth_provider, is_private")
    .eq("id", project.github_repo_id).single();
  if (!repo) return NextResponse.json({ error: "Repo not found" }, { status: 404 });

  const provider = (repo.oauth_provider ?? "github") as "github" | "gitlab";
  if (provider !== "github") {
    return NextResponse.json({ error: "Manual reindex only supported for GitHub repos" }, { status: 400 });
  }

  const token = await getGitHubToken(admin, profile.team_id);
  if (!token) {
    return NextResponse.json({ error: "No GitHub token available. Connect GitHub in Settings." }, { status: 400 });
  }

  const branch = repo.default_branch ?? "main";
  const [owner, repoName] = repo.repo_full_name.split("/");

  // Fetch git tree (recursive) to get all file paths
  const treeRes = await fetch(
    `${GH_API}/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
  );
  if (!treeRes.ok) {
    return NextResponse.json({ error: `GitHub tree fetch failed: ${treeRes.status}` }, { status: 502 });
  }
  const treeData = await treeRes.json() as { tree?: Array<{ path?: string; type?: string }> };
  const allFiles = (treeData.tree ?? [])
    .filter((item) => item.type === "blob" && item.path && !shouldSkip(item.path) && SUPPORTED_EXTENSIONS.has(ext(item.path ?? "")))
    .map((item) => item.path!)
    .slice(0, 200);

  if (allFiles.length === 0) {
    return NextResponse.json({ ok: true, message: "No supported source files found", filesQueued: 0 });
  }

  // Get HEAD commit SHA
  const commitRes = await fetch(
    `${GH_API}/repos/${owner}/${repoName}/commits/${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } }
  );
  const commitData = commitRes.ok ? await commitRes.json() as { sha?: string; commit?: { message?: string; committer?: { date?: string } } } : null;
  const commitSha = commitData?.sha ?? "manual-reindex";
  const commitMessage = commitData?.commit?.message?.split("\n")[0] ?? "Manual AST reindex";
  const commitTimestamp = commitData?.commit?.committer?.date ?? new Date().toISOString();

  // Run indexing in background — respond immediately
  const jobStart = Date.now();
  (async () => {
    try {
      const result = await indexChangedFiles({
        repoId: repo.id,
        teamId: profile.team_id,
        repoFullName: repo.repo_full_name,
        provider: "github",
        commitSha,
        commitMessage,
        commitTimestamp,
        changedFiles: allFiles,
      });
      console.log(`[ast-reindex] ${repo.repo_full_name}: ${result.filesProcessed} files, ${result.edgesAdded} edges in ${Date.now() - jobStart}ms`);
    } catch (err) {
      console.error("[ast-reindex] error:", err);
    }
  })();

  return NextResponse.json({
    ok: true,
    message: `AST indexing started for ${allFiles.length} files. This runs in the background — refresh in ~30s.`,
    filesQueued: allFiles.length,
    commitSha: commitSha.slice(0, 8),
  });
}
