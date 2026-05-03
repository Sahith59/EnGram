"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Plus,
  Copy,
  Check,
  X,
  LogOut,
  Crown,
  Shield,
  User as UserIcon,
  Link2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: "owner" | "admin" | "member";
}
interface Team {
  id: string;
  name: string;
  slug: string;
}
interface Invite {
  id: string;
  code: string;
  created_at: string;
  expires_at: string | null;
  max_uses: number;
  use_count: number;
  revoked_at: string | null;
  status: "active" | "revoked" | "expired" | "exhausted";
}

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [role, setRole] = useState<string>("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tr, ir] = await Promise.all([
        fetch("/api/team").then((r) => r.json()),
        fetch("/api/team/invites").then((r) => r.json()).catch(() => ({ invites: [] })),
      ]);
      if (tr.team) {
        setTeam(tr.team);
        setRole(tr.role);
        setMembers(tr.members ?? []);
      }
      setInvites(ir.invites ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch whenever the active team changes elsewhere in the app
  // (TeamSwitcher fires "engram:team-changed" on create/switch/join).
  useEffect(() => {
    function onTeamChanged() {
      setLoading(true);
      refresh();
    }
    window.addEventListener("engram:team-changed", onTeamChanged);
    return () =>
      window.removeEventListener("engram:team-changed", onTeamChanged);
  }, [refresh]);

  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const otherMemberCount = members.filter((m) => m.role !== "owner" || m.id !== members.find((x) => x.role === "owner")?.id).length;

  async function createInvite() {
    setCreatingInvite(true);
    setError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      // Always rebuild from window.location.origin — the browser knows the
      // real public URL, even if the server header detection ever fails.
      const code = data?.invite?.code;
      const url = code ? `${window.location.origin}/team/join/${code}` : data.url;
      setNewInviteUrl(url);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function revokeInvite(code: string) {
    if (!confirm(`Revoke invite ${code}? People who already have the link won't be able to use it.`)) return;
    const res = await fetch(`/api/team/invite/${code}/revoke`, { method: "POST" });
    if (res.ok) await refresh();
    else setError("Failed to revoke");
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function leaveTeam() {
    const owners = members.filter((m) => m.role === "owner");
    const isOnlyMember = members.length === 1;
    const confirmMsg = isOnlyMember
      ? "Leave this team? A new personal workspace will be created for you and your captures will follow."
      : role === "owner" && owners.length === 1
        ? "You're the only owner — you can't leave until you remove or transfer ownership to another member."
        : "Leave this team? Your captures will move to a new personal workspace.";
    if (role === "owner" && owners.length === 1 && !isOnlyMember) {
      alert(confirmMsg);
      return;
    }
    if (!confirm(confirmMsg)) return;
    setLeaving(true);
    try {
      const res = await fetch("/api/team/leave", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      window.location.href = "/team";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to leave");
      setLeaving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
        <div className="text-sm text-gh-muted">Loading team…</div>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8 flex items-start justify-between gap-4"
      >
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
            collaborators
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-gh-text mb-1">
            {team?.name ?? "Team"}
          </h1>
          <p className="text-sm text-gh-muted">
            {members.length} {members.length === 1 ? "member" : "members"} ·{" "}
            <span className="font-mono text-xs">{team?.slug}</span>
          </p>
        </div>
        <button
          onClick={leaveTeam}
          disabled={leaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gh-border text-xs text-gh-muted hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-50"
          title={
            role === "owner" && members.length > 1
              ? "Owners with members must transfer ownership first"
              : "Leave this team"
          }
        >
          <LogOut className="h-3.5 w-3.5" />
          {leaving ? "Leaving…" : "Leave team"}
        </button>
      </motion.div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Members card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden mb-6"
      >
        <div className="px-5 py-4 border-b border-gh-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-gh-muted" />
            <span className="text-sm font-medium text-gh-text">Members</span>
          </div>
          {isOwnerOrAdmin && (
            <button
              onClick={() => {
                setShowInviteModal(true);
                setNewInviteUrl(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Invite
            </button>
          )}
        </div>

        <ul className="divide-y divide-gh-border">
          {members.map((m) => (
            <li key={m.id} className="px-5 py-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gh-bg border border-gh-border flex items-center justify-center text-xs font-medium text-gh-muted">
                {(m.full_name ?? m.email ?? "?").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gh-text truncate">
                  {m.full_name ?? m.email?.split("@")[0] ?? "Unknown"}
                </div>
                <div className="text-xs text-gh-muted truncate">{m.email}</div>
              </div>
              <RoleBadge role={m.role} />
            </li>
          ))}
        </ul>
      </motion.div>

      {/* Active invites — owners/admins only */}
      {isOwnerOrAdmin && invites.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-gh-border flex items-center gap-2">
            <Link2 className="h-4 w-4 text-gh-muted" />
            <span className="text-sm font-medium text-gh-text">Invite links</span>
          </div>
          <ul className="divide-y divide-gh-border">
            {invites.map((inv) => (
              <li key={inv.id} className="px-5 py-3 flex items-center gap-3">
                <code className="font-mono text-xs text-gh-text bg-gh-bg border border-gh-border rounded px-2 py-1">
                  {inv.code}
                </code>
                <div className="flex-1 min-w-0 text-xs text-gh-muted">
                  {inv.use_count}/{inv.max_uses} uses
                  {inv.expires_at && (
                    <> · expires {new Date(inv.expires_at).toLocaleDateString()}</>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-mono uppercase px-1.5 py-0.5 rounded",
                    inv.status === "active"
                      ? "bg-green-500/10 text-green-400 border border-green-500/30"
                      : "bg-gh-bg text-gh-muted border border-gh-border"
                  )}
                >
                  {inv.status}
                </span>
                {inv.status === "active" && (
                  <>
                    <button
                      onClick={() =>
                        copyToClipboard(`${window.location.origin}/team/join/${inv.code}`)
                      }
                      className="p-1.5 text-gh-muted hover:text-gh-text rounded transition-colors"
                      title="Copy invite link"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => revokeInvite(inv.code)}
                      className="p-1.5 text-gh-muted hover:text-red-400 rounded transition-colors"
                      title="Revoke"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Invite modal */}
      {showInviteModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowInviteModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-gh-border bg-gh-canvas p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gh-text">Invite to {team?.name}</h2>
                <p className="text-xs text-gh-muted mt-1">
                  Generates a shareable link. Default: 5 uses, expires in 7 days.
                </p>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-gh-muted hover:text-gh-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!newInviteUrl ? (
              <button
                onClick={createInvite}
                disabled={creatingInvite}
                className="w-full px-4 py-2.5 rounded-md bg-engram hover:bg-engram-light text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {creatingInvite ? "Generating…" : "Generate invite link"}
              </button>
            ) : (
              <>
                <div className="rounded-md border border-gh-border bg-gh-bg p-3 mb-3">
                  <div className="text-[10px] font-mono uppercase text-gh-muted mb-1.5">
                    Share this link
                  </div>
                  <div className="font-mono text-xs text-gh-text break-all select-all">
                    {newInviteUrl}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyToClipboard(newInviteUrl)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-engram hover:bg-engram-light text-white text-xs font-medium transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy link
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setNewInviteUrl(null)}
                    className="px-3 py-2 rounded-md border border-gh-border text-xs text-gh-muted hover:text-gh-text transition-colors"
                  >
                    Create another
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const config = {
    owner: { Icon: Crown, label: "Owner", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
    admin: { Icon: Shield, label: "Admin", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
    member: { Icon: UserIcon, label: "Member", cls: "bg-gh-bg text-gh-muted border-gh-border" },
  }[role] ?? { Icon: UserIcon, label: role, cls: "bg-gh-bg text-gh-muted border-gh-border" };
  const { Icon, label, cls } = config;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border",
        cls
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
