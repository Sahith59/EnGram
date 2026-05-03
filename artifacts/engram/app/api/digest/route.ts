import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

/**
 * GET /api/digest
 *   ?from=YYYY-MM-DD            (inclusive; default: 30 days ago)
 *   &to=YYYY-MM-DD              (inclusive; default: today)
 *   &scope=personal|team        (default: personal)
 *   &groupBy=project|tag|tool|none  (default: project)
 *   &tool=chatgpt|claude|gemini (optional filter)
 *   &format=md|json             (default: md)
 *
 * Deterministic, no-LLM markdown digest of captured decisions in a date
 * range, grouped by the chosen dimension. Deduped by identity_hash so
 * multiple captures of the same conversation surface only the most
 * recent snapshot.
 *
 * Privacy: scope=personal returns only the caller's personal-visibility
 * rows; scope=team returns the team's team-visibility rows. RLS already
 * enforces both — the explicit filters here keep the SQL deterministic
 * and survive future policy changes.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("team_id")
    .eq("id", user.id)
    .single();
  if (!profile?.team_id) {
    return NextResponse.json({ error: "User has no team" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;

  const today = new Date();
  const thirtyAgo = new Date(today);
  thirtyAgo.setUTCDate(today.getUTCDate() - 30);

  const fromParam = sp.get("from");
  const toParam = sp.get("to");

  const isYmd = (s: string | null): s is string =>
    !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

  const fromDate = isYmd(fromParam) ? fromParam : ymd(thirtyAgo);
  const toDate = isYmd(toParam) ? toParam : ymd(today);

  // Inclusive end-of-day for `to`.
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;

  if (fromIso > toIso) {
    return NextResponse.json(
      { error: "from must be on or before to" },
      { status: 400 }
    );
  }

  const scope: "personal" | "team" =
    sp.get("scope") === "team" ? "team" : "personal";
  const groupBy = (sp.get("groupBy") ?? "project") as
    | "project"
    | "tag"
    | "tool"
    | "none";
  const validGroupBy = ["project", "tag", "tool", "none"].includes(groupBy)
    ? groupBy
    : "project";

  const toolFilter = sp.get("tool");
  const format = sp.get("format") === "json" ? "json" : "md";

  let q = supabase
    .from("context_snapshots")
    .select(
      "id, title, summary, decision, rationale, ai_tool, tags, project, created_at, identity_hash, visibility, author_handle, created_by"
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false });

  if (scope === "team") {
    q = q.eq("team_id", profile.team_id).eq("visibility", "team");
  } else {
    q = q.eq("created_by", user.id).eq("visibility", "personal");
  }

  if (toolFilter && ["chatgpt", "claude", "gemini"].includes(toolFilter)) {
    q = q.eq("ai_tool", toolFilter);
  }

  const { data: rowsRaw, error } = await q;
  if (error) {
    console.error("[digest] query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  type Row = {
    id: string;
    title: string | null;
    summary: string | null;
    decision: string | null;
    rationale: string | null;
    ai_tool: string;
    tags: string[] | null;
    project: string | null;
    created_at: string;
    identity_hash: string | null;
    visibility: string | null;
    author_handle: string | null;
    created_by: string;
  };

  // Dedupe by identity_hash (keep most recent — query is desc). Rows
  // without an identity_hash (legacy captures) are kept as-is.
  const seenHashes = new Set<string>();
  const rows: Row[] = [];
  for (const r of (rowsRaw ?? []) as Row[]) {
    if (r.identity_hash) {
      if (seenHashes.has(r.identity_hash)) continue;
      seenHashes.add(r.identity_hash);
    }
    rows.push(r);
  }

  // Group rows by the chosen dimension. A row with multiple tags appears
  // under each tag bucket when groupBy=tag.
  type Bucket = { label: string; rows: Row[] };
  const buckets: Bucket[] = [];
  const bucketIndex = new Map<string, number>();

  function pushTo(label: string, row: Row) {
    let idx = bucketIndex.get(label);
    if (idx === undefined) {
      idx = buckets.length;
      buckets.push({ label, rows: [] });
      bucketIndex.set(label, idx);
    }
    buckets[idx].rows.push(row);
  }

  for (const r of rows) {
    if (validGroupBy === "none") {
      pushTo("All decisions", r);
    } else if (validGroupBy === "project") {
      pushTo(r.project?.trim() || "(no project)", r);
    } else if (validGroupBy === "tool") {
      pushTo(toolLabel(r.ai_tool), r);
    } else if (validGroupBy === "tag") {
      const tags = (r.tags ?? []).filter(Boolean);
      if (tags.length === 0) {
        pushTo("(untagged)", r);
      } else {
        for (const t of tags) pushTo(t, r);
      }
    }
  }

  // Sort buckets: empty/(no project)/(untagged) buckets last, otherwise alpha.
  buckets.sort((a, b) => {
    const aLast = a.label.startsWith("(");
    const bLast = b.label.startsWith("(");
    if (aLast !== bLast) return aLast ? 1 : -1;
    return a.label.localeCompare(b.label);
  });

  const md = renderMarkdown({
    fromDate,
    toDate,
    scope,
    groupBy: validGroupBy,
    toolFilter: toolFilter ?? null,
    totalDecisions: rows.length,
    buckets,
  });

  const filename = `engram-digest-${fromDate}-to-${toDate}.md`;

  if (format === "json") {
    return NextResponse.json({
      markdown: md,
      filename,
      from: fromDate,
      to: toDate,
      scope,
      groupBy: validGroupBy,
      tool: toolFilter ?? null,
      total: rows.length,
      buckets: buckets.map((b) => ({ label: b.label, count: b.rows.length })),
      generated_at: new Date().toISOString(),
    });
  }

  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toolLabel(t: string): string {
  if (t === "chatgpt") return "ChatGPT";
  if (t === "claude") return "Claude";
  if (t === "gemini") return "Gemini";
  return t;
}

function escapeMd(s: string | null | undefined): string {
  if (!s) return "";
  // (1) Defuse heading/list markers at line starts so user content can't
  //     hijack the document structure. (2) Escape raw HTML so the digest
  //     is safe when pasted into renderers that allow inline HTML
  //     (GitHub READMEs, legacy markdown viewers, etc.).
  return s
    .replace(/\r\n/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((line) => line.replace(/^(\s*)(#{1,6}\s|[-*]\s|\d+\.\s)/, "$1\\$2"))
    .join("\n")
    .trim();
}

function renderMarkdown(args: {
  fromDate: string;
  toDate: string;
  scope: "personal" | "team";
  groupBy: "project" | "tag" | "tool" | "none";
  toolFilter: string | null;
  totalDecisions: number;
  buckets: { label: string; rows: Array<{
    id: string;
    title: string | null;
    summary: string | null;
    decision: string | null;
    ai_tool: string;
    tags: string[] | null;
    created_at: string;
    author_handle: string | null;
  }> }[];
}): string {
  const {
    fromDate,
    toDate,
    scope,
    groupBy,
    toolFilter,
    totalDecisions,
    buckets,
  } = args;

  const lines: string[] = [];
  lines.push(`# Decision Log Digest`);
  lines.push("");
  lines.push(`**Range:** ${fromDate} → ${toDate}  `);
  lines.push(`**Scope:** ${scope === "team" ? "Team" : "Personal"}  `);
  lines.push(`**Grouped by:** ${groupBy}  `);
  if (toolFilter) lines.push(`**Tool filter:** ${toolLabel(toolFilter)}  `);
  lines.push(`**Total decisions:** ${totalDecisions}  `);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  if (totalDecisions === 0) {
    lines.push("---");
    lines.push("");
    lines.push(
      "_No captured decisions in this range. Try widening the date range, switching scope, or capturing more chats with the ENGRAM browser extension._"
    );
    lines.push("");
    return lines.join("\n");
  }

  for (const bucket of buckets) {
    lines.push("---");
    lines.push("");
    lines.push(`## ${bucket.label} _(${bucket.rows.length})_`);
    lines.push("");
    for (const r of bucket.rows) {
      const date = r.created_at.slice(0, 10);
      const title = escapeMd(r.title) || "Untitled";
      lines.push(
        `### ${date} · ${toolLabel(r.ai_tool)} · ${title}`
      );
      if (r.tags && r.tags.length > 0) {
        lines.push(`**Tags:** ${r.tags.map((t) => `\`${t}\``).join(", ")}  `);
      }
      if (scope === "team" && r.author_handle) {
        lines.push(`**By:** ${r.author_handle}  `);
      }
      if (r.summary) {
        lines.push("");
        lines.push(`**Summary:** ${escapeMd(r.summary)}`);
      }
      if (r.decision) {
        lines.push("");
        lines.push(`**Decision:** ${escapeMd(r.decision)}`);
      }
      lines.push("");
      lines.push(`[Open snapshot →](/context/${r.id})`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
