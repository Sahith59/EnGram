/**
 * GET /api/oauth/github
 * Initiates the GitHub App installation flow.
 *
 * Redirects the user to the GitHub App's installation page. After the user
 * installs/authorizes the app on their org or repos, GitHub redirects back
 * to /api/oauth/github/callback with an installation_id parameter.
 *
 * Required env vars:
 *   GITHUB_APP_NAME  — the slug of the GitHub App (e.g. "engram-code-sync")
 *   GITHUB_APP_ID    — numeric GitHub App ID
 *   GITHUB_APP_PRIVATE_KEY — RSA private key PEM (for installation token generation)
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

const GH_APP_INSTALL_BASE = "https://github.com/apps";

export async function GET() {
  const appName = process.env.GITHUB_APP_NAME;
  if (!appName) {
    return NextResponse.json(
      { error: "GitHub App not configured. Set GITHUB_APP_NAME." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // CSRF state token stored in a short-lived cookie
  const state = randomBytes(16).toString("hex");

  // Redirect to GitHub App installation page
  // After installation, GitHub redirects to the app's setup_url with installation_id + state
  const installUrl = `${GH_APP_INSTALL_BASE}/${encodeURIComponent(appName)}/installations/new?state=${state}`;

  const response = NextResponse.redirect(installUrl);
  response.cookies.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  return response;
}
