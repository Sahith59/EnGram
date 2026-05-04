/**
 * POST /api/webhooks/github
 * Receives GitHub push events and triggers incremental AST re-indexing.
 *
 * Setup: In your GitHub repo → Settings → Webhooks → Add webhook
 *   Payload URL: https://<your-app>/api/webhooks/github
 *   Content type: application/json
 *   Secret: value of GITHUB_WEBHOOK_SECRET env var
 *   Events: Just the push event
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexChangedFiles } from "@/lib/repo-indexer";
import { createHmac, timingSafeEqual } from "crypto";

function verifyGitHubSignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if no secret configured (dev mode)
  if (!signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGitHubSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  if (event !== "push") {
    return NextResponse.json({ ok: true, skipped: `event=${event}` });
  }

  let payload: {
    ref?: string;
    after?: string;
    repository?: { full_name?: string };
    commits?: Array<{
      id?: string;
      added?: string[];
      modified?: string[];
      removed?: string[];
    }>;
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repoFullName = payload.repository?.full_name;
  const commitSha = payload.after;

  if (!repoFullName || !commitSha || commitSha === "0000000000000000000000000000000000000000") {
    return NextResponse.json({ ok: true, skipped: "no_repo_or_delete_event" });
  }

  // Collect all changed files from all commits in the push
  const changedFiles = new Set<string>();
  for (const commit of payload.commits ?? []) {
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      changedFiles.add(f);
    }
  }

  if (changedFiles.size === 0) {
    return NextResponse.json({ ok: true, skipped: "no_changed_files" });
  }

  // Find the indexed repo record
  const admin = createAdminClient();
  const { data: repo } = await admin
    .from("github_repos")
    .select("id, team_id")
    .ilike("repo_full_name", repoFullName)
    .maybeSingle();

  if (!repo) {
    return NextResponse.json({ ok: true, skipped: "repo_not_indexed" });
  }

  // Run indexing in background (don't block the webhook response)
  indexChangedFiles({
    repoId: repo.id,
    teamId: repo.team_id,
    repoFullName,
    provider: "github",
    commitSha,
    changedFiles: Array.from(changedFiles),
  }).catch((err) => console.error("[webhook/github] indexing error:", err));

  return NextResponse.json({
    ok: true,
    repo: repoFullName,
    commit: commitSha.slice(0, 8),
    files: changedFiles.size,
  });
}
