// ============================================================
// ENGRAM — Content Script (Intelligent Auto-Capture)
// Runs in ChatGPT / Claude / Gemini pages.
// Watches for new conversation turns and silently captures
// snapshots in the background. Manual capture is also supported.
// ============================================================

(() => {
  const HOST = location.hostname;
  let TOOL = "other";
  if (HOST.includes("openai") || HOST.includes("chatgpt")) TOOL = "chatgpt";
  else if (HOST.includes("claude")) TOOL = "claude";
  else if (HOST.includes("gemini")) TOOL = "gemini";

  const LIMIT_PHRASES = [
    "conversation is getting long",
    "context length exceeded",
    "maximum context length",
    "conversation is too long",
    "reached the maximum",
    "message limit",
    "memory full",
  ];

  // ----- State -----
  let lastCaptureAt = 0;
  let lastCaptureFingerprint = "";
  let lastUrl = location.href;
  let pendingTimer = null;

  // ----- Pair extraction (per-tool DOM probes) -----
  function extractPairs() {
    const pairs = [];
    if (TOOL === "chatgpt") {
      document.querySelectorAll("[data-message-author-role]").forEach((el) => {
        const role = el.getAttribute("data-message-author-role");
        const content = el.innerText?.trim();
        if (content) pairs.push({ role, content });
      });
    } else if (TOOL === "claude") {
      document.querySelectorAll("[data-testid^='message']").forEach((el) => {
        const isUser = el.getAttribute("data-testid")?.includes("user");
        pairs.push({
          role: isUser ? "user" : "assistant",
          content: el.innerText?.trim() ?? "",
        });
      });
      if (pairs.length === 0) {
        document
          .querySelectorAll("article, .font-claude-message, .font-user-message")
          .forEach((el) => {
            const role = el.classList.contains("font-user-message")
              ? "user"
              : "assistant";
            const content = el.innerText?.trim();
            if (content) pairs.push({ role, content });
          });
      }
    } else if (TOOL === "gemini") {
      document.querySelectorAll("user-query, model-response").forEach((el) => {
        const role = el.tagName.toLowerCase() === "user-query" ? "user" : "assistant";
        pairs.push({ role, content: el.innerText?.trim() ?? "" });
      });
    }
    return pairs.filter((p) => p.content && p.content.length > 1);
  }

  function detectLimitPhrase() {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    return LIMIT_PHRASES.some((p) => text.includes(p));
  }

  // ----- Conversation fingerprint (cheap dedup of "same chat, same length") -----
  function fingerprint(pairs) {
    if (!pairs.length) return "";
    const last = pairs[pairs.length - 1];
    return `${pairs.length}:${(last.content || "").slice(0, 80)}`;
  }

  // ----- Toast UI -----
  function ensureToastContainer() {
    let c = document.getElementById("engram-toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "engram-toast-container";
      document.body.appendChild(c);
    }
    return c;
  }

  function toast({ kind = "ok", title, body, sticky = false }) {
    const c = ensureToastContainer();
    const t = document.createElement("div");
    t.className = `engram-toast engram-toast-${kind}`;
    t.innerHTML = `
      <div class="engram-toast-head">
        <span class="engram-logo-mini">ENGRAM</span>
        <span class="engram-toast-kind">${kind === "ok" ? "Captured" : "Notice"}</span>
        <button class="engram-toast-close" aria-label="Dismiss">×</button>
      </div>
      <div class="engram-toast-title">${(title ?? "").replace(/</g, "&lt;")}</div>
      ${body ? `<div class="engram-toast-body">${String(body).replace(/</g, "&lt;")}</div>` : ""}
    `;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add("engram-toast-in"));
    t.querySelector(".engram-toast-close")?.addEventListener("click", () => t.remove());
    if (!sticky) {
      setTimeout(() => {
        t.classList.remove("engram-toast-in");
        setTimeout(() => t.remove(), 300);
      }, 5000);
    }
  }

  // ----- Capture core (silent unless verbose=true) -----
  function send(payload) {
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { type: "CAPTURE", payload },
        (resp) => resolve(resp)
      )
    );
  }

  async function tryCapture({ reason, verbose, minPairs = 2 }) {
    const pairs = extractPairs();
    if (pairs.length < minPairs) {
      if (verbose) {
        toast({
          kind: "err",
          title: "Nothing to capture yet",
          body: "Have a back-and-forth conversation first.",
        });
      }
      return { ok: false, error: "Empty conversation" };
    }

    const fp = fingerprint(pairs);
    if (fp === lastCaptureFingerprint && reason !== "manual" && reason !== "limit") {
      // Nothing meaningfully changed since the last save
      return { ok: false, error: "no_change" };
    }

    const now = Date.now();
    // Hard floor: never more than once every 20 seconds for any reason.
    if (now - lastCaptureAt < 20_000 && reason !== "manual") {
      return { ok: false, error: "throttled" };
    }

    lastCaptureAt = now;
    lastCaptureFingerprint = fp;

    const resp = await send({
      pairs,
      tool: TOOL,
      url: location.href,
      reason,
    });

    if (resp?.ok) {
      // For background autocaptures, show a subtle toast only on the first
      // capture of a session — otherwise stay silent.
      if (verbose || reason === "first" || reason === "limit") {
        toast({
          kind: "ok",
          title: resp.data?.title ?? "Snapshot saved",
          body: resp.data?.summary,
        });
      }
    } else if (verbose) {
      toast({ kind: "err", title: "Capture failed", body: resp?.error });
    }
    return resp;
  }

  // ----- Debounced reactive capture (fired by MutationObserver) -----
  function scheduleCapture(reason = "change") {
    if (pendingTimer) clearTimeout(pendingTimer);
    // Wait 8s of quiet after the last DOM change so we capture *complete*
    // assistant responses, not half-streamed ones.
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      tryCapture({ reason, verbose: false, minPairs: 2 });
    }, 8000);
  }

  // ----- Context-limit guard -----
  function checkContextLimit() {
    if (!detectLimitPhrase()) return;
    tryCapture({ reason: "limit", verbose: true, minPairs: 1 });
  }

  // ----- URL change detection (SPA navigation between conversations) -----
  function watchUrlChanges() {
    const interval = setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Reset fingerprint when switching conversations
        lastCaptureFingerprint = "";
        // Capture the *previous* conversation we were on (best effort)
        scheduleCapture("nav");
      }
    }, 1500);
    window.addEventListener("beforeunload", () => clearInterval(interval));
  }

  // ----- Save on tab close / hide -----
  function watchVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        // Best-effort flush
        tryCapture({ reason: "visibility", verbose: false, minPairs: 2 });
      }
    });
  }

  // ----- Mutation observer: react to new messages appearing -----
  function watchDom() {
    const observer = new MutationObserver(() => {
      scheduleCapture("change");
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
      attributes: false,
    });
  }

  // ----- Listener for "Capture now" from popup -----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CAPTURE_NOW") {
      tryCapture({ reason: "manual", verbose: true, minPairs: 1 }).then(sendResponse);
      return true;
    }
  });

  // ----- Boot -----
  function boot() {
    watchDom();
    watchUrlChanges();
    watchVisibility();
    setInterval(checkContextLimit, 5000);
    // Safety net: every 2 minutes, force a check even if MutationObserver missed
    setInterval(() => scheduleCapture("heartbeat"), 120_000);

    // First-load capture (after DOM settles) — gives users immediate feedback
    setTimeout(() => {
      tryCapture({ reason: "first", verbose: false, minPairs: 4 });
    }, 4000);

    console.log("[engram] intelligent capture armed for", TOOL);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
