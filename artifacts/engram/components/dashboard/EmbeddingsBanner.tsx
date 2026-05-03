"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
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
 * Surfaces the embedding/backfill state for the dashboard. Shown when:
 *  - Embeddings exist but some captures still need backfill, OR
 *  - The OpenAI key is unhealthy (missing / quota / auth / error), so
 *    the user knows why semantic search isn't working.
 *
 * The previous version silently hid itself when the key was unhealthy,
 * which made it look like Phase 6 was broken with no signal.
 */
export function EmbeddingsBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function refresh() {
    try {
      const r = await fetch("/api/admin/backfill-embeddings");
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        console.warn(
          "[EmbeddingsBanner] status fetch failed",
          r.status,
          t.slice(0, 200)
        );
        return;
      }
      const data = await r.json();
      setStatus(data);
    } catch (e) {
      console.warn("[EmbeddingsBanner] status fetch error", e);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function backfill() {
    setBusy(true);
    setError(null);
    try {
      for (let i = 0; i < 8; i++) {
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
          const firstErr = data.failures?.[0]?.error;
          setError(
            firstErr?.includes("insufficient_quota")
              ? "OpenAI quota exhausted — add billing at platform.openai.com to continue."
              : firstErr ?? "Some snapshots failed to embed."
          );
          break;
        }
        if (data.remaining === 0) {
          setDone(true);
          break;
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // ---- ERROR STATES ----
  // Show a clear message when the OpenAI key is unhealthy. Without this
  // the banner would silently hide and the user would have no idea why
  // smart search isn't working.
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
  if (status.openAIStatus === "error") {
    return (
      <ErrorCard
        icon={<AlertCircle className="h-4 w-4" />}
        title="OpenAI request failed"
        body={status.openAIDetail ?? "Try again in a moment."}
      />
    );
  }

  // ---- HEALTHY KEY: show backfill prompt or success ----
  if (done && status.missing === 0) {
    return (
      <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-sm text-emerald-200">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span>
          Smart search is ready. {status.embedded} of {status.total} captures
          indexed.
        </span>
      </div>
    );
  }

  if (status.missing === 0) return null;

  return (
    <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-engram/30 bg-engram/5 px-3.5 py-2.5">
      <div className="flex items-start gap-2.5 text-sm text-gh-text">
        <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0 text-engram-light" />
        <div>
          <p className="font-medium">Smart search needs an index pass</p>
          <p className="text-xs text-gh-muted mt-0.5">
            {status.missing} of {status.total} captures haven&apos;t been
            embedded yet. New captures get indexed automatically — this is a
            one-time backfill for your existing chats.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={backfill}
        disabled={busy}
        className="inline-flex items-center gap-2 self-end sm:self-auto px-3 py-1.5 rounded-md bg-engram hover:bg-engram-light disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Indexing…
          </>
        ) : (
          <>Re-index now</>
        )}
      </button>
      {error && (
        <div className="flex items-start gap-2 text-xs text-rose-300 sm:basis-full">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
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
