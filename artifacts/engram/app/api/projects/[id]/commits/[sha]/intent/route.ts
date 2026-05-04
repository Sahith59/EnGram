/**
 * GET /api/projects/[id]/commits/[sha]/intent
 * Returns all semantic_links for a commit + a Claude-generated "Why this
 * was built" intent summary derived from the linked conversation snapshots.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { anthropic } from "@/lib/anthropic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string; sha: string } }
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

  // Verify project membership + get repo
  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: repo } = await admin
    .from("github_repos")
    .select("id, repo_full_name")
    .eq("id", project.github_repo_id)
    .single();
  if (!repo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch semantic links for this commit
  const { data: links } = await admin
    .from("semantic_links")
    .select("id, snapshot_id, similarity, linked_files, commit_message, committed_at, is_manual")
    .eq("repo_id", repo.id)
    .eq("commit_sha", params.sha)
    .order("similarity", { ascending: false });

  if (!links || links.length === 0) {
    return NextResponse.json({
      commit_sha: params.sha,
      intent_summary: null,
      linked_snapshots: [],
    });
  }

  // Load the linked snapshot details
  const snapshotIds = links.map((l) => l.snapshot_id);
  const { data: snapshots } = await admin
    .from("context_snapshots")
    .select("id, title, summary, decision, created_at, ai_tool")
    .in("id", snapshotIds);

  const snapshotMap = new Map((snapshots ?? []).map((s) => [s.id, s]));
  const linkedSnapshots = links.map((l) => ({
    link_id: l.id,
    snapshot_id: l.snapshot_id,
    similarity: l.similarity,
    is_manual: l.is_manual,
    linked_files: l.linked_files,
    snapshot: snapshotMap.get(l.snapshot_id) ?? null,
  }));

  // Generate Claude intent summary from the linked conversations
  let intentSummary: string | null = null;
  try {
    const snapshotContext = linkedSnapshots
      .filter((l) => l.snapshot !== null)
      .map((l) => {
        const s = l.snapshot!;
        return [
          `Conversation: "${s.title ?? "Untitled"}"`,
          s.summary ? `Summary: ${s.summary.slice(0, 400)}` : null,
          s.decision ? `Decision: ${s.decision.slice(0, 300)}` : null,
        ].filter(Boolean).join("\n");
      })
      .join("\n\n---\n\n");

    const commitMsg = links[0]?.commit_message ?? params.sha;
    const prompt = `You are analyzing a git commit and the AI conversations that preceded it.

Commit: "${commitMsg}"
Repo: ${repo.repo_full_name}
Files changed: ${(links[0]?.linked_files ?? []).slice(0, 10).join(", ")}

AI conversations captured before this commit:
${snapshotContext}

Explain in 2-3 sentences why this commit was made and what constraint or goal it satisfies. Be specific and grounded in the conversation content above.`;

    const msg = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    intentSummary = block.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.warn("[intent] Claude error:", err);
  }

  return NextResponse.json({
    commit_sha: params.sha,
    intent_summary: intentSummary,
    linked_snapshots: linkedSnapshots,
  });
}
