"use client";

import { motion } from "framer-motion";
import { Users, Mail, Plus } from "lucide-react";

export default function TeamPage() {
  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
          collaborators
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-1">
          Team
        </h1>
        <p className="text-sm text-gh-muted">
          Share captured AI conversations with your teammates.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-gh-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gh-muted" />
            <span className="text-sm font-medium text-gh-text">Members</span>
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium transition-colors">
            <Plus className="h-3.5 w-3.5" />
            Invite
          </button>
        </div>

        <div className="px-5 py-12 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-gh-bg border border-gh-border mb-4">
            <Mail className="h-5 w-5 text-gh-muted" />
          </div>
          <h3 className="text-base font-semibold text-gh-text mb-2">
            You&apos;re flying solo
          </h3>
          <p className="text-sm text-gh-muted max-w-sm mx-auto">
            Invite teammates by email to share contexts, ask questions across
            everyone&apos;s captures, and build collective AI memory.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
