/**
 * GET /api/health
 *
 * F-12: Extension health monitor heartbeat target.
 * Called every 5 minutes by the extension background service worker.
 * Returns a lightweight status so the popup can show 🟢/🟡/🔴.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startMs = Date.now();

  // ── Supabase reachability ────────────────────────────────────────────────
  let supabaseOk = false;
  let supabaseError: string | null = null;

  if (!isSupabaseConfigured()) {
    supabaseError = "not_configured";
  } else {
    try {
      const admin = createAdminClient();
      // Lightest possible query — just ping the DB
      const { error } = await admin
        .from("profiles")
        .select("id")
        .limit(1)
        .maybeSingle();
      supabaseOk = !error;
      if (error) supabaseError = error.message.slice(0, 80);
    } catch (e) {
      supabaseError = String(e).slice(0, 80);
    }
  }

  // ── AI key presence ──────────────────────────────────────────────────────
  const aiOk = !!(
    process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
  );

  // ── Derived status ───────────────────────────────────────────────────────
  const latencyMs = Date.now() - startMs;
  let status: "ok" | "degraded" | "error";
  if (supabaseOk && aiOk) {
    status = "ok";
  } else if (supabaseOk || aiOk) {
    status = "degraded";
  } else {
    status = "error";
  }

  return NextResponse.json(
    {
      status,
      supabase: supabaseOk,
      ai: aiOk,
      latency_ms: latencyMs,
      ...(supabaseError ? { supabase_error: supabaseError } : {}),
      ts: Date.now(),
    },
    {
      headers: {
        // Allow extension to call without CORS issues
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
