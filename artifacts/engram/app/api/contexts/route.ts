import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/lib/supabase/bearer";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * GET /api/contexts?scope=personal|team[&tool=&search=&page=&limit=]
 *
 * scope semantics:
 *   personal (default) — rows the viewer created with visibility='personal'.
 *   team               — rows in the viewer's team with visibility='team'.
 *                        Other team members' raw_conversation is hidden by
 *                        the detail endpoint; this list view never returns
 *                        raw_conversation regardless of scope.
 * Supports both cookie-based (browser) and Bearer token (CLI) auth.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, pages: 0 },
      unconfigured: true,
    });
  }
  const supabase = await createClient();
  const { data: { user: cookieUser } } = await supabase.auth.getUser();

  // Bearer token fallback for CLI clients
  let user = cookieUser;
  if (!user) {
    user = await getUserFromBearer(request.headers.get("authorization"));
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();

  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const tool = searchParams.get("tool");
  const search = searchParams.get("search");
  const scopeParam = searchParams.get("scope");
  const scope: "personal" | "team" = scopeParam === "team" ? "team" : "personal";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);
  const offset = (page - 1) * limit;

  // Build the scoped query. We intentionally DON'T select raw_conversation
  // here — list cards never need it, and excluding it keeps team-scope rows
  // safe for non-creators by construction.
  let query = db
    .from("context_snapshots")
    .select(
      "id, title, summary, ai_tool, tags, project, decision, created_by, created_at, visibility, author_handle",
      { count: "exact" }
    )
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (scope === "team") {
    query = query
      .eq("team_id", profile.team_id)
      .eq("visibility", "team");
  } else {
    query = query
      .eq("created_by", user.id)
      .eq("visibility", "personal");
  }

  if (tool) query = query.eq("ai_tool", tool);

  if (search) {
    // Per-token OR match — much better recall than '%full phrase%'.
    const tokens = search
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 6);
    // Tokens are already pre-sanitized to [a-z0-9 ] above. Sanitize the
    // raw `search` fallback the same way so PostgREST `.or()` can never be
    // broken out of via commas, parentheses, dots, or colons.
    const safeFallback = search.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().slice(0, 80);
    if (tokens.length > 0) {
      const orClause = tokens
        .flatMap((t) => [
          `title.ilike.%${t}%`,
          `summary.ilike.%${t}%`,
          `decision.ilike.%${t}%`,
        ])
        .join(",");
      query = query.or(orClause);
    } else if (safeFallback) {
      query = query.or(
        `title.ilike.%${safeFallback}%,summary.ilike.%${safeFallback}%,decision.ilike.%${safeFallback}%`
      );
    }
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("contexts list error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json({
    scope,
    data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / limit),
    },
  });
}
