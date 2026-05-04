/**
 * POST /api/projects/[id]/blast-radius
 *
 * Blast Radius Engine — streaming SSE endpoint.
 * Accepts { file_path, change_description, analysis_name? }
 * and streams three phases:
 *   1. `affected_files` — bidirectional AST traversal result
 *   2. `intent_snapshots` — relevant AI conversations
 *   3. `token` chunks — Claude synthesis (streamed)
 *   4. `result` — structured JSON with risk_level + saved query id
 *
 * A hard 15-second timeout is enforced via AbortController.
 * If triggered, an `error` event is emitted and the stream is closed.
 *
 * GET /api/projects/[id]/blast-radius
 * Returns the 10 most recent blast radius analyses for this project.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { traverseAstEdges } from "@/lib/blast-radius/ast-traverser";
import { retrieveIntent } from "@/lib/blast-radius/intent-retriever";
import { synthesizeBlastRadius } from "@/lib/blast-radius/synthesizer";

const ANALYSIS_TIMEOUT_MS = 30_000;

// ── Auth helper ───────────────────────────────────────────────────────────────
async function resolveUserAndProject(
  projectId: string
): Promise<{ userId: string; teamId: string; repoId: string } | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return null;

  const { data: project } = await admin
    .from("projects")
    .select("id, github_repo_id")
    .eq("id", projectId)
    .eq("team_id", profile.team_id)
    .single();
  if (!project?.github_repo_id) return null;

  return { userId: user.id, teamId: profile.team_id, repoId: project.github_repo_id };
}

// ── SSE encoder ───────────────────────────────────────────────────────────────
function sseEvent(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── POST — streaming blast radius analysis ────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const ctx = await resolveUserAndProject(params.id);
  if (!ctx) return NextResponse.json({ error: "Unauthorized or no repo" }, { status: 401 });

  let body: { file_path: string; change_description: string; analysis_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { file_path, change_description, analysis_name } = body;
  if (!file_path?.trim() || !change_description?.trim()) {
    return NextResponse.json(
      { error: "file_path and change_description are required" },
      { status: 400 }
    );
  }

  const admin   = createAdminClient();
  const encoder = new TextEncoder();

  // ── 30-second hard timeout ─────────────────────────────────────────────────
  const ac        = new AbortController();
  const timeoutId = setTimeout(
    () => ac.abort(new Error("Analysis timed out after 30 seconds")),
    ANALYSIS_TIMEOUT_MS
  );

  const stream = new ReadableStream({
    async start(controller) {
      // Guard against double-close (timeout abort listener + finally block racing)
      let controllerClosed = false;
      function safeClose() {
        if (!controllerClosed) {
          controllerClosed = true;
          controller.close();
        }
      }

      function send(event: string, data: unknown) {
        if (!controllerClosed) {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        }
      }

      // If timeout fires while we're still running, emit error and close
      ac.signal.addEventListener("abort", () => {
        send("error", { message: "Analysis timed out — Claude is taking longer than expected. Try again or use a more specific file path." });
        safeClose();
      }, { once: true });

      try {
        // ── Phase 1: AST traversal ─────────────────────────────────────────
        const { files: affectedFiles, edgesTraversed } = await traverseAstEdges({
          repoId:    ctx.repoId,
          startFile: file_path.trim(),
        });

        if (ac.signal.aborted) return;

        send("affected_files", {
          files:          affectedFiles,
          edges_traversed: edgesTraversed,
          file_path:       file_path.trim(),
        });

        // ── Phase 2: Intent retrieval ──────────────────────────────────────
        const { snapshots: intentSnapshots, linksFound } = await retrieveIntent({
          repoId:            ctx.repoId,
          projectId:         params.id,
          teamId:            ctx.teamId,
          affectedFiles:     affectedFiles.map((f) => f.file_path),
          targetFile:        file_path.trim(),
          changeDescription: change_description.trim(),
        });

        if (ac.signal.aborted) return;

        send("intent_snapshots", {
          snapshots:   intentSnapshots,
          links_found: linksFound,
        });

        // ── Phase 3: Claude synthesis (streamed) ───────────────────────────
        let riskLevel:    string   = "Medium";
        let riskSummary:  string   = "";
        let filesToUpdate: string[] = [];

        for await (const chunk of synthesizeBlastRadius({
          targetFile:        file_path.trim(),
          changeDescription: change_description.trim(),
          affectedFiles,
          intentSnapshots,
          signal:            ac.signal,
        })) {
          if (ac.signal.aborted) break;

          if (chunk.startsWith("\n__RESULT__:")) {
            const jsonStr = chunk.slice("\n__RESULT__:".length);
            try {
              const result  = JSON.parse(jsonStr);
              riskLevel     = result.risk_level     ?? "Medium";
              riskSummary   = result.risk_summary   ?? "";
              filesToUpdate = result.files_to_update ?? [];
            } catch { /* keep defaults */ }
          } else {
            send("token", { text: chunk });
          }
        }

        if (ac.signal.aborted) return;

        // ── Phase 4: Persist + return structured result ────────────────────
        const { data: savedQuery } = await admin
          .from("blast_radius_queries")
          .insert({
            project_id:           params.id,
            query_file:           file_path.trim(),
            change_description:   change_description.trim(),
            analysis_name:        analysis_name?.trim() || null,
            affected_files:       affectedFiles,
            intent_snapshots:     intentSnapshots,
            risk_summary:         riskSummary,
            risk_level:           riskLevel,
            ast_edges_traversed:  edgesTraversed,
            semantic_links_found: linksFound,
            created_by:           ctx.userId,
          })
          .select("id")
          .single();

        send("result", {
          query_id:        savedQuery?.id ?? null,
          risk_level:      riskLevel,
          risk_summary:    riskSummary,
          files_to_update: filesToUpdate,
          stats: {
            edges_traversed: edgesTraversed,
            links_found:     linksFound,
            affected_count:  affectedFiles.length,
            snapshots_count: intentSnapshots.length,
          },
        });
      } catch (err) {
        if (ac.signal.aborted) return; // timeout already sent the error event
        console.error("[blast-radius] error:", err);
        send("error", { message: "Analysis failed — check server logs" });
      } finally {
        clearTimeout(timeoutId);
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}

// ── GET — past analyses ───────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) return NextResponse.json({ error: "No team" }, { status: 400 });

  // Verify project membership
  const { data: project } = await admin
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: queries } = await admin
    .from("blast_radius_queries")
    .select(
      "id, query_file, change_description, analysis_name, risk_level, risk_summary, " +
      "ast_edges_traversed, semantic_links_found, created_at, " +
      "affected_files, intent_snapshots"
    )
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({ queries: queries ?? [] });
}
