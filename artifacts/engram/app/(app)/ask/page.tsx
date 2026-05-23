"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, User, Users, Globe } from "lucide-react";
import {
  AnswerCard,
  type AnswerSource,
  type RelatedSource,
} from "@/components/ask/AnswerCard";
import SessionSidebar from "@/components/ask/SessionSidebar";
import { useAskSessions } from "@/hooks/useAskSessions";

type Scope = "personal" | "team" | "all";

const SCOPE_CONFIG: { value: Scope; label: string; Icon: React.ElementType }[] = [
  { value: "personal", label: "My contexts", Icon: User },
  { value: "team", label: "Team", Icon: Users },
  { value: "all", label: "All", Icon: Globe },
];

function LoadingDots() {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden">
        <div className="px-5 py-3 border-b border-gh-border bg-gh-bg/40 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-engram-light animate-pulse" />
          <span className="text-xs font-mono text-gh-muted">ENGRAM is thinking…</span>
        </div>
        <div className="p-6 flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-2 h-2 rounded-full bg-engram-light/50 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onExample }: { onExample: (q: string) => void }) {
  const examples = [
    "What decisions did we make about authentication?",
    "Write a BST insertion function in Java",
    "What was the last thing we discussed about the database schema?",
    "Summarize any recent architecture changes",
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-4 py-12">
      <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-engram/10 border border-engram/20">
        <Sparkles className="w-6 h-6 text-engram-light" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-gh-text mb-2">Ask ENGRAM</h2>
        <p className="text-sm text-gh-muted max-w-sm leading-relaxed">
          Search your captured AI conversations and code context — or ask anything and ENGRAM will
          answer from its knowledge, grounded in your team&apos;s captures where available.
        </p>
      </div>
      <div className="w-full max-w-md space-y-2">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => onExample(ex)}
            className="w-full text-left px-4 py-2.5 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/30 hover:bg-gh-bg/60 text-sm text-gh-muted hover:text-gh-text transition-all"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AskPage() {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    createSession,
    addMessage,
    deleteSession,
    renameSession,
    togglePin,
    toggleFavorite,
  } = useAskSessions();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<Scope>("personal");
  const [loading, setLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages?.length, loading]);

  function handleExample(q: string) {
    setQuestion(q);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || loading) return;

    setQuestion("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setLoading(true);

    let session = activeSession;
    let sessionId = activeSessionId;
    if (!session) {
      session = createSession(q, scope);
      sessionId = session.id;
    }

    const conversationHistory = session.messages.map((m) => ({
      question: m.question,
      answer: m.answer,
    }));

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, scope, conversationHistory }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();

      addMessage(sessionId!, {
        question: q,
        answer: data.answer ?? "No answer returned.",
        sources: data.sources ?? [],
        related: data.related ?? [],
        confidence: data.confidence ?? null,
        scope: data.scope ?? scope,
        ts: Date.now(),
      });
    } catch (err) {
      addMessage(sessionId!, {
        question: q,
        answer: `Failed to get an answer: ${err instanceof Error ? err.message : "Unknown error"}. Check your connection and try again.`,
        sources: [],
        related: [],
        confidence: null,
        scope,
        ts: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const messages = activeSession?.messages ?? [];

  return (
    <div className="flex overflow-hidden bg-gh-bg" style={{ height: "calc(100vh - 3.5rem)" }}>
      {/* Sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((p) => !p)}
        onSelect={setActiveSessionId}
        onNew={() => setActiveSessionId(null)}
        onDelete={deleteSession}
        onRename={renameSession}
        onPin={togglePin}
        onFavorite={toggleFavorite}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Scope bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gh-border bg-gh-canvas/40 shrink-0">
          <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-zinc-600 mr-1">
            Search in
          </span>
          <div className="flex items-center gap-1">
            {SCOPE_CONFIG.map(({ value, label, Icon }) => (
              <button
                key={value}
                onClick={() => setScope(value)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  scope === value
                    ? "bg-engram/15 text-engram-light ring-1 ring-engram/30"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          {activeSession && (
            <span className="ml-auto text-[10px] font-mono text-zinc-700 truncate max-w-xs">
              {activeSession.title}
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
          {messages.length === 0 && !loading ? (
            <EmptyState onExample={handleExample} />
          ) : (
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={msg.ts ?? i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <AnswerCard
                    question={msg.question}
                    answer={msg.answer}
                    sources={msg.sources as AnswerSource[]}
                    related={msg.related as unknown as RelatedSource[]}
                    confidence={msg.confidence}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}

          {loading && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <LoadingDots />
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 px-4 py-3 border-t border-gh-border bg-gh-canvas/40"
        >
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <div className="flex-1">
              <textarea
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything — follow-ups keep context. Enter to send, Shift+Enter for newline."
                rows={1}
                disabled={loading}
                className="w-full resize-none bg-gh-bg border border-gh-border rounded-xl px-4 py-3 text-sm text-gh-text placeholder:text-zinc-700 focus:outline-none focus:border-engram/40 focus:ring-1 focus:ring-engram/20 disabled:opacity-50 transition-colors overflow-y-auto"
                style={{ minHeight: "3rem", maxHeight: "10rem" }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = "auto";
                  t.style.height = Math.min(t.scrollHeight, 160) + "px";
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!question.trim() || loading}
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-engram disabled:opacity-30 hover:opacity-90 disabled:cursor-not-allowed transition-opacity"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
