"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { GitBranch, ArrowLeft, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export default function LoginPage() {
  const router = useRouter();
  const [configError, setConfigError] = useState<string | null>(null);

  const supabase = useMemo<SupabaseClient | null>(() => {
    try {
      return createClient();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Supabase is not configured");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        router.push("/dashboard");
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, supabase]);

  return (
    <div className="min-h-screen bg-gh-bg text-gh-text relative overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #e6edf3 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      <div
        className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[700px] rounded-full opacity-25 blur-[120px] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(124,58,237,0.6), transparent 60%)",
        }}
      />

      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-sm text-gh-muted hover:text-gh-text transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <div className="relative min-h-screen flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-engram to-engram-light flex items-center justify-center mb-4 shadow-lg shadow-engram/30">
              <GitBranch className="h-6 w-6 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mb-1">
              Welcome to ENGRAM
            </h1>
            <p className="text-sm text-gh-muted">
              Git for AI decisions
            </p>
          </div>

          <div className="rounded-xl border border-gh-border bg-gh-canvas p-6 shadow-xl shadow-black/30">
            {configError || !supabase ? (
              <div className="flex flex-col items-center text-center gap-3 py-4">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
                <h2 className="text-base font-semibold text-gh-text">
                  Supabase isn&apos;t configured yet
                </h2>
                <p className="text-sm text-gh-muted leading-relaxed">
                  Add your <code className="font-mono text-engram-light">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                  <code className="font-mono text-engram-light">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
                  <code className="font-mono">.env.local</code> and restart the server.
                </p>
                {configError && (
                  <p className="text-[11px] font-mono text-gh-muted/70 mt-2 px-3 py-2 rounded bg-gh-bg border border-gh-border">
                    {configError}
                  </p>
                )}
              </div>
            ) : (
            <Auth
              supabaseClient={supabase}
              providers={["google", "github"]}
              redirectTo={
                typeof window !== "undefined"
                  ? `${window.location.origin}/auth/callback`
                  : undefined
              }
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: "#7c3aed",
                      brandAccent: "#a78bfa",
                      brandButtonText: "#ffffff",
                      defaultButtonBackground: "#161b22",
                      defaultButtonBackgroundHover: "#21262d",
                      defaultButtonBorder: "#30363d",
                      defaultButtonText: "#e6edf3",
                      dividerBackground: "#30363d",
                      inputBackground: "#0d1117",
                      inputBorder: "#30363d",
                      inputBorderHover: "#8b949e",
                      inputBorderFocus: "#7c3aed",
                      inputText: "#e6edf3",
                      inputLabelText: "#8b949e",
                      inputPlaceholder: "#8b949e",
                      messageText: "#e6edf3",
                      messageTextDanger: "#f87171",
                      anchorTextColor: "#a78bfa",
                      anchorTextHoverColor: "#c4b5fd",
                    },
                    radii: {
                      borderRadiusButton: "8px",
                      buttonBorderRadius: "8px",
                      inputBorderRadius: "8px",
                    },
                    fonts: {
                      bodyFontFamily: "Inter, system-ui, sans-serif",
                      buttonFontFamily: "Inter, system-ui, sans-serif",
                      inputFontFamily: "Inter, system-ui, sans-serif",
                      labelFontFamily: "Inter, system-ui, sans-serif",
                    },
                  },
                },
              }}
              theme="dark"
            />
            )}
          </div>

          <p className="mt-6 text-center text-xs text-gh-muted">
            By continuing, you agree to capture and own your AI conversations.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
