/**
 * Project Clustering — cosine similarity against project centroids.
 *
 * Algorithm:
 *  1. Fetch all projects for the team that have a centroid vector.
 *  2. Compare the new snapshot's embedding against each centroid.
 *  3. If the best match is above CLUSTER_THRESHOLD → assign to that project
 *     and update its centroid (online running average).
 *  4. Otherwise → create a new project, auto-name it via Claude Haiku.
 *  5. Write project_id back onto the context_snapshot row.
 *
 * This runs non-blocking after a successful capture so it never
 * slows down the critical path.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@/lib/anthropic";

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
      // Table might not exist yet (migration not applied)
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
      // ── Assign to existing project ───────────────────────────────────────
      projectId = best.id;
      projectName = best.name;
      isNew = false;

      // Fetch current centroid for weighted update
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
      // ── Create new project ───────────────────────────────────────────────
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

    // 2. Assign project_id on the snapshot
    await admin
      .from("context_snapshots")
      .update({ project_id: projectId })
      .eq("id", snapshotId);

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
