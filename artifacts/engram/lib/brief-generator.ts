/**
 * Brief Generator — Phase 12: Trustworthy Brief Generation
 *
 * Builds a structured, trustworthy project brief from all active claims.
 * Every statement in the brief:
 *   - Traces to a real captured conversation (source_snapshot_id)
 *   - Has a confidence score (recency × frequency)
 *   - Is flagged if stale (not seen in 60+ days)
 *   - Is excluded from injection if it conflicts with another claim
 *
 * Output includes three injection-ready sizes:
 *   - full    (~1,400 tokens) — for Claude 3+ and GPT-4o
 *   - medium  (~900 tokens)  — for standard context windows
 *   - compact (~400 tokens)  — for tight budgets or quick resumes
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCodeContext, type CodeAnchor } from "@/lib/code-context-fetcher";

const STALENESS_DAYS = 60; // claims unseen for 60+ days are flagged

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrustyClaim {
  id: string;
  claim_text: string;
  claim_type:
    | "decision"
    | "constraint"
    | "next_step"
    | "technology"
    | "dead_end"
    | "observation";
  status: "active" | "superseded" | "abandoned" | "conflicted";
  confidence_score: number; // 0–1, computed from recency + frequency
  is_stale: boolean;
  reinforcement_count: number;
  first_seen_at: string;
  last_seen_at: string;
  snapshot_id: string;
  snapshot_title: string | null;
}

export interface ConflictSummary {
  id: string;
  claim_a: TrustyClaim;
  claim_b: TrustyClaim;
}

export interface ProjectBrief {
  project_id: string;
  project_name: string;
  generated_at: string;
  capture_count: number;
  claim_count: number;
  unresolved_conflict_count: number;
  // Claims grouped by type — only active, non-conflicted claims
  categories: {
    decision: TrustyClaim[];
    constraint: TrustyClaim[];
    next_step: TrustyClaim[];
    technology: TrustyClaim[];
    dead_end: TrustyClaim[];
    observation: TrustyClaim[];
  };
  // Unresolved conflicts — must be shown before injection
  conflicts: ConflictSummary[];
  // F-09: Code anchors from linked GitHub repo
  code_context: CodeAnchor[];
  // Injection-ready markdown at three sizes
  injection: {
    full: string;     // ~1,400 tokens
    medium: string;   // ~900 tokens
    compact: string;  // ~400 tokens
  };
  // Estimated token counts (rough: 1 token ≈ 4 chars)
  token_estimates: {
    full: number;
    medium: number;
    compact: number;
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateProjectBrief(
  projectId: string
): Promise<ProjectBrief | null> {
  const admin = createAdminClient();

  // Fetch project metadata (include team_id + github_repo_id for code context)
  const { data: project } = await admin
    .from("projects")
    .select("id, name, snapshot_count, team_id, github_repo_id")
    .eq("id", projectId)
    .single();

  if (!project) return null;

  // Fetch all non-abandoned claims with their source snapshot titles
  const { data: rawClaims } = await admin
    .from("project_claims")
    .select(
      `id, claim_text, claim_type, status, confidence_score,
       reinforcement_count, first_seen_at, last_seen_at, snapshot_id,
       context_snapshots!snapshot_id(title)`
    )
    .eq("project_id", projectId)
    .neq("status", "abandoned")
    .order("last_seen_at", { ascending: false })
    .limit(500);

  // Fetch unresolved conflicts
  const { data: rawConflicts } = await admin
    .from("claim_conflicts")
    .select(
      `id, claim_a_id, claim_b_id`
    )
    .eq("project_id", projectId)
    .eq("resolved", false)
    .limit(50);

  const claims = (rawClaims ?? []).map((c) =>
    computeTrustyClaim(c as RawClaim)
  );

  // Build claim lookup map for conflict summaries
  const claimMap = new Map(claims.map((c) => [c.id, c]));

  const conflicts: ConflictSummary[] = (rawConflicts ?? [])
    .map((cf) => {
      const a = claimMap.get(cf.claim_a_id);
      const b = claimMap.get(cf.claim_b_id);
      if (!a || !b) return null;
      return { id: cf.id, claim_a: a, claim_b: b };
    })
    .filter(Boolean) as ConflictSummary[];

  // Active, non-conflicted claims only for injection
  const injectable = claims.filter((c) => c.status === "active");

  const categories = {
    decision: injectable
      .filter((c) => c.claim_type === "decision")
      .sort(byConfidenceDesc),
    constraint: injectable
      .filter((c) => c.claim_type === "constraint")
      .sort(byConfidenceDesc),
    next_step: injectable
      .filter((c) => c.claim_type === "next_step")
      .sort(byConfidenceDesc),
    technology: injectable
      .filter((c) => c.claim_type === "technology")
      .sort(byConfidenceDesc),
    dead_end: injectable
      .filter((c) => c.claim_type === "dead_end")
      .sort(byConfidenceDesc),
    observation: injectable
      .filter((c) => c.claim_type === "observation")
      .sort(byConfidenceDesc),
  };

  // F-09: Fetch code anchors from the linked GitHub repo (best-effort)
  let codeContext: CodeAnchor[] = [];
  const proj = project as unknown as { github_repo_id: string | null; team_id: string };
  if (proj.github_repo_id && proj.team_id) {
    try {
      codeContext = await fetchCodeContext({
        projectId,
        githubRepoId: proj.github_repo_id,
        teamId: proj.team_id,
        claims: injectable,
      });
    } catch (err) {
      console.warn("[brief] code context fetch failed:", err);
    }
  }

  const injection = buildInjectionBriefs(
    project.name,
    categories,
    conflicts,
    codeContext
  );

  return {
    project_id: projectId,
    project_name: project.name,
    generated_at: new Date().toISOString(),
    capture_count: project.snapshot_count ?? 0,
    claim_count: claims.length,
    unresolved_conflict_count: conflicts.length,
    categories,
    conflicts,
    code_context: codeContext,
    injection,
    token_estimates: {
      full: Math.round(injection.full.length / 4),
      medium: Math.round(injection.medium.length / 4),
      compact: Math.round(injection.compact.length / 4),
    },
  };
}

// ── Confidence scoring ────────────────────────────────────────────────────────
// confidence = 0.6 × recency_score + 0.4 × frequency_score
// recency_score = exp(-days_since_last_seen / 45)  → half-life ~31 days
// frequency_score = min(reinforcement_count / 5, 1.0) → saturates at 5

function computeConfidence(
  lastSeenAt: string,
  reinforcementCount: number
): number {
  const daysSince =
    (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
  const recency = Math.exp(-daysSince / 45);
  const frequency = Math.min(reinforcementCount / 5, 1.0);
  return Math.round((0.6 * recency + 0.4 * frequency) * 1000) / 1000;
}

// ── Raw DB type ───────────────────────────────────────────────────────────────

interface RawClaim {
  id: string;
  claim_text: string;
  claim_type: string;
  status: string;
  confidence_score: number;
  reinforcement_count: number;
  first_seen_at: string;
  last_seen_at: string;
  snapshot_id: string;
  // Supabase returns joined rows as an array when using !snapshot_id
  context_snapshots: { title: string | null } | { title: string | null }[] | null;
}

function computeTrustyClaim(raw: RawClaim): TrustyClaim {
  const confidence = computeConfidence(
    raw.last_seen_at,
    raw.reinforcement_count ?? 1
  );
  const daysSince =
    (Date.now() - new Date(raw.last_seen_at).getTime()) /
    (1000 * 60 * 60 * 24);

  return {
    id: raw.id,
    claim_text: raw.claim_text,
    claim_type: raw.claim_type as TrustyClaim["claim_type"],
    status: raw.status as TrustyClaim["status"],
    confidence_score: confidence,
    is_stale: daysSince > STALENESS_DAYS,
    reinforcement_count: raw.reinforcement_count ?? 1,
    first_seen_at: raw.first_seen_at,
    last_seen_at: raw.last_seen_at,
    snapshot_id: raw.snapshot_id,
    snapshot_title: Array.isArray(raw.context_snapshots)
      ? (raw.context_snapshots[0]?.title ?? null)
      : (raw.context_snapshots?.title ?? null),
  };
}

function byConfidenceDesc(a: TrustyClaim, b: TrustyClaim) {
  return b.confidence_score - a.confidence_score;
}

// ── Brief markdown builders ───────────────────────────────────────────────────

function staleTag(c: TrustyClaim): string {
  return c.is_stale ? " ⚠️ [possibly stale]" : "";
}

function confTag(c: TrustyClaim): string {
  const pct = Math.round(c.confidence_score * 100);
  if (pct >= 80) return "";
  if (pct >= 50) return ` (${pct}% confidence)`;
  return ` (⚠️ ${pct}% confidence)`;
}

function buildInjectionBriefs(
  projectName: string,
  cats: ProjectBrief["categories"],
  conflicts: ConflictSummary[],
  codeContext: CodeAnchor[] = []
): ProjectBrief["injection"] {
  const ts = new Date().toLocaleDateString();

  // ── FULL brief ────────────────────────────────────────────────────────────
  const conflictWarning =
    conflicts.length > 0
      ? `\n> ⚡ **${conflicts.length} unresolved decision conflict${conflicts.length > 1 ? "s" : ""} detected.** Review in ENGRAM before acting on conflicting items.\n`
      : "";

  const sections: string[] = [
    `# ENGRAM Project Brief — ${projectName}`,
    `*Generated: ${ts} · All claims are sourced from captured AI conversations*`,
    conflictWarning,
  ];

  if (cats.decision.length) {
    sections.push("## Decisions Made");
    cats.decision.forEach((c) => {
      sections.push(`- ${c.claim_text}${confTag(c)}${staleTag(c)}`);
    });
  }

  if (cats.constraint.length) {
    sections.push("## Constraints & Non-Goals");
    cats.constraint.forEach((c) => {
      sections.push(`- ${c.claim_text}${confTag(c)}${staleTag(c)}`);
    });
  }

  if (cats.next_step.length) {
    sections.push("## Immediate Next Steps");
    cats.next_step.forEach((c) => {
      sections.push(`- ${c.claim_text}${confTag(c)}${staleTag(c)}`);
    });
  }

  if (cats.technology.length) {
    sections.push("## Active Technologies");
    sections.push(
      cats.technology.map((c) => `\`${c.claim_text}\``).join(", ")
    );
  }

  if (cats.dead_end.length) {
    sections.push("## Dead Ends (Do Not Revisit)");
    cats.dead_end.forEach((c) => {
      sections.push(`- ~~${c.claim_text}~~${staleTag(c)}`);
    });
  }

  if (cats.observation.length && cats.observation.length <= 8) {
    sections.push("## Current State");
    cats.observation.slice(0, 8).forEach((c) => {
      sections.push(`- ${c.claim_text}${confTag(c)}${staleTag(c)}`);
    });
  }

  // F-09: Code anchors (full brief only)
  if (codeContext.length > 0) {
    sections.push("## Code Anchors (from linked repository)");
    sections.push(
      "*These are the most relevant code locations based on the decisions above.*"
    );
    codeContext.forEach((anchor) => {
      const lang = anchor.language ?? "";
      sections.push(
        `**\`${anchor.file_path}\`** (relevance: ${Math.round(anchor.similarity * 100)}%)\n\`\`\`${lang}\n${anchor.snippet}\n\`\`\``
      );
    });
  }

  sections.push(
    "\n---",
    "**Instructions for the AI receiving this brief:**",
    "1. Read all sections above carefully.",
    "2. Do NOT start generating code or plans until you acknowledge what you've understood.",
    "3. If you are about to state something not in this brief, prefix it with `⚠️ Inferring:`.",
    "4. Ask me: 'What would you like to do next?' and wait for my answer."
  );

  const full = sections.join("\n\n");

  // ── MEDIUM brief (decisions + constraints + next steps only) ──────────────
  const medSections: string[] = [
    `# ENGRAM Brief — ${projectName} (${ts})`,
    conflictWarning,
  ];
  if (cats.decision.length) {
    medSections.push(
      "## Decisions\n" +
        cats.decision
          .slice(0, 8)
          .map((c) => `- ${c.claim_text}${staleTag(c)}`)
          .join("\n")
    );
  }
  if (cats.constraint.length) {
    medSections.push(
      "## Constraints\n" +
        cats.constraint
          .slice(0, 5)
          .map((c) => `- ${c.claim_text}`)
          .join("\n")
    );
  }
  if (cats.next_step.length) {
    medSections.push(
      "## Next Steps\n" +
        cats.next_step
          .slice(0, 5)
          .map((c) => `- ${c.claim_text}`)
          .join("\n")
    );
  }
  if (cats.technology.length) {
    medSections.push(
      "**Stack:** " + cats.technology.slice(0, 8).map((c) => c.claim_text).join(", ")
    );
  }
  medSections.push(
    "\n*Prefix inferences with ⚠️. Say what you understood before starting work.*"
  );
  const medium = medSections.join("\n\n");

  // ── COMPACT brief (one-liner per category) ────────────────────────────────
  const compactParts: string[] = [
    `**${projectName}** — ENGRAM context (${ts})`,
  ];
  if (cats.decision.length)
    compactParts.push(
      `Decisions: ${cats.decision
        .slice(0, 4)
        .map((c) => c.claim_text)
        .join("; ")}`
    );
  if (cats.next_step.length)
    compactParts.push(
      `Next: ${cats.next_step
        .slice(0, 3)
        .map((c) => c.claim_text)
        .join("; ")}`
    );
  if (cats.technology.length)
    compactParts.push(
      `Stack: ${cats.technology
        .slice(0, 6)
        .map((c) => c.claim_text)
        .join(", ")}`
    );
  if (cats.constraint.length)
    compactParts.push(
      `Constraints: ${cats.constraint
        .slice(0, 3)
        .map((c) => c.claim_text)
        .join("; ")}`
    );
  if (conflicts.length)
    compactParts.push(`⚡ ${conflicts.length} unresolved conflict(s) — check ENGRAM`);
  compactParts.push("Prefix inferences with ⚠️.");
  const compact = compactParts.join("\n");

  return { full, medium, compact };
}
