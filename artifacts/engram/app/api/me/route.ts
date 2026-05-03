import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { corsOptions, withCors } from "@/lib/cors";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/me
 * Returns the currently signed-in user's identity for use by the Chrome
 * extension. Relies on the Supabase session cookie set when the user signs
 * into the dashboard. Cross-origin requests must include credentials.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return withCors(
      NextResponse.json({ error: "Supabase not configured" }, { status: 503 }),
      request
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return withCors(
      NextResponse.json({ connected: false, error: "Not signed in" }, { status: 401 }),
      request
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return withCors(
    NextResponse.json({
      connected: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: profile?.full_name ?? null,
        avatar_url: profile?.avatar_url ?? null,
      },
      team_id: profile?.team_id ?? null,
    }),
    request
  );
}
