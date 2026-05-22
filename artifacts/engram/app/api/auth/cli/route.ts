import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { corsOptions, withCors } from "@/lib/cors";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensureUserTeam } from "@/lib/team";

export function OPTIONS(request: NextRequest) {
  return corsOptions(request);
}

/**
 * POST /api/auth/cli
 * Authenticates a user with email + password and returns a JWT
 * for use by the ENGRAM CLI (stored in ~/.config/engram/config.json).
 *
 * Body: { email: string; password: string }
 * Response: { access_token, refresh_token, user: { id, email, full_name }, team_id }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return withCors(
      NextResponse.json({ error: "Supabase not configured" }, { status: 503 }),
      request
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return withCors(
      NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
      request
    );
  }

  const { email, password } = body;
  if (!email || !password) {
    return withCors(
      NextResponse.json({ error: "email and password are required" }, { status: 400 }),
      request
    );
  }

  const admin = createAdminClient();

  // Sign in with email + password via Supabase Auth
  const { data, error } = await admin.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    return withCors(
      NextResponse.json(
        { error: error?.message ?? "Invalid credentials" },
        { status: 401 }
      ),
      request
    );
  }

  const { session, user } = data;

  // Ensure team exists (creates one if missing)
  const teamId = await ensureUserTeam({
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata as
      | { full_name?: string; avatar_url?: string }
      | null,
  });

  // Fetch profile for display name
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return withCors(
    NextResponse.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user: {
        id: user.id,
        email: user.email,
        full_name: profile?.full_name ?? null,
      },
      team_id: teamId ?? null,
    }),
    request
  );
}
