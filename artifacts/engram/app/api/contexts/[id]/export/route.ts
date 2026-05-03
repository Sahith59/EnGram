import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/contexts/[id]/export?mode=handoff|brief|raw
 *  - brief (default): the AI-generated handoff brief markdown
 *  - handoff: brief wrapped with a starter prompt for pasting into a new AI chat
 *  - raw: verbatim conversation transcript only
 *
 * Privacy rules (must mirror /api/contexts/[id]):
 *   - Personal rows: only the creator can read in any mode.
 *   - Team rows: any team member can read brief/handoff (sans raw turns),
 *     but `mode=raw` and the verbatim tail in `mode=handoff` are reserved
 *     to the original author. Non-author team members get a redacted
 *     handoff (no raw turns) and a 403 on raw.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
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

  // Fetch including ownership + visibility so we can enforce scoped access.
  // RLS will already block disallowed rows (personal rows you don't own;
  // team rows from a different team) but we re-check application-side so we
  // can branch on visibility for redaction.
  const { data: row, error } = await supabase
    .from("context_snapshots")
    .select(
      "title, rationale, summary, decision, tags, ai_tool, created_at, raw_conversation, created_by, team_id, visibility"
    )
    .eq("id", params.id)
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const safeRow = row as typeof row & {
    created_by: string;
    team_id: string;
    visibility?: string | null;
  };

  const visibility = safeRow.visibility ?? "personal";
  const isCreator = safeRow.created_by === user.id;
  const isSameTeam = safeRow.team_id === profile.team_id;

  // Defensive auth checks (RLS should already prevent these)
  if (visibility === "personal" && !isCreator) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (visibility === "team" && !isSameTeam) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const mode = request.nextUrl.searchParams.get("mode") ?? "brief";
  const targetTool = request.nextUrl.searchParams.get("target") ?? "the new AI";

  // Raw transcripts NEVER leave the author's hands when the row is shared.
  const canSeeRaw = isCreator;

  const titleSafe = (safeRow.title ?? "untitled").toString();
  const tagsArr = (safeRow.tags as string[] | null) ?? [];

  const brief =
    safeRow.rationale ??
    `# ${titleSafe}

## Summary
${safeRow.summary ?? "_No summary available._"}

## Key Decisions
${safeRow.decision ?? "_No decisions recorded._"}

## Technologies
${tagsArr.length > 0 ? tagsArr.map((t) => `- ${t}`).join("\n") : "_None identified._"}

---
*Captured from ${safeRow.ai_tool} on ${new Date(safeRow.created_at).toLocaleDateString()}*
`;

  function buildHandoffPrompt() {
    const rawPairs =
      (safeRow.raw_conversation as { role: string; content: string }[] | null) ?? [];
    const tail = canSeeRaw
      ? rawPairs
          .slice(-4)
          .map(
            (p) =>
              `> **${p.role.toUpperCase()}:** ${p.content.slice(0, 1500).replace(/\n/g, "\n> ")}`
          )
          .join("\n>\n")
      : "";

    const verbatimSection = canSeeRaw
      ? `## 📜 Verbatim Recent Exchanges (Ground Truth)

These are the last few raw turns of the original conversation, exactly as they happened. Treat them as authoritative over your own paraphrasing.

${tail || "_(none captured)_"}

---

`
      : `## 📜 Verbatim Recent Exchanges

_Redacted — the verbatim transcript stays private to the original author of this team snapshot._

---

`;

    return `# 🔁 ENGRAM Project Handoff

I'm resuming a project that was previously discussed in **${safeRow.ai_tool}**. The full handoff brief is below. Your job is to **pick up exactly where we left off without hallucinating or inventing details**.

## ✋ READ THIS FIRST — Receiving AI Instructions

1. **Do NOT** start generating new work until you have completed steps 2 and 3.
2. **Read** the entire handoff brief below carefully.
3. **Echo back** the answers to the "Verification Checkpoint" questions in section 10. List 3-5 concrete facts you've understood. If anything is ambiguous, ASK before assuming.
4. **Then** ask me: "What would you like to do next?" and wait for my answer.
5. Throughout this conversation, if you are about to state a fact that isn't in this brief, prefix it with "⚠️ Inferring:" so I can correct you.

---

${brief}

---

${verbatimSection}*Handoff prepared by ENGRAM · captured ${new Date(safeRow.created_at).toLocaleString()} · target: ${targetTool}*
`;
  }

  let body: string;
  let filename: string;
  if (mode === "handoff") {
    body = buildHandoffPrompt();
    filename = `${titleSafe.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}-handoff.md`;
  } else if (mode === "raw") {
    if (!canSeeRaw) {
      return NextResponse.json(
        {
          error:
            "Raw transcript is private to the original author of this team snapshot.",
        },
        { status: 403 }
      );
    }
    const rawPairs =
      (safeRow.raw_conversation as { role: string; content: string }[] | null) ?? [];
    body =
      `# ${titleSafe} — Raw Transcript\n\n` +
      rawPairs
        .map((p) => `## ${p.role.toUpperCase()}\n\n${p.content}`)
        .join("\n\n---\n\n");
    filename = `${titleSafe.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}-transcript.md`;
  } else {
    body = brief;
    filename = `${titleSafe.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}.md`;
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
