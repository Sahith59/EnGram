"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Github, Check, X, RefreshCw, Trash2, BookOpen,
  Lock, Globe, AlertCircle, ChevronRight,
  Square, CheckSquare, Loader2, Search, Layers,
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

// ── Step indicator ────────────────────────────────────────────────────────────
function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
        done ? "bg-green-500 text-white" : active ? "bg-engram text-white" : "bg-gh-border text-gh-muted"
      )}>
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </div>
      <span className={cn("text-xs font-medium", active ? "text-gh-text" : "text-gh-muted")}>{label}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function GitHubSettingsPage() {
  // Connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [pat, setPat] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Repo data
  const [allRepos, setAllRepos] = useState<GithubRepo[]>([]);
  const [indexed, setIndexed] = useState<IndexedRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Selection state (shown after first connect or when adding more repos)
  const [step, setStep] = useState<"connect" | "select" | "manage">("connect");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [filterPrivate, setFilterPrivate] = useState<"all" | "public" | "private">("all");

  // Bulk-index state
  const [indexingBulk, setIndexingBulk] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [individualIndexing, setIndividualIndexing] = useState<Record<string, boolean>>({});

  // ── Load state ──────────────────────────────────────────────────────────────
  async function checkConnection() {
    const r = await fetch("/api/github/connect");
    const d = await r.json();
    setConnected(d.connected ?? false);
    setGithubLogin(d.login ?? null);
    if (d.connected) {
      await loadRepos();
      setStep("manage");
    }
  }

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      const r = await fetch("/api/github/repos");
      const d = await r.json();
      setAllRepos(d.repos ?? []);
      setIndexed(d.indexed ?? []);
    } catch { /* ignore */ }
    finally { setLoadingRepos(false); }
  }

  useEffect(() => { checkConnection(); }, []);

  // ── Connect ─────────────────────────────────────────────────────────────────
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
      setGithubLogin(d.login ?? null);
      setPat("");
      setLoadingRepos(true);
      const r2 = await fetch("/api/github/repos");
      const d2 = await r2.json();
      setAllRepos(d2.repos ?? []);
      setIndexed(d2.indexed ?? []);
      setLoadingRepos(false);
      setStep("select"); // → go to repo selection
    } finally {
      setConnecting(false);
    }
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────
  async function disconnect() {
    if (!confirm("Disconnect GitHub? Your indexed repos will be removed from ENGRAM.")) return;
    await fetch("/api/github/connect", { method: "DELETE" });
    setConnected(false);
    setGithubLogin(null);
    setAllRepos([]);
    setIndexed([]);
    setSelected(new Set());
    setStep("connect");
  }

  // ── Selection helpers ────────────────────────────────────────────────────────
  const indexedNames = useMemo(() => new Set(indexed.map((r) => r.repo_full_name)), [indexed]);

  const availableRepos = useMemo(() =>
    allRepos.filter((r) => !indexedNames.has(r.full_name)), [allRepos, indexedNames]);

  const filteredAvailable = useMemo(() => {
    return availableRepos.filter((r) => {
      const matchSearch = r.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (r.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filterPrivate === "all" ? true :
        filterPrivate === "private" ? r.private :
        !r.private;
      return matchSearch && matchFilter;
    });
  }, [availableRepos, search, filterPrivate]);

  const allFilteredSelected = filteredAvailable.length > 0 &&
    filteredAvailable.every((r) => selected.has(r.full_name));

  function toggleRepo(fullName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(fullName) ? next.delete(fullName) : next.add(fullName);
      return next;
    });
  }

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredAvailable.forEach((r) => next.delete(r.full_name));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredAvailable.forEach((r) => next.add(r.full_name));
        return next;
      });
    }
  }

  // ── Bulk index selected repos ────────────────────────────────────────────────
  async function indexSelected() {
    const toIndex = allRepos.filter((r) => selected.has(r.full_name));
    if (!toIndex.length) return;
    setIndexingBulk(true);
    setIndexProgress({ done: 0, total: toIndex.length });
    for (let i = 0; i < toIndex.length; i++) {
      const repo = toIndex[i];
      try {
        await fetch("/api/github/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoFullName: repo.full_name, defaultBranch: repo.default_branch }),
        });
      } catch { /* continue */ }
      setIndexProgress({ done: i + 1, total: toIndex.length });
    }
    setIndexingBulk(false);
    setIndexProgress(null);
    setSelected(new Set());
    await loadRepos();
    setStep("manage");
  }

  // ── Individual re-index / remove ────────────────────────────────────────────
  async function reindexRepo(repo_full_name: string) {
    const r = allRepos.find((r) => r.full_name === repo_full_name);
    if (!r) return;
    setIndividualIndexing((p) => ({ ...p, [repo_full_name]: true }));
    try {
      await fetch("/api/github/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoFullName: r.full_name, defaultBranch: r.default_branch }),
      });
      await loadRepos();
    } finally {
      setIndividualIndexing((p) => ({ ...p, [repo_full_name]: false }));
    }
  }

  async function removeIndex(repoId: string) {
    if (!confirm("Remove this repo from ENGRAM? The index will be deleted.")) return;
    await fetch("/api/github/index", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId }),
    });
    await loadRepos();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">integration</p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text flex items-center gap-3">
          <Github className="h-7 w-7" />
          GitHub
        </h1>
        <p className="text-sm text-gh-muted mt-1">
          Index your GitHub repositories so ENGRAM can answer questions about your codebase.
        </p>
      </motion.div>

      {/* Step indicator (only when going through the flow) */}
      {(step === "connect" || step === "select") && (
        <div className="flex items-center gap-3 mb-6">
          <Step n={1} label="Connect account" active={step === "connect"} done={step !== "connect"} />
          <ChevronRight className="h-3.5 w-3.5 text-gh-border" />
          <Step n={2} label="Select repositories" active={step === "select"} done={false} />
        </div>
      )}

      {/* Loading skeleton */}
      {connected === null && (
        <div className="h-32 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />
      )}

      <AnimatePresence mode="wait">
        {/* ── STEP 1: Connect ──────────────────────────────────────────────── */}
        {connected === false && step === "connect" && (
          <motion.div key="connect" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-lg border border-gh-border bg-gh-canvas p-6">
            <h2 className="text-base font-semibold text-gh-text mb-4">Connect GitHub</h2>
            <div className="mb-4 p-3 rounded-md bg-gh-bg border border-gh-border text-xs text-gh-muted leading-relaxed">
              <p className="font-medium text-gh-text mb-1">You need a Personal Access Token (PAT)</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Go to{" "}
                  <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener"
                    className="text-engram-light hover:underline">
                    github.com/settings/tokens/new
                  </a>
                </li>
                <li>Select <strong className="text-gh-text">repo</strong> scope (private repos) or{" "}
                  <strong className="text-gh-text">public_repo</strong> for public only</li>
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
                className="px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
            {connectError && (
              <p className="mt-2 text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />{connectError}
              </p>
            )}
          </motion.div>
        )}

        {/* ── STEP 2: Select repos ─────────────────────────────────────────── */}
        {connected && step === "select" && (
          <motion.div key="select" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {/* Account banner */}
            <div className="flex items-center justify-between mb-4 p-3 rounded-lg border border-green-500/20 bg-green-500/5">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <Check className="h-4 w-4" />
                Connected as <strong className="text-green-300">{githubLogin ?? "GitHub user"}</strong>
              </div>
              <button onClick={disconnect} className="text-xs text-gh-muted hover:text-red-400 flex items-center gap-1 transition-colors">
                <X className="h-3.5 w-3.5" />Disconnect
              </button>
            </div>

            <div className="rounded-lg border border-gh-border bg-gh-canvas p-5">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h2 className="text-base font-semibold text-gh-text">Select repositories</h2>
                  <p className="text-xs text-gh-muted mt-0.5">
                    Choose which repos ENGRAM can access and answer questions about.
                  </p>
                </div>
                {selected.size > 0 && (
                  <span className="text-xs bg-engram/20 text-engram-light rounded-full px-2 py-0.5 font-medium">
                    {selected.size} selected
                  </span>
                )}
              </div>

              {/* Search + filter bar */}
              <div className="flex gap-2 mt-4 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gh-muted" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search repositories…"
                    className="w-full pl-8 pr-3 py-1.5 bg-gh-bg border border-gh-border rounded-md text-xs text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram"
                  />
                </div>
                <div className="flex rounded-md border border-gh-border overflow-hidden text-xs">
                  {(["all", "public", "private"] as const).map((f) => (
                    <button key={f} onClick={() => setFilterPrivate(f)}
                      className={cn("px-2.5 py-1.5 capitalize transition-colors",
                        filterPrivate === f ? "bg-engram text-white" : "bg-gh-bg text-gh-muted hover:text-gh-text")}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Select all row */}
              {filteredAvailable.length > 0 && (
                <button onClick={toggleAll}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md mb-1 border border-gh-border bg-gh-bg hover:border-engram/40 transition-colors group">
                  <div className={cn("h-4 w-4 rounded border flex items-center justify-center transition-colors",
                    allFilteredSelected ? "bg-engram border-engram" : "border-gh-border group-hover:border-engram/50")}>
                    {allFilteredSelected && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-gh-muted" />
                    <span className="text-xs font-medium text-gh-text">
                      {allFilteredSelected ? "Deselect all" : `Select all ${filteredAvailable.length} repos`}
                    </span>
                  </div>
                </button>
              )}

              {/* Repo list */}
              {loadingRepos ? (
                <div className="flex items-center justify-center h-24 text-gh-muted text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading repositories…
                </div>
              ) : filteredAvailable.length === 0 ? (
                <div className="text-center py-8 text-sm text-gh-muted">
                  {allRepos.length === 0 ? "No repositories found on your account." : "No repos match the current filter."}
                </div>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {filteredAvailable.map((repo) => {
                    const isSelected = selected.has(repo.full_name);
                    return (
                      <button key={repo.full_name} onClick={() => toggleRepo(repo.full_name)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors text-left",
                          isSelected
                            ? "border-engram/50 bg-engram/5"
                            : "border-gh-border bg-gh-canvas hover:border-engram/30"
                        )}>
                        <div className={cn("h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                          isSelected ? "bg-engram border-engram" : "border-gh-border")}>
                          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {repo.private
                              ? <Lock className="h-3 w-3 text-gh-muted shrink-0" />
                              : <Globe className="h-3 w-3 text-gh-muted shrink-0" />}
                            <span className="text-sm font-medium text-gh-text truncate">{repo.full_name}</span>
                          </div>
                          {repo.description && (
                            <p className="text-xs text-gh-muted truncate mt-0.5">{repo.description}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Action row */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gh-border">
                <button onClick={() => setStep("manage")}
                  className="text-xs text-gh-muted hover:text-gh-text transition-colors">
                  Skip for now →
                </button>
                <button
                  onClick={indexSelected}
                  disabled={selected.size === 0 || indexingBulk}
                  className="px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {indexingBulk
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Indexing {indexProgress?.done}/{indexProgress?.total}…</>
                    : <>
                        <BookOpen className="h-3.5 w-3.5" />
                        Index {selected.size} repo{selected.size !== 1 ? "s" : ""}
                      </>}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: Manage indexed repos ─────────────────────────────────── */}
        {connected && step === "manage" && (
          <motion.div key="manage" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {/* Account banner */}
            <div className="flex items-center justify-between mb-6 p-3 rounded-lg border border-green-500/20 bg-green-500/5">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <Check className="h-4 w-4" />
                Connected as <strong className="text-green-300">{githubLogin ?? "GitHub user"}</strong>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setSelected(new Set()); setStep("select"); }}
                  className="text-xs text-engram-light hover:text-engram flex items-center gap-1 transition-colors"
                >
                  + Add more repos
                </button>
                <button onClick={disconnect} className="text-xs text-gh-muted hover:text-red-400 flex items-center gap-1 transition-colors">
                  <X className="h-3.5 w-3.5" />Disconnect
                </button>
              </div>
            </div>

            {/* Indexed repos */}
            {indexed.length === 0 ? (
              <div className="text-center py-12 rounded-lg border border-dashed border-gh-border">
                <BookOpen className="h-8 w-8 text-gh-muted mx-auto mb-3" />
                <p className="text-sm font-medium text-gh-text mb-1">No repos indexed yet</p>
                <p className="text-xs text-gh-muted mb-4">Select repositories to let ENGRAM answer questions about your code.</p>
                <button
                  onClick={() => { setSelected(new Set()); setStep("select"); }}
                  className="px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 transition-colors"
                >
                  Select repositories
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
                    Indexed Repositories ({indexed.length})
                  </h2>
                  <button onClick={loadRepos} className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors" title="Refresh">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-2">
                  {indexed.map((repo) => {
                    const isReindexing = individualIndexing[repo.repo_full_name];
                    return (
                      <div key={repo.id} className={cn(
                        "flex items-center justify-between p-3.5 rounded-lg border transition-colors",
                        repo.status === "error"
                          ? "border-red-500/20 bg-red-500/5"
                          : repo.status === "indexing"
                          ? "border-amber-500/20 bg-amber-500/5"
                          : "border-gh-border bg-gh-canvas"
                      )}>
                        <div className="flex items-center gap-3 min-w-0">
                          <BookOpen className="h-4 w-4 text-gh-muted shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gh-text truncate">{repo.repo_full_name}</div>
                            <div className={cn("text-xs mt-0.5", {
                              "text-green-400": repo.status === "indexed",
                              "text-amber-400": repo.status === "indexing",
                              "text-red-400":   repo.status === "error",
                              "text-gh-muted":  repo.status === "pending",
                            })}>
                              {repo.status === "indexed"
                                ? `${repo.file_count.toLocaleString()} files · ${repo.chunk_count.toLocaleString()} chunks · last indexed ${repo.indexed_at ? new Date(repo.indexed_at).toLocaleDateString() : "—"}`
                                : repo.status === "indexing"
                                ? "Indexing in progress…"
                                : repo.status === "error"
                                ? `Error: ${repo.error_message ?? "unknown"}`
                                : "Pending"}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => reindexRepo(repo.repo_full_name)}
                            disabled={isReindexing}
                            className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors disabled:opacity-50"
                            title="Re-index"
                          >
                            {isReindexing
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <RefreshCw className="h-3.5 w-3.5" />}
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
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
