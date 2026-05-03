"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QueryInput } from "@/components/ask/QueryInput";
import {
  AnswerCard,
  type AnswerSource,
  type RelatedSource,
} from "@/components/ask/AnswerCard";
import { Sparkles, User, Users, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface GithubSource {
  ref: string;
  id: string;
  repo_full_name: string;
  file_path: string;
  language: string;
  similarity: number;
}

interface QueryRecord {
  question: string;
  answer: string;
  sources: AnswerSource[];
  related: RelatedSource[];
  github_sources?: GithubSource[];
  confidence?: number | null;
  scope?: "personal" | "team" | "all";
  ts: number;
}

type Scope = "personal" | "team" | "all";

export default function AskPage() {
  const [history, setHistory] = useState<QueryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("personal");

  async function ask(question: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, scope }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setHistory((h) => [
          {
            question,
            answer: data.answer,
            sources: data.sources ?? [],
            related: data.related ?? [],
            github_sources: data.github_sources ?? [],
            confidence: data.confidence,
            scope: data.scope ?? scope,
            ts: Date.now(),
          },
          ...h,
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="px-6 py-12 md:py-20">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-10"
      >
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-engram/30 bg-engram/5 mb-4">
          <Sparkles className="h-3 w-3 text-engram-light" />
          <span className="text-[11px] font-mono text-engram-light tracking-wide">
            ask engram
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-gh-text mb-3">
          Search your decisions.
        </h1>
        <p className="text-sm md:text-base text-gh-muted max-w-md mx-auto">
          Plain English. Cited answers. From every captured AI conversation.
        </p>
      </motion.div>

      <QueryInput onAsk={ask} loading={loading} />

      <div className="max-w-2xl mx-auto mt-4 flex items-center justify-center gap-1 text-[11px] font-mono uppercase tracking-wider">
        <span className="text-gh-muted mr-2">search in:</span>
        <ScopePill
          active={scope === "personal"}
          onClick={() => setScope("personal")}
          icon={<User className="h-3 w-3" />}
          label="my contexts"
        />
        <ScopePill
          active={scope === "team"}
          onClick={() => setScope("team")}
          icon={<Users className="h-3 w-3" />}
          label="team"
        />
        <ScopePill
          active={scope === "all"}
          onClick={() => setScope("all")}
          icon={<Globe className="h-3 w-3" />}
          label="all"
        />
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-2xl mx-auto mt-6 px-4 py-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-sm text-rose-300 text-center"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {history.length > 0 && (
        <div className="mt-12 space-y-12">
          {history.map((q) => (
            <AnswerCard
              key={q.ts}
              question={q.question}
              answer={q.answer}
              sources={q.sources}
              related={q.related}
              confidence={q.confidence}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScopePill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all",
        active
          ? "bg-engram/15 text-engram-light shadow-[inset_0_0_0_1px_rgba(124,58,237,0.4)]"
          : "text-gh-muted hover:text-gh-text"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
