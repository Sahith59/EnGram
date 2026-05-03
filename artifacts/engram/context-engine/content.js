// ============================================================
// ENGRAM — Content Script (Intelligent Auto-Capture)
// Runs in ChatGPT / Claude / Gemini pages.
// Watches for new conversation turns and silently captures
// snapshots in the background. Manual capture is also supported.
//
// DEDUP STRATEGY (Phase 5B):
//  1. Per-conversation fingerprint persisted in chrome.storage.local
//     keyed by source URL — survives tab reloads, profile switches.
//  2. Server-side SHA-256 dedup as the safety net (free if dup hits).
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

  const STORAGE_KEY = "engram_fingerprints"; // { [url]: { fp, ts } }
  const FINGERPRINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  // ----- State -----
  let lastCaptureAt = 0;
  let lastCaptureFingerprint = ""; // in-memory cache for current page
  let lastUrl = location.href;
  let pendingTimer = null;
  let storageHydrated = false;

  // ----- Persistent fingerprint store -----
  function urlKey(url) {
    // Normalize: drop hash, drop query params that are tracking-only
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return url;
    }
  }

  function getStoredFingerprint(url) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          const all = res?.[STORAGE_KEY] ?? {};
          const entry = all[urlKey(url)];
          if (!entry) return resolve(null);
          if (Date.now() - entry.ts > FINGERPRINT_TTL_MS) return resolve(null);
          resolve(entry.fp);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function setStoredFingerprint(url, fp) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (res) => {
          const all = res?.[STORAGE_KEY] ?? {};
          // GC old entries (cap to ~500)
          const keys = Object.keys(all);
          if (keys.length > 500) {
            const sorted = keys
              .map((k) => [k, all[k].ts || 0])
              .sort((a, b) => a[1] - b[1])
              .slice(0, keys.length - 400);
            sorted.forEach(([k]) => delete all[k]);
          }
          all[urlKey(url)] = { fp, ts: Date.now() };
          chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
        });
      } catch {
        resolve();
      }
    });
  }

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

  // ----- Fingerprint: stable signature of current conversation -----
  // Uses pair count + length + first/last content slices. Cheap, deterministic,
  // matches across reloads of the same conversation.
  function fingerprint(pairs) {
    if (!pairs.length) return "";
    const total = pairs.reduce((a, p) => a + (p.content?.length || 0), 0);
    const first = pairs[0]?.content?.slice(0, 60) ?? "";
    const last = pairs[pairs.length - 1]?.content?.slice(0, 60) ?? "";
    return `${pairs.length}:${total}:${first}|${last}`;
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

  // ----- Capture core -----
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

    // Check in-memory first (fast path)
    if (fp === lastCaptureFingerprint && reason !== "manual" && reason !== "limit") {
      return { ok: false, error: "no_change_memory" };
    }

    // Check persistent storage (survives reloads / tab reopens)
    if (reason !== "manual" && reason !== "limit") {
      const stored = await getStoredFingerprint(location.href);
      if (stored === fp) {
        lastCaptureFingerprint = fp; // hydrate in-memory cache
        if (reason === "first" || reason === "nav") {
          // Silent — user just revisited an already-captured conversation
          return { ok: false, error: "no_change_persisted" };
        }
        return { ok: false, error: "no_change_persisted" };
      }
    }

    const now = Date.now();
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
      // Persist fingerprint (even on duplicate — server may have rejected as dup)
      await setStoredFingerprint(location.href, fp);

      // Don't toast on duplicates returned by server
      if (resp.data?.duplicate) {
        return resp;
      }

      if (verbose || reason === "limit") {
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

  // ----- URL change detection -----
  function watchUrlChanges() {
    const interval = setInterval(async () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        lastCaptureFingerprint = ""; // reset in-memory; persistent store still authoritative
        // Don't auto-fire capture on nav — wait for MutationObserver to see new content,
        // and persistent fingerprint will short-circuit if conversation unchanged.
      }
    }, 1500);
    window.addEventListener("beforeunload", () => clearInterval(interval));
  }

  // ----- Save on tab close / hide -----
  function watchVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        // Best-effort flush — fingerprint check will skip if unchanged
        tryCapture({ reason: "visibility", verbose: false, minPairs: 2 });
      }
    });
  }

  // ----- Mutation observer -----
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

  // ----- Listener for "Capture now" / ping from popup -----
  if (!window.__engramListenerInstalled) {
    window.__engramListenerInstalled = true;
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "PING") {
        sendResponse({ ok: true, ready: true });
        return false;
      }
      if (msg?.type === "CAPTURE_NOW") {
        tryCapture({ reason: "manual", verbose: true, minPairs: 1 }).then(sendResponse);
        return true;
      }
    });
  }

  // ----- Boot -----
  async function boot() {
    if (window.__engramBooted) return;
    window.__engramBooted = true;

    // Hydrate fingerprint from storage so first DOM mutation doesn't re-capture
    const stored = await getStoredFingerprint(location.href);
    if (stored) {
      lastCaptureFingerprint = stored;
    }
    storageHydrated = true;

    watchDom();
    watchUrlChanges();
    watchVisibility();
    setInterval(checkContextLimit, 5000);
    // Heartbeat: every 5 minutes (not 2). Fingerprint check will short-circuit
    // if nothing changed, so this is essentially free.
    setInterval(() => scheduleCapture("heartbeat"), 5 * 60_000);

    // NOTE: no more `reason: "first"` auto-fire. MutationObserver + visibility
    // handle real changes. Persistent fingerprint prevents revisit duplicates.

    console.log("[engram] intelligent capture armed for", TOOL, stored ? "(known conversation)" : "(new conversation)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
