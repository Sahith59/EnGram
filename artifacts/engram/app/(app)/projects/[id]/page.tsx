"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  FolderGit2, ArrowLeft, Clock, Sparkles, ChevronRight,
  Copy, Check, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Snapshot = {
  id: string;
  title: string;
  summary: string | null;
  ai_tool: string;
  tags: string[];
  decision: string | null;
  created_at: string;
  visibility: string;
  author_handle: string | null;
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  snapshot_count: number;
  created_at: string;
  updated_at: string;
};

const TOOL_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", other: "Other",
};
const TOOL_DOT: Record<string, string> = {
  chatgpt: "bg-tool-chatgpt", claude: "bg-tool-claude",
  gemini: "bg-tool-gemini", other: "bg-gh-muted",
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mergedBrief, setMergedBrief] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) { router.push("/projects"); return; }
      const d = await r.json();
      setProject(d.project);
      setSnapshots(d.snapshots ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function generateMergedBrief() {
    setGenerating(true);
    setMergedBrief(null);
    try {
      const contextParts = snapshots.map((s, i) =>
        `## Session ${i + 1}: ${s.title} (${TOOL_LABEL[s.ai_tool]}, ${new Date(s.created_at).toLocaleDateString()})\n\n${s.summary ?? ""}\n\n**Key Decisions:** ${s.decision ?? "None"}`
      ).join("\n\n---\n\n");

      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: `Synthesize a unified project brief for "${project?.name}" that merges all the sessions into a coherent current state. What is the current state of the project? What are the key decisions made across all sessions? What are the immediate next steps?`,
          scope: "all",
        }),
      });
      const d = await r.json();
      setMergedBrief(d.answer ?? "Could not generate brief.");
    } finally {
      setGenerating(false);
    }
  }

  function copyBrief() {
    if (!mergedBrief) return;
    navigator.clipboard.writeText(mergedBrief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
        <div className="h-8 w-48 rounded bg-gh-canvas animate-pulse mb-8" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-lg border border-gh-border bg-gh-canvas animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <Link href="/projects" className="flex items-center gap-1.5 text-sm text-gh-muted hover:text-gh-text mb-6 transition-colors w-fit">
          <ArrowLeft className="h-3.5 w-3.5" /> All Projects
        </Link>

        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <FolderGit2 className="h-6 w-6 text-engram-light" />
              <h1 className="text-2xl font-semibold tracking-tight text-gh-text">{project.name}</h1>
            </div>
            <div className="flex items-center gap-4 text-xs text-gh-muted">
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{snapshots.length} session{snapshots.length !== 1 ? "s" : ""}</span>
              <span>Started {new Date(project.created_at).toLocaleDateString()}</span>
              <span>Last active {new Date(project.updated_at).toLocaleDateString()}</span>
            </div>
          </div>
          <button
            onClick={generateMergedBrief}
            disabled={generating || snapshots.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-engram text-white text-sm font-medium hover:bg-engram/90 disabled:opacity-50 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            {generating ? "Generating…" : "Merge Brief"}
          </button>
        </div>

        {mergedBrief && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 rounded-lg border border-engram/30 bg-engram/5 p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-engram-light">
                <Sparkles className="h-4 w-4" />
                Unified Project Brief
              </div>
              <button
                onClick={copyBrief}
                className="flex items-center gap-1.5 text-xs text-gh-muted hover:text-gh-text transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-sm text-gh-text leading-relaxed whitespace-pre-wrap">{mergedBrief}</p>
          </motion.div>
        )}

        <div className="mb-4">
          <h2 className="text-xs font-mono uppercase tracking-wider text-gh-muted mb-3">
            Session Timeline — {snapshots.length} capture{snapshots.length !== 1 ? "s" : ""}
          </h2>

          <div className="relative">
            <div className="absolute left-[7px] top-0 bottom-0 w-px bg-gh-border" />
            <div className="space-y-3 pl-6">
              {snapshots.map((snap, i) => (
                <motion.div
                  key={snap.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="relative"
                >
                  <div className="absolute -left-6 top-3.5 flex items-center justify-center">
                    <div className={cn("h-3.5 w-3.5 rounded-full border-2 border-gh-bg", TOOL_DOT[snap.ai_tool] ?? "bg-gh-muted")} />
                  </div>
                  <div className="rounded-lg border border-gh-border bg-gh-canvas p-4 hover:border-engram/40 transition-colors group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn("text-[10px] font-mono uppercase tracking-wider", TOOL_DOT[snap.ai_tool] ? `text-${snap.ai_tool === "chatgpt" ? "tool-chatgpt" : snap.ai_tool === "claude" ? "tool-claude" : "tool-gemini"}` : "text-gh-muted")}>
                            {TOOL_LABEL[snap.ai_tool] ?? snap.ai_tool}
                          </span>
                          <span className="text-[10px] text-gh-muted">
                            {new Date(snap.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                          {snap.author_handle && snap.visibility === "team" && (
                            <span className="text-[10px] text-gh-muted">· {snap.author_handle}</span>
                          )}
                        </div>
                        <h3 className="font-medium text-gh-text text-sm mb-1 leading-snug">{snap.title}</h3>
                        {snap.summary && (
                          <p className="text-xs text-gh-muted leading-relaxed line-clamp-2">{snap.summary}</p>
                        )}
                        {snap.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {snap.tags.slice(0, 5).map((tag) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-gh-muted">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Link
                        href={`/context/${snap.id}`}
                        className="shrink-0 p-1.5 rounded hover:bg-gh-bg text-gh-muted hover:text-gh-text transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
