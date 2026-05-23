"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Sparkles, ArrowUpRight, Info } from "lucide-react";
import { ToolBadge } from "@/components/context/ToolBadge";
import { formatRelativeTime } from "@/lib/utils";
import { MarkdownContent } from "@/components/ui/MarkdownContent";
import type { AITool } from "@/types";

export interface AnswerSource {
  ref: number;
  id: string;
  title: string;
  ai_tool: AITool | string;
  created_at: string;
}

export interface RelatedSource {
  id: string;
  title: string;
  ai_tool: AITool | string;
  created_at: string;
  similarity?: number;
  keywordHits?: number;
}

export function AnswerCard({
  question,
  answer,
  sources,
  related = [],
  confidence,
}: {
  question: string;
  answer: string;
  sources: AnswerSource[];
  related?: RelatedSource[];
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
          <MarkdownContent content={answer} sources={sources} />
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

      {related.length > 0 && (
        <div className="space-y-2">
          {sources.length === 0 && (
            <p className="text-[11px] text-gh-muted/80 px-1 italic">
              Claude didn&apos;t directly cite a source for the answer above,
              but these captures came up in the search — open them to verify.
            </p>
          )}
          <div className="flex items-center gap-1.5 px-1">
            <p className="text-[11px] font-mono uppercase tracking-wider text-gh-muted">
              Related captures
            </p>
            <span
              className="inline-flex items-center"
              title="These captures matched your search but Claude didn't cite them in the answer above. Open them to verify yourself."
            >
              <Info className="h-3 w-3 text-gh-muted/60" />
            </span>
            <span className="text-[10px] font-mono text-gh-muted/60">
              · not directly cited
            </span>
          </div>
          <div className="grid gap-2">
            {related.map((src, i) => (
              <motion.div
                key={src.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                <Link
                  href={`/context/${src.id}`}
                  className="group flex items-center gap-3 p-2.5 rounded-lg border border-dashed border-gh-border/70 bg-gh-canvas/40 hover:border-engram/30 hover:bg-gh-canvas/70 transition-all"
                >
                  <ToolBadge tool={src.ai_tool} />
                  <span className="flex-1 text-[13px] text-gh-muted truncate group-hover:text-gh-text transition-colors">
                    {src.title}
                  </span>
                  {typeof src.similarity === "number" && src.similarity > 0 && (
                    <span
                      className="font-mono text-[10px] text-gh-muted/70 shrink-0"
                      title={`Cosine similarity ${src.similarity.toFixed(2)}${src.keywordHits ? ` · ${src.keywordHits} keyword hit${src.keywordHits === 1 ? "" : "s"}` : ""}`}
                    >
                      sim {src.similarity.toFixed(2)}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-gh-muted/70 shrink-0">
                    {formatRelativeTime(src.created_at)}
                  </span>
                  <ArrowUpRight className="h-3 w-3 text-gh-muted/60 group-hover:text-engram-light transition-colors" />
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

