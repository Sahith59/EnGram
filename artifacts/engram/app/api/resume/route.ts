import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ data: null, unconfigured: true });
  }
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tool = request.nextUrl.searchParams.get("tool");

  let query = supabase
    .from("context_snapshots")
    .select("id, title, summary, ai_tool, tags, project, decision, rationale, created_at")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tool && ["chatgpt", "claude", "gemini", "other"].includes(tool)) {
    query = query.eq("ai_tool", tool);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("resume query error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ data: null, message: "No snapshots found" });
  }

  return NextResponse.json({ data });
}
