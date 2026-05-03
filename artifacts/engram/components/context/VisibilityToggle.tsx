"use client";

import { useEffect, useRef, useState } from "react";
import { Lock, Users, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  contextId: string;
  visibility: "personal" | "team";
  authorHandle?: string | null;
  /** When true, badge is clickable and opens an inline switcher. */
  editable: boolean;
  onChanged?: (next: "personal" | "team") => void;
}

/**
 * Compact visibility chip. Renders as a static badge for non-creators,
 * and as a small popover-button for the creator (so they can promote a
 * personal capture to their team or demote a team capture back to personal).
 */
export function VisibilityToggle({
  contextId,
  visibility,
  authorHandle,
  editable,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function setVis(next: "personal" | "team") {
    if (next === visibility) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/contexts/${contextId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Update failed");
      onChanged?.(next);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const isTeam = visibility === "team";
  const Icon = isTeam ? Users : Lock;
  const label = isTeam ? `team${authorHandle ? ` · ${authorHandle}` : ""}` : "personal";
  const colorCls = isTeam
    ? "bg-engram/10 text-engram-light border-engram/30"
    : "bg-gh-bg text-gh-muted border-gh-border";

  // Static (not the creator) — just show a badge
  if (!editable) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border",
          colorCls
        )}
        title={
          isTeam
            ? authorHandle
              ? `Shared with team by ${authorHandle}`
              : "Shared with team"
            : "Private to you"
        }
      >
        <Icon className="h-2.5 w-2.5" />
        {label}
      </span>
    );
  }

  // Editable — clickable chip with popover
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border transition-colors",
          colorCls,
          "hover:opacity-80"
        )}
        title="Change visibility"
      >
        <Icon className="h-2.5 w-2.5" />
        {busy ? "saving…" : label}
        <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="absolute left-0 top-full mt-1 z-50 w-52 rounded-md border border-gh-border bg-gh-canvas shadow-2xl shadow-black/60 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-gh-border/60 bg-gh-bg/50">
            <p className="text-[9px] font-mono uppercase tracking-wider text-gh-muted">
              Who can see this
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVis("personal")}
            className="w-full px-3 py-2 flex items-start gap-2 text-left text-xs hover:bg-gh-bg transition-colors"
          >
            <Lock className="h-3 w-3 mt-0.5 text-gh-muted shrink-0" />
            <span className="flex-1">
              <span className="text-gh-text font-medium">Personal</span>
              <span className="block text-[10px] text-gh-muted leading-snug">Only you can see it</span>
            </span>
            {visibility === "personal" && <Check className="h-3 w-3 text-engram-light shrink-0 mt-1" />}
          </button>
          <button
            type="button"
            onClick={() => setVis("team")}
            className="w-full px-3 py-2 flex items-start gap-2 text-left text-xs hover:bg-gh-bg transition-colors border-t border-gh-border/40"
          >
            <Users className="h-3 w-3 mt-0.5 text-engram-light shrink-0" />
            <span className="flex-1">
              <span className="text-gh-text font-medium">Team</span>
              <span className="block text-[10px] text-gh-muted leading-snug">
                Shared with everyone in your active team
              </span>
            </span>
            {visibility === "team" && <Check className="h-3 w-3 text-engram-light shrink-0 mt-1" />}
          </button>
          {err && (
            <div className="px-3 py-1.5 text-[10px] text-red-300 bg-red-500/10 border-t border-red-500/30">
              {err}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
