"use client";

import { motion } from "framer-motion";
import { Download, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

export function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.21, 0.47, 0.32, 0.98] }}
      className="relative overflow-hidden rounded-xl border border-gh-border bg-gh-canvas px-8 py-12 md:py-16"
    >
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #e6edf3 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />

      <div
        className="absolute -top-24 -right-24 h-72 w-72 rounded-full opacity-30 blur-3xl pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(124,58,237,0.45), transparent 60%)",
        }}
      />

      <div className="relative max-w-2xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-engram/30 bg-engram/10 mb-6"
        >
          <Sparkles className="h-3 w-3 text-engram-light" />
          <span className="text-[11px] font-mono text-engram-light tracking-wide">
            no captures yet
          </span>
        </motion.div>

        <h2 className="text-2xl md:text-[28px] font-semibold text-gh-text leading-tight tracking-tight mb-5">
          Fred Smith got a <span className="text-gh-muted line-through">C</span>{" "}
          <span className="text-engram-light">on the paper.</span>
        </h2>

        <div className="space-y-4 text-[15px] leading-relaxed text-gh-muted max-w-xl mb-8">
          <p>
            In 1965, a Yale undergrad named Fred Smith wrote a paper proposing
            overnight package delivery. His professor scrawled a C across the
            top: &ldquo;The concept is interesting and well-formed, but to earn
            better than a C the idea must be feasible.&rdquo;
          </p>
          <p>
            Eight years later, that &ldquo;infeasible&rdquo; paper became
            FedEx — a $90B company built on a decision someone almost threw
            away.
          </p>
          <p className="text-gh-text">
            The conversations your team has with AI today contain decisions like
            that. ENGRAM keeps them so the next person doesn&apos;t have to
            rediscover them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="#"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-engram hover:bg-engram-light text-white text-sm font-medium transition-colors"
          >
            <Download className="h-4 w-4" />
            Install Chrome extension
          </a>
          <Link
            href="/ask"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-gh-border bg-gh-bg hover:border-gh-muted text-sm text-gh-text transition-colors"
          >
            Ask a question
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-gh-border/60 flex items-center gap-6 text-[11px] font-mono text-gh-muted">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-tool-chatgpt" />
            ChatGPT
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-tool-claude" />
            Claude
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-tool-gemini" />
            Gemini
          </div>
        </div>
      </div>
    </motion.div>
  );
}
