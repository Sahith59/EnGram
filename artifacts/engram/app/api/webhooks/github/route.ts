/**
 * POST /api/webhooks/github
 * Receives GitHub push events and triggers incremental AST re-indexing.
 *
 * Setup: In your GitHub App → Webhooks → Add webhook
 *   Payload URL: https://<your-app>/api/webhooks/github
 *   Content type: application/json
 *   Secret: value of GITHUB_WEBHOOK_SECRET env var
 *   Events: Just the push event
 *
 * Security: GITHUB_WEBHOOK_SECRET is REQUIRED in non-development environments.
 * Requests without a valid X-Hub-Signature-256 HMAC are rejected with 401.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { indexChangedFiles } from "@/lib/repo-indexer";
import { linkCommitToConversations } from "@/lib/commit-linker";
import { createHmac, timingSafeEqual } from "crypto";

function verifyGitHubSignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[webhook/github] GITHUB_WEBHOOK_SECRET not set — skipping signature check (dev only)");
      return true;
    }
    console.error("[webhook/github] GITHUB_WEBHOOK_SECRET is not configured — rejecting request");
    return false;
  }

  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  try {
    const sigBuf = Buffer.from(signature.padEnd(expected.length));
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGitHubSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  if (event !== "push") {
    return NextResponse.json({ ok: true, skipped: `event=${event}` });
  }

  let payload: {
    ref?: string;
    after?: string;
    repository?: { full_name?: string; default_branch?: string };
    head_commit?: { message?: string; timestamp?: string };
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
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repoFullName = payload.repository?.full_name;
  const commitSha = payload.after;

  if (!repoFullName || !commitSha || commitSha === "0000000000000000000000000000000000000000") {
    return NextResponse.json({ ok: true, skipped: "no_repo_or_delete_event" });
  }

  // Only process pushes to the default branch (main/master/etc.)
  // Webhook payload provides the pushed ref (e.g. "refs/heads/main")
  // and the repo's default_branch (e.g. "main"). Skip feature branches.
  const pushedBranch = payload.ref?.replace(/^refs\/heads\//, "");
  const defaultBranch = payload.repository?.default_branch ?? "main";
  if (pushedBranch && pushedBranch !== defaultBranch) {
    return NextResponse.json({ ok: true, skipped: `non_default_branch:${pushedBranch}` });
  }

  // Extract head commit metadata for storage alongside AST edges
  const commitMessage = payload.head_commit?.message
    ? payload.head_commit.message.split("\n")[0].slice(0, 500)
    : payload.commits?.[0]?.message?.split("\n")[0].slice(0, 500);
  const commitTimestamp = payload.head_commit?.timestamp ?? payload.commits?.[0]?.timestamp;

  // Collect added/modified files (will be re-indexed) and removed files (edges/chunks deleted)
  const changedFiles = new Set<string>();
  const removedFiles = new Set<string>();
  for (const commit of payload.commits ?? []) {
    for (const f of [...(commit.added ?? []), ...(commit.modified ?? [])]) {
      changedFiles.add(f);
    }
    for (const f of commit.removed ?? []) {
      removedFiles.add(f);
      changedFiles.delete(f); // don't re-index a file that was deleted
    }
  }

  if (changedFiles.size === 0 && removedFiles.size === 0) {
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

  // Delete edges and chunk AST metadata for removed files immediately (synchronous cleanup)
  if (removedFiles.size > 0) {
    const removedArr = Array.from(removedFiles);
    await admin
      .from("code_ast_edges")
      .delete()
      .eq("repo_id", repo.id)
      .in("source_file", removedArr);
    await admin
      .from("github_chunks")
      .update({ ast_node_type: null, ast_parent: null })
      .eq("repo_id", repo.id)
      .in("file_path", removedArr);
  }

  // Run AST indexing then semantic linking in background (non-blocking)
  (async () => {
    try {
      await indexChangedFiles({
        repoId: repo.id,
        teamId: repo.team_id,
        repoFullName,
        provider: "github",
        commitSha,
        commitMessage,
        commitTimestamp,
        changedFiles: Array.from(changedFiles),
      });
    } catch (err) {
      console.error("[webhook/github] indexing error:", err);
    }
    linkCommitToConversations({
      repoId: repo.id,
      teamId: repo.team_id,
      commitSha,
      commitMessage,
      commitTimestamp,
      changedFiles: Array.from(changedFiles),
    }).catch((err) => console.error("[webhook/github] commit-linker error:", err));
  })();

  return NextResponse.json({
    ok: true,
    repo: repoFullName,
    commit: commitSha.slice(0, 8),
    files: changedFiles.size,
  });
}
