"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const suggestions = [
  "Why did we choose Postgres over DynamoDB?",
  "What was decided about the auth flow?",
  "How did we structure the API layer?",
];

export function QueryInput({
  onAsk,
  loading,
}: {
  onAsk: (q: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    if (!value.trim() || loading) return;
    onAsk(value.trim());
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={cn(
          "relative rounded-xl border bg-gh-canvas transition-all duration-200",
          focused
            ? "border-engram/60 shadow-[0_0_0_4px_rgba(124,58,237,0.12)]"
            : "border-gh-border"
        )}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-engram to-transparent transition-opacity duration-300",
            focused ? "opacity-100" : "opacity-0"
          )}
        />

        <div className="flex items-start gap-3 p-4">
          <Sparkles
            className={cn(
              "h-5 w-5 mt-2 transition-colors",
              focused ? "text-engram-light" : "text-gh-muted"
            )}
          />
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask anything about your team's AI decisions…"
            rows={2}
            className="flex-1 bg-transparent text-[15px] text-gh-text placeholder:text-gh-muted/70 outline-none resize-none min-h-[56px] py-1.5 leading-relaxed"
            disabled={loading}
          />
          <button
            onClick={submit}
            disabled={!value.trim() || loading}
            className={cn(
              "shrink-0 h-10 w-10 rounded-lg flex items-center justify-center transition-all",
              value.trim() && !loading
                ? "bg-engram hover:bg-engram-light text-white shadow-lg shadow-engram/30"
                : "bg-gh-bg text-gh-muted cursor-not-allowed"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            )}
          </button>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gh-border/60 text-[11px] font-mono text-gh-muted">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border">↵</kbd> send
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border">⇧↵</kbd> newline
            </span>
          </div>
          <span className="opacity-60">{value.length} chars</span>
        </div>
      </motion.div>

      {!value && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="mt-4 flex flex-wrap gap-2 justify-center"
        >
          {suggestions.map((s, i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
              onClick={() => {
                setValue(s);
                inputRef.current?.focus();
              }}
              className="px-3 py-1.5 rounded-full text-xs text-gh-muted hover:text-gh-text bg-gh-canvas border border-gh-border hover:border-engram/40 transition-colors"
            >
              {s}
            </motion.button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
