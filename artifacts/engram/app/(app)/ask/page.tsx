"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QueryInput } from "@/components/ask/QueryInput";
import { AnswerCard, type AnswerSource } from "@/components/ask/AnswerCard";
import { Sparkles } from "lucide-react";

interface QueryRecord {
  question: string;
  answer: string;
  sources: AnswerSource[];
  confidence?: number | null;
  ts: number;
}

export default function AskPage() {
  const [history, setHistory] = useState<QueryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
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
            confidence: data.confidence,
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
          Search your team&apos;s decisions.
        </h1>
        <p className="text-sm md:text-base text-gh-muted max-w-md mx-auto">
          Plain English. Cited answers. From every captured AI conversation.
        </p>
      </motion.div>

      <QueryInput onAsk={ask} loading={loading} />

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
              confidence={q.confidence}
            />
          ))}
        </div>
      )}
    </div>
  );
}
