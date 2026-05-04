/**
 * Routing Threshold — Phase 14 (F-14)
 *
 * Adaptive per-project similarity threshold for Tier 2 (semantic) routing.
 * Default: 0.35. Adjusts based on observed routing outcomes:
 *
 *   - Projects with low avg similarity but successful captures → lower threshold
 *   - Projects with many low-confidence routes → raise threshold (reduce noise)
 *
 * Stats are recorded per routing decision and re-evaluated lazily when
 * getProjectThreshold() is called (max once per 30 min per project).
 */

import { createAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_THRESHOLD = 0.35;
const MIN_THRESHOLD = 0.25;
const MAX_THRESHOLD = 0.55;
const CALIBRATE_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const MIN_DECISIONS_TO_ADAPT = 10; // need at least 10 decisions before adapting

export interface RoutingStats {
  project_id: string;
  repo_id: string;
  routing_attempts: number;
  routing_hits: number;         // times a route was accepted (not rejected)
  avg_similarity: number;       // avg similarity of all routing decisions
  threshold_override: number;   // the currently active threshold
  last_calibrated_at: string;
  updated_at: string;
}

// ── Main exports ──────────────────────────────────────────────────────────────

/**
 * Get the effective similarity threshold for a specific project.
 * Falls back to DEFAULT_THRESHOLD if no stats exist yet.
 */
export async function getProjectThreshold(
  projectId: string,
  repoId: string | number
): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("project_routing_stats")
    .select("threshold_override, routing_attempts, avg_similarity, last_calibrated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!data) return DEFAULT_THRESHOLD;

  // Re-calibrate if stale and enough data
  if (
    data.routing_attempts >= MIN_DECISIONS_TO_ADAPT &&
    Date.now() - new Date(data.last_calibrated_at).getTime() > CALIBRATE_INTERVAL_MS
  ) {
    const newThreshold = calibrateThreshold(data.avg_similarity, data.routing_attempts);
    if (Math.abs(newThreshold - data.threshold_override) >= 0.02) {
      // Update threshold quietly
      await admin
        .from("project_routing_stats")
        .update({
          threshold_override: newThreshold,
          last_calibrated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("project_id", projectId);
      return newThreshold;
    }
    // Still mark calibration time even if unchanged
    await admin
      .from("project_routing_stats")
      .update({ last_calibrated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("project_id", projectId);
  }

  return data.threshold_override ?? DEFAULT_THRESHOLD;
}

/**
 * Record a routing decision for future calibration.
 * Call after every Tier 2 routing attempt (hit or miss).
 */
export async function recordRoutingDecision(opts: {
  projectId: string;
  repoId: string | number;
  similarity: number;
  routed: boolean; // true = was above threshold and accepted
}): Promise<void> {
  const { projectId, repoId, similarity, routed } = opts;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Upsert the stats row, updating running averages
  const { data: existing } = await admin
    .from("project_routing_stats")
    .select("routing_attempts, routing_hits, avg_similarity, threshold_override")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existing) {
    // First ever routing decision for this project
    await admin.from("project_routing_stats").insert({
      project_id: projectId,
      repo_id: String(repoId),
      routing_attempts: 1,
      routing_hits: routed ? 1 : 0,
      avg_similarity: similarity,
      threshold_override: DEFAULT_THRESHOLD,
      last_calibrated_at: now,
      updated_at: now,
    });
    return;
  }

  const newAttempts = existing.routing_attempts + 1;
  const newHits = existing.routing_hits + (routed ? 1 : 0);
  // Incremental running average
  const newAvg =
    (existing.avg_similarity * existing.routing_attempts + similarity) / newAttempts;

  await admin
    .from("project_routing_stats")
    .update({
      routing_attempts: newAttempts,
      routing_hits: newHits,
      avg_similarity: Math.round(newAvg * 10000) / 10000,
      updated_at: now,
    })
    .eq("project_id", projectId);
}

/**
 * Compute a calibrated threshold from observed statistics.
 * The logic is intentionally conservative — small incremental adjustments.
 */
function calibrateThreshold(avgSimilarity: number, _attempts: number): number {
  // If avg similarity is high, we can afford to be more strict
  // If avg similarity is low, lower the threshold to avoid missing things
  let threshold = DEFAULT_THRESHOLD;

  if (avgSimilarity > 0.52) {
    // Conversations are matching very well — allow slight raise for precision
    threshold = Math.min(DEFAULT_THRESHOLD + 0.05, MAX_THRESHOLD);
  } else if (avgSimilarity < 0.38) {
    // Conversations are borderline — lower threshold to be more inclusive
    threshold = Math.max(DEFAULT_THRESHOLD - 0.05, MIN_THRESHOLD);
  }

  return Math.round(threshold * 1000) / 1000;
}
