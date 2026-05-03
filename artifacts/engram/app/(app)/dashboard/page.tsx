"use client";

import { Suspense, useState } from "react";
import { motion } from "framer-motion";
import { Search, User, Users } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ContextTimeline } from "@/components/context/ContextTimeline";
import { cn } from "@/lib/utils";

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
  const scope: "personal" | "team" =
    params.get("scope") === "team" ? "team" : "personal";

  function setScope(next: "personal" | "team") {
    const p = new URLSearchParams(params.toString());
    p.set("scope", next);
    router.replace(`${pathname}?${p.toString()}`);
  }

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
          {scope === "team" ? "your team's shared memory" : "your private memory"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-1">
          Dashboard
        </h1>
        <p className="text-sm text-gh-muted">
          {scope === "team"
            ? "Snapshots your teammates have explicitly shared. Briefs only — original chats stay private."
            : "Your personal AI conversations. Visible only to you."}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.03 }}
        className="inline-flex rounded-lg border border-gh-border bg-gh-canvas p-1 mb-5"
        role="tablist"
      >
        <ScopeTab
          active={scope === "personal"}
          onClick={() => setScope("personal")}
          icon={<User className="h-3.5 w-3.5" />}
          label="My contexts"
        />
        <ScopeTab
          active={scope === "team"}
          onClick={() => setScope("team")}
          icon={<Users className="h-3.5 w-3.5" />}
          label="Team contexts"
        />
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

      <ContextTimeline scope={scope} />
    </>
  );
}

function ScopeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
        active
          ? "bg-engram/15 text-engram-light shadow-[inset_0_0_0_1px_rgba(124,58,237,0.4)]"
          : "text-gh-muted hover:text-gh-text"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
