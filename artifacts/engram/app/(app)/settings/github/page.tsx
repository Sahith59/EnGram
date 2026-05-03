"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Github, Check, X, RefreshCw, Trash2, BookOpen,
  Lock, Globe, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IndexedRepo = {
  id: string;
  repo_full_name: string;
  status: "pending" | "indexing" | "indexed" | "error";
  file_count: number;
  chunk_count: number;
  indexed_at: string | null;
  error_message: string | null;
};

type GithubRepo = {
  full_name: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-gh-muted",
  indexing: "text-amber-400",
  indexed: "text-green-400",
  error: "text-red-400",
};

export default function GitHubSettingsPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [pat, setPat] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [indexed, setIndexed] = useState<IndexedRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [indexing, setIndexing] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  async function checkConnection() {
    const r = await fetch("/api/github/connect");
    const d = await r.json();
    setConnected(d.connected ?? false);
    if (d.connected) loadRepos();
  }

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      const r = await fetch("/api/github/repos");
      const d = await r.json();
      setRepos(d.repos ?? []);
      setIndexed(d.indexed ?? []);
    } catch { /* ignore */ }
    finally { setLoadingRepos(false); }
  }

  useEffect(() => { checkConnection(); }, []);

  async function connect() {
    if (!pat.trim()) return;
    setConnecting(true);
    setConnectError("");
    try {
      const r = await fetch("/api/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: pat.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setConnectError(d.error ?? "Connection failed"); return; }
      setConnected(true);
      setPat("");
      loadRepos();
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect GitHub? Your indexed repos will be removed.")) return;
    await fetch("/api/github/connect", { method: "DELETE" });
    setConnected(false);
    setRepos([]);
    setIndexed([]);
  }

  async function indexRepo(repo: GithubRepo) {
    setIndexing((prev) => ({ ...prev, [repo.full_name]: true }));
    try {
      const r = await fetch("/api/github/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: repo.full_name, defaultBranch: repo.default_branch }),
      });
      const d = await r.json();
      if (!r.ok) alert(d.error ?? "Indexing failed");
    } finally {
      setIndexing((prev) => ({ ...prev, [repo.full_name]: false }));
      loadRepos();
    }
  }

  async function removeIndex(repoId: string) {
    if (!confirm("Remove this repo from ENGRAM? The index will be deleted.")) return;
    await fetch("/api/github/index", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId }),
    });
    loadRepos();
  }

  const indexedNames = new Set(indexed.map((r) => r.repo_full_name));
  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );
  const displayRepos = showAll ? filteredRepos : filteredRepos.slice(0, 10);

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">integration</p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text flex items-center gap-3">
          <Github className="h-7 w-7" />
          GitHub
        </h1>
        <p className="text-sm text-gh-muted mt-1">
          Index your GitHub repositories so ENGRAM can answer questions about your codebase.
        </p>
      </motion.div>

      {connected === null ? (
        <div className="h-20 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />
      ) : !connected ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-lg border border-gh-border bg-gh-canvas p-6">
          <h2 className="text-base font-semibold text-gh-text mb-4">Connect GitHub</h2>
          <div className="mb-4 p-3 rounded-md bg-gh-bg border border-gh-border text-xs text-gh-muted leading-relaxed">
            <p className="font-medium text-gh-text mb-1">You need a Personal Access Token (PAT)</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener" className="text-engram-light hover:underline">github.com/settings/tokens/new</a></li>
              <li>Select <strong className="text-gh-text">repo</strong> scope (for private repos) or <strong className="text-gh-text">public_repo</strong> for public only</li>
              <li>Copy the token and paste it below</li>
            </ol>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="flex-1 bg-gh-bg border border-gh-border rounded-md px-3 py-2 text-sm text-gh-text placeholder:text-gh-muted/50 font-mono focus:outline-none focus:border-engram"
            />
            <button
              onClick={connect}
              disabled={connecting || !pat.trim()}
              className="px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </div>
          {connectError && (
            <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />{connectError}
            </p>
          )}
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="flex items-center justify-between mb-6 p-4 rounded-lg border border-green-500/20 bg-green-500/5">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <Check className="h-4 w-4" />
              GitHub connected
            </div>
            <button onClick={disconnect} className="text-xs text-gh-muted hover:text-red-400 flex items-center gap-1 transition-colors">
              <X className="h-3.5 w-3.5" />Disconnect
            </button>
          </div>

          {indexed.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted mb-3">Indexed Repositories</h2>
              <div className="space-y-2">
                {indexed.map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between p-3 rounded-lg border border-gh-border bg-gh-canvas">
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-4 w-4 text-gh-muted shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-gh-text">{repo.repo_full_name}</div>
                        <div className={cn("text-xs", STATUS_COLOR[repo.status])}>
                          {repo.status === "indexed"
                            ? `${repo.file_count} files · ${repo.chunk_count} chunks · ${repo.indexed_at ? new Date(repo.indexed_at).toLocaleDateString() : ""}`
                            : repo.status === "error"
                            ? `Error: ${repo.error_message ?? "unknown"}`
                            : repo.status}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const r = repos.find((rr) => rr.full_name === repo.repo_full_name);
                          if (r) indexRepo(r);
                        }}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors"
                        title="Re-index"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeIndex(repo.id)}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-red-400 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
                Your Repositories {loadingRepos ? "(loading…)" : `(${repos.length})`}
              </h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search repos…"
                className="bg-gh-bg border border-gh-border rounded px-2 py-1 text-xs text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram w-40"
              />
            </div>

            <div className="space-y-2">
              {displayRepos.map((repo) => {
                const isIndexed = indexedNames.has(repo.full_name);
                const isLoading = indexing[repo.full_name];
                return (
                  <div key={repo.full_name} className="flex items-center justify-between p-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {repo.private
                        ? <Lock className="h-3.5 w-3.5 text-gh-muted shrink-0" />
                        : <Globe className="h-3.5 w-3.5 text-gh-muted shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gh-text truncate">{repo.full_name}</div>
                        {repo.description && (
                          <div className="text-xs text-gh-muted truncate">{repo.description}</div>
                        )}
                      </div>
                    </div>
                    {isIndexed ? (
                      <span className="text-xs text-green-400 flex items-center gap-1 shrink-0">
                        <Check className="h-3.5 w-3.5" />Indexed
                      </span>
                    ) : (
                      <button
                        onClick={() => indexRepo(repo)}
                        disabled={isLoading}
                        className="shrink-0 text-xs px-3 py-1.5 rounded-md border border-gh-border bg-gh-bg hover:border-engram/40 hover:text-engram-light text-gh-muted transition-colors disabled:opacity-50"
                      >
                        {isLoading ? "Indexing…" : "Index"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {filteredRepos.length > 10 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="mt-3 flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors mx-auto"
              >
                {showAll ? <><ChevronUp className="h-3.5 w-3.5" />Show less</> : <><ChevronDown className="h-3.5 w-3.5" />Show all {filteredRepos.length} repos</>}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
