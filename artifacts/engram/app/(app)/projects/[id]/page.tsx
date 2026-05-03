"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderGit2, ArrowLeft, Github, Lock, Globe, Users, BookOpen,
  GitCommit, MessageSquare, Sparkles, ExternalLink, Clock,
  Crown, UserPlus, Trash2, Copy, Check, Send, Loader2,
  ChevronRight, X, GitBranch,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────── */
type Repo = {
  id: string; repo_full_name: string; repo_name: string; owner_login: string;
  file_count: number; chunk_count: number; is_private: boolean;
  indexed_at: string | null; default_branch: string | null;
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
};
type AskSource = { type: "snapshot" | "github"; title: string; excerpt: string; tool?: string; path?: string; language?: string };

/* ─── Helpers ────────────────────────────────────────────── */
const TOOL_LABEL: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", other: "Other" };
const TOOL_DOT: Record<string, string> = { chatgpt: "bg-tool-chatgpt", claude: "bg-tool-claude", gemini: "bg-tool-gemini", other: "bg-gh-muted" };
const TOOL_TEXT: Record<string, string> = { chatgpt: "text-tool-chatgpt", claude: "text-tool-claude", gemini: "text-tool-gemini" };

type Tab = "feed" | "ask" | "members";

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
                      <span className="flex items-center gap-1"><GitCommit className="h-3 w-3 text-engram-light/70" />commits indexed</span>
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
            {(["feed", "ask", "members"] as Tab[]).map((tab) => (
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
                {tab === "members" && <Users className="h-3.5 w-3.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
          {activeTab === "members" && (
            <motion.div key="members" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <MembersTab
                projectId={projectId} members={members}
                isOwner={project.is_owner} onRefresh={load}
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
      {/* Context badge */}
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

      {/* Conversation history */}
      {history.length > 0 && (
        <div className="space-y-6 mb-8">
          {history.map((item, i) => (
            <div key={i} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-engram text-white rounded-lg px-4 py-2.5 text-sm">
                  {item.q}
                </div>
              </div>
              <div className="rounded-lg border border-gh-border bg-gh-canvas p-4">
                <p className="text-sm text-gh-text leading-relaxed whitespace-pre-wrap">{item.a}</p>
                {item.sources.length > 0 && <SourcesList sources={item.sources} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Live answer */}
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

      {/* Suggestions */}
      {history.length === 0 && !loading && (
        <div className="mb-6 grid grid-cols-2 gap-2">
          {[
            "What are the key architectural decisions made?",
            "What is the current state of this project?",
            hasRepo ? "How does authentication work in this codebase?" : "What are the open questions?",
            hasRepo ? "What are the recent commits about?" : "What decisions are pending?",
          ].map((sug) => (
            <button key={sug} onClick={() => { setQuestion(sug); }}
              className="text-left text-xs text-gh-muted p-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 hover:text-gh-text transition-colors leading-relaxed">
              {sug}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
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
function MembersTab({ projectId, members, isOwner, onRefresh }: {
  projectId: string; members: Member[]; isOwner: boolean; onRefresh: () => void;
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
    <div className="max-w-2xl">
      {/* Invite section — only for owners */}
      {isOwner && (
        <div className="mb-8 p-5 rounded-lg border border-gh-border bg-gh-canvas">
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

      {/* Member list */}
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
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-full overflow-hidden bg-engram/20 border border-gh-border shrink-0 flex items-center justify-center">
                    {m.profile?.avatar_url
                      ? <img src={m.profile.avatar_url} alt={displayName} className="h-full w-full object-cover" />
                      : <span className="text-sm font-medium text-engram-light">
                          {displayName.charAt(0).toUpperCase()}
                        </span>}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gh-text truncate">{displayName}</span>
                      {m.is_self && <span className="text-[10px] text-gh-muted">(you)</span>}
                    </div>
                    {m.profile?.email && (
                      <p className="text-xs text-gh-muted truncate">{m.profile.email}</p>
                    )}
                    <p className="text-[10px] text-gh-muted">
                      Joined {new Date(m.joined_at).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Role badge */}
                  <div className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider shrink-0",
                    m.role === "owner" ? "bg-engram/10 text-engram-light border border-engram/20" : "bg-gh-bg text-gh-muted border border-gh-border"
                  )}>
                    {m.role === "owner" && <Crown className="h-2.5 w-2.5" />}
                    {m.role}
                  </div>

                  {/* Remove */}
                  {isOwner && !m.is_self && (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      disabled={removing === m.user_id}
                      className="p-1.5 rounded text-gh-muted hover:text-red-400 hover:bg-gh-bg transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      title="Remove member">
                      {removing === m.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

/* ─── Loading skeleton ───────────────────────────────────── */
function LoadingSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-gh-border bg-gh-bg px-6 md:px-10 py-4">
        <div className="max-w-6xl mx-auto space-y-3">
          <div className="h-4 w-40 rounded bg-gh-canvas animate-pulse" />
          <div className="h-8 w-72 rounded bg-gh-canvas animate-pulse" />
          <div className="h-4 w-96 rounded bg-gh-canvas animate-pulse" />
          <div className="flex gap-2 mt-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-8 w-20 rounded bg-gh-canvas animate-pulse" />)}
          </div>
        </div>
      </div>
      <div className="px-6 md:px-10 py-8 max-w-6xl mx-auto space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />)}
      </div>
    </div>
  );
}
