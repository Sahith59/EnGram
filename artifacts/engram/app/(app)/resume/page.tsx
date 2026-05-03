"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  Check,
  ClipboardCopy,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { ToolBadge } from "@/components/context/ToolBadge";
import { formatRelativeTime, cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import type { AITool } from "@/types";

interface ResumeData {
  id: string;
  title: string;
  summary: string | null;
  ai_tool: AITool | string;
  tags: string[];
  project: string | null;
  decision: string | null;
  rationale: string | null;
  created_at: string;
}

const targets = [
  { id: "claude", label: "Resume in Claude", url: "https://claude.ai/new", color: "tool-claude" },
  { id: "chatgpt", label: "Resume in ChatGPT", url: "https://chat.openai.com", color: "tool-chatgpt" },
  { id: "gemini", label: "Resume in Gemini", url: "https://gemini.google.com", color: "tool-gemini" },
];

export default function ResumePage() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [handoffPrompt, setHandoffPrompt] = useState<string>("");
  const [handoffLoading, setHandoffLoading] = useState(false);

  function load(tool?: string) {
    setLoading(true);
    const url = tool ? `/api/resume?tool=${tool}` : "/api/resume";
    fetch(url)
      .then((r) => r.json())
      .then((res) => setData(res.data ?? null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(filter ?? undefined);
  }, [filter]);

  // Pre-fetch the rich handoff brief whenever data changes, so the
  // "Resume in X" buttons can write to clipboard synchronously on click.
  useEffect(() => {
    if (!data) {
      setHandoffPrompt("");
      return;
    }
    setHandoffLoading(true);
    fetch(`/api/contexts/${data.id}/export?mode=handoff`)
      .then((r) => (r.ok ? r.text() : ""))
      .then((txt) => setHandoffPrompt(txt))
      .finally(() => setHandoffLoading(false));
  }, [data]);

  function copyPrompt() {
    if (!handoffPrompt) return;
    if (copyToClipboard(handoffPrompt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function resumeIn(target: typeof targets[number]) {
    if (!handoffPrompt) {
      alert("Brief still loading — please wait a moment and try again.");
      return;
    }
    const ok = copyToClipboard(handoffPrompt);
    if (!ok) {
      alert("Could not copy to clipboard. Please grant permission and try again.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    window.open(target.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gh-muted hover:text-gh-text transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
          continue your session
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-2">
          Resume
        </h1>
        <p className="text-sm text-gh-muted mb-8">
          Your most recent capture, ready to drop into a fresh chat.
        </p>

        <div className="flex items-center gap-2 mb-6">
          <span className="text-[11px] font-mono uppercase text-gh-muted">filter:</span>
          {[null, "claude", "chatgpt", "gemini"].map((t) => (
            <button
              key={t ?? "all"}
              onClick={() => setFilter(t)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-mono transition-colors",
                filter === t
                  ? "bg-engram/15 text-engram-light border border-engram/30"
                  : "text-gh-muted hover:text-gh-text border border-gh-border"
              )}
            >
              {t ?? "any"}
            </button>
          ))}
          <button
            onClick={() => load(filter ?? undefined)}
            className="ml-auto p-1.5 rounded-md text-gh-muted hover:text-gh-text hover:bg-gh-canvas transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-gh-border bg-gh-canvas p-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-gh-muted mx-auto" />
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-gh-border bg-gh-canvas p-12 text-center">
            <p className="text-gh-muted">No captures yet for this filter.</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden mb-6">
              <div className="px-5 py-3 border-b border-gh-border bg-gh-bg/40 flex items-center gap-2">
                <ToolBadge tool={data.ai_tool} />
                {data.project && (
                  <span className="font-mono text-[11px] text-gh-muted">↳ {data.project}</span>
                )}
                <span className="ml-auto font-mono text-[11px] text-gh-muted">
                  {formatRelativeTime(data.created_at)}
                </span>
              </div>
              <div className="p-6">
                <h2 className="text-xl font-semibold text-gh-text mb-3">
                  {data.title}
                </h2>
                {data.summary && (
                  <p className="text-sm text-gh-muted leading-relaxed mb-4">
                    {data.summary}
                  </p>
                )}
                {data.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded font-mono text-[10px] bg-gh-bg text-gh-muted border border-gh-border"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden mb-6">
              <div className="px-5 py-2.5 border-b border-gh-border bg-gh-bg/40 flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-gh-muted">
                  resume prompt
                </span>
                <button
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono text-gh-muted hover:text-gh-text transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      copied
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="h-3 w-3" />
                      copy
                    </>
                  )}
                </button>
              </div>
              <pre className="p-5 text-xs font-mono text-gh-text leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-72">
                {handoffLoading
                  ? "Preparing handoff brief…"
                  : handoffPrompt || "No brief available."}
              </pre>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => resumeIn(t)}
                  disabled={handoffLoading || !handoffPrompt}
                  className="group flex items-center justify-between p-4 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        t.color === "tool-claude" && "bg-tool-claude",
                        t.color === "tool-chatgpt" && "bg-tool-chatgpt",
                        t.color === "tool-gemini" && "bg-tool-gemini"
                      )}
                    />
                    <span className="text-sm text-gh-text">{t.label}</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-gh-muted group-hover:text-engram-light transition-colors" />
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] font-mono text-gh-muted text-center">
              we copy the full handoff brief and open the tool — paste with{" "}
              <kbd className="font-mono">⌘V</kbd> / <kbd className="font-mono">Ctrl+V</kbd>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
