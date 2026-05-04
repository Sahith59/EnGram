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
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────── */
type Repo = {
  id: string; repo_full_name: string; repo_name: string; owner_login: string;
  file_count: number; chunk_count: number; is_private: boolean;
  indexed_at: string | null; default_branch: string | null;
  last_indexed_commit: string | null;
};
type MemberProfile = { id: string; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string | null };
type Member = { id: string; user_id: string; role: string; joined_at: string; profile: MemberProfile | null; is_self: boolean };
type Snapshot = {
  id: string; title: string; summary: string | null; ai_tool: string;
  tags: string[]; decision: string | null; created_at: string;
  visibility: string; author_handle: string | null;
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

type Tab = "feed" | "ask" | "brief" | "members";

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
            {(["feed", "ask", "brief", "members"] as Tab[]).map((tab) => (
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
                {tab === "members" && <Users className="h-3.5 w-3.5" />}
                {tab === "brief" ? "Trust Brief" : tab.charAt(0).toUpperCase() + tab.slice(1)}
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
            ))}
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
              <FeedTab snapshots={snapshots} projectName={project.name} projectId={projectId} />
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
function FeedTab({ snapshots, projectName, projectId }: { snapshots: Snapshot[]; projectName: string; projectId: string }) {
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
          {snapshots.map((snap, i) => (
            <motion.div key={snap.id}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="relative">
              <div className="absolute -left-6 top-4 flex items-center justify-center">
                <div className={cn("h-3.5 w-3.5 rounded-full border-2 border-gh-bg", TOOL_DOT[snap.ai_tool] ?? "bg-gh-muted")} />
              </div>
              <div className="rounded-lg border border-gh-border bg-gh-canvas p-4 hover:border-engram/40 transition-colors group">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
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
                  <Link href={`/context/${snap.id}`}
                    className="shrink-0 p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
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
        </div>
        {repo ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <a
                  href={`https://github.com/${repo.repo_full_name}`}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1.5 text-sm text-gh-text hover:text-engram-light transition-colors font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {repo.repo_full_name}
                </a>
                <div className="flex items-center gap-3 mt-1 text-xs text-gh-muted">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />{repo.default_branch ?? "main"}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />{repo.file_count.toLocaleString()} files
                  </span>
                  {repo.is_private && (
                    <span className="flex items-center gap-1"><Lock className="h-3 w-3" />Private</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                {repo.last_indexed_commit ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
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
                    Indexed {new Date(repo.indexed_at).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
            {!repo.last_indexed_commit && (
              <div className="text-xs text-gh-muted bg-gh-bg border border-gh-border rounded-md px-3 py-2">
                AST indexing starts automatically on the next push event. Connect a webhook in your GitHub App settings to enable this.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-gh-muted">
            No code repository linked to this project yet. Add a GitHub repository in the project settings to enable codebase search and AST analysis.
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
