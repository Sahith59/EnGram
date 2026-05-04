/**
 * synthesizer.ts — Blast Radius Engine
 *
 * Takes the AST traversal result + intent snapshots + the change description,
 * calls Claude to produce a senior-dev blast radius analysis.
 *
 * Returns an async generator that yields SSE-ready chunks.
 * The final yielded string is a special sentinel: `\n__RESULT__:` followed by
 * a JSON object containing { risk_level, risk_summary, files_to_update }.
 *
 * Accepts an AbortSignal — if the caller aborts (e.g. 15s timeout),
 * the stream is torn down and the generator exits cleanly.
 */

import { anthropic } from "@/lib/anthropic";
import type { AffectedFile } from "./ast-traverser";
import type { IntentSnapshot } from "./intent-retriever";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface SynthesisResult {
  risk_level:      RiskLevel;
  risk_summary:    string;
  files_to_update: string[];
}

function formatAffectedFiles(files: AffectedFile[], direction: "reverse" | "forward"): string {
  const subset = files.filter((f) => f.direction === direction);
  if (subset.length === 0) {
    return direction === "reverse"
      ? "(no direct dependents found in the indexed AST graph)"
      : "(no dependencies found in the indexed AST graph)";
  }
  const lines = subset.slice(0, 20).map((f) => {
    const symbol = f.via_symbol ? ` [uses ${f.via_symbol}]` : "";
    return `  - ${f.file_path} (${f.impact_level} — ${f.hops} hop${f.hops !== 1 ? "s" : ""} via ${f.via_file}${symbol})`;
  });
  if (subset.length > 20) lines.push(`  ... and ${subset.length - 20} more`);
  return lines.join("\n");
}

function formatIntentSnapshots(snapshots: IntentSnapshot[]): string {
  if (snapshots.length === 0) return "(no relevant AI conversations found in ENGRAM memory)";
  return snapshots
    .map((s, i) => {
      const decision = s.decision ? `\n  Decision: "${s.decision}"` : "";
      const summary  = s.summary  ? `\n  Summary: "${s.summary.slice(0, 200)}"` : "";
      return `  [${i + 1}] "${s.title}" (${new Date(s.created_at).toLocaleDateString()}, ${s.source})${decision}${summary}`;
    })
    .join("\n\n");
}

/**
 * Call Claude with a structured blast-radius prompt, streaming the response.
 * Yields raw text chunks as they arrive.
 * The last yielded string is a special sentinel: `\n__RESULT__:` followed by JSON.
 */
export async function* synthesizeBlastRadius(opts: {
  targetFile:        string;
  changeDescription: string;
  affectedFiles:     AffectedFile[];
  intentSnapshots:   IntentSnapshot[];
  signal?:           AbortSignal;
}): AsyncGenerator<string> {
  const { targetFile, changeDescription, affectedFiles, intentSnapshots, signal } = opts;

  const systemPrompt = `You are a senior staff engineer conducting a blast radius analysis for a code change.
Your job is to give a precise, actionable risk assessment in plain English — the kind a 20-year veteran would write in 3 minutes.

You have access to:
1. The AST dependency graph — files that depend on the changed file (reverse), and files the changed file depends on (forward/context)
2. The team's AI conversation history from ENGRAM (why the code was built this way)

Output format — write EXACTLY in this order:
1. A risk level on its own line: "RISK: Low|Medium|High|Critical"
2. A risk summary paragraph (4-8 sentences, senior-dev voice). Include:
   - What will break and why (focus on reverse dependents)
   - Historical context from the conversation history (cite specific decisions if found)
   - The 3-5 most critical files to update (named explicitly)
   - Any subtle constraints that would trap a junior dev
3. A line: "FILES_TO_UPDATE:" followed by a bullet list of the top files to change

Be specific. Name real file paths. Reference actual decisions from the conversation history.
If conversation history is sparse, say so and rely on the AST analysis.`;

  const userPrompt = `TARGET FILE: ${targetFile}
PROPOSED CHANGE: ${changeDescription}

FILES THAT DEPEND ON THIS FILE (reverse — will break if the interface changes):
${formatAffectedFiles(affectedFiles, "reverse")}

FILES THIS FILE DEPENDS ON (forward — context for understanding the change):
${formatAffectedFiles(affectedFiles, "forward")}

RELEVANT AI CONVERSATIONS (why this code was built this way):
${formatIntentSnapshots(intentSnapshots)}

Write the blast radius analysis now.`;

  const fullText: string[] = [];

  const stream = anthropic.messages.stream({
    model:      "claude-3-5-sonnet-20241022",
    max_tokens: 800,
    system:     systemPrompt,
    messages:   [{ role: "user", content: userPrompt }],
  });

  // Abort the Anthropic stream if the caller's signal fires
  if (signal) {
    signal.addEventListener("abort", () => {
      stream.abort();
    }, { once: true });
  }

  try {
    for await (const event of stream) {
      if (signal?.aborted) break;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const chunk = event.delta.text;
        fullText.push(chunk);
        yield chunk;
      }
    }
  } catch (err: unknown) {
    // Abort from signal is expected — re-throw only genuine errors
    if (signal?.aborted) return;
    throw err;
  }

  // Parse the structured output from the full text and emit as sentinel
  const full   = fullText.join("");
  const result = parseResult(full);
  yield `\n__RESULT__:${JSON.stringify(result)}`;
}

function parseResult(text: string): SynthesisResult {
  // Extract risk level
  const riskMatch   = text.match(/RISK:\s*(Low|Medium|High|Critical)/i);
  const risk_level: RiskLevel = (riskMatch?.[1] as RiskLevel) ?? "Medium";

  // Extract risk summary (everything between RISK: line and FILES_TO_UPDATE:)
  const summaryMatch = text.match(/RISK:.*?\n([\s\S]*?)(?:FILES_TO_UPDATE:|$)/i);
  const risk_summary = summaryMatch?.[1]?.trim() ?? text.trim();

  // Extract files to update
  const filesSection   = text.split(/FILES_TO_UPDATE:/i)[1] ?? "";
  const files_to_update = filesSection
    .split("\n")
    .map((l) => l.replace(/^[-*•\s]+/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("("))
    .slice(0, 10);

  return { risk_level, risk_summary, files_to_update };
}
