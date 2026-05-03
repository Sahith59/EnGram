"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Trash2,
  Download,
  Check,
  ClipboardCopy,
  Loader2,
  FileText,
  X,
} from "lucide-react";
import { ToolBadge } from "@/components/context/ToolBadge";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { ContextSnapshot } from "@/types";

const tabs = [
  { id: "summary", label: "Summary" },
  { id: "context", label: "context.md" },
  { id: "raw", label: "Raw conversation" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function ContextDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ContextSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("summary");
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adrOpen, setAdrOpen] = useState(false);
  const [adrLoading, setAdrLoading] = useState(false);
  const [adrMarkdown, setAdrMarkdown] = useState<string | null>(null);
  const [adrFilename, setAdrFilename] = useState<string>("decision.md");
  const [adrError, setAdrError] = useState<string | null>(null);
  const [adrCopied, setAdrCopied] = useState(false);

  async function generateAdr() {
    setAdrOpen(true);
    setAdrError(null);
    setAdrMarkdown(null);
    setAdrLoading(true);
    try {
      const res = await fetch(`/api/contexts/${id}/adr?format=json`);
      const j = await res.json();
      if (!res.ok) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setAdrMarkdown(j.markdown);
      setAdrFilename(j.filename || "decision.md");
    } catch (e) {
      setAdrError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdrLoading(false);
    }
  }

  async function copyAdr() {
    if (!adrMarkdown) return;
    await navigator.clipboard.writeText(adrMarkdown);
    setAdrCopied(true);
    setTimeout(() => setAdrCopied(false), 1500);
  }

  function downloadAdr() {
    if (!adrMarkdown) return;
    const blob = new Blob([adrMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = adrFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    fetch(`/api/contexts/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) setError(res.error);
        else setData(res.data);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function copyMd() {
    if (!data?.rationale) return;
    await navigator.clipboard.writeText(data.rationale);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function downloadMd() {
    window.open(`/api/contexts/${id}/export`, "_blank");
  }

  async function del() {
    if (!confirm("Delete this snapshot? This can't be undone.")) return;
    setDeleting(true);
    const res = await fetch(`/api/contexts/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/dashboard");
    else setDeleting(false);
  }

  if (error) {
    return (
      <div className="p-10 max-w-2xl mx-auto">
        <p className="text-rose-400">Couldn&apos;t load: {error}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-engram-light text-sm">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-10 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gh-muted" />
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gh-muted hover:text-gh-text transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <ToolBadge tool={data.ai_tool} size="md" />
          {data.project && (
            <span className="font-mono text-xs text-gh-muted">↳ {data.project}</span>
          )}
          <span className="font-mono text-xs text-gh-muted ml-auto">
            captured {formatRelativeTime(data.created_at)}
          </span>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-4 leading-tight">
          {data.title}
        </h1>

        {data.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {data.tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded font-mono text-[11px] bg-gh-canvas text-gh-muted border border-gh-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 mb-8">
          <button
            onClick={copyMd}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono text-gh-text border border-gh-border bg-gh-canvas hover:border-gh-muted transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? "copied" : "copy markdown"}
          </button>
          <button
            onClick={downloadMd}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono text-gh-text border border-gh-border bg-gh-canvas hover:border-gh-muted transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            download
          </button>
          <button
            onClick={generateAdr}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono text-engram-light border border-engram/40 bg-engram/5 hover:bg-engram/10 hover:border-engram/60 transition-colors"
            title="Generate a clean Architecture Decision Record from this snapshot"
          >
            <FileText className="h-3.5 w-3.5" />
            export as ADR
          </button>
          <button
            onClick={del}
            disabled={deleting}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-mono text-rose-400 border border-rose-500/30 hover:bg-rose-500/10 transition-colors"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            delete
          </button>
        </div>

        <div className="border-b border-gh-border mb-6">
          <div className="flex gap-1">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative px-4 py-2.5 text-sm transition-colors",
                    active ? "text-gh-text" : "text-gh-muted hover:text-gh-text"
                  )}
                >
                  {t.label}
                  {active && (
                    <motion.div
                      layoutId="ctx-tab"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-engram"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "summary" && <SummaryView data={data} />}
            {tab === "context" && <ContextMdView md={data.rationale} />}
            {tab === "raw" && <RawView raw={data.raw_conversation} />}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {adrOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setAdrOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-gh-border bg-gh-bg shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gh-border">
                <FileText className="h-4 w-4 text-engram-light" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gh-text">
                    Architecture Decision Record
                  </div>
                  <div className="text-[11px] font-mono text-gh-muted truncate">
                    {adrFilename}
                  </div>
                </div>
                {adrMarkdown && !adrLoading && (
                  <>
                    <button
                      onClick={copyAdr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-gh-text border border-gh-border hover:border-gh-muted transition-colors"
                    >
                      {adrCopied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      )}
                      {adrCopied ? "copied" : "copy"}
                    </button>
                    <button
                      onClick={downloadAdr}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-gh-text border border-gh-border hover:border-gh-muted transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" />
                      download
                    </button>
                  </>
                )}
                <button
                  onClick={() => setAdrOpen(false)}
                  className="p-1.5 rounded-md text-gh-muted hover:text-gh-text hover:bg-gh-canvas transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-5">
                {adrLoading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-gh-muted">
                    <Loader2 className="h-6 w-6 animate-spin text-engram-light" />
                    <p className="text-sm">Generating decision record…</p>
                    <p className="text-xs font-mono">
                      Claude is synthesizing context · decision · consequences
                    </p>
                  </div>
                )}
                {adrError && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
                    <p className="font-medium mb-1">Couldn&apos;t generate ADR</p>
                    <p className="text-xs font-mono break-all">{adrError}</p>
                    <button
                      onClick={generateAdr}
                      className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-rose-100 border border-rose-500/40 hover:bg-rose-500/10 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {adrMarkdown && !adrLoading && (
                  <pre className="text-sm text-gh-text font-mono leading-relaxed whitespace-pre-wrap break-words">
                    {adrMarkdown}
                  </pre>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryView({ data }: { data: ContextSnapshot }) {
  return (
    <div className="space-y-6">
      <Section title="Summary">
        <p className="text-[15px] text-gh-text leading-relaxed">
          {data.summary ?? <span className="text-gh-muted italic">No summary captured.</span>}
        </p>
      </Section>
      <Section title="Key decisions">
        <p className="text-[15px] text-gh-text leading-relaxed whitespace-pre-wrap">
          {data.decision ?? <span className="text-gh-muted italic">No decisions extracted.</span>}
        </p>
      </Section>
    </div>
  );
}

function ContextMdView({ md }: { md: string | null }) {
  if (!md) {
    return <p className="text-gh-muted italic">No context.md available.</p>;
  }
  return (
    <pre className="rounded-lg border border-gh-border bg-gh-canvas p-5 text-sm text-gh-text font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
      {md}
    </pre>
  );
}

function RawView({ raw }: { raw: ContextSnapshot["raw_conversation"] }) {
  if (!raw || raw.length === 0) {
    return <p className="text-gh-muted italic">No raw messages stored.</p>;
  }
  return (
    <div className="space-y-3">
      {raw.map((m, i) => (
        <div key={i} className="rounded-lg border border-gh-border bg-gh-canvas overflow-hidden">
          <div
            className={cn(
              "px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider border-b border-gh-border",
              m.role === "user" ? "text-engram-light bg-engram/5" : "text-emerald-400 bg-emerald-500/5"
            )}
          >
            {m.role}
          </div>
          <div className="p-4 text-sm text-gh-text whitespace-pre-wrap leading-relaxed">
            {m.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[11px] font-mono uppercase tracking-wider text-gh-muted mb-2.5">
        {title}
      </h2>
      {children}
    </div>
  );
}
