import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/contexts/[id]/export?mode=handoff|brief|raw
 *  - brief (default): the AI-generated handoff brief markdown
 *  - handoff: brief wrapped with a starter prompt for pasting into a new AI chat
 *  - raw: verbatim conversation transcript only
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

  const { data, error } = await supabase
    .from("context_snapshots")
    .select(
      "title, rationale, summary, decision, tags, ai_tool, created_at, raw_conversation"
    )
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const mode = request.nextUrl.searchParams.get("mode") ?? "brief";
  const targetTool = request.nextUrl.searchParams.get("target") ?? "the new AI";

  const brief =
    data.rationale ??
    `# ${data.title}

## Summary
${data.summary ?? "_No summary available._"}

## Key Decisions
${data.decision ?? "_No decisions recorded._"}

## Technologies
${(data.tags as string[]).length > 0 ? (data.tags as string[]).map((t: string) => `- ${t}`).join("\n") : "_None identified._"}

---
*Captured from ${data.ai_tool} on ${new Date(data.created_at).toLocaleDateString()}*
`;

  // Build the starter prompt that wraps the brief with anti-hallucination scaffolding.
  function buildHandoffPrompt() {
    const rawPairs = (data.raw_conversation as
      | { role: string; content: string }[]
      | null) ?? [];
    const tail = rawPairs
      .slice(-4)
      .map(
        (p) =>
          `> **${p.role.toUpperCase()}:** ${p.content.slice(0, 1500).replace(/\n/g, "\n> ")}`
      )
      .join("\n>\n");

    return `# 🔁 ENGRAM Project Handoff

I'm resuming a project that was previously discussed in **${data.ai_tool}**. The full handoff brief and verbatim recent context are below. Your job is to **pick up exactly where we left off without hallucinating or inventing details**.

## ✋ READ THIS FIRST — Receiving AI Instructions

1. **Do NOT** start generating new work until you have completed steps 2 and 3.
2. **Read** the entire handoff brief below carefully.
3. **Echo back** the answers to the "Verification Checkpoint" questions in section 10. List 3-5 concrete facts you've understood. If anything is ambiguous, ASK before assuming.
4. **Then** ask me: "What would you like to do next?" and wait for my answer.
5. Throughout this conversation, if you are about to state a fact that isn't in this brief, prefix it with "⚠️ Inferring:" so I can correct you.

---

${brief}

---

## 📜 Verbatim Recent Exchanges (Ground Truth)

These are the last few raw turns of the original conversation, exactly as they happened. Treat them as authoritative over your own paraphrasing.

${tail || "_(none captured)_"}

---

*Handoff prepared by ENGRAM · captured ${new Date(data.created_at).toLocaleString()} · target: ${targetTool}*
`;
  }

  let body: string;
  let filename: string;
  if (mode === "handoff") {
    body = buildHandoffPrompt();
    filename = `${data.title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}-handoff.md`;
  } else if (mode === "raw") {
    const rawPairs = (data.raw_conversation as
      | { role: string; content: string }[]
      | null) ?? [];
    body =
      `# ${data.title} — Raw Transcript\n\n` +
      rawPairs
        .map((p) => `## ${p.role.toUpperCase()}\n\n${p.content}`)
        .join("\n\n---\n\n");
    filename = `${data.title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}-transcript.md`;
  } else {
    body = brief;
    filename = `${data.title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}.md`;
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
