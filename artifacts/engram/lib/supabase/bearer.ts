import { createAdminClient } from "./admin";
import type { User } from "@supabase/supabase-js";

/**
 * Extract and validate a Bearer JWT from an Authorization header.
 * Returns the Supabase User if valid, null otherwise.
 * Used by API routes to support CLI / non-browser clients.
 */
export async function getUserFromBearer(
  authHeader: string | null
): Promise<User | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user;
  } catch {
    return null;
  }
}
