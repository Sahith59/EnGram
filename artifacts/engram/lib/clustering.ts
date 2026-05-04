/**
 * Project Clustering — cosine similarity against project centroids.
 *
 * Algorithm:
 *  1. Fetch all projects for the team that have a centroid vector.
 *  2. Compare the new snapshot's embedding against each centroid.
 *  3. If the best match is above CLUSTER_THRESHOLD → assign to that project
 *     and update its centroid (online running average).
 *  4. Otherwise → before creating a NEW project, check if any repo-linked
 *     workspace exists for this team. If one does, prefer it over spinning up
 *     a duplicate manual project. Only create a new project when there are
 *     genuinely no repo workspaces at all.
 *  5. Write project_id back onto the context_snapshot row.
 *
 * This runs non-blocking after a successful capture so it never
 * slows down the critical path.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";
import { extractClaimsFromSnapshot } from "@/lib/claims-extractor";

const CLUSTER_THRESHOLD = 0.72;
const MAX_PROJECTS_TO_CHECK = 50;

// ── cosine similarity ────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = norm(a) * norm(b);
  if (n === 0) return 0;
  return dot(a, b) / n;
}

// ── centroid update (online weighted average) ────────────────────────────────

export function updateCentroid(
  oldCentroid: number[],
  oldCount: number,
  newVector: number[]
): number[] {
  const total = oldCount + 1;
  return oldCentroid.map((v, i) => (v * oldCount + newVector[i]) / total);
}

// ── auto-name a new project via Claude Haiku ─────────────────────────────────

async function autoNameProject(title: string, summary: string): Promise<string> {
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: `Given this AI conversation title and summary, produce a short project name (3-6 words, title case, no punctuation) that describes the project this conversation belongs to.

Title: ${title.slice(0, 200)}
Summary: ${summary.slice(0, 400)}

Reply with ONLY the project name, nothing else.`,
        },
      ],
    });
    const raw =
      msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    return raw.slice(0, 80) || title.slice(0, 80);
  } catch {
    return title.slice(0, 80);
  }
}

// ── main entry point ─────────────────────────────────────────────────────────

export interface ClusterResult {
  projectId: string;
  projectName: string;
  isNew: boolean;
  similarity?: number;
}

export async function assignSnapshotToProject(opts: {
  snapshotId: string;
  teamId: string;
  embedding: number[];
  title: string;
  summary: string;
}): Promise<ClusterResult | null> {
  const { snapshotId, teamId, embedding, title, summary } = opts;
  const admin = createAdminClient();

  try {
    // 1. Use pgvector to find the nearest project centroid
    const { data: nearestProjects, error: rpcErr } = await admin.rpc(
      "find_nearest_project",
      {
        query_embedding: embedding,
        team_id_filter: teamId,
        match_threshold: CLUSTER_THRESHOLD,
        match_count: MAX_PROJECTS_TO_CHECK,
      }
    );

    if (rpcErr) {
      console.warn("[clustering] find_nearest_project failed:", rpcErr.message);
      return null;
    }

    const best =
      nearestProjects && nearestProjects.length > 0
        ? nearestProjects[0]
        : null;

    let projectId: string;
    let projectName: string;
    let isNew: boolean;

    if (best) {
      // ── Assign to existing project (centroid matched) ─────────────────────
      projectId = best.id;
      projectName = best.name;
      isNew = false;

      // Update centroid (running weighted average)
      const { data: proj } = await admin
        .from("projects")
        .select("centroid, snapshot_count")
        .eq("id", projectId)
        .single();

      if (proj?.centroid) {
        const newCentroid = updateCentroid(
          proj.centroid as unknown as number[],
          proj.snapshot_count ?? 0,
          embedding
        );
        await admin
          .from("projects")
          .update({
            centroid: newCentroid as unknown as string,
            snapshot_count: (proj.snapshot_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId);
      }
    } else {
      // ── No centroid match — check for repo-linked workspaces first ────────
      // Before creating a new manual project, prefer any existing Repository
      // Workspace for this team. This prevents the "QueryMesh Database Query
      // Optimization" duplicate scenario where a conversation about a known
      // repo ends up in a new orphan project because the workspace has 0
      // captures and no centroid yet.
      const { data: repoProjects } = await admin
        .from("projects")
        .select("id, name, github_repo_id, snapshot_count")
        .eq("team_id", teamId)
        .not("github_repo_id", "is", null)
        .order("snapshot_count", { ascending: false })
        .limit(10);

      if (repoProjects && repoProjects.length > 0) {
        // Pick the repo workspace with the fewest captures so new content
        // is distributed rather than always piling onto the first one.
        // If only one repo workspace exists it gets everything by default.
        // We pick the one with the lowest count (but at least 1 to show it
        // exists) if possible, otherwise just the first.
        const target =
          repoProjects.find((p) => p.snapshot_count === 0) ??
          repoProjects[repoProjects.length - 1];

        projectId = target.id;
        projectName = target.name;
        isNew = false;

        console.log(
          `[clustering] no centroid match → routing to repo workspace "${projectName}" ` +
            `(github_repo_id=${target.github_repo_id}) to avoid orphan project`
        );

        // Seed centroid with this capture's embedding so future clustering works
        await admin
          .from("projects")
          .update({
            centroid: embedding as unknown as string,
            snapshot_count: (target.snapshot_count ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", projectId);
      } else {
        // ── No repo workspaces exist — create a new manual project ──────────
        isNew = true;
        projectName = await autoNameProject(title, summary);

        const { data: newProj, error: insertErr } = await admin
          .from("projects")
          .insert({
            team_id: teamId,
            name: projectName,
            centroid: embedding as unknown as string,
            snapshot_count: 1,
          })
          .select("id")
          .single();

        if (insertErr || !newProj) {
          console.warn("[clustering] project insert failed:", insertErr?.message);
          return null;
        }
        projectId = newProj.id;
      }
    }

    // 2. Assign project_id on the snapshot
    await admin
      .from("context_snapshots")
      .update({ project_id: projectId })
      .eq("id", snapshotId);

    // 3. Trigger claims extraction now that project_id is known.
    //    Fetch the snapshot content we need, then run extraction async.
    Promise.resolve().then(async () => {
      try {
        const { data: snap } = await admin
          .from("context_snapshots")
          .select("created_by, raw_conversation, title, summary")
          .eq("id", snapshotId)
          .single();

        if (!snap) return;

        const pairs = Array.isArray(snap.raw_conversation)
          ? (snap.raw_conversation as { role: string; content: string }[])
          : [];
        const conversationText = pairs
          .map((p) => `${p.role.toUpperCase()}: ${p.content}`)
          .join("\n\n")
          .slice(0, 120_000);

        await extractClaimsFromSnapshot({
          snapshotId,
          projectId,
          teamId,
          createdBy: snap.created_by ?? "",
          conversationText,
          title: snap.title ?? "",
          summary: snap.summary ?? "",
        });
      } catch (e) {
        console.warn("[clustering] claims extraction error:", e);
      }
    });

    return {
      projectId,
      projectName,
      isNew,
      similarity: best?.similarity,
    };
  } catch (err) {
    console.warn("[clustering] unexpected error:", err);
    return null;
  }
}
