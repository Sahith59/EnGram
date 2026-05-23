import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/lib/supabase/bearer";
import { isSupabaseConfigured } from "@/lib/supabase/config";

async function getUser(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();
  let user = cookieUser;
  if (!user) user = await getUserFromBearer(request.headers.get("authorization"));
  return user;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ session: null });
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ask_sessions")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();
    if (error) return NextResponse.json({ session: null });
    return NextResponse.json({ session: data });
  } catch {
    return NextResponse.json({ session: null });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { messages?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("ask_sessions")
      .update({ messages: body.messages ?? [], updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("user_id", user.id);
    if (error && !error.message.includes("does not exist")) {
      console.error("[ask/sessions PATCH]", error.message);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ ok: true });
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    await admin
      .from("ask_sessions")
      .delete()
      .eq("id", params.id)
      .eq("user_id", user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
