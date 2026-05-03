import Link from "next/link";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ExtensionSettingsPage() {
  const apiUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "https://your-engram-app";

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 text-gh-text">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-gh-muted hover:text-gh-text mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to settings
      </Link>

      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-engram-light mb-2">
          Chrome Extension
        </p>
        <h1 className="text-3xl font-semibold mb-2">Context Engine</h1>
        <p className="text-gh-muted">
          The ENGRAM extension watches your AI conversations on ChatGPT, Claude
          and Gemini. When the chat gets long or you click "capture," it sends a
          summary here so your team can search and resume it later.
        </p>
      </div>

      <section className="rounded-xl border border-gh-border bg-gh-card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Download className="h-4 w-4 text-engram-light" />
          Install in Chrome
        </h2>
        <ol className="space-y-3 text-sm text-gh-text/90 list-decimal list-inside">
          <li>
            <a
              href="/engram-extension.tar.gz"
              download
              className="text-engram-light hover:underline inline-flex items-center gap-1"
            >
              Download the extension <Download className="h-3 w-3" />
            </a>
            {" "}and unpack it (or use the folder at{" "}
            <code className="px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-xs">
              artifacts/engram/context-engine
            </code>{" "}
            directly).
          </li>
          <li>
            Open Chrome and go to{" "}
            <code className="px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-xs">
              chrome://extensions
            </code>
            .
          </li>
          <li>
            Toggle <strong>Developer mode</strong> on (top-right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and select the{" "}
            <code className="px-1.5 py-0.5 rounded bg-gh-bg border border-gh-border text-xs">
              context-engine
            </code>{" "}
            folder.
          </li>
          <li>Pin the ENGRAM icon to your toolbar for quick access.</li>
          <li>
            Open the popup and confirm it shows{" "}
            <span className="text-green-400">Connected</span> (it will, because
            you're already signed into this dashboard).
          </li>
        </ol>
      </section>

      <section className="rounded-xl border border-gh-border bg-gh-card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">Configuration</h2>
        <p className="text-sm text-gh-muted mb-4">
          The extension talks to your ENGRAM deployment. By default it uses the
          URL it was built with, but you can override it from the popup's{" "}
          <strong>Settings</strong> drawer.
        </p>
        <div className="text-xs font-mono px-3 py-2 rounded bg-gh-bg border border-gh-border break-all">
          {apiUrl}
        </div>
      </section>

      <section className="rounded-xl border border-gh-border bg-gh-card p-6 mb-6">
        <h2 className="text-lg font-semibold mb-3">How capture works</h2>
        <ul className="space-y-3 text-sm text-gh-text/90">
          <li>
            <strong>Manual:</strong> click the ENGRAM icon → "Capture this
            conversation" while you're on a ChatGPT/Claude/Gemini chat.
          </li>
          <li>
            <strong>Auto on context limit:</strong> when the AI tool warns you
            the conversation is getting long, ENGRAM saves a snapshot
            automatically so you can resume in a fresh chat.
          </li>
          <li>
            <strong>Periodic:</strong> for long working sessions, ENGRAM saves
            an updated snapshot every ~90 seconds.
          </li>
        </ul>
      </section>

      <section className="rounded-xl border border-gh-border bg-gh-card p-6">
        <h2 className="text-lg font-semibold mb-3">Test it</h2>
        <ol className="space-y-2 text-sm text-gh-text/90 list-decimal list-inside">
          <li>
            Open a ChatGPT, Claude or Gemini chat with at least a few back-and-forth
            messages.
          </li>
          <li>Click the ENGRAM icon → "Capture this conversation."</li>
          <li>
            You'll see a toast in the bottom-right confirming the snapshot was
            saved with its title.
          </li>
          <li>
            Come back to the{" "}
            <Link href="/dashboard" className="text-engram-light hover:underline inline-flex items-center gap-1">
              dashboard <ExternalLink className="h-3 w-3" />
            </Link>{" "}
            — the new snapshot will appear at the top of the list.
          </li>
        </ol>
      </section>
    </div>
  );
}
