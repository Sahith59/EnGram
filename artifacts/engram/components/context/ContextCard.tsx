"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ClipboardCopy, ChevronDown, ExternalLink, Sparkles, Square, CheckSquare } from "lucide-react";
import { ToolBadge } from "./ToolBadge";
import { VisibilityToggle } from "./VisibilityToggle";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import type { AITool } from "@/types";

export interface ContextCardData {
  id: string;
  title: string;
  summary: string | null;
  ai_tool: AITool | string;
  tags: string[];
  project: string | null;
  decision: string | null;
  created_at: string;
  visibility?: "personal" | "team" | string | null;
  author_handle?: string | null;
  created_by?: string | null;
}

const continueTargets = [
  { tool: "claude", label: "Continue in Claude", url: "https://claude.ai/new" },
  { tool: "chatgpt", label: "Continue in ChatGPT", url: "https://chatgpt.com/" },
  { tool: "gemini", label: "Continue in Gemini", url: "https://gemini.google.com/app" },
];

export function ContextCard({
  ctx,
  index = 0,
  currentUserId,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onVisibilityChange,
}: {
  ctx: ContextCardData;
  index?: number;
  currentUserId?: string | null;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onVisibilityChange?: (id: string, next: "personal" | "team") => void;
}) {
  const isCreator = !!currentUserId && ctx.created_by === currentUserId;
  const visibility: "personal" | "team" = ctx.visibility === "team" ? "team" : "personal";
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [continueState, setContinueState] = useState<"idle" | "preparing" | "ready">("idle");
  const ddRef = useRef<HTMLDivElement>(null);
  const handoffCache = useRef<Record<string, string>>({});
  const briefMd = useRef<string | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Prefetch brief once on mount (cheap — just a markdown fetch)
  useEffect(() => {
    fetch(`/api/contexts/${ctx.id}/export?mode=brief`)
      .then((r) => (r.ok ? r.text() : null))
      .then((txt) => {
        if (txt) briefMd.current = txt;
      })
      .catch(() => {});
  }, [ctx.id]);

  // Prefetch ALL handoff variants the moment the dropdown opens, so the
  // click handler can write to clipboard synchronously inside the user gesture.
  useEffect(() => {
    if (!open) return;
    continueTargets.forEach((t) => {
      if (handoffCache.current[t.tool]) return;
      fetch(
        `/api/contexts/${ctx.id}/export?mode=handoff&target=${encodeURIComponent(t.label)}`
      )
        .then((r) => (r.ok ? r.text() : null))
        .then((txt) => {
          if (txt) handoffCache.current[t.tool] = txt;
        })
        .catch(() => {});
    });
  }, [open, ctx.id]);

  function copyContextMd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const text = briefMd.current;
    if (!text) {
      // Cache miss — show a hint, refetch, but no instant copy this click
      fetch(`/api/contexts/${ctx.id}/export?mode=brief`)
        .then((r) => r.text())
        .then((t) => {
          briefMd.current = t;
        });
      return;
    }
    if (copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  function handleContinue(e: React.MouseEvent, target: typeof continueTargets[number]) {
    e.preventDefault();
    e.stopPropagation();
    const cached = handoffCache.current[target.tool];

    if (cached) {
      // Synchronous path — clipboard write inside user gesture, then open tab
      const ok = copyToClipboard(cached);
      if (ok) {
        setContinueState("ready");
        window.open(target.url, "_blank", "noopener,noreferrer");
        setTimeout(() => setContinueState("idle"), 4500);
      } else {
        setContinueState("idle");
        alert("Could not copy to clipboard. Please grant clipboard permission and try again.");
      }
      setOpen(false);
      return;
    }

    // Cache miss (rare — fetch should have completed). Fetch, then write, then open.
    setContinueState("preparing");
    fetch(
      `/api/contexts/${ctx.id}/export?mode=handoff&target=${encodeURIComponent(target.label)}`
    )
      .then((r) => r.text())
      .then((handoffPrompt) => {
        handoffCache.current[target.tool] = handoffPrompt;
        const ok = copyToClipboard(handoffPrompt);
        if (ok) {
          setContinueState("ready");
          window.open(target.url, "_blank", "noopener,noreferrer");
          setTimeout(() => setContinueState("idle"), 4500);
        } else {
          setContinueState("idle");
        }
      })
      .catch(() => setContinueState("idle"));
    setOpen(false);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3), ease: [0.21, 0.47, 0.32, 0.98] }}
      whileHover={{ y: -2 }}
      style={{ position: "relative", zIndex: open ? 50 : "auto" }}
    >
      <CardWrapper
        contextId={ctx.id}
        selectMode={selectMode}
        onToggleSelect={onToggleSelect}
      >
        <div
          className={cn(
            "group relative rounded-lg border bg-gh-canvas p-5 transition-all duration-200",
            selected
              ? "border-engram shadow-[0_0_0_1px_rgba(124,58,237,0.4)]"
              : "border-gh-border hover:border-engram/60 hover:shadow-[0_0_0_1px_rgba(124,58,237,0.15),0_8px_32px_-8px_rgba(124,58,237,0.25)]"
          )}
        >
          {selectMode && (
            <div className="absolute top-3 left-3">
              {selected ? (
                <CheckSquare className="h-4 w-4 text-engram-light" />
              ) : (
                <Square className="h-4 w-4 text-gh-muted" />
              )}
            </div>
          )}
          <div
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-engram/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
            aria-hidden
          />

          <div className={cn("flex items-start justify-between gap-4 mb-3", selectMode && "pl-6")}>
            <div className="flex items-center gap-2 min-w-0">
              <ToolBadge tool={ctx.ai_tool} />
              <VisibilityToggle
                contextId={ctx.id}
                visibility={visibility}
                authorHandle={ctx.author_handle}
                editable={isCreator && !selectMode}
                onChanged={(next) => onVisibilityChange?.(ctx.id, next)}
              />
              {ctx.project && (
                <span className="font-mono text-[11px] text-gh-muted truncate">
                  ↳ {ctx.project}
                </span>
              )}
            </div>
            <time className="font-mono text-[11px] text-gh-muted shrink-0">
              {formatRelativeTime(ctx.created_at)}
            </time>
          </div>

          <h3 className="text-[15px] font-semibold text-gh-text leading-snug mb-2 group-hover:text-engram-light transition-colors">
            {ctx.title}
          </h3>

          {ctx.summary && (
            <p className="text-sm text-gh-muted leading-relaxed mb-4">
              {truncate(ctx.summary, 150)}
            </p>
          )}

          {ctx.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {ctx.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded font-mono text-[10px] bg-gh-bg text-gh-muted border border-gh-border"
                >
                  {tag}
                </span>
              ))}
              {ctx.tags.length > 6 && (
                <span className="font-mono text-[10px] text-gh-muted/70 self-center">
                  +{ctx.tags.length - 6}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-3 border-t border-gh-border/60">
            <button
              onClick={copyContextMd}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono",
                "text-gh-muted hover:text-gh-text hover:bg-gh-bg border border-gh-border transition-colors"
              )}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span className="text-emerald-400">copied</span>
                </>
              ) : (
                <>
                  <ClipboardCopy className="h-3 w-3" />
                  <span>context.md</span>
                </>
              )}
            </button>

            <div ref={ddRef} className="relative ml-auto">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen((v) => !v);
                }}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono",
                  "text-engram-light hover:bg-engram/10 border border-engram/30 transition-colors"
                )}
              >
                {continueState === "preparing" ? (
                  <>Preparing…</>
                ) : continueState === "ready" ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>Brief copied</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3" />
                    Continue
                    <ChevronDown
                      className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
                    />
                  </>
                )}
              </button>

              <AnimatePresence>
                {open && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 mt-2 w-72 rounded-lg border border-gh-border bg-gh-canvas shadow-2xl shadow-black/60 overflow-hidden z-50"
                  >
                    <div className="px-3 py-2 border-b border-gh-border/60 bg-gh-bg/50">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-gh-muted">
                        Hand off to
                      </p>
                    </div>
                    {continueTargets.map((t) => (
                      <button
                        key={t.tool}
                        type="button"
                        onClick={(e) => handleContinue(e, t)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-gh-text hover:bg-gh-bg transition-colors group/item text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              t.tool === "claude" && "bg-tool-claude",
                              t.tool === "chatgpt" && "bg-tool-chatgpt",
                              t.tool === "gemini" && "bg-tool-gemini"
                            )}
                          />
                          {t.label}
                        </span>
                        <ExternalLink className="h-3 w-3 text-gh-muted opacity-0 group-hover/item:opacity-100" />
                      </button>
                    ))}
                    <div className="px-3 py-2 border-t border-gh-border/60 bg-gh-bg/30">
                      <p className="text-[10px] text-gh-muted leading-snug">
                        We&apos;ll copy a verified handoff brief to your clipboard, then open the new
                        tool. Paste with <kbd className="font-mono">⌘V</kbd> /{" "}
                        <kbd className="font-mono">Ctrl+V</kbd>.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </CardWrapper>
    </motion.div>
  );
}

function CardWrapper({
  contextId,
  selectMode,
  onToggleSelect,
  children,
}: {
  contextId: string;
  selectMode: boolean;
  onToggleSelect?: (id: string) => void;
  children: React.ReactNode;
}) {
  if (selectMode) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect?.(contextId);
        }}
        className="w-full text-left"
      >
        {children}
      </button>
    );
  }
  return <Link href={`/context/${contextId}`}>{children}</Link>;
}

export function ContextCardSkeleton() {
  return (
    <div className="rounded-lg border border-gh-border bg-gh-canvas p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-5 w-16 rounded-full bg-gh-bg" />
        <div className="h-3 w-20 rounded bg-gh-bg ml-auto" />
      </div>
      <div className="h-4 w-3/4 rounded bg-gh-bg mb-3" />
      <div className="h-3 w-full rounded bg-gh-bg mb-2" />
      <div className="h-3 w-2/3 rounded bg-gh-bg mb-4" />
      <div className="flex gap-1.5">
        <div className="h-4 w-12 rounded bg-gh-bg" />
        <div className="h-4 w-16 rounded bg-gh-bg" />
        <div className="h-4 w-10 rounded bg-gh-bg" />
      </div>
    </div>
  );
}
