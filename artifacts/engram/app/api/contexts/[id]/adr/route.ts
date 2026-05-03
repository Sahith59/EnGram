import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { anthropic } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/contexts/[id]/adr?format=md|json
 *
 * Generates a Markdown Architecture Decision Record (MADR-style) from a
 * captured context snapshot. Uses Claude Sonnet to synthesize a clean,
 * shareable decision document — Title / Status / Context / Decision /
 * Consequences / Alternatives Considered / References.
 *
 * Privacy mirrors /api/contexts/[id]/export:
 *   - Personal rows: only the creator can read.
 *   - Team rows: any team member can read the synthesized ADR (it never
 *     leaks raw turns), but personal-visibility rows belonging to others
 *     are 404'd.
 *
 * Response:
 *   - format=md (default): text/markdown body, suitable for direct download
 *     or clipboard copy.
 *   - format=json: { markdown, filename, generated_at }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("context_snapshots")
    .select(
      "id, title, summary, decision, rationale, tags, ai_tool, created_at, raw_conversation, created_by, team_id, visibility"
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = data as typeof data & {
    created_by: string;
    team_id: string;
    visibility?: string | null;
  };
  const visibility = (row.visibility as string | undefined) ?? "personal";
  const isCreator = row.created_by === user.id;
  const isSameTeam = row.team_id === profile.team_id;

  if (visibility === "personal" && !isCreator) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (visibility === "team" && !isSameTeam) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const titleSafe = (row.title ?? "Untitled Decision").toString();
  const tagsArr = (row.tags as string[] | null) ?? [];
  const rawPairs =
    (row.raw_conversation as { role: string; content: string }[] | null) ?? [];

  // Compact transcript hint for Claude (only if creator — privacy preserved).
  // Cap to ~6000 chars to keep prompt lean and ADR generation fast.
  const transcriptHint = isCreator
    ? rawPairs
        .map((p) => `${p.role.toUpperCase()}: ${p.content}`)
        .join("\n\n")
        .slice(0, 6000)
    : "";

  const dateStr = new Date(row.created_at).toISOString().slice(0, 10);
  const slug =
    titleSafe
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "decision";
  const filename = `adr-${dateStr}-${slug}.md`;

  const userPrompt = `You are generating a clean **Architecture Decision Record (ADR)** in MADR-style Markdown from a captured AI-assisted decision. Output ONLY the Markdown — no preamble, no code fences around the whole document, no commentary.

REQUIRED STRUCTURE (use these exact headings, in this order):

# ADR-${dateStr.replace(/-/g, "")}: <concise decision title, max 80 chars>

- **Status:** Accepted
- **Date:** ${dateStr}
- **Source:** Captured from ${row.ai_tool} via ENGRAM
${tagsArr.length ? `- **Tags:** ${tagsArr.map((t) => `\`${t}\``).join(", ")}\n` : ""}
## Context

A 2-4 sentence description of the problem space and the forces at play. Be concrete. No fluff.

## Decision

A precise statement of what was decided. Lead with a single declarative sentence ("We will use X because..."), then 2-4 supporting bullets covering the *what*, not the *why*.

## Rationale

The reasoning behind the decision — the tradeoffs weighed, the constraints respected. 3-6 bullets.

## Consequences

### Positive
- 2-4 bullets describing benefits and capabilities unlocked.

### Negative / Risks
- 2-4 bullets describing tradeoffs, limitations, or risks accepted. **Be honest** — if the source material doesn't surface real downsides, infer plausible ones for this class of decision and label them clearly with "(inferred)".

## Alternatives Considered

- **<Alternative name>:** 1-line description and why it was rejected.
- (List 2-3 alternatives. If the source mentions none, infer the obvious ones for this decision class and label them "(inferred)".)

## References

- Original conversation captured in ${row.ai_tool} on ${dateStr}
- ENGRAM snapshot ID: \`${row.id}\`

---
SOURCE MATERIAL (use this as ground truth — do not invent facts beyond what is supported):

**Title:** ${titleSafe}

**Summary:**
${row.summary ?? "(none)"}

**Recorded decision(s):**
${row.decision ?? "(none)"}

**Existing rationale / context.md:**
${row.rationale ?? "(none)"}

${transcriptHint ? `**Conversation excerpts (verbatim):**\n${transcriptHint}` : ""}

Generate the ADR now. Output Markdown only, starting directly with the \`# ADR-...\` heading.`;

  let markdown: string;
  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      temperature: 0.2,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = resp.content.find((b) => b.type === "text");
    markdown = block && block.type === "text" ? block.text.trim() : "";
    if (!markdown) {
      return NextResponse.json(
        { error: "Empty ADR generated" },
        { status: 502 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `ADR generation failed: ${msg}` },
      { status: 502 }
    );
  }

  const format = request.nextUrl.searchParams.get("format") ?? "md";
  if (format === "json") {
    return NextResponse.json({
      markdown,
      filename,
      generated_at: new Date().toISOString(),
    });
  }

  const dispositionMode =
    request.nextUrl.searchParams.get("download") === "1"
      ? "attachment"
      : "inline";

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `${dispositionMode}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
