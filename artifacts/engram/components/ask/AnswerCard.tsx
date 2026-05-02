"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { ToolBadge } from "@/components/context/ToolBadge";
import { formatRelativeTime } from "@/lib/utils";
import type { AITool } from "@/types";

export interface AnswerSource {
  ref: number;
  id: string;
  title: string;
  ai_tool: AITool | string;
  created_at: string;
}

export function AnswerCard({
  question,
  answer,
  sources,
  confidence,
}: {
  question: string;
  answer: string;
  sources: AnswerSource[];
  confidence?: number | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.21, 0.47, 0.32, 0.98] }}
      className="w-full max-w-2xl mx-auto space-y-4"
    >
      <div className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden">
        <div className="px-5 py-3 border-b border-gh-border bg-gh-bg/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-engram-light" />
            <span className="text-xs font-mono text-gh-muted">
              synthesized from {sources.length} {sources.length === 1 ? "source" : "sources"}
            </span>
          </div>
          {typeof confidence === "number" && (
            <ConfidenceBar confidence={confidence} />
          )}
        </div>

        <div className="p-6">
          <p className="text-xs font-mono text-gh-muted mb-3">YOU ASKED</p>
          <p className="text-[15px] text-gh-text mb-6 leading-relaxed">
            {question}
          </p>

          <p className="text-xs font-mono text-gh-muted mb-3">ANSWER</p>
          <div className="text-[15px] text-gh-text leading-relaxed whitespace-pre-wrap">
            {renderWithCitations(answer, sources)}
          </div>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-wider text-gh-muted px-1">
            Sources
          </p>
          <div className="grid gap-2">
            {sources.map((src, i) => (
              <motion.div
                key={src.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                <Link
                  href={`/context/${src.id}`}
                  className="group flex items-center gap-3 p-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 hover:bg-gh-canvas/80 transition-all"
                >
                  <span className="font-mono text-[11px] text-engram-light w-6 shrink-0">
                    [{src.ref}]
                  </span>
                  <ToolBadge tool={src.ai_tool} />
                  <span className="flex-1 text-sm text-gh-text truncate group-hover:text-engram-light transition-colors">
                    {src.title}
                  </span>
                  <span className="font-mono text-[11px] text-gh-muted shrink-0">
                    {formatRelativeTime(src.created_at)}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-gh-muted group-hover:text-engram-light transition-colors" />
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence > 0.75 ? "bg-emerald-500" : confidence > 0.5 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-gh-muted">{pct}%</span>
      <div className="h-1 w-20 rounded-full bg-gh-border overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className={`h-full ${color}`}
        />
      </div>
    </div>
  );
}

function renderWithCitations(text: string, sources: AnswerSource[]) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) {
      const ref = parseInt(m[1], 10);
      const src = sources.find((s) => s.ref === ref);
      if (src) {
        return (
          <Link
            key={i}
            href={`/context/${src.id}`}
            className="inline-flex items-center px-1.5 py-px rounded text-[11px] font-mono bg-engram/15 text-engram-light hover:bg-engram/25 transition-colors mx-0.5 align-baseline"
          >
            {ref}
          </Link>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}
