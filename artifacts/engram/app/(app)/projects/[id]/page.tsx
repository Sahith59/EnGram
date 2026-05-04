"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderGit2, ArrowLeft, Github, Lock, Globe, Users, BookOpen,
  GitCommit, MessageSquare, Sparkles, ExternalLink, Clock,
  Crown, UserPlus, Trash2, Copy, Check, Send, Loader2,
  ChevronRight, X, GitBranch, Shield, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, Zap, RefreshCw, Archive,
  Target, FileCode, History, AlertCircle, Info, ChevronUp,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────── */
type Repo = {
  id: string; repo_full_name: string; repo_name: string; owner_login: string;
  file_count: number; chunk_count: number; is_private: boolean;
  indexed_at: string | null; default_branch: string | null;
  last_indexed_commit: string | null;
  provider: "github" | "gitlab" | null;
};
type MemberProfile = { id: string; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string | null };
type Member = { id: string; user_id: string; role: string; joined_at: string; profile: MemberProfile | null; is_self: boolean };
type SnapshotSemanticLink = { commit_sha: string; committed_at: string | null };
type Snapshot = {
  id: string; title: string; summary: string | null; ai_tool: string;
  tags: string[]; decision: string | null; created_at: string;
  visibility: string; author_handle: string | null;
  semantic_links?: SnapshotSemanticLink[];
};
type Project = {
  id: string; name: string; description: string | null;
  snapshot_count: number; created_at: string; updated_at: string;
  github_repo_id: string | null; repo: Repo | null;
  member_count: number; is_owner: boolean; is_member: boolean;
  created_by: string | null;
  is_archived: boolean;
  is_dormant: boolean;
  last_capture_at: string | null;
  days_since_capture: number | null;
};
type AskSource = { type: "snapshot" | "github"; title: string; excerpt: string; tool?: string; path?: string; language?: string };

/* ─── Brief types ────────────────────────────────────────── */
type ClaimType = "decision" | "constraint" | "next_step" | "technology" | "dead_end" | "observation";
type ClaimStatus = "active" | "superseded" | "abandoned" | "conflicted";

interface TrustyClaim {
  id: string;
  claim_text: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  confidence_score: number;
  is_stale: boolean;
  reinforcement_count: number;
  first_seen_at: string;
  last_seen_at: string;
  snapshot_id: string;
  snapshot_title: string | null;
}

interface ConflictSummary {
  id: string;
  claim_a: TrustyClaim;
  claim_b: TrustyClaim;
}

interface CodeAnchor {
  file_path: string;
  language: string | null;
  snippet: string;
  similarity: number;
}

interface ProjectBrief {
  project_id: string;
  project_name: string;
  generated_at: string;
  capture_count: number;
  claim_count: number;
  unresolved_conflict_count: number;
  categories: {
    decision: TrustyClaim[];
    constraint: TrustyClaim[];
    next_step: TrustyClaim[];
    technology: TrustyClaim[];
    dead_end: TrustyClaim[];
    observation: TrustyClaim[];
  };
  conflicts: ConflictSummary[];
  code_context: CodeAnchor[];  // F-09: code anchors from linked repo
  injection: { full: string; medium: string; compact: string };
  token_estimates: { full: number; medium: number; compact: number };
}

/* ─── Helpers ────────────────────────────────────────────── */
const TOOL_LABEL: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", other: "Other" };
const TOOL_DOT: Record<string, string> = { chatgpt: "bg-tool-chatgpt", claude: "bg-tool-claude", gemini: "bg-tool-gemini", other: "bg-gh-muted" };
const TOOL_TEXT: Record<string, string> = { chatgpt: "text-tool-chatgpt", claude: "text-tool-claude", gemini: "text-tool-gemini" };

type Tab = "feed" | "ask" | "brief" | "commits" | "blast" | "members";

/* ── F-13: Archive/Unarchive buttons ────────────────────── */
function ArchiveButton({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  async function handleArchive() {
    if (!confirm("Archive this project? It will stop receiving new captures and be hidden from routing.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/archive`, { method: "POST" });
      if (res.ok) onDone();
    } finally { setLoading(false); }
  }
  return (
    <button onClick={handleArchive} disabled={loading}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-gh-border text-gh-muted hover:text-gh-text hover:border-gh-muted/60 transition-colors disabled:opacity-50">
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
      Archive
    </button>
  );
}

function UnarchiveButton({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  async function handleUnarchive() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/archive`, { method: "DELETE" });
      if (res.ok) onDone();
    } finally { setLoading(false); }
  }
  return (
    <button onClick={handleUnarchive} disabled={loading}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-gh-border text-gh-muted hover:text-gh-text hover:border-gh-muted/60 transition-colors disabled:opacity-50">
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
      Unarchive
    </button>
  );
}

/* ══════════════════════════════════════════════════════════ */
export default function ProjectWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.id as string;

  const initialTab = (searchParams.get("tab") as Tab) ?? "feed";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedCommitSha, setFocusedCommitSha] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) { router.push("/projects"); return; }
      const d = await r.json();
      setProject(d.project);
      setSnapshots(d.snapshots ?? []);
      setMembers(d.members ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab;
    if (tab) setActiveTab(tab);
  }, [searchParams]);

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  }

  if (loading) return <LoadingSkeleton />;
  if (!project) return null;

  const repo = project.repo;

  return (
    <div className="min-h-screen">
      {/* ── Project Header ───────────────────────────────── */}
      <div className="border-b border-gh-border bg-gh-bg sticky top-0 z-20">
        <div className="px-6 md:px-10 py-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-gh-muted mb-3">
            <Link href="/projects" className="flex items-center gap-1 hover:text-gh-text transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />Projects
            </Link>
            <ChevronRight className="h-3 w-3 text-gh-border" />
            <span className="text-gh-text font-medium">{project.name}</span>
            {repo?.is_private
              ? <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-gh-border text-gh-muted ml-1"><Lock className="h-2.5 w-2.5" />Private</span>
              : repo && <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-gh-border text-gh-muted ml-1"><Globe className="h-2.5 w-2.5" />Public</span>}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center border shrink-0",
                repo ? "bg-gh-canvas border-gh-border" : "bg-engram/10 border-engram/20")}>
                {repo ? <Github className="h-5 w-5 text-gh-text" /> : <FolderGit2 className="h-5 w-5 text-engram-light" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-gh-text">{project.name}</h1>
                  {repo && (
                    <a href={`https://github.com/${repo.repo_full_name}`} target="_blank" rel="noopener"
                      className="flex items-center gap-1 text-xs text-gh-muted hover:text-engram-light transition-colors">
                      <ExternalLink className="h-3 w-3" />{repo.repo_full_name}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gh-muted">
                  {repo && (
                    <>
                      <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{repo.default_branch ?? "main"}</span>
                      <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{repo.file_count.toLocaleString()} files</span>
                      {repo.last_indexed_commit ? (
                        <span className="flex items-center gap-1 text-green-400/80" title={`AST indexed at commit ${repo.last_indexed_commit}`}>
                          <GitCommit className="h-3 w-3" />AST @ {repo.last_indexed_commit.slice(0, 7)}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-yellow-400/70" title="First AST indexing in progress — push a commit to trigger">
                          <Loader2 className="h-3 w-3 animate-spin" />Indexing…
                        </span>
                      )}
                    </>
                  )}
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{project.member_count} member{project.member_count !== 1 ? "s" : ""}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{project.snapshot_count} capture{project.snapshot_count !== 1 ? "s" : ""}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ──────────────────────────────────────── */}
          <div className="flex items-center gap-1 mt-4 -mb-px">
            {(["feed", "ask", "brief", "commits", "blast", "members"] as Tab[]).map((tab) => {
              const hidden = ((tab === "commits" || tab === "blast") && !project.github_repo_id);
              if (hidden) return null;
              return (
                <button key={tab}
                  onClick={() => switchTab(tab)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                    activeTab === tab
                      ? "border-engram text-gh-text"
                      : "border-transparent text-gh-muted hover:text-gh-text hover:border-gh-border"
                  )}>
                  {tab === "feed" && <MessageSquare className="h-3.5 w-3.5" />}
                  {tab === "ask" && <Sparkles className="h-3.5 w-3.5" />}
                  {tab === "brief" && <Shield className="h-3.5 w-3.5" />}
                  {tab === "commits" && <GitCommit className="h-3.5 w-3.5" />}
                  {tab === "blast" && <Target className="h-3.5 w-3.5" />}
                  {tab === "members" && <Users className="h-3.5 w-3.5" />}
                  {tab === "brief" ? "Trust Brief" : tab === "commits" ? "Commits" : tab === "blast" ? "Blast Radius" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab === "feed" && snapshots.length > 0 && (
                    <span className="text-[10px] bg-gh-canvas border border-gh-border px-1.5 rounded-full text-gh-muted">
                      {snapshots.length}
                    </span>
                  )}
                  {tab === "members" && members.length > 0 && (
                    <span className="text-[10px] bg-gh-canvas border border-gh-border px-1.5 rounded-full text-gh-muted">
                      {members.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── F-13: Dormant / Archived banner ─────────────── */}
      {(project.is_archived || project.is_dormant) && (
        <div className={cn(
          "border-b px-6 md:px-10 py-3 max-w-6xl mx-auto",
          project.is_archived
            ? "bg-gh-bg border-gh-border"
            : "bg-amber-500/5 border-amber-500/15"
        )}>
          <div className="flex items-center gap-3">
            {project.is_archived ? (
              <>
                <Archive className="h-4 w-4 text-gh-muted shrink-0" />
                <p className="text-sm text-gh-muted flex-1">
                  This project is archived. It won&apos;t receive new captures or appear in routing.
                </p>
                {project.is_owner && (
                  <UnarchiveButton projectId={project.id} onDone={load} />
                )}
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-sm text-gh-muted flex-1">
                  <span className="text-amber-400 font-medium">Dormant</span>
                  {project.days_since_capture != null
                    ? ` — no captures in ${project.days_since_capture} days.`
                    : " — no captures yet."}
                  {" "}Archive to exclude from routing.
                </p>
                {project.is_owner && (
                  <ArchiveButton projectId={project.id} onDone={load} />
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Tab Content ─────────────────────────────────── */}
      <div className="px-6 md:px-10 py-8 max-w-6xl mx-auto">
        <AnimatePresence mode="wait">
          {activeTab === "feed" && (
            <motion.div key="feed" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <FeedTab snapshots={snapshots} projectName={project.name} projectId={projectId} onGoToCommit={(sha) => { setFocusedCommitSha(sha); switchTab("commits"); }} />
            </motion.div>
          )}
          {activeTab === "ask" && (
            <motion.div key="ask" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <AskTab projectId={projectId} projectName={project.name} hasRepo={!!project.github_repo_id} />
            </motion.div>
          )}
          {activeTab === "brief" && (
            <motion.div key="brief" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <BriefTab projectId={projectId} projectName={project.name} captureCount={project.snapshot_count} />
            </motion.div>
          )}
          {activeTab === "commits" && project.github_repo_id && (
            <motion.div key="commits" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <CommitsTab
                projectId={projectId}
                snapshots={snapshots}
                focusedCommitSha={focusedCommitSha}
                onFocusHandled={() => setFocusedCommitSha(null)}
              />
            </motion.div>
          )}
          {activeTab === "blast" && project.github_repo_id && (
            <motion.div key="blast" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <BlastRadiusTab projectId={projectId} />
            </motion.div>
          )}
          {activeTab === "members" && (
            <motion.div key="members" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <MembersTab
                projectId={projectId} members={members}
                isOwner={project.is_owner} onRefresh={load}
                repo={project.repo}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   FEED TAB — conversation timeline
══════════════════════════════════════════════════════════ */
function FeedTab({ snapshots, projectName, projectId, onGoToCommit }: {
  snapshots: Snapshot[]; projectName: string; projectId: string;
  onGoToCommit?: (sha: string) => void;
}) {
  const [linkingSnap, setLinkingSnap] = useState<string | null>(null);

  if (snapshots.length === 0) {
    return (
      <div className="text-center py-20">
        <MessageSquare className="h-12 w-12 text-gh-muted/30 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gh-text mb-2">No conversations yet</h3>
        <p className="text-sm text-gh-muted max-w-sm mx-auto">
          When you or your teammates capture AI conversations and tag them to <strong>{projectName}</strong>,
          they'll appear here in a shared timeline.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
          Session Timeline — {snapshots.length} capture{snapshots.length !== 1 ? "s" : ""}
        </h2>
      </div>
      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gh-border" />
        <div className="space-y-3 pl-6">
          {snapshots.map((snap, i) => {
            const links = snap.semantic_links ?? [];
            const topLink = links[0] ?? null;
            return (
              <motion.div key={snap.id}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                className="relative">
                <div className="absolute -left-6 top-4 flex items-center justify-center">
                  <div className={cn("h-3.5 w-3.5 rounded-full border-2 border-gh-bg", TOOL_DOT[snap.ai_tool] ?? "bg-gh-muted")} />
                </div>
                <div className="rounded-lg border border-gh-border bg-gh-canvas p-4 hover:border-engram/40 transition-colors group">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={cn("text-[10px] font-mono uppercase tracking-wider", TOOL_TEXT[snap.ai_tool] ?? "text-gh-muted")}>
                          {TOOL_LABEL[snap.ai_tool] ?? snap.ai_tool}
                        </span>
                        <span className="text-[10px] text-gh-muted">
                          {new Date(snap.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        {snap.author_handle && (
                          <span className="text-[10px] text-gh-muted flex items-center gap-1">
                            · <Users className="h-2.5 w-2.5" />{snap.author_handle}
                          </span>
                        )}
                        {snap.visibility === "team" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-gh-muted">team</span>
                        )}
                        {/* ── Commit badge ── */}
                        {topLink && (
                          <button
                            onClick={() => onGoToCommit?.(topLink.commit_sha)}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-engram/10 border border-engram/25 text-engram-light hover:bg-engram/20 transition-colors font-mono">
                            <GitCommit className="h-2.5 w-2.5" />
                            → {topLink.commit_sha.slice(0, 7)}
                            {links.length > 1 && <span className="ml-0.5 text-engram-light/70">+{links.length - 1}</span>}
                          </button>
                        )}
                      </div>
                      <h3 className="font-medium text-gh-text text-sm mb-1 leading-snug">{snap.title}</h3>
                      {snap.summary && <p className="text-xs text-gh-muted leading-relaxed line-clamp-2">{snap.summary}</p>}
                      {snap.decision && (
                        <div className="mt-2 flex items-start gap-1.5">
                          <span className="text-[10px] font-mono text-engram-light shrink-0 mt-0.5">DECISION</span>
                          <p className="text-xs text-gh-muted line-clamp-1">{snap.decision}</p>
                        </div>
                      )}
                      {snap.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {snap.tags.slice(0, 5).map((tag) => (
                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-gh-muted">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* ··· menu */}
                      <button
                        onClick={() => setLinkingSnap(snap.id)}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100"
                        title="Link to commit">
                        <GitCommit className="h-3.5 w-3.5" />
                      </button>
                      <Link href={`/context/${snap.id}`}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Manual link modal: link a snapshot to a commit SHA */}
      {linkingSnap && (
        <CommitLinkModal
          projectId={projectId}
          snapshotId={linkingSnap}
          snapshotTitle={snapshots.find((s) => s.id === linkingSnap)?.title ?? ""}
          onClose={() => setLinkingSnap(null)}
        />
      )}
    </div>
  );
}

/* ── CommitLinkModal ────────────────────────────────────── */
function CommitLinkModal({ projectId, snapshotId, snapshotTitle, onClose }: {
  projectId: string; snapshotId: string; snapshotTitle: string; onClose: () => void;
}) {
  const [sha, setSha] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    const trimmed = sha.trim();
    if (!trimmed) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/commits/${trimmed}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: snapshotId }),
      });
      if (!r.ok) { const d = await r.json(); setError(d.error ?? "Failed"); return; }
      setDone(true);
      setTimeout(onClose, 1200);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bg-gh-canvas border border-gh-border rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gh-text">Link to commit</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gh-bg text-gh-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-gh-muted mb-3 truncate">Linking: <span className="text-gh-text">{snapshotTitle}</span></p>
        <input
          value={sha}
          onChange={(e) => setSha(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
          placeholder="Commit SHA (full or short)"
          className="w-full bg-gh-bg border border-gh-border rounded-lg px-3 py-2 text-sm font-mono text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram mb-3"
          autoFocus
        />
        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        {done && <p className="text-xs text-green-400 mb-2">Linked successfully!</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-gh-border text-gh-muted text-sm hover:text-gh-text transition-colors">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !sha.trim() || done}
            className="flex-1 py-2 rounded-lg bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {done ? "Done!" : "Link"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   COMMITS TAB — recent commits + semantic links
══════════════════════════════════════════════════════════ */

interface DiffFile {
  filename:  string;
  status:    string;
  additions: number;
  deletions: number;
  patch:     string | null;
}

interface CommitRow {
  sha: string;
  sha_short: string;
  message: string;
  author: string;
  timestamp: string;
  files_changed: number;
  linked_conversations: number;
  linked_snapshot_ids: string[];
  top_similarity: number;
}

interface IntentResult {
  commit_sha: string;
  intent_summary: string | null;
  linked_snapshots: Array<{
    link_id: string;
    snapshot_id: string;
    similarity: number;
    is_manual: boolean;
    linked_files: string[];
    snapshot: { id: string; title: string; summary: string | null; decision: string | null; created_at: string; ai_tool: string } | null;
  }>;
}

function CommitsTab({ projectId, snapshots, focusedCommitSha, onFocusHandled }: {
  projectId: string;
  snapshots: Snapshot[];
  focusedCommitSha?: string | null;
  onFocusHandled?: () => void;
}) {
  const [commits, setCommits] = useState<CommitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSha, setExpandedSha] = useState<string | null>(null);
  const [intentMap, setIntentMap] = useState<Record<string, IntentResult>>({});
  const [intentLoading, setIntentLoading] = useState<string | null>(null);
  const [linkModalCommit, setLinkModalCommit] = useState<CommitRow | null>(null);
  const [repoFullName, setRepoFullName] = useState<string>("");
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const commitRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [diffMap, setDiffMap] = useState<Record<string, DiffFile[]>>({});
  const [diffLoading, setDiffLoading] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<Record<string, boolean>>({});

  async function loadCommits() {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/commits`);
      if (r.ok) {
        const d = await r.json();
        setCommits(d.commits ?? []);
        setRepoFullName(d.repo_full_name ?? "");
        setProvider(d.provider ?? "github");
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { loadCommits(); }, [projectId]);

  // Auto-expand and scroll to focused commit (from feed badge click)
  useEffect(() => {
    if (!focusedCommitSha || loading) return;
    // Find matching commit (full SHA or short SHA)
    const match = commits.find(
      (c) => c.sha === focusedCommitSha || c.sha.startsWith(focusedCommitSha) || c.sha_short === focusedCommitSha
    );
    if (!match) return;
    setExpandedSha(match.sha);
    loadIntent(match.sha);
    setTimeout(() => {
      commitRefs.current[match.sha]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    onFocusHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCommitSha, loading, commits]);

  async function loadIntent(sha: string) {
    if (intentMap[sha]) return;
    setIntentLoading(sha);
    try {
      const r = await fetch(`/api/projects/${projectId}/commits/${sha}/intent`);
      if (r.ok) {
        const d = await r.json();
        setIntentMap((prev) => ({ ...prev, [sha]: d }));
      }
    } finally { setIntentLoading(null); }
  }

  function toggleExpand(sha: string) {
    if (expandedSha === sha) {
      setExpandedSha(null);
    } else {
      setExpandedSha(sha);
      loadIntent(sha);
    }
  }

  async function loadDiff(sha: string) {
    if (diffMap[sha]) return;
    setDiffLoading(sha);
    try {
      const r = await fetch(`/api/projects/${projectId}/commits/${sha}/diff`);
      if (r.ok) {
        const d = await r.json();
        setDiffMap((prev) => ({ ...prev, [sha]: d.files ?? [] }));
      }
    } finally { setDiffLoading(null); }
  }

  function toggleDiff(sha: string) {
    const next = !showDiff[sha];
    setShowDiff((prev) => ({ ...prev, [sha]: next }));
    if (next) loadDiff(sha);
  }

  async function unlinkSnapshot(sha: string, snapshotId: string) {
    await fetch(`/api/projects/${projectId}/commits/${sha}/links?snapshot_id=${snapshotId}`, { method: "DELETE" });
    setIntentMap((prev) => {
      const updated = { ...prev };
      delete updated[sha];
      return updated;
    });
    loadIntent(sha);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-6 w-6 text-engram-light animate-spin" />
        <p className="text-sm text-gh-muted">Loading commit history…</p>
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="text-center py-20">
        <GitCommit className="h-12 w-12 text-gh-muted/30 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gh-text mb-2">No commits yet</h3>
        <p className="text-sm text-gh-muted max-w-sm mx-auto">
          Push a commit to the connected repository. Semantic links are created automatically after each push.
        </p>
      </div>
    );
  }

  const baseUrl = provider === "gitlab"
    ? `https://gitlab.com/${repoFullName}/-/commit`
    : `https://github.com/${repoFullName}/commit`;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted flex items-center gap-2">
          <GitCommit className="h-3.5 w-3.5" />
          Commit History — {commits.length} recent
        </h2>
        <button onClick={loadCommits} className="p-1.5 rounded hover:bg-gh-canvas text-gh-muted hover:text-gh-text transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        {commits.map((commit) => {
          const isExpanded = expandedSha === commit.sha;
          const intent = intentMap[commit.sha];
          const isLoadingIntent = intentLoading === commit.sha;
          const isFocused = !!(focusedCommitSha && (
            commit.sha === focusedCommitSha || commit.sha.startsWith(focusedCommitSha)
          ));

          return (
            <div
              key={commit.sha}
              ref={(el) => { commitRefs.current[commit.sha] = el; }}
              className={cn(
                "rounded-lg border bg-gh-canvas overflow-hidden transition-shadow",
                isFocused ? "border-engram/50 ring-1 ring-engram/30" : "border-gh-border"
              )}>
              {/* ── Commit row ── */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gh-bg transition-colors"
                onClick={() => toggleExpand(commit.sha)}>
                <div className="h-2 w-2 rounded-full bg-gh-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <code className="text-[11px] font-mono text-engram-light shrink-0">{commit.sha_short}</code>
                    <span className="text-sm text-gh-text leading-snug truncate flex-1 min-w-0">{commit.message}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-gh-muted">
                    <span>{commit.author}</span>
                    {commit.timestamp && (
                      <span>{new Date(commit.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                    )}
                    {commit.files_changed > 0 && (
                      <span>{commit.files_changed} file{commit.files_changed !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {commit.linked_conversations > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-engram/10 border border-engram/25 text-engram-light">
                      <MessageSquare className="h-2.5 w-2.5" />
                      {commit.linked_conversations} conversation{commit.linked_conversations !== 1 ? "s" : ""}
                    </span>
                  )}
                  <a
                    href={`${baseUrl}/${commit.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-gh-canvas text-gh-muted hover:text-gh-text transition-colors">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <ChevronDown className={cn("h-4 w-4 text-gh-muted transition-transform", isExpanded && "rotate-180")} />
                </div>
              </div>

              {/* ── Expanded detail ── */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-gh-border">
                    <div className="px-4 py-4 space-y-4">
                      {/* Intent summary */}
                      {isLoadingIntent ? (
                        <div className="flex items-center gap-2 text-xs text-gh-muted">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-engram-light" />
                          Generating intent summary…
                        </div>
                      ) : intent?.intent_summary ? (
                        <div className="rounded-lg border border-engram/20 bg-engram/5 px-3 py-2.5">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Sparkles className="h-3.5 w-3.5 text-engram-light shrink-0" />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-engram-light">Why this was built</span>
                          </div>
                          <p className="text-xs text-gh-text leading-relaxed">{intent.intent_summary}</p>
                        </div>
                      ) : intent && !intent.intent_summary ? (
                        <p className="text-xs text-gh-muted">No linked conversations yet — push a commit or link manually.</p>
                      ) : null}

                      {/* Linked conversations */}
                      {intent && intent.linked_snapshots.length > 0 && (
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-wider text-gh-muted mb-2">
                            Linked conversations ({intent.linked_snapshots.length})
                          </p>
                          <div className="space-y-1.5">
                            {intent.linked_snapshots.map((link) => (
                              <div key={link.link_id}
                                className="flex items-start gap-2 p-2 rounded-lg border border-gh-border bg-gh-bg group">
                                <MessageSquare className="h-3.5 w-3.5 text-gh-muted shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Link href={`/context/${link.snapshot_id}`}
                                      className="text-xs text-gh-text hover:text-engram-light transition-colors truncate">
                                      {link.snapshot?.title ?? "Untitled conversation"}
                                    </Link>
                                    {link.is_manual && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-gh-canvas border border-gh-border text-gh-muted shrink-0">manual</span>
                                    )}
                                    {!link.is_manual && (
                                      <span className="text-[9px] text-gh-muted shrink-0">{Math.round(link.similarity * 100)}% match</span>
                                    )}
                                  </div>
                                  {link.snapshot?.decision && (
                                    <p className="text-[10px] text-gh-muted mt-0.5 line-clamp-1">→ {link.snapshot.decision}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => unlinkSnapshot(commit.sha, link.snapshot_id)}
                                  className="p-1 rounded hover:bg-red-500/10 text-gh-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                  title="Unlink">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Diff viewer */}
                      {showDiff[commit.sha] && (
                        <div className="rounded-lg border border-gh-border overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-gh-bg border-b border-gh-border">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-gh-muted flex items-center gap-1.5">
                              <FileCode className="h-3 w-3" />
                              Code Changes
                            </span>
                            {diffLoading === commit.sha && (
                              <Loader2 className="h-3 w-3 animate-spin text-engram-light" />
                            )}
                          </div>
                          {diffLoading === commit.sha ? (
                            <div className="px-4 py-6 flex items-center justify-center gap-2 text-xs text-gh-muted">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-engram-light" />
                              Loading diff…
                            </div>
                          ) : !diffMap[commit.sha] || diffMap[commit.sha].length === 0 ? (
                            <p className="px-4 py-4 text-xs text-gh-muted">No file changes found for this commit.</p>
                          ) : (
                            <div className="divide-y divide-gh-border max-h-[500px] overflow-y-auto">
                              {diffMap[commit.sha].map((file) => (
                                <CommitDiffFile key={file.filename} file={file} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Action buttons row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => toggleDiff(commit.sha)}
                          className={cn(
                            "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors",
                            showDiff[commit.sha]
                              ? "border-engram/40 bg-engram/5 text-engram-light"
                              : "border-gh-border bg-gh-bg text-gh-muted hover:text-gh-text hover:border-engram/40"
                          )}>
                          {diffLoading === commit.sha
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <FileCode className="h-3.5 w-3.5" />}
                          {showDiff[commit.sha] ? "Hide Diff" : "View Diff"}
                        </button>
                        <button
                          onClick={() => setLinkModalCommit(commit)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gh-border bg-gh-bg text-gh-muted hover:text-gh-text hover:border-engram/40 transition-colors">
                          <MessageSquare className="h-3.5 w-3.5" />
                          Add conversation
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Manual link from commit detail: search + pick a snapshot */}
      {linkModalCommit && (
        <CommitSnapshotSearchModal
          projectId={projectId}
          commit={linkModalCommit}
          snapshots={snapshots}
          onClose={() => setLinkModalCommit(null)}
          onLinked={() => {
            // Refresh intent for this commit
            setIntentMap((prev) => {
              const updated = { ...prev };
              delete updated[linkModalCommit.sha];
              return updated;
            });
            loadIntent(linkModalCommit.sha);
            setLinkModalCommit(null);
          }}
        />
      )}
    </div>
  );
}

/* ── CommitDiffFile — renders a single file's unified diff ── */
function CommitDiffFile({ file }: { file: DiffFile }) {
  const [collapsed, setCollapsed] = useState(false);

  const statusColor: Record<string, string> = {
    added:    "text-green-400 bg-green-500/10 border-green-500/25",
    removed:  "text-red-400 bg-red-500/10 border-red-500/25",
    modified: "text-blue-400 bg-blue-500/10 border-blue-500/25",
    renamed:  "text-yellow-400 bg-yellow-500/10 border-yellow-500/25",
  };
  const badge = statusColor[file.status] ?? "text-gh-muted bg-gh-bg border-gh-border";

  const lines = (file.patch ?? "").split("\n");

  return (
    <div className="bg-gh-canvas">
      {/* file header */}
      <button
        onClick={() => setCollapsed((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gh-bg transition-colors text-left">
        <ChevronDown className={cn("h-3.5 w-3.5 text-gh-muted shrink-0 transition-transform", collapsed && "-rotate-90")} />
        <FileCode className="h-3.5 w-3.5 text-gh-muted shrink-0" />
        <span className="text-xs font-mono text-gh-text flex-1 truncate">{file.filename}</span>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded border shrink-0", badge)}>
          {file.status}
        </span>
        {(file.additions > 0 || file.deletions > 0) && (
          <span className="text-[10px] font-mono text-gh-muted shrink-0">
            <span className="text-green-400">+{file.additions}</span>
            {" / "}
            <span className="text-red-400">-{file.deletions}</span>
          </span>
        )}
      </button>

      {/* diff body */}
      {!collapsed && file.patch && (
        <div className="overflow-x-auto border-t border-gh-border">
          <table className="w-full text-[11px] font-mono border-collapse">
            <tbody>
              {lines.map((line, i) => {
                const isAdd     = line.startsWith("+") && !line.startsWith("+++");
                const isDel     = line.startsWith("-") && !line.startsWith("---");
                const isHunk    = line.startsWith("@@");
                const isFileHdr = line.startsWith("+++") || line.startsWith("---");

                const rowClass = isAdd
                  ? "bg-green-500/8"
                  : isDel
                  ? "bg-red-500/8"
                  : isHunk
                  ? "bg-engram/5"
                  : isFileHdr
                  ? "bg-gh-bg"
                  : "";

                const lineClass = isAdd
                  ? "text-green-400"
                  : isDel
                  ? "text-red-400"
                  : isHunk
                  ? "text-engram-light"
                  : "text-gh-muted";

                return (
                  <tr key={i} className={rowClass}>
                    <td className={cn("select-none pl-3 pr-2 py-0.5 text-right w-6 border-r border-gh-border/50", lineClass)}>
                      {isAdd ? "+" : isDel ? "−" : isHunk ? "⋯" : ""}
                    </td>
                    <td className="pl-3 pr-4 py-0.5 whitespace-pre text-gh-text">
                      <span className={isHunk ? "text-engram-light" : isAdd ? "text-green-300" : isDel ? "text-red-300" : ""}>
                        {isAdd || isDel ? line.slice(1) : line}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!collapsed && !file.patch && (
        <p className="px-4 py-3 text-xs text-gh-muted border-t border-gh-border">
          Binary file or patch not available.
        </p>
      )}
    </div>
  );
}

/* ── CommitSnapshotSearchModal ──────────────────────────── */
function CommitSnapshotSearchModal({ projectId, commit, snapshots, onClose, onLinked }: {
  projectId: string;
  commit: CommitRow;
  snapshots: Snapshot[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set(commit.linked_snapshot_ids));

  const filtered = snapshots.filter((s) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (s.title ?? "").toLowerCase().includes(q) ||
      (s.summary ?? "").toLowerCase().includes(q) ||
      (s.decision ?? "").toLowerCase().includes(q);
  });

  async function link(snapshotId: string) {
    setLinking(snapshotId);
    try {
      const r = await fetch(`/api/projects/${projectId}/commits/${commit.sha}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot_id: snapshotId,
          commit_message: commit.message,
          committed_at: commit.timestamp || null,
        }),
      });
      if (r.ok) {
        setLinked((prev) => new Set([...prev, snapshotId]));
        onLinked();
      }
    } finally { setLinking(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-gh-canvas border border-gh-border rounded-xl shadow-xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gh-border">
          <div>
            <h3 className="text-sm font-semibold text-gh-text">Link conversation to commit</h3>
            <p className="text-xs text-gh-muted mt-0.5 font-mono">{commit.sha_short} — {commit.message.slice(0, 60)}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gh-bg text-gh-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-3 border-b border-gh-border">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations…"
            autoFocus
            className="w-full bg-gh-bg border border-gh-border rounded-lg px-3 py-2 text-sm text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {filtered.length === 0 && (
            <p className="text-xs text-gh-muted text-center py-8">No conversations match.</p>
          )}
          {filtered.map((snap) => {
            const isLinked = linked.has(snap.id);
            const isLinking = linking === snap.id;
            return (
              <div key={snap.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-gh-border bg-gh-bg hover:border-engram/40 transition-colors">
                <div className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", TOOL_DOT[snap.ai_tool] ?? "bg-gh-muted")} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gh-text leading-snug truncate">{snap.title}</p>
                  {snap.decision && <p className="text-[10px] text-gh-muted mt-0.5 line-clamp-1">→ {snap.decision}</p>}
                  <p className="text-[10px] text-gh-muted mt-0.5">
                    {new Date(snap.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => !isLinked && link(snap.id)}
                  disabled={isLinked || isLinking}
                  className={cn(
                    "shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors",
                    isLinked
                      ? "border-green-500/30 bg-green-500/10 text-green-400 cursor-default"
                      : "border-gh-border text-gh-muted hover:border-engram/40 hover:text-engram-light"
                  )}>
                  {isLinking ? <Loader2 className="h-3 w-3 animate-spin" /> : isLinked ? <Check className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                  {isLinked ? "Linked" : "Link"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-gh-border">
          <button onClick={onClose} className="w-full py-2 rounded-lg border border-gh-border text-gh-muted text-sm hover:text-gh-text transition-colors">
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TRUST BRIEF TAB — structured, attributable project brief
══════════════════════════════════════════════════════════ */

type BriefSize = "full" | "medium" | "compact";

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  decision: "Decisions Made",
  constraint: "Constraints & Non-Goals",
  next_step: "Next Steps",
  technology: "Active Technologies",
  dead_end: "Dead Ends",
  observation: "Current State",
};

const CLAIM_TYPE_COLOR: Record<ClaimType, string> = {
  decision: "text-engram-light border-engram/30 bg-engram/5",
  constraint: "text-yellow-400 border-yellow-400/30 bg-yellow-400/5",
  next_step: "text-green-400 border-green-400/30 bg-green-400/5",
  technology: "text-blue-400 border-blue-400/30 bg-blue-400/5",
  dead_end: "text-red-400 border-red-400/30 bg-red-400/5",
  observation: "text-gh-muted border-gh-border bg-gh-canvas",
};

const CLAIM_TYPE_DOT: Record<ClaimType, string> = {
  decision: "bg-engram",
  constraint: "bg-yellow-400",
  next_step: "bg-green-400",
  technology: "bg-blue-400",
  dead_end: "bg-red-400",
  observation: "bg-gh-muted",
};

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-16 bg-gh-border rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gh-muted tabular-nums">{pct}%</span>
    </div>
  );
}

function ClaimCard({
  claim, onUpdateStatus,
}: {
  claim: TrustyClaim;
  onUpdateStatus: (claimId: string, status: "abandoned" | "superseded" | "active") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  async function handleStatus(status: "abandoned" | "superseded" | "active") {
    setUpdating(true);
    await onUpdateStatus(claim.id, status);
    setUpdating(false);
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(claim.last_seen_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className={cn(
      "rounded-lg border p-3 text-sm transition-colors",
      claim.is_stale ? "border-yellow-400/20 bg-yellow-400/3" : "border-gh-border bg-gh-canvas"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn("h-2 w-2 rounded-full mt-1.5 shrink-0", CLAIM_TYPE_DOT[claim.claim_type])} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm leading-snug", claim.claim_type === "dead_end" ? "line-through text-gh-muted" : "text-gh-text")}>
            {claim.claim_text}
          </p>
          <div className="flex items-center gap-3 mt-2">
            <ConfidenceBar score={claim.confidence_score} />
            {claim.is_stale && (
              <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                <AlertTriangle className="h-2.5 w-2.5" />possibly stale ({daysSince}d ago)
              </span>
            )}
            {claim.reinforcement_count > 1 && (
              <span className="text-[10px] text-gh-muted">
                seen {claim.reinforcement_count}× across captures
              </span>
            )}
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-[10px] text-gh-muted hover:text-gh-text transition-colors ml-auto">
              {expanded ? "▴ less" : "▾ source"}
            </button>
          </div>

          {expanded && (
            <div className="mt-3 space-y-2 border-t border-gh-border pt-3">
              {claim.snapshot_title && (
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3 w-3 text-gh-muted shrink-0" />
                  <Link href={`/context/${claim.snapshot_id}`}
                    className="text-[10px] text-gh-muted hover:text-engram-light underline underline-offset-2 truncate">
                    Source: {claim.snapshot_title}
                  </Link>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-gh-muted">
                  First seen {new Date(claim.first_seen_at).toLocaleDateString()} ·
                  Last seen {new Date(claim.last_seen_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {claim.status !== "abandoned" && (
                  <button
                    onClick={() => handleStatus("abandoned")}
                    disabled={updating}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50">
                    {updating ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <XCircle className="h-2.5 w-2.5" />}
                    Mark abandoned
                  </button>
                )}
                {claim.status === "abandoned" && (
                  <button
                    onClick={() => handleStatus("active")}
                    disabled={updating}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-green-400/30 text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
                    <CheckCircle2 className="h-2.5 w-2.5" />Restore
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConflictCard({
  conflict,
  projectId,
  onResolved,
}: {
  conflict: ConflictSummary;
  projectId: string;
  onResolved: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);

  async function resolve(winnerId: string) {
    setChosen(winnerId);
    setResolving(true);
    try {
      await fetch(`/api/projects/${projectId}/conflicts/${conflict.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winner_claim_id: winnerId }),
      });
      onResolved();
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="rounded-lg border border-red-400/30 bg-red-400/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-red-400 shrink-0" />
        <span className="text-sm font-medium text-red-400">Decision Conflict Detected</span>
        <span className="text-[10px] text-gh-muted ml-auto">
          Resolve before injecting into AI
        </span>
      </div>

      <div className="space-y-2">
        {[conflict.claim_a, conflict.claim_b].map((claim) => (
          <div key={claim.id}
            className={cn(
              "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
              chosen === claim.id
                ? "border-green-400/50 bg-green-400/5"
                : "border-gh-border bg-gh-canvas hover:border-engram/40"
            )}
            onClick={() => !resolving && resolve(claim.id)}>
            <div className="h-2 w-2 rounded-full bg-gh-muted mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gh-text leading-snug">{claim.claim_text}</p>
              <p className="text-[10px] text-gh-muted mt-1">
                {claim.snapshot_title ?? "Captured conversation"} ·{" "}
                {new Date(claim.last_seen_at).toLocaleDateString()}
              </p>
            </div>
            {resolving && chosen === claim.id && (
              <Loader2 className="h-4 w-4 text-engram-light animate-spin shrink-0" />
            )}
            {chosen !== claim.id && !resolving && (
              <span className="text-[10px] text-gh-muted shrink-0">Click to keep →</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefTab({
  projectId, projectName, captureCount,
}: {
  projectId: string;
  projectName: string;
  captureCount: number;
}) {
  const [brief, setBrief] = useState<ProjectBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefSize, setBriefSize] = useState<BriefSize>("full");
  const [copied, setCopied] = useState(false);
  const [showDeadEnds, setShowDeadEnds] = useState(false);
  const [showObservations, setShowObservations] = useState(false);

  const loadBrief = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/brief`);
      if (r.ok) {
        const d = await r.json();
        setBrief(d);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadBrief(); }, [loadBrief]);

  async function updateClaimStatus(claimId: string, status: "abandoned" | "superseded" | "active") {
    await fetch(`/api/projects/${projectId}/claims/${claimId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadBrief();
  }

  function copyBrief() {
    if (!brief) return;
    const text = brief.injection[briefSize];
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-6 w-6 text-engram-light animate-spin" />
        <p className="text-sm text-gh-muted">Building trustworthy brief…</p>
      </div>
    );
  }

  if (!brief || brief.claim_count === 0) {
    return (
      <div className="text-center py-20">
        <Shield className="h-12 w-12 text-gh-muted/30 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gh-text mb-2">No claims yet</h3>
        <p className="text-sm text-gh-muted max-w-sm mx-auto mb-6">
          Capture AI conversations for <strong>{projectName}</strong> and ENGRAM will automatically
          extract structured, trustworthy claims from them. Each claim traces back to its source.
        </p>
        {captureCount === 0 && (
          <p className="text-xs text-gh-muted">
            This project has no captures yet. Use the Chrome extension to capture conversations.
          </p>
        )}
        {captureCount > 0 && (
          <p className="text-xs text-gh-muted">
            {captureCount} capture{captureCount !== 1 ? "s" : ""} found — claims are processed in the background.
            Refresh in a moment.
          </p>
        )}
      </div>
    );
  }

  const { categories, conflicts } = brief;
  const totalInjectable =
    categories.decision.length +
    categories.constraint.length +
    categories.next_step.length +
    categories.technology.length;

  return (
    <div className="max-w-4xl">
      {/* ── Header stats ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 mb-6 p-4 rounded-lg border border-gh-border bg-gh-canvas">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-engram-light" />
          <span className="text-sm font-medium text-gh-text">Trust Brief</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gh-muted">
          <span>{brief.claim_count} claims</span>
          <span>{captureCount} captures</span>
          <span>Updated {new Date(brief.generated_at).toLocaleTimeString()}</span>
        </div>
        {conflicts.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-red-400 ml-auto">
            <AlertTriangle className="h-3.5 w-3.5" />
            {conflicts.length} conflict{conflicts.length !== 1 ? "s" : ""} need resolution
          </div>
        )}
        <button onClick={loadBrief} className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Copy for AI ──────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6 p-4 rounded-lg border border-engram/20 bg-engram/5">
        <Zap className="h-4 w-4 text-engram-light shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-engram-light">Copy for AI Injection</p>
          <p className="text-xs text-gh-muted">
            {totalInjectable} claims ready to inject ·{" "}
            {brief.conflicts.length > 0
              ? `⚡ ${brief.conflicts.length} conflict${brief.conflicts.length !== 1 ? "s" : ""} excluded until resolved`
              : "no conflicts"}
          </p>
        </div>
        {/* Size picker */}
        <div className="flex items-center gap-1 rounded-lg border border-gh-border bg-gh-bg p-0.5">
          {(["compact", "medium", "full"] as BriefSize[]).map((size) => (
            <button
              key={size}
              onClick={() => setBriefSize(size)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                briefSize === size
                  ? "bg-engram text-white"
                  : "text-gh-muted hover:text-gh-text"
              )}>
              {size === "full"
                ? `Full (~${brief.token_estimates.full.toLocaleString()}t)`
                : size === "medium"
                ? `Medium (~${brief.token_estimates.medium.toLocaleString()}t)`
                : `Compact (~${brief.token_estimates.compact.toLocaleString()}t)`}
            </button>
          ))}
        </div>
        <button
          onClick={copyBrief}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-engram text-white text-sm font-medium hover:bg-engram/90 transition-colors">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy Brief"}
        </button>
      </div>

      {/* ── Conflicts (always shown first) ───────────────── */}
      {conflicts.length > 0 && (
        <div className="mb-6 space-y-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-red-400 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Resolve Before Injecting ({conflicts.length})
          </h2>
          {conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              projectId={projectId}
              onResolved={loadBrief}
            />
          ))}
        </div>
      )}

      {/* ── Claims by category ───────────────────────────── */}
      <div className="space-y-6">
        {(["decision", "constraint", "next_step", "technology"] as ClaimType[]).map((type) => {
          const items = categories[type];
          if (!items.length) return null;
          return (
            <ClaimSection
              key={type}
              type={type}
              claims={items}
              onUpdateStatus={updateClaimStatus}
            />
          );
        })}

        {/* Dead ends — collapsed by default */}
        {categories.dead_end.length > 0 && (
          <div>
            <button
              onClick={() => setShowDeadEnds((v) => !v)}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gh-muted hover:text-gh-text transition-colors mb-3">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showDeadEnds && "rotate-180")} />
              Dead Ends ({categories.dead_end.length}) — do not revisit
            </button>
            {showDeadEnds && (
              <div className="space-y-2">
                {categories.dead_end.map((c) => (
                  <ClaimCard key={c.id} claim={c} onUpdateStatus={updateClaimStatus} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Observations — collapsed by default */}
        {categories.observation.length > 0 && (
          <div>
            <button
              onClick={() => setShowObservations((v) => !v)}
              className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-gh-muted hover:text-gh-text transition-colors mb-3">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showObservations && "rotate-180")} />
              Observations ({categories.observation.length})
            </button>
            {showObservations && (
              <div className="space-y-2">
                {categories.observation.map((c) => (
                  <ClaimCard key={c.id} claim={c} onUpdateStatus={updateClaimStatus} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── F-09: Code Anchors ────────────────────────────── */}
      {brief.code_context && brief.code_context.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="h-3.5 w-3.5 text-gh-muted" />
            <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
              Code Anchors ({brief.code_context.length} files)
            </h2>
            <span className="text-[10px] text-gh-muted/60 ml-1">
              — most relevant files based on your decisions
            </span>
          </div>
          <div className="space-y-3">
            {brief.code_context.map((anchor) => (
              <div key={anchor.file_path}
                className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gh-border/50 bg-gh-bg">
                  <GitBranch className="h-3 w-3 text-gh-muted shrink-0" />
                  <code className="text-xs text-engram-light font-mono flex-1 truncate">
                    {anchor.file_path}
                  </code>
                  <span className="text-[10px] text-gh-muted shrink-0">
                    {Math.round(anchor.similarity * 100)}% relevant
                  </span>
                  {anchor.language && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border/50 text-gh-muted font-mono shrink-0">
                      {anchor.language}
                    </span>
                  )}
                </div>
                <pre className="p-3 text-[11px] font-mono text-gh-muted overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {anchor.snippet}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ClaimSection({
  type, claims, onUpdateStatus,
}: {
  type: ClaimType;
  claims: TrustyClaim[];
  onUpdateStatus: (id: string, status: "abandoned" | "superseded" | "active") => void;
}) {
  const staleCount = claims.filter((c) => c.is_stale).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", CLAIM_TYPE_DOT[type])} />
          {CLAIM_TYPE_LABELS[type]} ({claims.length})
        </h2>
        {staleCount > 0 && (
          <span className="text-[10px] text-yellow-400 flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5" />
            {staleCount} possibly stale
          </span>
        )}
      </div>

      {type === "technology" ? (
        // Technologies shown as pills
        <div className="flex flex-wrap gap-2">
          {claims.map((c) => (
            <span
              key={c.id}
              title={`Confidence: ${Math.round(c.confidence_score * 100)}% · Last seen: ${new Date(c.last_seen_at).toLocaleDateString()}`}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium",
                c.is_stale ? "border-yellow-400/30 text-yellow-400 bg-yellow-400/5" : CLAIM_TYPE_COLOR[type]
              )}>
              <code>{c.claim_text}</code>
              {c.is_stale && <AlertTriangle className="h-2.5 w-2.5" />}
            </span>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} onUpdateStatus={onUpdateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ASK TAB — ENGRAM Ask scoped to this project
══════════════════════════════════════════════════════════ */
function AskTab({ projectId, projectName, hasRepo }: { projectId: string; projectName: string; hasRepo: boolean }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string; sources: AskSource[] }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setQuestion("");
    setAnswer(null);
    setSources([]);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, scope: "project", project_id: projectId }),
      });
      const d = await r.json();
      const a = d.answer ?? "No answer available.";
      const s: AskSource[] = d.sources ?? [];
      setAnswer(a);
      setSources(s);
      setHistory((prev) => [...prev, { q, a, sources: s }]);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-6 p-3 rounded-lg bg-engram/5 border border-engram/20">
        <Sparkles className="h-4 w-4 text-engram-light shrink-0" />
        <div>
          <p className="text-xs font-medium text-engram-light">Project-scoped ENGRAM</p>
          <p className="text-xs text-gh-muted">
            Searching <strong>{projectName}</strong>'s {hasRepo ? "codebase, commit history, and " : ""}captured conversations only.
            No cross-project data.
          </p>
        </div>
      </div>

      {history.length > 0 && (
        <div className="space-y-6 mb-8">
          {history.map((item, i) => (
            <div key={i} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-engram text-white rounded-lg px-4 py-2.5 text-sm">{item.q}</div>
              </div>
              <div className="rounded-lg border border-gh-border bg-gh-canvas p-4">
                <p className="text-sm text-gh-text leading-relaxed whitespace-pre-wrap">{item.a}</p>
                {item.sources.length > 0 && <SourcesList sources={item.sources} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="mb-6 rounded-lg border border-gh-border bg-gh-canvas p-4">
          <div className="flex items-center gap-2 text-gh-muted text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-engram-light" />
            Searching {projectName}…
          </div>
        </div>
      )}
      {answer && !loading && (
        <div className="mb-6 rounded-lg border border-engram/30 bg-engram/5 p-4">
          <p className="text-sm text-gh-text leading-relaxed whitespace-pre-wrap">{answer}</p>
          {sources.length > 0 && <SourcesList sources={sources} />}
        </div>
      )}

      <div ref={bottomRef} />

      {history.length === 0 && !loading && (
        <div className="mb-6 grid grid-cols-2 gap-2">
          {[
            "What are the key architectural decisions made?",
            "What is the current state of this project?",
            hasRepo ? "How does authentication work in this codebase?" : "What are the open questions?",
            hasRepo ? "What are the recent commits about?" : "What decisions are pending?",
          ].map((sug) => (
            <button key={sug} onClick={() => setQuestion(sug)}
              className="text-left text-xs text-gh-muted p-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 hover:text-gh-text transition-colors leading-relaxed">
              {sug}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
          placeholder={`Ask anything about ${projectName}…`}
          disabled={loading}
          className="flex-1 bg-gh-canvas border border-gh-border rounded-lg px-4 py-3 text-sm text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram disabled:opacity-60"
        />
        <button onClick={ask} disabled={!question.trim() || loading}
          className="px-4 py-3 rounded-lg bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors flex items-center gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SourcesList({ sources }: { sources: AskSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-4 space-y-1.5 border-t border-gh-border pt-3">
      <p className="text-[10px] font-mono uppercase tracking-wider text-gh-muted mb-2">Sources</p>
      {sources.slice(0, 5).map((src, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-gh-muted">
          {src.type === "github"
            ? <GitCommit className="h-3.5 w-3.5 text-engram-light/70 shrink-0 mt-0.5" />
            : <MessageSquare className="h-3.5 w-3.5 text-gh-muted shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <span className="font-medium text-gh-text truncate block">{src.title}</span>
            {src.path && <span className="font-mono text-[10px] text-gh-muted/70">{src.path}</span>}
            {src.excerpt && <p className="text-gh-muted line-clamp-1 mt-0.5">{src.excerpt}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MEMBERS TAB — manage project members
══════════════════════════════════════════════════════════ */
function MembersTab({ projectId, members, isOwner, onRefresh, repo }: {
  projectId: string; members: Member[]; isOwner: boolean; onRefresh: () => void;
  repo: Repo | null;
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnectRepo() {
    if (!confirm("Disconnect this repository? The project will lose access to code search and AST analysis until a new repo is linked.")) return;
    setDisconnecting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/repo`, { method: "DELETE" });
      if (r.ok) onRefresh();
    } finally {
      setDisconnecting(false);
    }
  }

  async function generateInvite() {
    setInviteLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generate_invite: true }),
      });
      const d = await r.json();
      if (d.invite_url) setInviteUrl(d.invite_url);
    } finally {
      setInviteLoading(false);
    }
  }

  async function removeMember(userId: string) {
    if (!confirm("Remove this member from the project?")) return;
    setRemoving(userId);
    try {
      await fetch(`/api/projects/${projectId}/members?user_id=${userId}`, { method: "DELETE" });
      onRefresh();
    } finally {
      setRemoving(null);
    }
  }

  function copyInvite() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Code Repository Section ── */}
      <div className="p-5 rounded-lg border border-gh-border bg-gh-canvas">
        <div className="flex items-center gap-2 mb-3">
          <Github className="h-4 w-4 text-engram-light" />
          <h3 className="text-sm font-semibold text-gh-text">Code Repository</h3>
          {repo?.provider && (
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-gh-border/60 text-gh-muted capitalize">
              {repo.provider === "github" ? "GitHub App" : "GitLab OAuth"}
            </span>
          )}
        </div>
        {repo ? (
          <div className="space-y-3">
            {/* ── Repo identity + status ── */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={repo.provider === "gitlab"
                    ? `https://gitlab.com/${repo.repo_full_name}`
                    : `https://github.com/${repo.repo_full_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-gh-text hover:text-engram-light transition-colors font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{repo.repo_full_name}</span>
                </a>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gh-muted">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />{repo.default_branch ?? "main"}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />{repo.file_count.toLocaleString()} files
                  </span>
                  {repo.is_private ? (
                    <span className="flex items-center gap-1"><Lock className="h-3 w-3" />Private</span>
                  ) : (
                    <span className="flex items-center gap-1"><Globe className="h-3 w-3" />Public</span>
                  )}
                </div>
              </div>

              {/* Indexing status badge */}
              <div className="text-right shrink-0">
                {repo.last_indexed_commit ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
                    <GitCommit className="h-3 w-3" />
                    AST @ {repo.last_indexed_commit.slice(0, 7)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Awaiting first push
                  </span>
                )}
                {repo.indexed_at && (
                  <div className="text-[10px] text-gh-muted mt-1">
                    Last indexed {new Date(repo.indexed_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                )}
              </div>
            </div>

            {/* ── First-index notice ── */}
            {!repo.last_indexed_commit && (
              <div className="text-xs text-gh-muted bg-gh-bg border border-gh-border rounded-md px-3 py-2">
                AST indexing starts automatically on the next push to <span className="font-mono">{repo.default_branch ?? "main"}</span>.{" "}
                {repo.provider === "gitlab"
                  ? "Ensure a webhook is configured in your GitLab project settings."
                  : "Ensure a webhook is configured in your GitHub App installation."}
              </div>
            )}

            {/* ── Owner controls ── */}
            {isOwner && (
              <div className="flex justify-end pt-1 border-t border-gh-border/50">
                <button
                  onClick={disconnectRepo}
                  disabled={disconnecting}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition-colors disabled:opacity-50">
                  {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                  Disconnect repository
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gh-muted">
              No code repository linked yet. Connect a GitHub or GitLab repository to enable codebase search and AST dependency analysis.
            </p>
            {isOwner && (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/settings?tab=integrations`}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gh-border bg-gh-bg text-gh-text hover:border-engram-light/40 hover:text-engram-light transition-colors">
                  <Github className="h-3.5 w-3.5" />
                  GitHub App
                </a>
                <a
                  href={`/settings?tab=integrations`}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gh-border bg-gh-bg text-gh-text hover:border-engram-light/40 hover:text-engram-light transition-colors">
                  <GitBranch className="h-3.5 w-3.5" />
                  GitLab OAuth
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {isOwner && (
        <div className="p-5 rounded-lg border border-gh-border bg-gh-canvas">
          <div className="flex items-center gap-2 mb-3">
            <UserPlus className="h-4 w-4 text-engram-light" />
            <h3 className="text-sm font-semibold text-gh-text">Invite to this project</h3>
          </div>
          <p className="text-xs text-gh-muted mb-4">
            Generate a one-time invite link. The person must first join your team, then you can add them here directly.
          </p>

          {inviteUrl ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gh-bg border border-gh-border rounded-md px-3 py-2 text-xs text-gh-muted font-mono truncate">
                {inviteUrl}
              </div>
              <button onClick={copyInvite}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-engram text-white text-xs hover:bg-engram/90 transition-colors shrink-0">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
              <button onClick={() => setInviteUrl(null)} className="p-2 rounded-md border border-gh-border text-gh-muted hover:text-gh-text">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={generateInvite} disabled={inviteLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors">
              {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Generate invite link
            </button>
          )}
        </div>
      )}

      <div>
        <h3 className="text-xs font-mono uppercase tracking-wider text-gh-muted mb-4">
          Members ({members.length})
        </h3>

        {members.length === 0 ? (
          <div className="text-center py-12 text-gh-muted text-sm">
            No members yet. {isOwner ? "Generate an invite link to add someone." : ""}
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => {
              const displayName = m.profile?.full_name ?? m.profile?.display_name ?? m.profile?.email ?? "Unknown";
              return (
                <motion.div key={m.id}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gh-border bg-gh-canvas group">
                  <div className="h-8 w-8 rounded-full bg-engram/10 border border-engram/20 flex items-center justify-center text-sm font-medium text-engram-light shrink-0">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gh-text font-medium truncate">{displayName}</span>
                      {m.is_self && <span className="text-[10px] text-gh-muted">(you)</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.role === "owner" && <Crown className="h-3 w-3 text-yellow-400" />}
                      <span className="text-[10px] text-gh-muted capitalize">{m.role}</span>
                      <span className="text-[10px] text-gh-muted">
                        · Joined {new Date(m.joined_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {isOwner && !m.is_self && (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      disabled={removing === m.user_id}
                      className="p-1.5 rounded hover:bg-red-500/10 text-gh-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50">
                      {removing === m.user_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BLAST RADIUS TAB
══════════════════════════════════════════════════════════ */

interface BlastFile {
  file_path: string;
  impact_level: "Direct" | "Transitive" | "Indirect";
  hops: number;
  edge_type: string;
  via_file: string;
  via_symbol: string | null;
  direction: "reverse" | "forward";
}

interface BlastSnapshot {
  id: string;
  title: string;
  summary: string | null;
  decision: string | null;
  created_at: string;
  ai_tool: string;
  relevance_score: number;
  source: "commit_link" | "semantic_search" | "both";
}

interface BlastResult {
  query_id: string | null;
  risk_level: "Low" | "Medium" | "High" | "Critical";
  risk_summary: string;
  files_to_update: string[];
  stats: {
    edges_traversed: number;
    links_found: number;
    affected_count: number;
    snapshots_count: number;
  };
}

interface PastQuery {
  id: string;
  query_file: string;
  change_description: string;
  analysis_name: string | null;
  risk_level: string | null;
  risk_summary: string | null;
  ast_edges_traversed: number;
  semantic_links_found: number;
  created_at: string;
  affected_files: BlastFile[];
  intent_snapshots: BlastSnapshot[];
}

type BlastPhase = "idle" | "traversing" | "intenting" | "synthesizing" | "done" | "error";

const RISK_COLORS: Record<string, string> = {
  Low:      "text-green-400 bg-green-400/10 border-green-400/30",
  Medium:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  High:     "text-orange-400 bg-orange-400/10 border-orange-400/30",
  Critical: "text-red-400 bg-red-400/10 border-red-400/30",
};

const IMPACT_COLORS: Record<string, string> = {
  Direct:     "text-red-400 bg-red-400/10 border-red-400/30",
  Transitive: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  Indirect:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
};

function BlastRadiusTab({ projectId }: { projectId: string }) {
  const [filePath, setFilePath] = useState("");
  const [changeDesc, setChangeDesc] = useState("");
  const [analysisName, setAnalysisName] = useState("");
  const [fileOptions, setFileOptions] = useState<string[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [phase, setPhase] = useState<BlastPhase>("idle");
  const [affectedFiles, setAffectedFiles] = useState<BlastFile[]>([]);
  const [intentSnapshots, setIntentSnapshots] = useState<BlastSnapshot[]>([]);
  const [streamText, setStreamText] = useState("");
  const [result, setResult] = useState<BlastResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [pastQueries, setPastQueries] = useState<PastQuery[]>([]);
  const [pastLoading, setPastLoading] = useState(true);
  const [expandedPast, setExpandedPast] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPastQueries();
  }, [projectId]);

  async function loadPastQueries() {
    setPastLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/blast-radius`);
      if (r.ok) {
        const d = await r.json();
        setPastQueries(d.queries ?? []);
      }
    } finally {
      setPastLoading(false);
    }
  }

  function handleFileInputChange(val: string) {
    setFilePath(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setFileOptions([]); setShowAutocomplete(false); return; }
    debounceRef.current = setTimeout(async () => {
      const r = await fetch(`/api/projects/${projectId}/blast-radius/files?q=${encodeURIComponent(val)}`);
      if (r.ok) {
        const d = await r.json();
        setFileOptions(d.files ?? []);
        setShowAutocomplete((d.files ?? []).length > 0);
      }
    }, 250);
  }

  async function runAnalysis() {
    if (!filePath.trim() || !changeDesc.trim()) return;
    setPhase("traversing");
    setAffectedFiles([]);
    setIntentSnapshots([]);
    setStreamText("");
    setResult(null);
    setErrorMsg("");

    try {
      const response = await fetch(`/api/projects/${projectId}/blast-radius`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_path:         filePath.trim(),
          change_description: changeDesc.trim(),
          analysis_name:     analysisName.trim() || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        setPhase("error");
        setErrorMsg("Request failed. Check the file path and try again.");
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const lines = raw.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.slice(7).trim();
          let data: unknown;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }

          if (eventName === "affected_files") {
            const d = data as { files: BlastFile[] };
            setAffectedFiles(d.files ?? []);
            setPhase("intenting");
          } else if (eventName === "intent_snapshots") {
            const d = data as { snapshots: BlastSnapshot[] };
            setIntentSnapshots(d.snapshots ?? []);
            setPhase("synthesizing");
          } else if (eventName === "token") {
            const d = data as { text: string };
            setStreamText((prev) => prev + d.text);
          } else if (eventName === "result") {
            setResult(data as BlastResult);
            setPhase("done");
            loadPastQueries();
          } else if (eventName === "error") {
            const d = data as { message: string };
            setPhase("error");
            setErrorMsg(d.message ?? "Analysis failed");
          }
        }
      }
    } catch {
      setPhase("error");
      setErrorMsg("Connection error. Please try again.");
    }
  }

  function buildMarkdown(): string {
    if (!result) return "";
    const lines: string[] = [
      "## Blast Radius Analysis",
      "",
      `**File changed:** \`${filePath}\``,
      `**Change:** ${changeDesc}`,
      `**Risk level:** ${result.risk_level}`,
      "",
      "### Affected Files",
      "",
      "| File | Impact | Hops |",
      "|------|--------|------|",
      ...affectedFiles.slice(0, 20).map((f) =>
        `| \`${f.file_path}\` | ${f.impact_level} | ${f.hops} |`
      ),
      "",
      "### Historical Intent",
      "",
      ...intentSnapshots.map((s) => [
        `**${s.title}** (${new Date(s.created_at).toLocaleDateString()})`,
        s.decision ? `> Decision: ${s.decision}` : "",
        s.summary ? `> ${s.summary.slice(0, 200)}` : "",
        "",
      ].filter(Boolean).join("\n")),
      "### Risk Summary",
      "",
      result.risk_summary,
      "",
      "### Files to Update",
      "",
      ...result.files_to_update.map((f) => `- \`${f}\``),
      "",
      `---`,
      `*Generated by ENGRAM Blast Radius Engine — ${new Date().toLocaleString()}*`,
    ];
    return lines.join("\n");
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(buildMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isRunning = phase === "traversing" || phase === "intenting" || phase === "synthesizing";

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-orange-500/10 border border-orange-500/20 shrink-0">
          <Target className="h-5 w-5 text-orange-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gh-text">Blast Radius Engine</h2>
          <p className="text-xs text-gh-muted mt-0.5">
            Discover which files break and which AI decisions explain why — before you make the change.
          </p>
        </div>
      </div>

      {/* ── Query form ────────────────────────────────────── */}
      <div className="rounded-lg border border-gh-border bg-gh-canvas p-5 space-y-4">
        <div className="space-y-1 relative">
          <label className="text-xs font-medium text-gh-muted uppercase tracking-wider">File to change</label>
          <div className="relative">
            <FileCode className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gh-muted" />
            <input
              ref={fileInputRef}
              type="text"
              value={filePath}
              onChange={(e) => handleFileInputChange(e.target.value)}
              onFocus={() => { if (fileOptions.length > 0) setShowAutocomplete(true); }}
              onBlur={() => setTimeout(() => setShowAutocomplete(false), 150)}
              placeholder="src/auth/middleware.ts"
              className="w-full pl-9 pr-3 py-2 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-text placeholder:text-gh-muted/50 focus:outline-none focus:ring-1 focus:ring-engram/50 font-mono"
              disabled={isRunning}
            />
          </div>
          {showAutocomplete && (
            <div className="absolute z-30 mt-1 w-full rounded-md border border-gh-border bg-gh-canvas shadow-lg">
              {fileOptions.map((f) => (
                <button key={f} onMouseDown={() => { setFilePath(f); setShowAutocomplete(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono text-gh-text hover:bg-gh-bg truncate">
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gh-muted uppercase tracking-wider">What are you changing?</label>
          <textarea
            rows={3}
            value={changeDesc}
            onChange={(e) => setChangeDesc(e.target.value)}
            placeholder="e.g. Change JWT expiration from 15 minutes to 7 days"
            className="w-full px-3 py-2 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-text placeholder:text-gh-muted/50 focus:outline-none focus:ring-1 focus:ring-engram/50 resize-none"
            disabled={isRunning}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gh-muted uppercase tracking-wider">
            Analysis name <span className="normal-case text-gh-muted/60">(optional)</span>
          </label>
          <input
            type="text"
            value={analysisName}
            onChange={(e) => setAnalysisName(e.target.value)}
            placeholder="e.g. JWT expiry change — pre-release review"
            className="w-full px-3 py-2 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-text placeholder:text-gh-muted/50 focus:outline-none focus:ring-1 focus:ring-engram/50"
            disabled={isRunning}
          />
        </div>

        <button
          onClick={runAnalysis}
          disabled={isRunning || !filePath.trim() || !changeDesc.trim()}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
            isRunning || !filePath.trim() || !changeDesc.trim()
              ? "bg-gh-border text-gh-muted cursor-not-allowed"
              : "bg-orange-500/90 hover:bg-orange-500 text-white"
          )}>
          {isRunning
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analysing…</>
            : <><Zap className="h-3.5 w-3.5" /> Analyse Blast Radius</>}
        </button>
      </div>

      {/* ── Progress indicator ────────────────────────────── */}
      {isRunning && (
        <div className="flex items-center gap-6 text-xs text-gh-muted px-1">
          {[
            { key: "traversing", label: "Traversing AST graph" },
            { key: "intenting",  label: "Retrieving intent" },
            { key: "synthesizing", label: "Synthesising with Claude" },
          ].map(({ key, label }) => {
            const phases = ["traversing", "intenting", "synthesizing", "done"];
            const activeIdx = phases.indexOf(phase);
            const thisIdx = phases.indexOf(key);
            const isActive = key === phase;
            const isDone = thisIdx < activeIdx;
            return (
              <span key={key} className={cn("flex items-center gap-1.5 transition-colors",
                isDone ? "text-green-400" : isActive ? "text-gh-text" : "text-gh-muted/40")}>
                {isDone ? <CheckCircle2 className="h-3 w-3" /> :
                 isActive ? <Loader2 className="h-3 w-3 animate-spin" /> :
                 <div className="h-3 w-3 rounded-full border border-gh-border" />}
                {label}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Error state ───────────────────────────────────── */}
      {phase === "error" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-red-400/30 bg-red-400/5 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      {/* ── Saved confirmation ────────────────────────────── */}
      {phase === "done" && result && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-green-400/25 bg-green-400/5 text-xs text-green-400">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            Analysis saved
            {analysisName.trim() && (
              <> as <span className="font-medium">&ldquo;{analysisName.trim()}&rdquo;</span></>
            )}
            {" "}— visible in Past Analyses below.
          </span>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────── */}
      {(affectedFiles.length > 0 || intentSnapshots.length > 0 || streamText || result) && (
        <div className="space-y-4">
          {/* Affected Files — bidirectional */}
          {affectedFiles.length > 0 && (() => {
            const reverseFiles = affectedFiles.filter((f) => f.direction === "reverse");
            const forwardFiles = affectedFiles.filter((f) => f.direction === "forward");
            const renderFileRow = (f: BlastFile) => (
              <div key={`${f.direction}-${f.file_path}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border shrink-0", IMPACT_COLORS[f.impact_level])}>
                  {f.impact_level}
                </span>
                <code className="text-xs text-gh-text flex-1 min-w-0 truncate">{f.file_path}</code>
                <span className="text-[10px] text-gh-muted shrink-0 hidden sm:block">
                  via <code className="text-engram-light">{f.via_file.split("/").pop()}</code>
                  {f.via_symbol ? ` · ${f.via_symbol}` : ""}
                </span>
                <span className="text-[10px] text-gh-muted shrink-0">{f.hops}h</span>
              </div>
            );
            return (
              <div className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
                <div className="px-4 py-3 border-b border-gh-border flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-400" />
                  <span className="text-sm font-medium text-gh-text">Affected Files</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-400/10 border border-orange-400/25 text-orange-400">
                    {affectedFiles.length} file{affectedFiles.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {/* Reverse: files that depend on (will break) */}
                {reverseFiles.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-red-400/5 border-b border-gh-border flex items-center gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-red-400">
                        Dependents — will break if the interface changes
                      </span>
                      <span className="text-[10px] text-red-400/70">({reverseFiles.length})</span>
                    </div>
                    <div className="divide-y divide-gh-border">
                      {reverseFiles.slice(0, 20).map(renderFileRow)}
                      {reverseFiles.length > 20 && (
                        <p className="px-4 py-2 text-xs text-gh-muted">…and {reverseFiles.length - 20} more</p>
                      )}
                    </div>
                  </>
                )}
                {/* Forward: files this file imports (context) */}
                {forwardFiles.length > 0 && (
                  <>
                    <div className="px-4 py-2 bg-blue-400/5 border-y border-gh-border flex items-center gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-blue-400">
                        Dependencies — files this file relies on
                      </span>
                      <span className="text-[10px] text-blue-400/70">({forwardFiles.length})</span>
                    </div>
                    <div className="divide-y divide-gh-border">
                      {forwardFiles.slice(0, 20).map(renderFileRow)}
                      {forwardFiles.length > 20 && (
                        <p className="px-4 py-2 text-xs text-gh-muted">…and {forwardFiles.length - 20} more</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Historical Intent */}
          {(intentSnapshots.length > 0 || phase === "done") && (
            <div className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
              <div className="px-4 py-3 border-b border-gh-border flex items-center gap-2">
                <History className="h-4 w-4 text-engram-light" />
                <span className="text-sm font-medium text-gh-text">Historical Intent</span>
                {intentSnapshots.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-engram/10 border border-engram/25 text-engram-light">
                    {intentSnapshots.length} conversation{intentSnapshots.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {intentSnapshots.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-4 text-xs text-gh-muted">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  No AI conversations found for this file or change. Capture more sessions to build ENGRAM memory.
                </div>
              ) : (
                <div className="divide-y divide-gh-border">
                  {intentSnapshots.map((s) => (
                    <div key={s.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("text-[10px] font-mono uppercase tracking-wider", TOOL_TEXT[s.ai_tool] ?? "text-gh-muted")}>
                          {TOOL_LABEL[s.ai_tool] ?? s.ai_tool}
                        </span>
                        <span className="text-[10px] text-gh-muted">
                          {new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <span className={cn("text-[10px] px-1 py-0.5 rounded",
                          s.source === "both" ? "text-engram-light bg-engram/10" :
                          s.source === "commit_link" ? "text-orange-400/80 bg-orange-400/5" :
                          "text-gh-muted bg-gh-bg")}>
                          {s.source === "both" ? "commit + semantic" : s.source === "commit_link" ? "commit linked" : "semantic"}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gh-text leading-snug">{s.title}</p>
                      {s.decision && (
                        <div className="mt-1 flex items-start gap-1">
                          <span className="text-[10px] font-mono text-engram-light shrink-0 mt-0.5">DECISION</span>
                          <p className="text-xs text-gh-muted">{s.decision}</p>
                        </div>
                      )}
                      {s.summary && !s.decision && (
                        <p className="text-xs text-gh-muted mt-1 line-clamp-2">{s.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Risk Summary */}
          {(streamText || result) && (
            <div className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
              <div className="px-4 py-3 border-b border-gh-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-gh-muted" />
                  <span className="text-sm font-medium text-gh-text">Risk Summary</span>
                  {result && (
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", RISK_COLORS[result.risk_level])}>
                      {result.risk_level}
                    </span>
                  )}
                </div>
                {result && (
                  <button onClick={copyMarkdown}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-gh-border text-gh-muted hover:text-gh-text hover:border-gh-muted/50 transition-colors">
                    {copied ? <><Check className="h-3 w-3 text-green-400" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy as Markdown</>}
                  </button>
                )}
              </div>
              <div className="px-4 py-4">
                <p className="text-sm text-gh-text leading-relaxed whitespace-pre-wrap">
                  {streamText || result?.risk_summary}
                </p>
                {phase === "synthesizing" && (
                  <span className="inline-block w-1 h-3.5 bg-engram ml-0.5 animate-pulse" />
                )}
                {result?.files_to_update && result.files_to_update.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gh-border">
                    <p className="text-xs font-medium text-gh-muted uppercase tracking-wider mb-2">Files to update</p>
                    <div className="space-y-1">
                      {result.files_to_update.map((f) => (
                        <div key={f} className="flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-orange-400 shrink-0" />
                          <code className="text-xs text-gh-text">{f}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result && (
                  <div className="mt-4 pt-3 border-t border-gh-border flex items-center gap-4 text-[10px] text-gh-muted">
                    <span>{result.stats.edges_traversed} AST edges traversed</span>
                    <span>{result.stats.links_found} semantic link{result.stats.links_found !== 1 ? "s" : ""}</span>
                    <span>{result.stats.affected_count} file{result.stats.affected_count !== 1 ? "s" : ""} affected</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Past Analyses ─────────────────────────────────── */}
      <div className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
        <button
          onClick={() => setShowPast((p) => !p)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gh-bg transition-colors">
          <div className="flex items-center gap-2 text-sm font-medium text-gh-muted">
            <History className="h-4 w-4" />
            Past Analyses
            {!pastLoading && pastQueries.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gh-bg border border-gh-border text-gh-muted">
                {pastQueries.length}
              </span>
            )}
          </div>
          {showPast ? <ChevronUp className="h-4 w-4 text-gh-muted" /> : <ChevronDown className="h-4 w-4 text-gh-muted" />}
        </button>
        {showPast && (
          <div className="border-t border-gh-border divide-y divide-gh-border">
            {pastLoading ? (
              <div className="px-4 py-6 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gh-muted" />
              </div>
            ) : pastQueries.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gh-muted">No past analyses yet.</p>
            ) : (
              pastQueries.map((q) => (
                <div key={q.id}>
                  <button
                    onClick={() => setExpandedPast(expandedPast === q.id ? null : q.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gh-bg transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {q.risk_level && (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", RISK_COLORS[q.risk_level])}>
                            {q.risk_level}
                          </span>
                        )}
                        {q.analysis_name
                          ? <span className="text-xs font-medium text-gh-text truncate">{q.analysis_name}</span>
                          : <code className="text-xs text-engram-light truncate">{q.query_file}</code>}
                      </div>
                      <p className="text-xs text-gh-muted truncate">
                        {q.analysis_name && <code className="text-engram-light/70 mr-1">{q.query_file}</code>}
                        {q.change_description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-gh-muted">
                        {new Date(q.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <ChevronDown className={cn("h-3.5 w-3.5 text-gh-muted transition-transform",
                        expandedPast === q.id && "rotate-180")} />
                    </div>
                  </button>
                  {expandedPast === q.id && (
                    <div className="px-4 pb-4 space-y-3 bg-gh-bg/30">
                      {q.risk_summary && (
                        <p className="text-xs text-gh-muted leading-relaxed">{q.risk_summary.slice(0, 400)}</p>
                      )}
                      <div className="flex items-center gap-4 text-[10px] text-gh-muted">
                        <span>{(q.affected_files ?? []).length} files affected</span>
                        <span>{q.ast_edges_traversed} AST edges</span>
                        <span>{q.semantic_links_found} semantic links</span>
                      </div>
                      <button
                        onClick={() => {
                          setFilePath(q.query_file);
                          setChangeDesc(q.change_description);
                        }}
                        className="text-xs text-engram-light hover:underline">
                        Re-run this analysis →
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Loading skeleton ─────────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-gh-border bg-gh-bg px-6 md:px-10 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="h-4 w-32 bg-gh-canvas rounded animate-pulse mb-4" />
          <div className="h-6 w-48 bg-gh-canvas rounded animate-pulse mb-2" />
          <div className="h-3 w-64 bg-gh-canvas rounded animate-pulse" />
        </div>
      </div>
      <div className="px-6 md:px-10 py-8 max-w-6xl mx-auto space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-gh-canvas rounded-lg border border-gh-border animate-pulse" />
        ))}
      </div>
    </div>
  );
}
