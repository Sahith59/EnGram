/**
 * POST /api/webhooks/gitlab
 * Receives GitLab push events and triggers incremental AST re-indexing.
 *
 * Setup: In your GitLab project → Settings → Webhooks → Add webhook
 *   URL: https://<your-app>/api/webhooks/gitlab
 *   Secret token: value of GITLAB_WEBHOOK_TOKEN env var
 *   Trigger: Push events
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexChangedFiles } from "@/lib/repo-indexer";

export async function POST(request: NextRequest) {
  const token = request.headers.get("x-gitlab-token");
  const expectedToken = process.env.GITLAB_WEBHOOK_TOKEN;

  if (expectedToken && token !== expectedToken) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
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

  const changedFiles = new Set<string>();
  for (const commit of payload.commits ?? []) {
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
    changedFiles: Array.from(changedFiles),
  }).catch((err) => console.error("[webhook/gitlab] indexing error:", err));

  return NextResponse.json({
    ok: true,
    repo: repoFullName,
    commit: commitSha.slice(0, 8),
    files: changedFiles.size,
  });
}
