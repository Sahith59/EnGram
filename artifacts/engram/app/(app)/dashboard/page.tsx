"use client";

import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ContextTimeline } from "@/components/context/ContextTimeline";

export default function DashboardPage() {
  return (
    <div className="px-6 md:px-10 py-8 max-w-5xl mx-auto">
      <Suspense>
        <DashboardInner />
      </Suspense>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initialSearch = params.get("search") ?? "";
  const [search, setSearch] = useState(initialSearch);

  function onSearch(v: string) {
    setSearch(v);
    const p = new URLSearchParams(params.toString());
    if (v) p.set("search", v);
    else p.delete("search");
    router.replace(`${pathname}?${p.toString()}`);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
          your team&apos;s memory
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-1">
          Dashboard
        </h1>
        <p className="text-sm text-gh-muted">
          Every AI conversation your team has captured, organized by recency.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="relative mb-6"
      >
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gh-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search titles, summaries, decisions…"
          className="w-full h-11 pl-10 pr-4 rounded-lg border border-gh-border bg-gh-canvas text-sm text-gh-text placeholder:text-gh-muted/70 outline-none focus:border-engram/50 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] transition-all"
        />
      </motion.div>

      <ContextTimeline />
    </>
  );
}
