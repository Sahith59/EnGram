"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play } from "lucide-react";
import { ToolBadge } from "@/components/context/ToolBadge";
import { formatRelativeTime, truncate } from "@/lib/utils";
import type { AITool } from "@/types";

interface ResumeData {
  id: string;
  title: string;
  summary: string | null;
  ai_tool: AITool | string;
  created_at: string;
}

export function ResumeBanner() {
  const [data, setData] = useState<ResumeData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("engram-resume-dismissed")) {
      setDismissed(true);
      return;
    }
    fetch("/api/resume")
      .then((r) => r.json())
      .then((res) => {
        if (res.data) setData(res.data);
      })
      .catch(() => {});
  }, []);

  function dismiss() {
    sessionStorage.setItem("engram-resume-dismissed", "1");
    setDismissed(true);
  }

  return (
    <AnimatePresence>
      {data && !dismissed && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)]"
        >
          <div className="relative rounded-xl border border-engram/30 bg-gh-canvas shadow-2xl shadow-black/60 overflow-hidden">
            <div
              className="absolute inset-0 opacity-50 pointer-events-none"
              style={{
                background:
                  "radial-gradient(120% 80% at 100% 0%, rgba(124,58,237,0.15), transparent 60%)",
              }}
            />

            <button
              onClick={dismiss}
              className="absolute top-2.5 right-2.5 h-6 w-6 rounded-md flex items-center justify-center text-gh-muted hover:text-gh-text hover:bg-gh-bg transition-colors z-10"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="relative p-4">
              <div className="flex items-center gap-2 mb-2">
                <ToolBadge tool={data.ai_tool} />
                <span className="text-[10px] font-mono text-gh-muted uppercase tracking-wider">
                  pick up where you left off
                </span>
              </div>

              <h4 className="text-sm font-semibold text-gh-text mb-1.5 leading-snug pr-6">
                {data.title}
              </h4>

              {data.summary && (
                <p className="text-xs text-gh-muted leading-relaxed mb-3">
                  {truncate(data.summary, 110)}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Link
                  href={`/resume`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium transition-colors"
                >
                  <Play className="h-3 w-3" fill="currentColor" />
                  Resume
                </Link>
                <Link
                  href={`/context/${data.id}`}
                  className="px-3 py-2 rounded-md border border-gh-border text-xs text-gh-muted hover:text-gh-text hover:bg-gh-bg transition-colors"
                >
                  View
                </Link>
                <span className="text-[10px] font-mono text-gh-muted ml-auto">
                  {formatRelativeTime(data.created_at)}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
