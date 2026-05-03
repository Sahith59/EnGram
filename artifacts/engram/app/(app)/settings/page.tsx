"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User as UserIcon,
  Key,
  Users as UsersIcon,
  Shield,
  Check,
  ClipboardCopy,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "api", label: "API Key", icon: Key },
  { id: "team", label: "Team", icon: UsersIcon },
  { id: "privacy", label: "Privacy", icon: Shield },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>("profile");

  return (
    <div className="px-6 md:px-10 py-8 max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-8"
      >
        <p className="text-[11px] font-mono uppercase tracking-wider text-engram-light mb-2">
          configuration
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gh-text">Settings</h1>
      </motion.div>

      <div className="grid md:grid-cols-[200px_1fr] gap-8">
        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {tabs.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left whitespace-nowrap",
                  active ? "text-gh-text" : "text-gh-muted hover:text-gh-text hover:bg-gh-canvas"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="settings-active"
                    className="absolute inset-0 rounded-md bg-gh-canvas border border-gh-border"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon className={cn("h-4 w-4 relative z-10", active && "text-engram-light")} />
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === "profile" && <ProfileTab />}
            {tab === "api" && <ApiTab />}
            {tab === "team" && <TeamTab />}
            {tab === "privacy" && <PrivacyTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gh-border bg-gh-canvas overflow-hidden">
      <div className="px-5 py-4 border-b border-gh-border">
        <h3 className="text-base font-semibold text-gh-text">{title}</h3>
        {desc && <p className="text-xs text-gh-muted mt-1">{desc}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="block text-[11px] font-mono uppercase tracking-wider text-gh-muted mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}

function ProfileTab() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email ?? "");
        setName(data.user?.user_metadata?.full_name ?? "");
      });
    } catch {
      // Supabase not configured
    }
  }, []);

  async function save() {
    try {
      const supabase = createClient();
      await supabase.auth.updateUser({ data: { full_name: name } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      // ignore
    }
  }

  return (
    <Card title="Profile" desc="Update your display name and email.">
      <Field label="Email">
        <input
          value={email}
          disabled
          className="w-full h-10 px-3 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-muted font-mono"
        />
      </Field>
      <Field label="Full name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-text outline-none focus:border-engram/50 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12)] transition-all"
        />
      </Field>
      <button
        onClick={save}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-engram hover:bg-engram-light text-white text-sm font-medium transition-colors"
      >
        {saved ? (
          <>
            <Check className="h-4 w-4" />
            Saved
          </>
        ) : (
          "Save changes"
        )}
      </button>
    </Card>
  );
}

function ApiTab() {
  const [key, setKey] = useState("engram_••••••••••••••••••••••••••");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  function generate() {
    const newKey =
      "engram_" +
      Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    setKey(newKey);
    setRevealed(true);
  }

  async function copy() {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card title="Extension API key" desc="Used by the Chrome extension to authenticate captures.">
      <Field label="Key">
        <div className="flex gap-2">
          <input
            value={revealed ? key : "engram_••••••••••••••••••••••••••"}
            readOnly
            className="flex-1 h-10 px-3 rounded-md border border-gh-border bg-gh-bg text-sm text-gh-text font-mono"
          />
          <button
            onClick={copy}
            disabled={!revealed}
            className="h-10 px-3 rounded-md border border-gh-border bg-gh-bg hover:border-gh-muted disabled:opacity-50 transition-colors"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <ClipboardCopy className="h-4 w-4 text-gh-muted" />}
          </button>
        </div>
      </Field>
      <button
        onClick={generate}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-gh-border bg-gh-bg hover:border-engram/40 hover:text-gh-text text-sm text-gh-muted transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Generate new key
      </button>
      <p className="mt-4 text-xs text-gh-muted leading-relaxed">
        Generating a new key will invalidate the previous one. Update your extension afterwards.
      </p>
      <a
        href="/settings/extension"
        className="mt-4 inline-flex items-center gap-2 text-sm text-engram-light hover:underline"
      >
        Install the Chrome extension →
      </a>
    </Card>
  );
}

function TeamTab() {
  return (
    <Card title="Team" desc="Manage your team members and invitations.">
      <p className="text-sm text-gh-text leading-relaxed">
        Team management lives on its own page — view members, generate invite
        links, and revoke access there.
      </p>
      <a
        href="/team"
        className="mt-4 inline-flex items-center gap-2 text-sm text-engram-light hover:underline"
      >
        Open team page →
      </a>
    </Card>
  );
}

function PrivacyTab() {
  return (
    <div className="space-y-4">
      <Card title="Data ownership" desc="Your conversations stay in your Supabase project.">
        <p className="text-sm text-gh-text leading-relaxed">
          Every captured snapshot lives in your own database. ENGRAM never trains on your data.
          You can export or delete everything at any time.
        </p>
      </Card>
      <Card title="Danger zone">
        <button className="px-4 py-2 rounded-md border border-rose-500/30 text-rose-400 text-sm hover:bg-rose-500/10 transition-colors">
          Delete all captured contexts
        </button>
      </Card>
    </div>
  );
}
