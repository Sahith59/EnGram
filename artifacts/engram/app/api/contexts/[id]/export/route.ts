import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(
  _request: NextRequest,
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
    .select("title, rationale, summary, decision, tags, ai_tool, created_at")
    .eq("id", params.id)
    .eq("team_id", profile.team_id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const markdown =
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

  const filename = `${data.title.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60)}.md`;

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
