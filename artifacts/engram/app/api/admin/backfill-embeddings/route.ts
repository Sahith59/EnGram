import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildSnapshotEmbeddingInput, embedText } from "@/lib/embeddings";

/**
 * POST /api/admin/backfill-embeddings
 *
 * Generates embeddings for every snapshot the caller can see that doesn't
 * have one yet. Scoped to the caller's team for safety — there is no
 * global "embed everyone's stuff" mode. Run from the dashboard or:
 *
 *   curl -X POST -b "<your auth cookie>" \
 *        $REPLIT_DEV_DOMAIN/api/admin/backfill-embeddings
 *
 * Body (optional): { batchSize?: number, dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set" },
      { status: 503 }
    );
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

  let body: { batchSize?: number; dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }
  const batchSize = Math.min(Math.max(body.batchSize ?? 25, 1), 100);
  const dryRun = body.dryRun === true;

  // Use the admin client to write the embedding column past RLS — but
  // scope reads to the caller's team so they can't trigger backfill on
  // someone else's data.
  // Privacy: only embed rows the caller can actually see — their own
  // captures plus team-shared ones. Never touch another user's personal
  // snapshots (which would otherwise be sent to OpenAI). Probe column
  // existence first to avoid error-sniffing fragility.
  const admin = createAdminClient();
  const { data: rows, error: fetchError } = await admin
    .from("context_snapshots")
    .select("id, title, summary, decision, rationale, tags")
    .eq("team_id", profile.team_id)
    .is("embedding", null)
    .or(`created_by.eq.${user.id},visibility.eq.team`)
    .order("created_at", { ascending: false })
    .limit(batchSize);

  if (fetchError) {
    return NextResponse.json(
      { error: "Fetch failed", detail: fetchError.message },
      { status: 500 }
    );
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      message: "No snapshots needing embeddings.",
      processed: 0,
      remaining: 0,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      message: "Dry run — nothing written.",
      wouldProcess: rows.length,
      ids: rows.map((r) => r.id),
    });
  }

  // Run sequentially with light concurrency. OpenAI's free tier rate
  // limits are tight, and these are tiny payloads — overlap of 3 is fine.
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const concurrency = 3;
  let i = 0;
  async function worker() {
    while (i < rows!.length) {
      const idx = i++;
      const row = rows![idx];
      try {
        const input = buildSnapshotEmbeddingInput(row);
        const r = await embedText(input);
        if (!r) {
          results.push({ id: row.id, ok: false, error: "no api key" });
          continue;
        }
        const { error: upErr } = await admin
          .from("context_snapshots")
          .update({ embedding: r.vector })
          .eq("id", row.id);
        if (upErr) {
          results.push({ id: row.id, ok: false, error: upErr.message });
        } else {
          results.push({ id: row.id, ok: true });
        }
      } catch (e) {
        results.push({
          id: row.id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  // How many caller-visible rows are still without embeddings?
  const remainingResp = await admin
    .from("context_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("team_id", profile.team_id)
    .is("embedding", null)
    .or(`created_by.eq.${user.id},visibility.eq.team`);
  const remaining = remainingResp.count;

  return NextResponse.json({
    message: failed === 0
      ? `Embedded ${succeeded} snapshot${succeeded === 1 ? "" : "s"}.`
      : `Embedded ${succeeded}, failed ${failed}.`,
    processed: results.length,
    succeeded,
    failed,
    remaining: remaining ?? 0,
    failures: results.filter((r) => !r.ok),
  });
}

/** GET — quick status: how many snapshots in your team need embeddings. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
  // Status only counts rows the caller can actually see — matches what
  // POST will process.
  const admin = createAdminClient();
  const visScope = `created_by.eq.${user.id},visibility.eq.team`;
  const m = await admin
    .from("context_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("team_id", profile.team_id)
    .is("embedding", null)
    .or(visScope);
  const missing = m.count ?? 0;
  const t = await admin
    .from("context_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("team_id", profile.team_id)
    .or(visScope);
  const total = t.count ?? 0;
  console.log("[backfill-status]", {
    teamId: profile.team_id,
    userId: user.id,
    total,
    missing,
  });
  // Probe the OpenAI key with a tiny request so the UI can tell the
  // difference between "no key" / "key works" / "key out of quota".
  let openAIStatus: "ok" | "missing" | "quota" | "auth" | "error" = "missing";
  let openAIDetail: string | null = null;
  if (process.env.OPENAI_API_KEY) {
    try {
      const probe = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: "ping" }),
      });
      if (probe.ok) {
        openAIStatus = "ok";
      } else if (probe.status === 401) {
        openAIStatus = "auth";
        openAIDetail = "Invalid OpenAI API key.";
      } else if (probe.status === 429) {
        openAIStatus = "quota";
        const j = await probe.json().catch(() => null);
        openAIDetail =
          j?.error?.code === "insufficient_quota"
            ? "Your OpenAI account has no quota. Add a payment method at platform.openai.com/account/billing — embeddings cost ~$0.02 per million tokens."
            : "OpenAI rate limit hit. Wait a moment and retry.";
      } else {
        openAIStatus = "error";
        openAIDetail = `OpenAI returned ${probe.status}.`;
      }
    } catch (e) {
      openAIStatus = "error";
      openAIDetail = e instanceof Error ? e.message : String(e);
    }
  }
  console.log("[backfill-status]", {
    total: total ?? 0,
    missing: missing ?? 0,
    openAIStatus,
  });
  return NextResponse.json({
    total: total ?? 0,
    embedded: (total ?? 0) - (missing ?? 0),
    missing: missing ?? 0,
    openAIStatus,
    openAIDetail,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
  });
}

