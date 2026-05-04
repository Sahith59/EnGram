"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  FolderGit2, Plus, Github, Lock, Globe, Users,
  GitCommit, MessageSquare, ChevronRight, Loader2,
  BookOpen, Sparkles, Archive, Clock,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Member = { user_id: string; role: string };
type RecentSnap = { id: string; title: string; ai_tool: string; created_at: string; author_handle: string | null };
type Repo = {
  repo_full_name: string; repo_name: string; owner_login: string;
  file_count: number; chunk_count: number; is_private: boolean; indexed_at: string | null;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  snapshot_count: number;
  updated_at: string;
  created_at: string;
  github_repo_id: string | null;
  repo: Repo | null;
  members: Member[];
  member_count: number;
  recent_snapshots: RecentSnap[];
  is_owner: boolean;
  is_member: boolean;
  is_archived: boolean;
  is_dormant: boolean;
  last_capture_at: string | null;
  days_since_capture: number | null;
};

const TOOL_COLOR: Record<string, string> = {
  chatgpt: "text-tool-chatgpt", claude: "text-tool-claude", gemini: "text-tool-gemini",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/projects");
      const d = await r.json();
      setProjects(d.projects ?? []);
      if (d.migration_needed) setMigrationNeeded(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createProject() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      setCreating(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  const activeProjects = projects.filter((p) => !p.is_archived);
  const archivedProjects = projects.filter((p) => p.is_archived);
  const repoProjects = activeProjects.filter((p) => p.github_repo_id);
  const manualProjects = activeProjects.filter((p) => !p.github_repo_id);

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">workspaces</p>
          <h1 className="text-3xl font-semibold tracking-tight text-gh-text">Projects</h1>
          <p className="text-sm text-gh-muted mt-1">
            Each GitHub repo becomes an isolated project with its own Ask, Feed, and team.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 transition-colors"
        >
          <Plus className="h-4 w-4" />New project
        </button>
      </motion.div>

      {migrationNeeded && (
        <div className="mb-6 p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <p className="text-xs text-amber-400 font-medium mb-1">Migration needed</p>
          <p className="text-xs text-gh-muted">
            Run migration 0013 in Supabase SQL Editor to unlock repo-linked projects and member management.
          </p>
          <Link href="/setup" className="text-xs text-engram-light hover:underline mt-1 inline-block">Go to DB Setup →</Link>
        </div>
      )}

      {creating && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-lg border border-engram/30 bg-engram/5">
          <p className="text-sm text-gh-muted mb-3">Name your new project</p>
          <div className="flex gap-2">
            <input autoFocus value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createProject(); if (e.key === "Escape") setCreating(false); }}
              placeholder="e.g. Payment Integration, CLI Tool…"
              className="flex-1 bg-gh-canvas border border-gh-border rounded-md px-3 py-2 text-sm text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram"
            />
            <button onClick={createProject} disabled={saving || !newName.trim()}
              className="px-3 py-2 rounded-md bg-engram text-white text-sm hover:bg-engram/90 disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Create
            </button>
            <button onClick={() => setCreating(false)} className="px-3 py-2 rounded-md border border-gh-border text-sm text-gh-muted hover:text-gh-text">Cancel</button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <FolderGit2 className="h-12 w-12 text-gh-muted/30 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gh-text mb-2">No projects yet</h3>
          <p className="text-sm text-gh-muted max-w-sm mx-auto mb-6">
            Index a GitHub repository to automatically create a project workspace, or create one manually.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/settings/github"
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 transition-colors">
              <Github className="h-4 w-4" />Connect GitHub
            </Link>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-gh-border text-sm text-gh-text hover:border-engram/40 transition-colors">
              <Plus className="h-4 w-4" />New project
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GitHub-linked projects */}
          {repoProjects.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Github className="h-3.5 w-3.5 text-gh-muted" />
                <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
                  Repository Workspaces ({repoProjects.length})
                </h2>
              </div>
              <div className="space-y-3">
                {repoProjects.map((proj, i) => (
                  <ProjectCard key={proj.id} proj={proj} i={i} />
                ))}
              </div>
            </section>
          )}

          {/* Manual projects */}
          {manualProjects.length > 0 && (
            <section>
              {repoProjects.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <FolderGit2 className="h-3.5 w-3.5 text-gh-muted" />
                  <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted">
                    Manual Projects ({manualProjects.length})
                  </h2>
                </div>
              )}
              <div className="space-y-3">
                {manualProjects.map((proj, i) => (
                  <ProjectCard key={proj.id} proj={proj} i={i} />
                ))}
              </div>
            </section>
          )}

          {/* Archived projects — collapsed section */}
          <ArchivedProjectsSection projects={archivedProjects} />
        </div>
      )}
    </div>
  );
}

function ProjectCard({ proj, i }: { proj: Project; i: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }}
      className="rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 transition-all duration-200 group"
    >
      <Link href={`/projects/${proj.id}`} className="block p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center shrink-0 border",
            proj.repo ? "bg-gh-bg border-gh-border" : "bg-engram/10 border-engram/20"
          )}>
            {proj.repo
              ? <Github className="h-5 w-5 text-gh-text" />
              : <FolderGit2 className="h-5 w-5 text-engram-light" />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gh-text group-hover:text-engram-light transition-colors">
                {proj.name}
              </h3>
              {proj.repo && (
                <>
                  {proj.repo.is_private
                    ? <Lock className="h-3 w-3 text-gh-muted" />
                    : <Globe className="h-3 w-3 text-gh-muted" />}
                  <span className="text-[10px] text-gh-muted font-mono bg-gh-bg border border-gh-border px-1.5 py-0.5 rounded">
                    {proj.repo.owner_login}/{proj.repo.repo_name}
                  </span>
                </>
              )}
              <ChevronRight className="h-3.5 w-3.5 text-gh-muted ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-gh-muted mb-3">
              {proj.repo && (
                <>
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />{proj.repo.file_count.toLocaleString()} files
                  </span>
                  <span className="flex items-center gap-1">
                    <GitCommit className="h-3 w-3 text-engram-light/70" />commits indexed
                  </span>
                </>
              )}
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />{proj.snapshot_count} capture{proj.snapshot_count !== 1 ? "s" : ""}
              </span>
              <span>Updated {new Date(proj.updated_at).toLocaleDateString()}</span>
            </div>

            {/* Bottom row: members + recent snaps */}
            <div className="flex items-center justify-between gap-4">
              {/* Member avatars */}
              <div className="flex items-center gap-2">
                {proj.member_count > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <div className="flex -space-x-1.5">
                      {proj.members.slice(0, 4).map((m, idx) => (
                        <div key={m.user_id}
                          style={{ zIndex: 4 - idx }}
                          className="h-6 w-6 rounded-full bg-engram/20 border-2 border-gh-canvas flex items-center justify-center relative">
                          <Users className="h-3 w-3 text-engram-light" />
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-gh-muted">
                      {proj.member_count} member{proj.member_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gh-muted flex items-center gap-1">
                    <Users className="h-3 w-3" />No members yet
                  </span>
                )}
              </div>

              {/* Recent snapshots */}
              {proj.recent_snapshots.length > 0 && (
                <div className="flex gap-1 overflow-hidden">
                  {proj.recent_snapshots.slice(0, 2).map((s) => (
                    <span key={s.id}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full border border-gh-border bg-gh-bg truncate max-w-[160px]",
                        TOOL_COLOR[s.ai_tool] ?? "text-gh-muted"
                      )}>
                      {s.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Quick actions */}
      <div className="border-t border-gh-border/50 px-5 py-2.5 flex items-center gap-3">
        <Link href={`/projects/${proj.id}?tab=ask`}
          className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-engram-light transition-colors">
          <Sparkles className="h-3 w-3" />Ask ENGRAM
        </Link>
        <span className="text-gh-border">·</span>
        <Link href={`/projects/${proj.id}?tab=feed`}
          className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors">
          <MessageSquare className="h-3 w-3" />Feed
        </Link>
        <span className="text-gh-border">·</span>
        <Link href={`/projects/${proj.id}?tab=members`}
          className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors">
          <Users className="h-3 w-3" />Members
        </Link>
        {proj.repo && (
          <>
            <span className="text-gh-border">·</span>
            <a href={`https://github.com/${proj.repo.repo_full_name}`} target="_blank" rel="noopener"
              className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors ml-auto">
              <Github className="h-3 w-3" />GitHub
            </a>
          </>
        )}
        {/* Dormant badge */}
        {proj.is_dormant && (
          <span className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-gh-border text-gh-muted bg-gh-bg">
            <Clock className="h-2.5 w-2.5" />
            {proj.days_since_capture != null ? `Dormant ${proj.days_since_capture}d` : "Dormant"}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function ArchivedProjectsSection({ projects }: { projects: Project[] }) {
  const [expanded, setExpanded] = useState(false);
  if (projects.length === 0) return null;
  return (
    <section className="mt-8">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 mb-3 text-xs text-gh-muted hover:text-gh-text transition-colors"
      >
        <Archive className="h-3.5 w-3.5" />
        <span className="font-mono uppercase tracking-wider">
          Archived ({projects.length})
        </span>
        <span className="ml-1">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="space-y-2 opacity-60">
          {projects.map((proj) => (
            <Link key={proj.id} href={`/projects/${proj.id}`}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gh-border bg-gh-canvas hover:border-gh-muted/50 transition-colors">
              <Archive className="h-4 w-4 text-gh-muted shrink-0" />
              <span className="text-sm text-gh-text">{proj.name}</span>
              {proj.repo && (
                <span className="text-[10px] text-gh-muted font-mono">
                  {proj.repo.repo_full_name}
                </span>
              )}
              <span className="ml-auto text-[10px] text-gh-muted flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {proj.last_capture_at
                  ? `${proj.days_since_capture}d dormant`
                  : "No captures"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
