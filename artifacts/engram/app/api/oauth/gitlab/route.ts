/**
 * GET /api/oauth/gitlab
 * Initiates the GitLab OAuth flow.
 *
 * Required env vars:
 *   GITLAB_CLIENT_ID — GitLab OAuth Application client ID
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const GITLAB_AUTHORIZE = "https://gitlab.com/oauth/authorize";

export async function GET() {
  const clientId = process.env.GITLAB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitLab OAuth not configured. Set GITLAB_CLIENT_ID." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: "api read_user read_repository",
    state,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/oauth/gitlab/callback`,
  });

  const response = NextResponse.redirect(`${GITLAB_AUTHORIZE}?${params}`);
  response.cookies.set("gl_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
