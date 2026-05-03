"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Database, CheckCircle2, XCircle, Copy, Check,
  ExternalLink, RefreshCw, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MigrationStatus = {
  projects: boolean;
  github_repos: boolean;
  github_chunks: boolean;
  project_id_col: boolean;
};

const CHECKS: { key: keyof MigrationStatus; label: string; description: string }[] = [
  { key: "projects", label: "Projects table", description: "Stores auto-clustered project groups" },
  { key: "project_id_col", label: "project_id column", description: "Links snapshots to projects" },
  { key: "github_repos", label: "GitHub repos table", description: "Tracks indexed repositories" },
  { key: "github_chunks", label: "GitHub chunks table", description: "Stores indexed code with embeddings" },
];

export default function SetupPage() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sql, setSql] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  async function checkStatus() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/migrate");
      const d = await r.json();
      setStatus(d.status);
      setSql(d.sql);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { checkStatus(); }, []);

  function copySql() {
    if (!sql) return;
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function tryAutoApply() {
    setApplying(true);
    setApplyResult(null);
    try {
      const r = await fetch("/api/admin/migrate", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setApplyResult("✓ Migrations applied automatically!");
        await checkStatus();
      } else {
        setApplyResult("Automatic apply not available — please copy the SQL below and run it in your Supabase SQL Editor.");
      }
    } finally {
      setApplying(false);
    }
  }

  const allDone = status ? Object.values(status).every(Boolean) : false;
  const anyMissing = status ? Object.values(status).some((v) => !v) : false;

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">database</p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text flex items-center gap-3">
          <Database className="h-7 w-7 text-engram-light" />
          Database Setup
        </h1>
        <p className="text-sm text-gh-muted mt-1">
          ENGRAM needs a few additional database tables for Project Clustering and GitHub integration.
        </p>
      </motion.div>

      {loading ? (
        <div className="h-40 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="rounded-lg border border-gh-border bg-gh-canvas p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gh-text">Migration Status</h2>
              <button onClick={checkStatus} className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-3">
              {CHECKS.map((c) => {
                const ok = status?.[c.key];
                return (
                  <div key={c.key} className="flex items-center gap-3">
                    {ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                      : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                    <div>
                      <div className={cn("text-sm font-medium", ok ? "text-gh-text" : "text-red-300")}>{c.label}</div>
                      <div className="text-xs text-gh-muted">{c.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {allDone ? (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-green-500/20 bg-green-500/5 text-green-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <div className="font-semibold">All migrations applied</div>
                <div className="text-sm opacity-80">Project Clustering and GitHub integration are ready to use.</div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-300 mb-1">Migrations needed</div>
                  <p className="text-xs text-gh-muted mb-3">
                    Run the SQL below in your{" "}
                    <a
                      href="https://supabase.com/dashboard/project/fvowlnhpzgkcejumftcv/sql/new"
                      target="_blank"
                      rel="noopener"
                      className="text-engram-light hover:underline inline-flex items-center gap-0.5"
                    >
                      Supabase SQL Editor <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={tryAutoApply}
                      disabled={applying}
                      className="text-xs px-3 py-1.5 rounded-md bg-engram text-white hover:bg-engram/90 disabled:opacity-50 transition-colors"
                    >
                      {applying ? "Trying…" : "Try auto-apply"}
                    </button>
                    <button
                      onClick={copySql}
                      className="text-xs px-3 py-1.5 rounded-md border border-gh-border bg-gh-bg hover:border-engram/40 text-gh-muted hover:text-gh-text transition-colors flex items-center gap-1.5"
                    >
                      {copied ? <><Check className="h-3.5 w-3.5 text-green-400" />Copied!</> : <><Copy className="h-3.5 w-3.5" />Copy SQL</>}
                    </button>
                    <a
                      href="https://supabase.com/dashboard/project/fvowlnhpzgkcejumftcv/sql/new"
                      target="_blank"
                      rel="noopener"
                      className="text-xs px-3 py-1.5 rounded-md border border-gh-border bg-gh-bg hover:border-engram/40 text-gh-muted hover:text-gh-text transition-colors flex items-center gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />Open SQL Editor
                    </a>
                  </div>
                  {applyResult && (
                    <p className="mt-2 text-xs text-amber-300">{applyResult}</p>
                  )}
                </div>
              </div>

              {sql && (
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-gh-muted uppercase tracking-wider">Migration SQL</span>
                    <button onClick={copySql} className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors">
                      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <pre className="bg-gh-bg border border-gh-border rounded-lg p-4 text-xs text-gh-muted font-mono overflow-x-auto max-h-96 whitespace-pre-wrap">
                    {sql}
                  </pre>
                </div>
              )}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
