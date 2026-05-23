import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/lib/supabase/bearer";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ sessions: [] });
  }
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();
  let user = cookieUser;
  if (!user) user = await getUserFromBearer(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ask_sessions")
      .select("id, title, messages, scope, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      if (error.message.includes("does not exist")) {
        return NextResponse.json({ sessions: [] });
      }
      console.error("[ask/sessions GET]", error.message);
      return NextResponse.json({ sessions: [] });
    }
    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    console.error("[ask/sessions GET] unexpected:", err);
    return NextResponse.json({ sessions: [] });
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true });
  }
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();
  let user = cookieUser;
  if (!user) user = await getUserFromBearer(request.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id: string; title: string; scope: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ask_sessions").insert({
      id: body.id,
      user_id: user.id,
      title: body.title ?? "New conversation",
      scope: body.scope ?? "personal",
      messages: [],
    });
    if (error) {
      if (error.message.includes("does not exist")) {
        return NextResponse.json({ ok: true });
      }
      console.error("[ask/sessions POST]", error.message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ask/sessions POST] unexpected:", err);
    return NextResponse.json({ ok: true });
  }
}
