import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { corsOptions, withCors } from "@/lib/cors";
import { ensureUserTeam } from "@/lib/team";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * GET /api/me
 * Returns the currently signed-in user's identity for the Chrome extension.
 * Auto-creates a personal workspace if the user doesn't have one yet.
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

  // Single source of truth for team bootstrap
  const teamId = await ensureUserTeam({
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata as
      | { full_name?: string; avatar_url?: string }
      | null,
  });

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
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
      team_id: teamId,
    }),
    request
  );
}
