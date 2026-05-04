/**
 * Signal Scorer — F-01: Auto-capture signal scoring
 *
 * Rates a conversation 0–100 on how "capture-worthy" it is.
 * High score = developer is making real decisions worth saving.
 * Low score = generic Q&A, tutorial-following, brainstorming without resolution.
 *
 * Formula:
 *   0.35 × decision_language   (keywords: "decided", "ruled out", "we'll use"…)
 *   0.25 × specificity         (tech names, file paths, version numbers, code)
 *   0.20 × length              (optimal 4–20 pairs; penalise very short/long)
 *   0.20 × novelty             (concrete project context vs. generic "how do I")
 */

export interface SignalScore {
  total: number;         // 0-100
  decision: number;      // 0-100
  specificity: number;   // 0-100
  length: number;        // 0-100
  novelty: number;       // 0-100
  label: "high" | "medium" | "low";
  suggestion: string | null;
}

// ── Vocabulary ────────────────────────────────────────────────────────────────

const DECISION_TERMS = [
  "decided", "decision", "we'll use", "we're using", "we are using",
  "going with", "chosen", "we chose", "ruled out", "not going to",
  "won't use", "will not use", "abandoned", "discarded", "dropped",
  "constraint", "requirement", "must", "should not", "next step",
  "action item", "we need to", "plan is", "the approach", "architecture",
  "chosen approach", "the solution", "will implement", "going to build",
  "we'll build", "we're building", "settled on", "agreed on",
  "the design", "the contract", "the interface", "the schema",
];

const TECH_REGEXES: RegExp[] = [
  /\b(postgres|postgresql|mongodb|redis|mysql|sqlite|supabase|prisma)\b/i,
  /\b(react|vue|angular|nextjs|next\.js|svelte|solid|remix)\b/i,
  /\b(typescript|javascript|python|rust|golang|java|kotlin|swift|dart)\b/i,
  /\b(docker|kubernetes|k8s|aws|gcp|azure|vercel|netlify|cloudflare)\b/i,
  /\b(graphql|rest|grpc|openapi|trpc|websocket)\b/i,
  /\b(tailwind|shadcn|mui|bootstrap|styled-components)\b/i,
  /v?\d+\.\d+(\.\d+)?/,                          // version numbers
  /[a-z][\w-]*\.[a-z]{2,4}\/[\w/-]/,             // file paths
  /\b(api|endpoint|route|schema|migration|table|column|function|class)\b/i,
  /`[^`\n]+`/,                                    // inline code
  /\b(npm|yarn|pnpm|pip|cargo|go)\b/i,
];

const NOVELTY_TERMS = [
  "we", "our", "the project", "the system", "we decided", "we chose",
  "the team", "we are building", "we need", "we will", "our approach",
  "in our case", "for our", "the codebase", "the repo", "our stack",
  "our app", "our api", "our database", "our users",
];

const GENERIC_TERMS = [
  "how do i", "what is", "explain ", "tell me about", "can you help",
  "what are the", "how does", "please write", "write me a",
  "give me an example", "show me how",
];

// ── Scorer ────────────────────────────────────────────────────────────────────

export function scoreConversation(
  pairs: { role: string; content: string }[]
): SignalScore {
  if (!pairs || pairs.length === 0) {
    return { total: 0, decision: 0, specificity: 0, length: 0, novelty: 0, label: "low", suggestion: null };
  }

  const fullText = pairs.map((p) => p.content).join(" ").toLowerCase();

  // 1. Decision language (0-100)
  const decisionHits = DECISION_TERMS.filter((t) => fullText.includes(t)).length;
  const decision = Math.round(Math.min(decisionHits / 5, 1) * 100);

  // 2. Specificity (0-100)
  const specHits = TECH_REGEXES.filter((r) => r.test(fullText)).length;
  const specificity = Math.round(Math.min(specHits / 5, 1) * 100);

  // 3. Length (0-100): optimal 4-20 pairs
  const n = pairs.length;
  let lengthRaw = 0;
  if (n >= 4 && n <= 20) lengthRaw = 1;
  else if (n >= 2 && n < 4) lengthRaw = 0.6;
  else if (n > 20 && n <= 40) lengthRaw = 0.8;
  else if (n === 1) lengthRaw = 0.2;
  else if (n > 40) lengthRaw = 0.5;
  const length = Math.round(lengthRaw * 100);

  // 4. Novelty (0-100): project-specific vs. generic
  const noveltyHits = NOVELTY_TERMS.filter((t) => fullText.includes(t)).length;
  const genericHits = GENERIC_TERMS.filter((t) => fullText.includes(t)).length;
  const noveltyRaw = Math.max(0, Math.min(1, noveltyHits / 4 - genericHits * 0.15));
  const novelty = Math.round(noveltyRaw * 100);

  // Composite
  const total = Math.max(
    0,
    Math.min(
      100,
      Math.round(0.35 * decision + 0.25 * specificity + 0.20 * length + 0.20 * novelty)
    )
  );

  const label: "high" | "medium" | "low" =
    total >= 65 ? "high" : total >= 35 ? "medium" : "low";

  const suggestion =
    label === "high"
      ? "Decisions detected — worth capturing"
      : label === "medium"
      ? "Some useful context — consider capturing"
      : null;

  return { total, decision, specificity, length, novelty, label, suggestion };
}

/**
 * Lightweight variant that just returns the total (0-100) and label.
 * Used in server-side API calls where the full breakdown isn't needed.
 */
export function quickScore(
  pairs: { role: string; content: string }[]
): { total: number; label: "high" | "medium" | "low" } {
  const { total, label } = scoreConversation(pairs);
  return { total, label };
}
