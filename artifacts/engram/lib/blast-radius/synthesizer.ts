/**
 * synthesizer.ts — Blast Radius Engine Phase C
 *
 * Takes the AST traversal result + intent snapshots + the change description,
 * calls Claude to produce a senior-dev blast radius analysis.
 *
 * Returns an async generator that yields SSE-ready chunks.
 * The final streamed JSON block contains: risk_level, risk_summary, files_to_update.
 */

import { anthropic } from "@/lib/anthropic";
import type { AffectedFile } from "./ast-traverser";
import type { IntentSnapshot } from "./intent-retriever";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export interface SynthesisResult {
  risk_level: RiskLevel;
  risk_summary: string;
  files_to_update: string[];
}

function formatAffectedFiles(files: AffectedFile[]): string {
  if (files.length === 0) return "(no direct dependents found in the indexed AST graph)";
  const lines = files.slice(0, 30).map((f) => {
    const symbol = f.via_symbol ? ` [uses ${f.via_symbol}]` : "";
    return `  - ${f.file_path} (${f.impact_level} — ${f.hops} hop${f.hops !== 1 ? "s" : ""} via ${f.via_file}${symbol})`;
  });
  if (files.length > 30) lines.push(`  ... and ${files.length - 30} more`);
  return lines.join("\n");
}

function formatIntentSnapshots(snapshots: IntentSnapshot[]): string {
  if (snapshots.length === 0) return "(no relevant AI conversations found in ENGRAM memory)";
  return snapshots
    .map((s, i) => {
      const decision = s.decision ? `\n  Decision: "${s.decision}"` : "";
      const summary = s.summary ? `\n  Summary: "${s.summary.slice(0, 200)}"` : "";
      return `  [${i + 1}] "${s.title}" (${new Date(s.created_at).toLocaleDateString()}, ${s.source})${decision}${summary}`;
    })
    .join("\n\n");
}

/**
 * Call Claude with a structured blast-radius prompt, streaming the response.
 * Yields raw text chunks as they arrive.
 * The last yielded string is a special sentinel: `\n__RESULT__:` followed by
 * a JSON object containing { risk_level, risk_summary, files_to_update }.
 */
export async function* synthesizeBlastRadius(opts: {
  targetFile: string;
  changeDescription: string;
  affectedFiles: AffectedFile[];
  intentSnapshots: IntentSnapshot[];
}): AsyncGenerator<string> {
  const { targetFile, changeDescription, affectedFiles, intentSnapshots } = opts;

  const directFiles = affectedFiles.filter((f) => f.impact_level === "Direct");
  const transitiveFiles = affectedFiles.filter((f) => f.impact_level !== "Direct");

  const systemPrompt = `You are a senior staff engineer conducting a blast radius analysis for a code change.
Your job is to give a precise, actionable risk assessment in plain English — the kind a 20-year veteran would write in 3 minutes.

You have access to:
1. The AST dependency graph (which files import/call the changed file)
2. The team's AI conversation history from ENGRAM (why the code was built this way)

Output format — write EXACTLY in this order:
1. A risk level on its own line: "RISK: Low|Medium|High|Critical"
2. A risk summary paragraph (4-8 sentences, senior-dev voice). Include:
   - What will break and why
   - Historical context from the conversation history (cite specific decisions if found)
   - The 3-5 most critical files to update (named explicitly)
   - Any subtle constraints that would trap a junior dev
3. A line: "FILES_TO_UPDATE:" followed by a bullet list of the top files to change

Be specific. Name real file paths. Reference actual decisions from the conversation history.
If conversation history is sparse, say so and rely on the AST analysis.`;

  const userPrompt = `TARGET FILE: ${targetFile}
PROPOSED CHANGE: ${changeDescription}

DIRECT DEPENDENTS (1 hop — will break immediately):
${formatAffectedFiles(directFiles)}

TRANSITIVE DEPENDENTS (2+ hops — indirect breakage risk):
${formatAffectedFiles(transitiveFiles)}

RELEVANT AI CONVERSATIONS (why this code was built this way):
${formatIntentSnapshots(intentSnapshots)}

Write the blast radius analysis now.`;

  const fullText: string[] = [];

  const stream = anthropic.messages.stream({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      const chunk = event.delta.text;
      fullText.push(chunk);
      yield chunk;
    }
  }

  // Parse the structured output from the full text
  const full = fullText.join("");
  const result = parseResult(full);

  // Emit the structured result as a special sentinel chunk
  yield `\n__RESULT__:${JSON.stringify(result)}`;
}

function parseResult(text: string): SynthesisResult {
  // Extract risk level
  const riskMatch = text.match(/RISK:\s*(Low|Medium|High|Critical)/i);
  const risk_level: RiskLevel = (riskMatch?.[1] as RiskLevel) ?? "Medium";

  // Extract risk summary (everything between RISK: line and FILES_TO_UPDATE:)
  const summaryMatch = text.match(/RISK:.*?\n([\s\S]*?)(?:FILES_TO_UPDATE:|$)/i);
  const risk_summary = summaryMatch?.[1]?.trim() ?? text.trim();

  // Extract files to update
  const filesSection = text.split(/FILES_TO_UPDATE:/i)[1] ?? "";
  const files_to_update = filesSection
    .split("\n")
    .map((l) => l.replace(/^[-*•\s]+/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("("))
    .slice(0, 10);

  return { risk_level, risk_summary, files_to_update };
}
