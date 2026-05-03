"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type Status = {
  total: number;
  embedded: number;
  missing: number;
  hasOpenAIKey: boolean;
};

/**
 * Shows up only when there are captures without embeddings AND an OpenAI
 * key is configured. Clicking re-indexes them in batches so semantic
 * search starts working on existing data.
 */
export function EmbeddingsBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function refresh() {
    try {
      const r = await fetch("/api/admin/backfill-embeddings");
      if (!r.ok) return;
      setStatus(await r.json());
    } catch {
      // Silent — banner is optional polish, not a blocker.
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function backfill() {
    setBusy(true);
    setError(null);
    try {
      // Run multiple batches if needed (batchSize 25, retry until 0 missing).
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
  if (!status.hasOpenAIKey) return null;
  if (status.missing === 0 && !done) return null;

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
        <div className="flex items-center gap-2 text-xs text-rose-300">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
