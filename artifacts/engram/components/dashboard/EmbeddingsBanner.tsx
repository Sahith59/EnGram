"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  AlertCircle,
  KeyRound,
} from "lucide-react";

type Status = {
  total: number;
  embedded: number;
  missing: number;
  hasOpenAIKey: boolean;
  openAIStatus?: "ok" | "missing" | "quota" | "auth" | "error";
  openAIDetail?: string | null;
};

/**
 * Surfaces embedding/backfill state on the dashboard.
 *
 * Behavior:
 *  - On mount, fetches status. If captures are missing embeddings AND
 *    OpenAI is healthy, it AUTOMATICALLY runs the backfill in the
 *    background — no user action required.
 *  - Shows a subtle "Indexing…" pill while the backfill runs.
 *  - Hides itself entirely when everything is healthy and indexed.
 *  - Shows clear actionable errors when OpenAI is unhealthy (so the
 *    user knows why semantic search isn't working).
 */
export function EmbeddingsBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggeredRef = useRef(false);

  async function fetchStatus(): Promise<Status | null> {
    try {
      const r = await fetch("/api/admin/backfill-embeddings");
      if (!r.ok) return null;
      return (await r.json()) as Status;
    } catch {
      return null;
    }
  }

  async function runBackfill() {
    setBusy(true);
    setError(null);
    try {
      // Loop in batches until nothing left or an error trips us up.
      for (let i = 0; i < 20; i++) {
        const r = await fetch("/api/admin/backfill-embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 25 }),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? "Backfill failed");
          break;
        }
        if (data.failed > 0) {
          const firstErr = data.failures?.[0]?.error ?? "";
          setError(
            firstErr.includes("insufficient_quota")
              ? "OpenAI quota exhausted — add billing at platform.openai.com to continue."
              : firstErr || "Some snapshots failed to embed."
          );
          break;
        }
        if (data.remaining === 0) break;
      }
      const fresh = await fetchStatus();
      if (fresh) setStatus(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Initial load + auto-trigger backfill if there's work to do and the
  // key is healthy. The triggeredRef guard prevents double-firing under
  // React strict mode.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await fetchStatus();
      if (cancelled) return;
      setStatus(s);
      if (
        s &&
        s.openAIStatus === "ok" &&
        s.missing > 0 &&
        !triggeredRef.current
      ) {
        triggeredRef.current = true;
        await runBackfill();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  // ---- ERROR STATES (always show — these block semantic search) ----
  if (status.openAIStatus === "missing") {
    return (
      <ErrorCard
        icon={<KeyRound className="h-4 w-4" />}
        title="Smart search needs an OpenAI API key"
        body="Add OPENAI_API_KEY in Secrets to enable semantic retrieval. Captures still work without it — only meaning-based search is offline."
      />
    );
  }
  if (status.openAIStatus === "auth") {
    return (
      <ErrorCard
        icon={<KeyRound className="h-4 w-4" />}
        title="OpenAI API key is invalid"
        body={status.openAIDetail ?? "Check your OPENAI_API_KEY in Secrets."}
      />
    );
  }
  if (status.openAIStatus === "quota") {
    return (
      <ErrorCard
        icon={<AlertCircle className="h-4 w-4" />}
        title="OpenAI quota exhausted"
        body={
          status.openAIDetail ??
          "Your OpenAI account has no quota. Add a payment method at platform.openai.com/account/billing."
        }
      />
    );
  }
  if (status.openAIStatus === "error" && error) {
    return (
      <ErrorCard
        icon={<AlertCircle className="h-4 w-4" />}
        title="OpenAI request failed"
        body={status.openAIDetail ?? error}
      />
    );
  }

  // ---- HEALTHY KEY: subtle floating indexing pill, or hide entirely ----
  // Fixed-position so it can mount globally in the layout without
  // disrupting any page's content flow.
  if (busy) {
    return (
      <div className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-engram/30 bg-gh-canvas/95 backdrop-blur px-3 py-1.5 text-xs text-engram-light shadow-lg">
        <Loader2 className="h-3 w-3 animate-spin" />
        Indexing for smart search…
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed bottom-4 right-4 z-40 max-w-sm inline-flex items-start gap-2 rounded-md border border-rose-500/30 bg-gh-canvas/95 backdrop-blur px-3 py-2 text-xs text-rose-200 shadow-lg">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  // Everything healthy and indexed — get out of the user's way.
  return null;
}

function ErrorCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3.5 py-2.5 text-sm">
      <span className="text-amber-300 mt-0.5 flex-shrink-0">{icon}</span>
      <div>
        <p className="font-medium text-amber-100">{title}</p>
        <p className="text-xs text-amber-200/80 mt-0.5">{body}</p>
      </div>
    </div>
  );
}
