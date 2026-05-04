/**
 * POST /api/webhooks/gitlab
 * Receives GitLab push events and triggers incremental AST re-indexing.
 *
 * Setup: In your GitLab project → Settings → Webhooks → Add webhook
 *   URL: https://<your-app>/api/webhooks/gitlab
 *   Secret token: value of GITLAB_WEBHOOK_TOKEN env var
 *   Trigger: Push events
 *
 * Security: GITLAB_WEBHOOK_TOKEN is REQUIRED in non-development environments.
 * Requests with an invalid or missing token are rejected with 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexChangedFiles } from "@/lib/repo-indexer";

function verifyGitLabToken(token: string | null): boolean {
  const expectedToken = process.env.GITLAB_WEBHOOK_TOKEN;

  if (!expectedToken) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[webhook/gitlab] GITLAB_WEBHOOK_TOKEN not set — skipping token check (dev only)");
      return true;
    }
    // Production/staging: reject unauthenticated requests
    console.error("[webhook/gitlab] GITLAB_WEBHOOK_TOKEN is not configured — rejecting request");
    return false;
  }

  return token === expectedToken;
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-gitlab-token");

  if (!verifyGitLabToken(token)) {
    return NextResponse.json({ error: "Invalid or missing webhook token" }, { status: 401 });
  }

  const event = request.headers.get("x-gitlab-event");
  if (event !== "Push Hook") {
    return NextResponse.json({ ok: true, skipped: `event=${event}` });
  }

  let payload: {
    checkout_sha?: string;
    project?: { path_with_namespace?: string };
    commits?: Array<{
      id?: string;
      message?: string;
      timestamp?: string;
      added?: string[];
      modified?: string[];
      removed?: string[];
    }>;
  };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repoFullName = payload.project?.path_with_namespace;
  const commitSha = payload.checkout_sha;

  if (!repoFullName || !commitSha) {
    return NextResponse.json({ ok: true, skipped: "no_repo_or_commit" });
  }

  // Extract changed files and capture head commit metadata
  const changedFiles = new Set<string>();
  let commitMessage: string | undefined;
  let commitTimestamp: string | undefined;

  for (const commit of payload.commits ?? []) {
    if (!commitMessage && commit.message) {
      // Use the first (most recent) commit's message and timestamp for metadata
      commitMessage = commit.message.split("\n")[0].slice(0, 500);
      commitTimestamp = commit.timestamp;
    }
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      changedFiles.add(f);
    }
  }

  if (changedFiles.size === 0) {
    return NextResponse.json({ ok: true, skipped: "no_changed_files" });
  }

  const admin = createAdminClient();
  const { data: repo } = await admin
    .from("github_repos")
    .select("id, team_id")
    .ilike("repo_full_name", repoFullName)
    .maybeSingle();

  if (!repo) {
    return NextResponse.json({ ok: true, skipped: "repo_not_indexed" });
  }

  indexChangedFiles({
    repoId: repo.id,
    teamId: repo.team_id,
    repoFullName,
    provider: "gitlab",
    commitSha,
    commitMessage,
    commitTimestamp,
    changedFiles: Array.from(changedFiles),
  }).catch((err) => console.error("[webhook/gitlab] indexing error:", err));

  return NextResponse.json({
    ok: true,
    repo: repoFullName,
    commit: commitSha.slice(0, 8),
    files: changedFiles.size,
  });
}
