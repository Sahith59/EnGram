"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ContextCard, ContextCardSkeleton, type ContextCardData } from "./ContextCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { AlertCircle } from "lucide-react";

export function ContextTimeline() {
  const searchParams = useSearchParams();
  const tool = searchParams.get("tool");
  const search = searchParams.get("search");

  const [items, setItems] = useState<ContextCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);

    const params = new URLSearchParams();
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
  }, [tool, search]);

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
    return <EmptyState />;
  }

  return (
    <motion.div className="space-y-3">
      <div className="flex items-baseline justify-between mb-1">
        <div className="font-mono text-[11px] text-gh-muted uppercase tracking-wider">
          {items.length} {items.length === 1 ? "snapshot" : "snapshots"}
          {tool && ` · ${tool}`}
        </div>
      </div>
      {items.map((ctx, i) => (
        <ContextCard key={ctx.id} ctx={ctx} index={i} />
      ))}
    </motion.div>
  );
}
