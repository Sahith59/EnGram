"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, User as UserIcon, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function TopBar({
  email,
  fullName,
  avatarUrl,
}: {
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function signOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Supabase not configured — fall through to navigation
    }
    router.push("/login");
    router.refresh();
  }

  const initials =
    (fullName ?? email ?? "U")
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "U";

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-gh-border bg-gh-bg/80 backdrop-blur-md">
      <div className="h-full px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-xs font-mono text-gh-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>connected</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/ask"
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono text-gh-muted hover:text-gh-text hover:bg-gh-canvas border border-transparent hover:border-gh-border transition-all"
          >
            <kbd className="px-1.5 py-0.5 rounded bg-gh-canvas border border-gh-border text-[10px]">
              ⌘K
            </kbd>
            <span>ask anything</span>
          </Link>

          <div ref={ref} className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2.5 px-1.5 py-1 rounded-md hover:bg-gh-canvas transition-colors"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full ring-1 ring-gh-border"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-gradient-to-br from-engram to-engram-light flex items-center justify-center text-[10px] font-mono font-semibold text-white">
                  {initials}
                </div>
              )}
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 mt-2 w-60 rounded-lg border border-gh-border bg-gh-canvas shadow-2xl shadow-black/50 overflow-hidden"
                >
                  <div className="px-3 py-3 border-b border-gh-border">
                    <div className="text-sm font-medium text-gh-text truncate">
                      {fullName ?? "User"}
                    </div>
                    <div className="text-xs text-gh-muted font-mono truncate">
                      {email}
                    </div>
                  </div>
                  <div className="p-1">
                    <MenuItem href="/settings" icon={UserIcon}>Profile</MenuItem>
                    <MenuItem href="/settings" icon={SettingsIcon}>Settings</MenuItem>
                    <button
                      onClick={signOut}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm",
                        "text-rose-400 hover:bg-rose-500/10 transition-colors"
                      )}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof UserIcon;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-gh-text hover:bg-gh-bg transition-colors"
    >
      <Icon className="h-4 w-4 text-gh-muted" />
      {children}
    </Link>
  );
}
