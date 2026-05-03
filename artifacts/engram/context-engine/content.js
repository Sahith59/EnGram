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
  const MODE_KEY = "engram_capture_mode";    // 'personal' | 'team'
  const FINGERPRINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function getCaptureMode() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([MODE_KEY], (res) => {
          resolve(res?.[MODE_KEY] === "team" ? "team" : "personal");
        });
      } catch {
        resolve("personal");
      }
    });
  }

  // ----- State -----
  let lastCaptureAt = 0;
  let lastCaptureFingerprint = ""; // in-memory cache for current page
  let lastUrl = location.href;
  let pendingTimer = null;
  let storageHydrated = false;
  // Page-load grace window: ignore visibility/heartbeat captures fired in the
  // first PAGE_LOAD_GRACE_MS after boot. Stops "browser reopen / tab focus
  // re-render → MutationObserver fires → capture" duplication entirely.
  // Manual captures and limit-detection still go through.
  const PAGE_LOAD_GRACE_MS = 30_000;
  const bootedAt = Date.now();

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
        // Prefer the actual rendered message body — falls back to innerText
        // if Gemini's structure shifts again. innerText alone picks up Material
        // icon ligatures (thumb_up, volume_up, …) and action labels which
        // poison the dedup hash on the server.
        const body =
          el.querySelector(".markdown") ||
          el.querySelector(".query-text") ||
          el.querySelector("message-content") ||
          el;
        pairs.push({ role, content: stripUiNoise(body.innerText ?? "") });
      });
    }
    return pairs.filter((p) => p.content && p.content.length > 1);
  }

  // Defensive: strip Material-icon ligatures and common Gemini/Claude action
  // button labels that leak into innerText. Server hashes the same way for
  // belt-and-braces dedup, but cleaning at source means smaller payloads too.
  const NOISE_LINES = new Set([
    "copy", "copy_all", "edit", "more_vert", "more_horiz", "share",
    "thumb_up", "thumb_down", "volume_up", "volume_off", "stop_circle",
    "play_arrow", "refresh", "download", "open_in_new", "close", "check",
    "show drafts", "hide drafts", "good response", "bad response",
    "regenerate", "regenerate response", "modify response",
    "retry", "retry from here", "edit message",
  ]);
  function stripUiNoise(raw) {
    if (!raw) return "";
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !NOISE_LINES.has(l.toLowerCase()))
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function detectLimitPhrase() {
    const text = document.body?.innerText?.toLowerCase() ?? "";
    return LIMIT_PHRASES.some((p) => text.includes(p));
  }

  // ----- Fingerprint: stable signature of current conversation -----
  // STABLE: based on pair count + first user message identity ONLY.
  // Intentionally excludes total length and last-message slices — those drift
  // when the AI tool re-renders the page (Material-icon ligatures appear /
  // disappear, streaming edits, draft toggles). The server's content_hash is
  // the source of truth for content equality; this fingerprint just answers
  // "is this the same conversation at the same number of turns?"
  //
  // Used by the in-memory + chrome.storage caches to short-circuit captures
  // we've already sent. Pair count is what changes when a real new turn
  // happens — that's exactly when we want to send.
  function stripUiNoiseLite(s) {
    // Mirrors the server's noise list — kept short on purpose. Just enough to
    // make the first-message slice stable across renders.
    return (s || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !/^(copy|copy_all|edit|share|thumb_up|thumb_down|volume_up|more_vert|regenerate|good response|bad response|show drafts|hide drafts)$/i.test(
            l
          )
      )
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function fingerprint(pairs) {
    if (!pairs.length) return "";
    const firstUser =
      pairs.find((p) => (p.role || "").toLowerCase() === "user") ?? pairs[0];
    const seed = stripUiNoiseLite(firstUser?.content ?? "").slice(0, 200);
    return `v2:${pairs.length}:${seed}`;
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

    // Dedupe: if a toast with the same title is already on screen, do not stack
    // another one — just refresh its lifetime so it stays visible a moment longer.
    const key = `${kind}::${title ?? ""}`;
    const existing = c.querySelector(`[data-engram-key="${CSS.escape(key)}"]`);
    if (existing) {
      const prevTimer = Number(existing.dataset.engramTimer || 0);
      if (prevTimer) clearTimeout(prevTimer);
      if (!sticky) {
        const tid = window.setTimeout(() => {
          existing.classList.remove("engram-toast-in");
          setTimeout(() => existing.remove(), 300);
        }, 5000);
        existing.dataset.engramTimer = String(tid);
      }
      return;
    }

    const t = document.createElement("div");
    t.className = `engram-toast engram-toast-${kind}`;
    t.dataset.engramKey = key;
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
      const tid = window.setTimeout(() => {
        t.classList.remove("engram-toast-in");
        setTimeout(() => t.remove(), 300);
      }, 5000);
      t.dataset.engramTimer = String(tid);
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

  // ================================================================
  // INLINE SAVE BUTTONS — Option C: per-response destination routing
  // ================================================================
  // Lets users save a specific AI response (+ its preceding prompt)
  // to Personal or any of their Teams, independently of the global
  // capture mode. A polished pill button appears on hover next to each
  // AI response; clicking reveals a destination dropdown.
  // ================================================================

  let cachedTeams = [];     // populated once at boot, refreshed on success
  let injectTimer = null;   // debounce handle for injection scheduling

  // Fetch teams via background (background can make credentialed fetches)
  async function loadTeamsCache() {
    try {
      const resp = await new Promise((resolve) =>
        chrome.runtime.sendMessage({ type: "GET_TEAMS" }, resolve)
      );
      if (resp?.ok && Array.isArray(resp.teams)) {
        cachedTeams = resp.teams;
      }
    } catch {
      cachedTeams = [];
    }
  }

  // Per-platform DOM config: which elements are AI responses, which are user
  // prompts, and where to insert the save button.
  function getPlatformConfig() {
    if (TOOL === "chatgpt") {
      return {
        assistantSel: '[data-message-author-role="assistant"]',
        userSel:      '[data-message-author-role="user"]',
        textSel:      '.markdown, .prose',
        // Insert the button wrap at the end of the message element itself
        getInsert:    (el) => el,
        // Hover class goes on the same element (ChatGPT wraps each msg)
        getHoverTarget: (el) => el,
      };
    }
    if (TOOL === "claude") {
      return {
        assistantSel: '.font-claude-message',
        userSel:      '.font-user-message',
        textSel:      null,
        getInsert:    (el) => el,
        getHoverTarget: (el) => el.closest("article") || el,
      };
    }
    if (TOOL === "gemini") {
      return {
        assistantSel: 'model-response',
        userSel:      'user-query',
        textSel:      '.markdown, .query-text, message-content',
        getInsert:    (el) => el,
        getHoverTarget: (el) => el,
      };
    }
    return null;
  }

  // Extract clean text from an element, preferring a focused child selector
  function getTextFromEl(el, textSel) {
    if (!el) return "";
    const target = textSel ? (el.querySelector(textSel) || el) : el;
    return stripUiNoise(target.innerText || "");
  }

  // Send a single user+assistant pair to a specific destination
  async function captureSpecificPair(userText, assistantText, mode, teamId) {
    const pairs = [
      { role: "user",      content: userText      },
      { role: "assistant", content: assistantText },
    ];
    return new Promise((resolve) =>
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE_PAIR",
          payload: {
            pairs,
            tool: TOOL,
            url: location.href,
            mode,
            teamId: teamId || undefined,
          },
        },
        resolve
      )
    );
  }

  // Build the pill + dropdown element for one AI response
  function createSaveButton(userText, assistantText) {
    const wrap = document.createElement("div");
    wrap.className = "engram-save-wrap";

    // ---- Trigger button ----
    const btn = document.createElement("button");
    btn.className = "engram-save-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      `<span class="engram-btn-icon">⬡</span>` +
      `<span class="engram-btn-label">Save to ENGRAM</span>` +
      `<span class="engram-btn-caret">▾</span>`;

    // ---- Dropdown ----
    const dropdown = document.createElement("div");
    dropdown.className = "engram-dropdown";

    // Header
    const header = document.createElement("div");
    header.className = "engram-dropdown-header";
    header.innerHTML =
      `<span class="engram-dropdown-logo">ENGRAM</span>` +
      `<span class="engram-dropdown-subtitle">Route this response to…</span>`;
    dropdown.appendChild(header);

    // Personal option
    const personalItem = document.createElement("button");
    personalItem.className = "engram-dropdown-item";
    personalItem.innerHTML =
      `<span class="engram-item-icon">🔒</span>` +
      `<span class="engram-item-label">Personal</span>` +
      `<span class="engram-item-badge engram-badge-personal">private</span>`;
    dropdown.appendChild(personalItem);

    // Team options (if any non-personal teams exist)
    const sharedTeams = cachedTeams.filter((t) => !t.isPersonal);
    if (sharedTeams.length > 0) {
      const div = document.createElement("div");
      div.className = "engram-dropdown-divider";
      dropdown.appendChild(div);
      const sec = document.createElement("div");
      sec.className = "engram-dropdown-section";
      sec.textContent = "Teams";
      dropdown.appendChild(sec);
      for (const team of sharedTeams) {
        const item = document.createElement("button");
        item.className = "engram-dropdown-item";
        const badge = team.role === "owner" ? "engram-badge-owner" : "engram-badge-team";
        const badgeLabel = team.role === "owner" ? "owner" : team.role || "member";
        item.innerHTML =
          `<span class="engram-item-icon">👥</span>` +
          `<span class="engram-item-label">${escapeHtml(team.name)}</span>` +
          `<span class="engram-item-badge ${badge}">${badgeLabel}</span>`;
        item.addEventListener("click", () => handleSave("team", team.id, team.name, btn, dropdown, wrap, userText, assistantText));
        dropdown.appendChild(item);
      }
    }

    personalItem.addEventListener("click", () => handleSave("personal", null, "Personal", btn, dropdown, wrap, userText, assistantText));

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);

    // Toggle dropdown
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains("engram-dropdown-open");
      closeAllDropdowns();
      if (!isOpen) {
        dropdown.classList.add("engram-dropdown-open");
        wrap.classList.add("engram-open");
        btn.setAttribute("aria-expanded", "true");
      }
    });

    // Close on outside click
    document.addEventListener("click", () => {
      if (dropdown.classList.contains("engram-dropdown-open")) {
        dropdown.classList.remove("engram-dropdown-open");
        wrap.classList.remove("engram-open");
        btn.setAttribute("aria-expanded", "false");
      }
    });

    return wrap;
  }

  // Close every open dropdown (so only one is open at a time)
  function closeAllDropdowns() {
    document.querySelectorAll(".engram-dropdown-open").forEach((d) => {
      d.classList.remove("engram-dropdown-open");
    });
    document.querySelectorAll(".engram-save-btn[aria-expanded='true']").forEach((b) => {
      b.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".engram-save-wrap.engram-open").forEach((w) => {
      w.classList.remove("engram-open");
    });
  }

  // Handle a destination selection — show states, send, feedback
  async function handleSave(mode, teamId, label, btn, dropdown, wrap, userText, assistantText) {
    // Close dropdown immediately
    dropdown.classList.remove("engram-dropdown-open");
    wrap.classList.remove("engram-open");
    btn.setAttribute("aria-expanded", "false");

    // Saving state
    btn.classList.add("engram-btn-saving");
    btn.querySelector(".engram-btn-label").textContent = "Saving…";
    btn.querySelector(".engram-btn-icon").innerHTML = `<span class="engram-spinner"></span>`;
    btn.querySelector(".engram-btn-caret").style.display = "none";
    wrap.classList.add("engram-open"); // keep visible while saving

    const resp = await captureSpecificPair(userText, assistantText, mode, teamId);

    btn.classList.remove("engram-btn-saving");

    if (resp?.ok) {
      // Success
      btn.classList.add("engram-btn-saved");
      btn.querySelector(".engram-btn-icon").textContent = "✓";
      btn.querySelector(".engram-btn-label").textContent =
        `Saved to ${label}`;
      // Reset after 3s
      setTimeout(() => {
        btn.classList.remove("engram-btn-saved");
        btn.querySelector(".engram-btn-icon").textContent = "⬡";
        btn.querySelector(".engram-btn-label").textContent = "Save to ENGRAM";
        btn.querySelector(".engram-btn-caret").style.display = "";
        wrap.classList.remove("engram-open");
      }, 3000);
    } else {
      // Error
      btn.classList.add("engram-btn-error");
      btn.querySelector(".engram-btn-icon").textContent = "✕";
      btn.querySelector(".engram-btn-label").textContent =
        resp?.error?.includes("sign in") ? "Sign in first" : "Failed — retry?";
      btn.querySelector(".engram-btn-caret").style.display = "none";
      setTimeout(() => {
        btn.classList.remove("engram-btn-error");
        btn.querySelector(".engram-btn-icon").textContent = "⬡";
        btn.querySelector(".engram-btn-label").textContent = "Save to ENGRAM";
        btn.querySelector(".engram-btn-caret").style.display = "";
        wrap.classList.remove("engram-open");
      }, 4000);
    }
  }

  // Escape HTML for team names in button markup
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Inject save buttons into all undecorated AI responses on the page
  function injectSaveButtons() {
    const config = getPlatformConfig();
    if (!config) return;

    // Collect all message elements (both user and assistant) in DOM order
    const allEls = [];
    const combined = `${config.assistantSel}, ${config.userSel}`;
    document.querySelectorAll(combined).forEach((el) => {
      const isAssistant = el.matches(config.assistantSel);
      allEls.push({ el, role: isAssistant ? "assistant" : "user" });
    });

    // Walk the list: for each assistant element, find its preceding user msg
    allEls.forEach(({ el, role }, idx) => {
      if (role !== "assistant") return;
      if (el.dataset.engramBtn) return; // already decorated

      // Find the most recent user message before this assistant element
      let userEl = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (allEls[i].role === "user") { userEl = allEls[i].el; break; }
      }
      if (!userEl) return;

      const assistantText = getTextFromEl(el, config.textSel);
      const userText      = getTextFromEl(userEl, config.textSel);
      if (!assistantText || !userText) return;

      // Mark injected BEFORE DOM manipulation to prevent double-inject
      el.dataset.engramBtn = "1";

      // Add hover class to the appropriate parent container
      const hoverTarget = config.getHoverTarget(el);
      if (hoverTarget && !hoverTarget.dataset.engramHover) {
        hoverTarget.classList.add("engram-msg-hoverable");
        hoverTarget.dataset.engramHover = "1";
      }

      const btnWrap = createSaveButton(userText, assistantText);
      const insertTarget = config.getInsert(el);
      insertTarget.appendChild(btnWrap);
    });
  }

  // Debounced version — called from MutationObserver so we don't thrash
  function scheduleSaveButtonInjection() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectSaveButtons();
    }, 1200); // slightly faster than capture debounce (8s) so buttons appear promptly
  }

  async function tryCapture({ reason, verbose, minPairs = 2 }) {
    // Page-load grace: never auto-fire on visibility/heartbeat/change events
    // in the first 30s after boot. This is the window where the browser is
    // restoring tabs, Gemini is rerendering its DOM, and the MutationObserver
    // would otherwise fire a redundant capture of an already-saved conversation.
    // Manual ("Capture now" button) and "limit" (context full) bypass.
    if (
      reason !== "manual" &&
      reason !== "limit" &&
      Date.now() - bootedAt < PAGE_LOAD_GRACE_MS
    ) {
      return { ok: false, error: "page_load_grace" };
    }
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

    const mode = await getCaptureMode();
    const resp = await send({
      pairs,
      tool: TOOL,
      url: location.href,
      reason,
      mode,
    });

    if (resp?.ok) {
      // Persist fingerprint (even on duplicate — server may have rejected as dup)
      await setStoredFingerprint(location.href, fp);

      // Don't toast on duplicates returned by server
      if (resp.data?.duplicate) {
        return resp;
      }

      // Server may have UPDATED an existing snapshot (same conversation grew)
      // — show a subtle "updated" toast on manual capture, silent otherwise.
      if (resp.data?.updated) {
        if (verbose) {
          toast({
            kind: "ok",
            title: resp.data?.title ?? "Snapshot updated",
            body: "Added new turns to this conversation.",
          });
        }
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
        // Re-inject save buttons for the new conversation after a short settle delay.
        setTimeout(() => {
          loadTeamsCache().then(() => injectSaveButtons());
        }, 2000);
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
      scheduleSaveButtonInjection(); // re-scan for new AI responses to decorate
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

    // Load teams for the inline save-button dropdown, then inject buttons
    // on all AI responses already present on the page.
    await loadTeamsCache();
    injectSaveButtons();

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
