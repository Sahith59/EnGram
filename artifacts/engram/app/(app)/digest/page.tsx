"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Download,
  Copy,
  Check,
  Loader2,
  Calendar,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Scope = "personal" | "team";
type GroupBy = "project" | "tag" | "tool" | "month" | "week" | "none";

interface DigestResponse {
  markdown: string;
  filename: string;
  from: string;
  to: string;
  scope: Scope;
  groupBy: GroupBy;
  tool: string | null;
  total: number;
  buckets: { label: string; count: number }[];
  isDegenerate?: boolean;
  degenerateReason?: string | null;
  generated_at: string;
  error?: string;
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRESETS: { id: string; label: string; days: number | "all" }[] = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: "all" },
];

export default function DigestPage() {
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - 30);
    return ymd(d);
  }, [today]);
  const defaultTo = ymd(today);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [preset, setPreset] = useState<string>("30d");
  const [scope, setScope] = useState<Scope>("personal");
  const [groupBy, setGroupBy] = useState<GroupBy>("project");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DigestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function applyPreset(id: string) {
    setPreset(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    const t = ymd(today);
    setTo(t);
    if (p.days === "all") {
      setFrom("2020-01-01");
    } else {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() - p.days);
      setFrom(ymd(d));
    }
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        scope,
        groupBy,
        format: "json",
      });
      const res = await fetch(`/api/digest?${params.toString()}`);
      const data: DigestResponse = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `Request failed (${res.status})`);
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate digest");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyMd() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard copy failed");
    }
  }

  function downloadMd() {
    if (!result) return;
    const blob = new Blob([result.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-9 w-9 rounded-md bg-engram/10 border border-engram/30 flex items-center justify-center">
          <FileText className="h-5 w-5 text-engram-light" />
        </div>
        <h1 className="text-2xl font-semibold text-gh-text tracking-tight">
          Decision Log Digest
        </h1>
      </div>
      <p className="text-sm text-gh-muted mb-6 max-w-2xl">
        A deterministic, copy-pasteable summary of your captured decisions for a
        date range, grouped by project, tag, or AI tool. Deduped by
        conversation, no AI synthesis — what you captured is what you get.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        <aside className="space-y-5">
          <Section title="Date range" icon={<Calendar className="h-3.5 w-3.5" />}>
            <div className="space-y-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors",
                    preset === p.id
                      ? "bg-engram/10 text-engram-light border border-engram/30"
                      : "text-gh-muted hover:text-gh-text hover:bg-gh-canvas border border-transparent"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <LabeledDate label="From" value={from} onChange={(v) => { setFrom(v); setPreset(""); }} />
              <LabeledDate label="To" value={to} onChange={(v) => { setTo(v); setPreset(""); }} />
            </div>
          </Section>

          <Section title="Scope" icon={<Layers className="h-3.5 w-3.5" />}>
            <div className="grid grid-cols-2 gap-1">
              {(["personal", "team"] as Scope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn(
                    "px-2 py-1.5 rounded-md text-xs capitalize transition-colors border",
                    scope === s
                      ? "bg-engram/10 text-engram-light border-engram/30"
                      : "text-gh-muted hover:text-gh-text border-gh-border hover:bg-gh-canvas"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Group by">
            <div className="grid grid-cols-2 gap-1">
              {(["project", "tag", "tool", "month", "week", "none"] as GroupBy[]).map(
                (g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={cn(
                      "px-2 py-1.5 rounded-md text-xs capitalize transition-colors border",
                      groupBy === g
                        ? "bg-engram/10 text-engram-light border-engram/30"
                        : "text-gh-muted hover:text-gh-text border-gh-border hover:bg-gh-canvas"
                    )}
                  >
                    {g}
                  </button>
                )
              )}
            </div>
          </Section>

          <button
            onClick={generate}
            disabled={loading}
            className={cn(
              "w-full px-3 py-2 rounded-md text-sm font-medium transition-colors",
              "bg-engram text-white hover:bg-engram-light",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "flex items-center justify-center gap-2"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>Generate digest</>
            )}
          </button>
        </aside>

        <main className="min-w-0">
          {error && (
            <div className="mb-3 px-3 py-2 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-400">
              {error}
            </div>
          )}

          <AnimatePresence mode="wait">
            {result && (
              <motion.div
                key={result.generated_at}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                {/* Bucket distribution chips — visible proof grouping was applied */}
                {result.total > 0 && result.groupBy !== "none" && (
                  <div className="rounded-md border border-gh-border bg-gh-canvas px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-gh-muted/70 mb-1.5">
                      Distribution · {result.buckets.length} bucket
                      {result.buckets.length === 1 ? "" : "s"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {result.buckets.slice(0, 16).map((b) => (
                        <span
                          key={b.label}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-gh-bg border border-gh-border"
                        >
                          <span className="text-gh-muted truncate max-w-[180px]">
                            {b.label}
                          </span>
                          <span className="text-engram-light font-mono">
                            {b.count}
                          </span>
                        </span>
                      ))}
                      {result.buckets.length > 16 && (
                        <span className="text-[11px] text-gh-muted px-1">
                          +{result.buckets.length - 16} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Degenerate-grouping warning — be honest with the user */}
                {result.isDegenerate && result.degenerateReason && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-200/90">
                    <div className="font-medium mb-0.5">
                      This grouping isn&apos;t adding value on your data.
                    </div>
                    <div className="text-yellow-200/70">
                      {result.degenerateReason} Try{" "}
                      <button
                        onClick={() => setGroupBy("month")}
                        className="underline hover:text-yellow-100"
                      >
                        Month
                      </button>{" "}
                      or{" "}
                      <button
                        onClick={() => setGroupBy("week")}
                        className="underline hover:text-yellow-100"
                      >
                        Week
                      </button>{" "}
                      — those work on any capture with a date.
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-gh-border bg-gh-bg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gh-border bg-gh-canvas">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gh-muted font-mono">
                      {result.filename}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gh-muted/70">
                      {result.total} decision{result.total === 1 ? "" : "s"} ·{" "}
                      {result.buckets.length} group
                      {result.buckets.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={copyMd}
                      className="px-2 py-1 rounded text-xs text-gh-muted hover:text-gh-text hover:bg-gh-bg border border-gh-border flex items-center gap-1.5 transition-colors"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-green-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={downloadMd}
                      className="px-2 py-1 rounded text-xs text-gh-muted hover:text-gh-text hover:bg-gh-bg border border-gh-border flex items-center gap-1.5 transition-colors"
                    >
                      <Download className="h-3 w-3" /> Download
                    </button>
                  </div>
                </div>
                <pre
                  data-testid="digest-markdown"
                  className="p-4 text-xs leading-relaxed text-gh-text whitespace-pre-wrap break-words font-mono max-h-[70vh] overflow-auto"
                >
                  {result.markdown}
                </pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!result && !loading && !error && (
            <div className="text-sm text-gh-muted">
              Pick a range and click Generate.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-gh-muted/70 mb-2">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function LabeledDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-gh-muted/70 mb-1">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gh-canvas border border-gh-border rounded-md px-2 py-1.5 text-xs text-gh-text focus:outline-none focus:border-engram/50"
      />
    </label>
  );
}
