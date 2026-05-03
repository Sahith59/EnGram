"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Users, Check, AlertCircle, ArrowRight } from "lucide-react";

interface Preview {
  valid: boolean;
  reason?: string;
  team?: { name: string; slug: string };
  inviter?: { handle: string };
  expires_at?: string | null;
  uses_remaining?: number;
}

// Next 14 client-component pages receive `params` as a plain object — DO NOT
// wrap it in `use()`. Doing so throws "An unsupported type was passed to use()".
export default function JoinTeamPage({
  params,
}: {
  params: { code: string };
}) {
  const { code } = params;
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/team/invite/${code}`)
      .then((r) => r.json())
      .then((data) => {
        setPreview(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load invite");
        setLoading(false);
      });
  }, [code]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const res = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to join");
      router.push("/team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 md:px-10 py-16 max-w-md mx-auto">
        <div className="text-sm text-gh-muted text-center">Loading invite…</div>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-10 py-16 max-w-md mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl border border-gh-border bg-gh-canvas p-8 text-center"
      >
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-engram/10 border border-engram/30 mb-4">
          <Users className="h-5 w-5 text-engram-light" />
        </div>

        {preview?.valid && preview.team ? (
          <>
            <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
              you&apos;ve been invited
            </p>
            <h1 className="text-2xl font-semibold text-gh-text mb-2">
              Join {preview.team.name}
            </h1>
            <p className="text-sm text-gh-muted mb-6">
              {preview.inviter?.handle} invited you to share AI conversation captures.
            </p>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 mb-6 text-left">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200/90 leading-relaxed">
                  Your existing captures will move with you. Your{" "}
                  <span className="font-mono">personal</span> ones stay private —
                  only your <span className="font-mono">team</span> ones become
                  visible to {preview.team.name}.
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 mb-4 text-xs text-red-300 text-left">
                {error}
              </div>
            )}

            <button
              onClick={join}
              disabled={joining}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-engram hover:bg-engram-light text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {joining ? (
                "Joining…"
              ) : (
                <>
                  Join team <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>

            <button
              onClick={() => router.push("/dashboard")}
              className="mt-3 text-xs text-gh-muted hover:text-gh-text transition-colors"
            >
              Cancel
            </button>

            <div className="mt-6 pt-4 border-t border-gh-border text-[11px] text-gh-muted">
              {preview.uses_remaining} {preview.uses_remaining === 1 ? "use" : "uses"} remaining
              {preview.expires_at && (
                <> · expires {new Date(preview.expires_at).toLocaleDateString()}</>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-gh-text mb-2">
              Invite unavailable
            </h1>
            <p className="text-sm text-gh-muted mb-6">
              {preview?.reason ?? "This invite is not valid."}
            </p>
            {preview?.reason?.includes("already a member") && (
              <div className="inline-flex items-center gap-2 text-xs text-engram-light mb-4">
                <Check className="h-3.5 w-3.5" />
                You&apos;re already in this team.
              </div>
            )}
            <button
              onClick={() => router.push(preview?.reason?.includes("already a member") ? "/team" : "/dashboard")}
              className="px-4 py-2 rounded-md border border-gh-border text-sm text-gh-text hover:bg-gh-bg transition-colors"
            >
              {preview?.reason?.includes("already a member") ? "Go to team →" : "Back to dashboard"}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
