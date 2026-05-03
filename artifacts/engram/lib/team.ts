import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ensure the given user has a profile row with a team_id. Idempotent —
 * safe to call from any API route or layout. Returns the resolved team_id
 * (or null if Supabase admin access is not available).
 *
 * This is the single source of truth for the "every user gets a workspace"
 * invariant. ENGRAM is single-player by default — every user owns their own
 * personal workspace and can be invited into shared ones later.
 */
export async function ensureUserTeam(user: {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: string; avatar_url?: string } | null;
}): Promise<string | null> {
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return null; // Service role not configured
  }

  // Fast path: profile already has a team
  const { data: existing } = await admin
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing?.team_id) return existing.team_id;

  // Create a personal workspace
  const handle = user.email ? user.email.split("@")[0] : "Personal";
  const teamName = `${handle}'s workspace`;

  const { data: newTeam, error: teamErr } = await admin
    .from("teams")
    .insert({ name: teamName })
    .select("id")
    .single();

  if (teamErr || !newTeam) {
    console.error("[ensureUserTeam] team insert failed:", teamErr);
    return null;
  }

  // Upsert the profile with the new team
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      full_name: user.user_metadata?.full_name ?? null,
      avatar_url: user.user_metadata?.avatar_url ?? null,
      team_id: newTeam.id,
    },
    { onConflict: "id" }
  );

  if (profileErr) {
    console.error("[ensureUserTeam] profile upsert failed:", profileErr);
    return null;
  }

  return newTeam.id;
}
