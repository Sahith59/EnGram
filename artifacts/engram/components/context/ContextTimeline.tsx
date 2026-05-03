"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ContextCard, ContextCardSkeleton, type ContextCardData } from "./ContextCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { AlertCircle, CheckSquare, Square, Lock, Users, X } from "lucide-react";

export function ContextTimeline({
  scope = "personal",
}: {
  scope?: "personal" | "team";
}) {
  const searchParams = useSearchParams();
  const tool = searchParams.get("tool");
  const search = searchParams.get("search");

  const [items, setItems] = useState<ContextCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user?.id) setCurrentUserId(d.user.id);
        else if (d?.id) setCurrentUserId(d.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    setSelected(new Set());

    const params = new URLSearchParams();
    params.set("scope", scope);
    if (tool) params.set("tool", tool);
    if (search) params.set("search", search);

    fetch(`/api/contexts?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          setItems([]);
        } else {
          setItems(res.data ?? []);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [tool, search, scope]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setBulkResult(null);
  }

  function applyVisibilityLocal(ids: Set<string>, next: "personal" | "team") {
    setItems((cur) => {
      if (!cur) return cur;
      // If the new visibility doesn't match the current scope, drop the
      // card from the view (it's moved to the other tab).
      if (next !== scope) return cur.filter((c) => !ids.has(c.id));
      return cur.map((c) => (ids.has(c.id) ? { ...c, visibility: next } : c));
    });
  }

  function onCardVisibilityChange(id: string, next: "personal" | "team") {
    applyVisibilityLocal(new Set([id]), next);
  }

  // Only the items the user actually owns are eligible for bulk action
  const ownedSelected = useMemo(
    () =>
      new Set(
        Array.from(selected).filter((id) => {
          const it = items?.find((c) => c.id === id);
          return it && it.created_by === currentUserId;
        })
      ),
    [selected, items, currentUserId]
  );

  async function bulkSet(next: "personal" | "team") {
    const ids = Array.from(ownedSelected);
    if (ids.length === 0) {
      setBulkResult("Pick at least one of your own captures");
      return;
    }
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const r = await fetch("/api/contexts/bulk-visibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, visibility: next }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Bulk update failed");
      applyVisibilityLocal(new Set(ids), next);
      const skipped = selected.size - ids.length;
      const skippedNote = skipped > 0 ? ` (skipped ${skipped} you don't own)` : "";
      setBulkResult(`Updated ${d.updated}${skippedNote}`);
      // Auto-exit after a beat so the user sees the result
      setTimeout(() => exitSelectMode(), 1400);
    } catch (e) {
      setBulkResult(e instanceof Error ? e.message : "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  if (items === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <ContextCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-3" />
        <p className="text-sm text-gh-text mb-1">Couldn&apos;t load contexts</p>
        <p className="text-xs text-gh-muted font-mono">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState scope={scope} />;
  }

  const ownedCount = items.filter((c) => c.created_by === currentUserId).length;

  return (
    <motion.div className="space-y-3">
      <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
        <div className="font-mono text-[11px] text-gh-muted uppercase tracking-wider">
          {items.length} {items.length === 1 ? "snapshot" : "snapshots"}
          {scope === "team" && " · shared with team"}
          {tool && ` · ${tool}`}
        </div>
        {ownedCount > 0 && !selectMode && (
          <button
            onClick={() => setSelectMode(true)}
            className="font-mono text-[10px] text-gh-muted hover:text-engram-light transition-colors uppercase tracking-wider"
          >
            select
          </button>
        )}
        {selectMode && (
          <button
            onClick={exitSelectMode}
            className="font-mono text-[10px] text-gh-muted hover:text-gh-text transition-colors uppercase tracking-wider flex items-center gap-1"
          >
            <X className="h-3 w-3" /> cancel select
          </button>
        )}
      </div>
      {items.map((ctx, i) => (
        <ContextCard
          key={ctx.id}
          ctx={ctx}
          index={i}
          currentUserId={currentUserId}
          selectMode={selectMode}
          selected={selected.has(ctx.id)}
          onToggleSelect={toggleSelect}
          onVisibilityChange={onCardVisibilityChange}
        />
      ))}

      {selectMode && selected.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-lg border border-gh-border bg-gh-canvas shadow-2xl shadow-black/60 px-3 py-2 flex items-center gap-2"
        >
          <span className="font-mono text-[11px] text-gh-muted px-2">
            {selected.size} selected
            {ownedSelected.size !== selected.size && (
              <span className="text-amber-400/80"> · {ownedSelected.size} yours</span>
            )}
          </span>
          <button
            onClick={() => bulkSet("personal")}
            disabled={bulkBusy || ownedSelected.size === 0}
            className="px-2.5 py-1 rounded-md flex items-center gap-1.5 text-xs text-gh-text border border-gh-border hover:bg-gh-bg disabled:opacity-40 transition-colors"
          >
            <Lock className="h-3 w-3" /> Make personal
          </button>
          <button
            onClick={() => bulkSet("team")}
            disabled={bulkBusy || ownedSelected.size === 0}
            className="px-2.5 py-1 rounded-md flex items-center gap-1.5 text-xs text-white bg-engram hover:bg-engram-light disabled:opacity-40 transition-colors"
          >
            <Users className="h-3 w-3" /> Make team
          </button>
          {bulkResult && (
            <span className="font-mono text-[10px] text-gh-muted px-2 max-w-[200px] truncate">
              {bulkResult}
            </span>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
