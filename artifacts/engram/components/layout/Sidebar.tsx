"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  MessageSquareText,
  Users,
  Settings,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ask", label: "Ask ENGRAM", icon: MessageSquareText },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

const tools = [
  { id: "all", label: "All sources", color: "bg-engram" },
  { id: "chatgpt", label: "ChatGPT", color: "bg-tool-chatgpt" },
  { id: "claude", label: "Claude", color: "bg-tool-claude" },
  { id: "gemini", label: "Gemini", color: "bg-tool-gemini" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool") ?? "all";

  function setToolFilter(toolId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (toolId === "all") params.delete("tool");
    else params.set("tool", toolId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-gh-border bg-gh-bg sticky top-0 h-screen">
      <div className="px-5 py-5 border-b border-gh-border flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-engram to-engram-light flex items-center justify-center">
          <GitBranch className="h-4 w-4 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-mono text-sm font-semibold tracking-tight text-gh-text">
          engram
        </span>
      </div>

      <nav className="px-3 py-4 space-y-0.5">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors group",
                active
                  ? "text-gh-text"
                  : "text-gh-muted hover:text-gh-text hover:bg-gh-canvas"
              )}
            >
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-md bg-gh-canvas border border-gh-border"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 relative z-10",
                  active && "text-engram-light"
                )}
              />
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 mt-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-gh-muted/70 mb-2.5">
          Filter sources
        </div>
        <div className="space-y-1">
          {tools.map((t) => {
            const checked = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setToolFilter(t.id)}
                className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md text-xs text-gh-muted hover:text-gh-text hover:bg-gh-canvas transition-colors group"
              >
                <span
                  className={cn(
                    "h-3.5 w-3.5 rounded-[3px] border flex items-center justify-center transition-colors",
                    checked
                      ? "border-transparent " + t.color
                      : "border-gh-border group-hover:border-gh-muted"
                  )}
                >
                  {checked && (
                    <motion.svg
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      className="text-white"
                    >
                      <path
                        d="M2 5l2 2 4-4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </motion.svg>
                  )}
                </span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto p-4 border-t border-gh-border">
        <div className="rounded-md bg-gradient-to-br from-engram/10 to-engram/5 border border-engram/20 p-3">
          <div className="text-[11px] font-mono text-engram-light mb-1">
            extension
          </div>
          <p className="text-xs text-gh-muted leading-relaxed">
            Install the Chrome extension to capture conversations automatically.
          </p>
        </div>
      </div>
    </aside>
  );
}
