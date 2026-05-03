"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FolderGit2, Plus, ChevronRight, GitMerge, Trash2, Pencil, Check, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type RecentSnap = { id: string; title: string; ai_tool: string; created_at: string };
type Project = {
  id: string;
  name: string;
  description: string | null;
  snapshot_count: number;
  updated_at: string;
  recent_snapshots: RecentSnap[];
};

const TOOL_COLOR: Record<string, string> = {
  chatgpt: "text-tool-chatgpt",
  claude: "text-tool-claude",
  gemini: "text-tool-gemini",
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [mergeMode, setMergeMode] = useState<string | null>(null);
  const [mergeTo, setMergeTo] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/projects");
      const d = await r.json();
      setProjects(d.projects ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createProject() {
    if (!newName.trim()) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName("");
    setCreating(false);
    load();
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project? Snapshots will be unassigned but not deleted.")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    load();
  }

  async function renameProject(id: string) {
    if (!editName.trim()) return;
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    setEditingId(null);
    load();
  }

  async function mergeProject(srcId: string) {
    if (!mergeTo || mergeTo === srcId) return;
    if (!confirm("Merge this project into the selected one? This cannot be undone.")) return;
    await fetch(`/api/projects/${srcId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetProjectId: mergeTo }),
    });
    setMergeMode(null);
    setMergeTo("");
    load();
  }

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8 flex items-end justify-between"
      >
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
            auto-clustered memory
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-gh-text">Projects</h1>
          <p className="text-sm text-gh-muted mt-1">
            AI conversations are automatically grouped into projects by topic similarity.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New project
        </button>
      </motion.div>

      {creating && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-lg border border-engram/30 bg-engram/5"
        >
          <p className="text-sm text-gh-muted mb-3">Name your new project</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createProject(); if (e.key === "Escape") setCreating(false); }}
              placeholder="e.g. ENGRAM Build, Payment Integration..."
              className="flex-1 bg-gh-canvas border border-gh-border rounded-md px-3 py-2 text-sm text-gh-text placeholder:text-gh-muted focus:outline-none focus:border-engram"
            />
            <button onClick={createProject} className="px-3 py-2 rounded-md bg-engram text-white text-sm hover:bg-engram/90">Create</button>
            <button onClick={() => setCreating(false)} className="px-3 py-2 rounded-md border border-gh-border text-sm text-gh-muted hover:text-gh-text">Cancel</button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <FolderGit2 className="h-12 w-12 text-gh-muted/30 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gh-text mb-2">No projects yet</h3>
          <p className="text-sm text-gh-muted max-w-sm mx-auto">
            Projects are created automatically when you capture AI conversations.
            Each capture is clustered by topic — conversations about the same project
            get grouped together.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((proj, i) => (
            <motion.div
              key={proj.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-lg border border-gh-border bg-gh-canvas hover:border-engram/40 transition-colors group"
            >
              <div className="p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {editingId === proj.id ? (
                    <div className="flex gap-2 mb-2">
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") renameProject(proj.id); if (e.key === "Escape") setEditingId(null); }}
                        className="flex-1 bg-gh-bg border border-engram/50 rounded px-2 py-1 text-sm text-gh-text focus:outline-none"
                      />
                      <button onClick={() => renameProject(proj.id)} className="text-green-400 hover:text-green-300"><Check className="h-4 w-4" /></button>
                      <button onClick={() => setEditingId(null)} className="text-gh-muted hover:text-gh-text"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <Link href={`/projects/${proj.id}`}>
                      <h3 className="font-semibold text-gh-text group-hover:text-engram-light transition-colors mb-1 flex items-center gap-2">
                        <FolderGit2 className="h-4 w-4 text-engram-light shrink-0" />
                        {proj.name}
                        <ChevronRight className="h-3.5 w-3.5 text-gh-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      </h3>
                    </Link>
                  )}
                  <div className="flex items-center gap-4 text-xs text-gh-muted">
                    <span>{proj.snapshot_count} snapshot{proj.snapshot_count !== 1 ? "s" : ""}</span>
                    <span>Updated {new Date(proj.updated_at).toLocaleDateString()}</span>
                  </div>
                  {proj.recent_snapshots.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {proj.recent_snapshots.map((s) => (
                        <Link
                          key={s.id}
                          href={`/context/${s.id}`}
                          className={cn(
                            "text-[11px] px-2 py-0.5 rounded-full border border-gh-border bg-gh-bg hover:border-engram/40 transition-colors truncate max-w-[200px]",
                            TOOL_COLOR[s.ai_tool] ?? "text-gh-muted"
                          )}
                        >
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {mergeMode === proj.id ? (
                    <div className="flex items-center gap-2">
                      <select
                        value={mergeTo}
                        onChange={(e) => setMergeTo(e.target.value)}
                        className="bg-gh-bg border border-gh-border rounded px-2 py-1 text-xs text-gh-text focus:outline-none"
                      >
                        <option value="">Merge into…</option>
                        {projects.filter((p) => p.id !== proj.id).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button onClick={() => mergeProject(proj.id)} className="text-xs px-2 py-1 rounded bg-engram text-white hover:bg-engram/90">Go</button>
                      <button onClick={() => { setMergeMode(null); setMergeTo(""); }} className="text-gh-muted hover:text-gh-text"><X className="h-4 w-4" /></button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditingId(proj.id); setEditName(proj.name); }}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100"
                        title="Rename"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => { setMergeMode(proj.id); setMergeTo(""); }}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100"
                        title="Merge into another project"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => deleteProject(proj.id)}
                        className="p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete project"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
