"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Check,
  Plus,
  ChevronDown,
  Crown,
  Shield,
  User as UserIcon,
  X,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TeamItem {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  memberCount: number;
  isPersonal: boolean;
  isActive: boolean;
}

export function TeamSwitcher() {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/teams");
      if (!r.ok) return;
      const d = await r.json();
      setTeams(d.teams ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = teams.find((t) => t.isActive) ?? teams[0];

  // Notify any listening client component (e.g. /team page) that the active
  // team membership changed, so they can refetch without a full route refresh.
  function broadcastTeamChange() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("engram:team-changed"));
    }
  }

  async function switchTo(teamId: string) {
    if (teamId === active?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/team/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: teamId }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed");
      await refresh();
      setOpen(false);
      broadcastTeamChange();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTeam() {
    if (newName.trim().length < 2) {
      setError("Team name must be at least 2 characters");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      setNewName("");
      setShowCreate(false);
      setOpen(false);
      await refresh();
      broadcastTeamChange();
      router.push("/team");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function joinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter an invite code");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      setJoinCode("");
      setShowJoin(false);
      setOpen(false);
      await refresh();
      broadcastTeamChange();
      router.push("/team");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Join failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !active) {
    return (
      <div className="mx-3 mt-3 px-3 py-2 rounded-md border border-gh-border bg-gh-canvas">
        <div className="text-xs text-gh-muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="mx-3 mt-3 relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 rounded-md border border-gh-border bg-gh-canvas hover:border-engram/40 transition-colors group flex items-center gap-2 text-left"
      >
        <Users className="h-3.5 w-3.5 text-gh-muted group-hover:text-engram-light shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-gh-text truncate flex items-center gap-1.5">
            {active.name}
            {active.isPersonal && (
              <span className="text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-engram/15 text-engram-light shrink-0">
                personal
              </span>
            )}
          </div>
          <div className="text-[10px] text-gh-muted">
            {active.memberCount} {active.memberCount === 1 ? "member" : "members"} · {active.role}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-gh-muted transition-transform shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-md border border-gh-border bg-gh-canvas shadow-xl overflow-hidden">
          {error && (
            <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-[11px] text-red-300 flex items-start gap-1.5">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {showCreate ? (
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-mono uppercase text-gh-muted">Create new team</div>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTeam()}
                placeholder="Team name"
                disabled={busy}
                maxLength={60}
                className="w-full px-2 py-1.5 text-xs rounded-md bg-gh-bg border border-gh-border focus:border-engram outline-none text-gh-text"
              />
              <div className="flex gap-2">
                <button
                  onClick={createTeam}
                  disabled={busy || newName.trim().length < 2}
                  className="flex-1 px-3 py-1.5 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "Creating…" : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowCreate(false);
                    setNewName("");
                    setError(null);
                  }}
                  className="px-3 py-1.5 rounded-md border border-gh-border text-xs text-gh-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : showJoin ? (
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-mono uppercase text-gh-muted">Join with code</div>
              <input
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && joinByCode()}
                placeholder="ABCDE12345"
                disabled={busy}
                maxLength={20}
                className="w-full px-2 py-1.5 text-xs font-mono rounded-md bg-gh-bg border border-gh-border focus:border-engram outline-none text-gh-text"
              />
              <div className="flex gap-2">
                <button
                  onClick={joinByCode}
                  disabled={busy || joinCode.trim().length < 4}
                  className="flex-1 px-3 py-1.5 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium disabled:opacity-50"
                >
                  {busy ? "Joining…" : "Join"}
                </button>
                <button
                  onClick={() => {
                    setShowJoin(false);
                    setJoinCode("");
                    setError(null);
                  }}
                  className="px-3 py-1.5 rounded-md border border-gh-border text-xs text-gh-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <ul className="max-h-72 overflow-y-auto py-1">
                {teams.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => switchTo(t.id)}
                      disabled={busy}
                      className={cn(
                        "w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gh-bg transition-colors",
                        t.isActive && "bg-gh-bg"
                      )}
                    >
                      <RoleIcon role={t.role} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gh-text truncate flex items-center gap-1.5">
                          {t.name}
                          {t.isPersonal && (
                            <span className="text-[9px] font-mono uppercase px-1 py-0.5 rounded bg-engram/15 text-engram-light shrink-0">
                              personal
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gh-muted">
                          {t.memberCount} {t.memberCount === 1 ? "member" : "members"}
                        </div>
                      </div>
                      {t.isActive && <Check className="h-3.5 w-3.5 text-engram-light shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="border-t border-gh-border p-1">
                <button
                  onClick={() => {
                    setShowCreate(true);
                    setError(null);
                  }}
                  className="w-full px-3 py-1.5 rounded-md flex items-center gap-2 text-xs text-gh-text hover:bg-gh-bg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" /> New team
                </button>
                <button
                  onClick={() => {
                    setShowJoin(true);
                    setError(null);
                  }}
                  className="w-full px-3 py-1.5 rounded-md flex items-center gap-2 text-xs text-gh-text hover:bg-gh-bg transition-colors"
                >
                  <Link2 className="h-3.5 w-3.5" /> Join with code
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RoleIcon({ role }: { role: string }) {
  const Icon = role === "owner" ? Crown : role === "admin" ? Shield : UserIcon;
  const cls =
    role === "owner" ? "text-amber-400" : role === "admin" ? "text-blue-400" : "text-gh-muted";
  return <Icon className={cn("h-3.5 w-3.5 shrink-0", cls)} />;
}
