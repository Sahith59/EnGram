"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  GitBranch,
  Search,
  RefreshCw,
  ArrowRight,
  Github,
  Sparkles,
  Zap,
  Lock,
} from "lucide-react";

const features = [
  {
    icon: GitBranch,
    title: "Capture every conversation",
    description:
      "A browser extension quietly snapshots your ChatGPT, Claude, and Gemini sessions. No copy-paste, no friction.",
    accent: "from-tool-claude/20 to-transparent",
  },
  {
    icon: Search,
    title: "Ask, get cited answers",
    description:
      "Why did we choose Postgres? What did we decide about auth? Search your team's collective AI memory in plain English.",
    accent: "from-engram/20 to-transparent",
  },
  {
    icon: RefreshCw,
    title: "Pick up where you left off",
    description:
      "Hit Claude's context limit? ENGRAM hands you a perfect resume prompt for the next session — no rework.",
    accent: "from-tool-gemini/20 to-transparent",
  },
];

const steps = [
  { n: "01", t: "Install", d: "Add the ENGRAM extension to Chrome." },
  { n: "02", t: "Chat", d: "Use ChatGPT, Claude, or Gemini like normal." },
  { n: "03", t: "Capture", d: "ENGRAM extracts decisions, rationale, and tech stack." },
  { n: "04", t: "Recall", d: "Anyone on your team can ask and get cited answers." },
];

export function LandingClient() {
  return (
    <div className="min-h-screen bg-gh-bg text-gh-text overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #e6edf3 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <header className="relative z-10 px-6 lg:px-12 py-5 flex items-center justify-between border-b border-gh-border/40">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-engram to-engram-light flex items-center justify-center">
            <GitBranch className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-mono text-base font-semibold tracking-tight">engram</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-gh-muted">
          <a href="#features" className="hover:text-gh-text transition-colors">Features</a>
          <a href="#how" className="hover:text-gh-text transition-colors">How it works</a>
          <a href="https://github.com" className="hover:text-gh-text transition-colors flex items-center gap-1.5">
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-sm text-gh-muted hover:text-gh-text px-3 py-1.5 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium px-4 py-1.5 rounded-md bg-engram hover:bg-engram-light text-white transition-colors"
          >
            Get started
          </Link>
        </div>
      </header>

      <section className="relative px-6 lg:px-12 pt-20 pb-32 max-w-6xl mx-auto">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-[800px] rounded-full opacity-30 blur-[120px] pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(124,58,237,0.6), transparent 60%)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative inline-flex items-center gap-2 px-3 py-1 rounded-full border border-engram/30 bg-engram/5 mb-8"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-engram-light animate-pulse" />
          <span className="text-[11px] font-mono text-engram-light tracking-wide">
            git for AI decisions
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="relative text-[44px] md:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1.05] max-w-4xl"
        >
          When Claude hits your limit,{" "}
          <span className="relative inline-block">
            <span className="relative z-10 bg-gradient-to-br from-engram-light via-engram to-engram-light bg-clip-text text-transparent">
              ENGRAM
            </span>
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, delay: 0.6, ease: [0.21, 0.47, 0.32, 0.98] }}
              className="absolute bottom-1 left-0 right-0 h-1 bg-engram/30 origin-left rounded-full"
            />
          </span>{" "}
          picks up where you left off.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative mt-6 text-lg md:text-xl text-gh-muted max-w-2xl leading-relaxed"
        >
          Capture every AI conversation. Search your team&apos;s decisions in
          plain English. Never re-explain your codebase to a fresh chat again.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="relative mt-10 flex flex-wrap gap-3"
        >
          <Link
            href="/login"
            className="group inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-engram hover:bg-engram-light text-white font-medium transition-all shadow-lg shadow-engram/30 hover:shadow-engram/50"
          >
            Start capturing
            <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <a
            href="#how"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-gh-muted text-gh-text transition-colors"
          >
            See how it works
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="relative mt-16 rounded-xl border border-gh-border bg-gh-canvas overflow-hidden shadow-2xl shadow-black/40"
        >
          <div className="px-4 py-2.5 border-b border-gh-border bg-gh-bg/40 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            <span className="ml-3 text-xs font-mono text-gh-muted">engram.dev/ask</span>
          </div>
          <div className="p-6 md:p-10 font-mono text-sm">
            <div className="text-gh-muted mb-2">$ engram ask</div>
            <div className="text-gh-text mb-4">
              <span className="text-engram-light">›</span> why did we pick Postgres over DynamoDB for the events table?
            </div>
            <div className="text-gh-muted mb-2">
              <span className="text-emerald-400">●</span> synthesized from 4 sources
            </div>
            <div className="text-gh-text leading-relaxed">
              You chose Postgres because the team needed{" "}
              <span className="text-engram-light bg-engram/10 px-1 rounded">[1]</span>{" "}
              transactional consistency for billing events and{" "}
              <span className="text-engram-light bg-engram/10 px-1 rounded">[2]</span>{" "}
              the existing schema migrations were already battle-tested. DynamoDB
              was rejected because the access patterns were too varied to model
              cleanly without expensive secondary indexes{" "}
              <span className="text-engram-light bg-engram/10 px-1 rounded">[3]</span>.
            </div>
          </div>
        </motion.div>
      </section>

      <section id="features" className="relative px-6 lg:px-12 py-24 border-t border-gh-border/60">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <p className="text-xs font-mono text-engram-light uppercase tracking-wider mb-3">
              what it does
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight max-w-2xl">
              The institutional memory your AI tools should have had from day one.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  className="group relative rounded-xl border border-gh-border bg-gh-canvas p-6 overflow-hidden hover:border-gh-muted/40 transition-colors"
                >
                  <div
                    className={`absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${f.accent}`}
                  />
                  <Icon className="h-6 w-6 text-engram-light mb-4 relative" />
                  <h3 className="relative text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="relative text-sm text-gh-muted leading-relaxed">{f.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="how" className="relative px-6 lg:px-12 py-24 border-t border-gh-border/60">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="mb-12"
          >
            <p className="text-xs font-mono text-engram-light uppercase tracking-wider mb-3">
              the flow
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              Four steps. Zero ceremony.
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-4 gap-px bg-gh-border rounded-xl overflow-hidden border border-gh-border">
            {steps.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="bg-gh-canvas p-6 relative group"
              >
                <div className="font-mono text-xs text-engram-light mb-3">{s.n}</div>
                <h4 className="text-base font-semibold mb-2">{s.t}</h4>
                <p className="text-sm text-gh-muted leading-relaxed">{s.d}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-12 grid md:grid-cols-3 gap-3 text-sm">
            {[
              { i: Zap, t: "Sub-second answers", d: "Claude Sonnet synthesis." },
              { i: Lock, t: "End-to-end private", d: "Your data, your Supabase." },
              { i: Sparkles, t: "Slack-native", d: "/engram in any channel." },
            ].map((b) => {
              const I = b.i;
              return (
                <div key={b.t} className="flex items-start gap-3 p-4 rounded-lg border border-gh-border bg-gh-canvas/60">
                  <I className="h-4 w-4 text-engram-light mt-0.5" />
                  <div>
                    <div className="font-medium text-gh-text">{b.t}</div>
                    <div className="text-xs text-gh-muted">{b.d}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="relative px-6 lg:px-12 py-24 border-t border-gh-border/60">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-4xl mx-auto rounded-2xl border border-engram/30 bg-gradient-to-br from-engram/10 via-gh-canvas to-gh-canvas p-10 md:p-16 text-center relative overflow-hidden"
        >
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(124,58,237,0.4), transparent 60%)",
            }}
          />
          <h2 className="relative text-3xl md:text-5xl font-semibold tracking-tight mb-4">
            Stop losing decisions to chat history.
          </h2>
          <p className="relative text-lg text-gh-muted mb-8 max-w-xl mx-auto">
            Free while we&apos;re in beta. Install in two minutes.
          </p>
          <Link
            href="/login"
            className="relative inline-flex items-center gap-2 px-6 py-3.5 rounded-lg bg-engram hover:bg-engram-light text-white font-medium transition-all shadow-xl shadow-engram/40"
          >
            Create your team
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </section>

      <footer className="relative px-6 lg:px-12 py-8 border-t border-gh-border/60 text-xs text-gh-muted font-mono flex items-center justify-between">
        <span>© ENGRAM</span>
        <span>git for AI decisions</span>
      </footer>
    </div>
  );
}
