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

  // Unique nonce for THIS injection. Each time Chrome re-injects the content
  // script (e.g. after extension reload), a new nonce is generated. Boot and
  // listener guards compare against the nonce so the new instance always wins
  // over a stale orphaned context.
  const ENGRAM_NONCE = `eg_${Math.random().toString(36).slice(2, 8)}`;

  // Safe check: returns false once the extension context is invalidated.
  // Wrapping chrome.runtime calls with this prevents the
  // "Extension context invalidated" console errors that appear when the page
  // is still open after an extension reload.
  function isContextAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

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
      // Strategy 1 (2025): data-testid="human-turn" / "ai-turn"
      const modernEls = document.querySelectorAll("[data-testid='human-turn'], [data-testid='ai-turn']");
      if (modernEls.length > 0) {
        modernEls.forEach((el) => {
          const isUser = el.getAttribute("data-testid") === "human-turn";
          const content = stripUiNoise(el.innerText?.trim() ?? "");
          if (content) pairs.push({ role: isUser ? "user" : "assistant", content });
        });
      }
      // Strategy 2: older data-testid^="message" pattern
      if (pairs.length === 0) {
        document.querySelectorAll("[data-testid^='message']").forEach((el) => {
          const tid = el.getAttribute("data-testid") ?? "";
          const isUser = tid.includes("human") || tid.includes("user");
          const content = stripUiNoise(el.innerText?.trim() ?? "");
          if (content) pairs.push({ role: isUser ? "user" : "assistant", content });
        });
      }
      // Strategy 3: class-based fallback
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

  // ----- F-01: Signal scorer (mirrors lib/signal-scorer.ts) -----
  const DECISION_TERMS_CS = [
    "decided", "decision", "we'll use", "we're using", "we are using",
    "going with", "chosen", "we chose", "ruled out", "not going to",
    "won't use", "abandoned", "constraint", "requirement", "must",
    "should not", "next step", "action item", "we need to", "plan is",
    "architecture", "chosen approach", "the solution", "will implement",
    "going to build", "we'll build", "settled on", "agreed on",
  ];
  const TECH_RE_CS = [
    /\b(postgres|postgresql|mongodb|redis|mysql|sqlite|supabase|prisma)\b/i,
    /\b(react|vue|angular|nextjs|next\.js|svelte|remix)\b/i,
    /\b(typescript|javascript|python|rust|golang|java|kotlin)\b/i,
    /\b(docker|kubernetes|k8s|aws|gcp|azure|vercel)\b/i,
    /\b(graphql|rest|grpc|trpc|websocket|openapi)\b/i,
    /v?\d+\.\d+(\.\d+)?/,
    /`[^`\n]+`/,
    /\b(api|endpoint|route|schema|migration|table|column)\b/i,
  ];
  const NOVELTY_CS = ["we", "our", "the project", "the system", "we decided",
    "the team", "we are building", "we need", "we will", "our approach",
    "in our case", "for our", "the codebase"];
  const GENERIC_CS = ["how do i", "what is", "explain ", "tell me about",
    "can you help", "what are the", "how does", "please write", "write me a"];

  function scoreConversation(pairs) {
    if (!pairs || pairs.length === 0) return { total: 0, label: "low", suggestion: null };
    const fullText = pairs.map((p) => p.content).join(" ").toLowerCase();
    const decisionHits = DECISION_TERMS_CS.filter((t) => fullText.includes(t)).length;
    const decision = Math.min(decisionHits / 5, 1);
    const specHits = TECH_RE_CS.filter((r) => r.test(fullText)).length;
    const specificity = Math.min(specHits / 5, 1);
    const n = pairs.length;
    const lengthRaw = n >= 4 && n <= 20 ? 1 : n >= 2 && n < 4 ? 0.6 : n > 20 && n <= 40 ? 0.8 : n === 1 ? 0.2 : 0.5;
    const noveltyHits = NOVELTY_CS.filter((t) => fullText.includes(t)).length;
    const genericHits = GENERIC_CS.filter((t) => fullText.includes(t)).length;
    const noveltyRaw = Math.max(0, Math.min(1, noveltyHits / 4 - genericHits * 0.15));
    const total = Math.max(0, Math.min(100, Math.round(
      0.35 * decision * 100 + 0.25 * specificity * 100 + 0.20 * lengthRaw * 100 + 0.20 * noveltyRaw * 100
    )));
    const label = total >= 65 ? "high" : total >= 35 ? "medium" : "low";
    const suggestion = label === "high"
      ? "Decisions detected — worth capturing"
      : label === "medium" ? "Some useful context — consider capturing" : null;
    return { total, label, suggestion };
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
    if (!isContextAlive()) return Promise.resolve({ ok: false, error: "context_dead" });
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "CAPTURE", payload }, (resp) => {
          if (chrome.runtime.lastError) {
            return resolve({ ok: false, error: chrome.runtime.lastError.message });
          }
          resolve(resp);
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  // ================================================================
  // INLINE SAVE BUTTONS — Option C: per-response destination routing
  // ================================================================
  // A polished pill button injected below every AI response on
  // ChatGPT / Claude / Gemini. Clicking opens a floating dropdown
  // letting the user route that specific (prompt + response) pair to
  // Personal or any Team — independently of the global capture mode.
  //
  // Architecture notes:
  //  • Hover visibility uses JS mouseenter/mouseleave (not CSS :hover)
  //    so it works even when the host page sets pointer-events:none on
  //    message containers.
  //  • The dropdown is appended to document.body as position:fixed and
  //    positioned via getBoundingClientRect() — bypasses any
  //    overflow:hidden clipping in the host page's layout.
  //  • Multiple selector fallbacks per platform handle DOM churn.
  // ================================================================

  let cachedTeams = [];   // teams fetched at boot
  let injectTimer  = null; // debounce handle

  // One global dropdown element lives in document.body.
  // It gets repositioned and repopulated each time a button is clicked.
  let engramGlobalDropdown = null;
  let engramDropdownCleanup = null; // function to call on close

  function ensureGlobalDropdown() {
    if (engramGlobalDropdown && document.body.contains(engramGlobalDropdown)) {
      return engramGlobalDropdown;
    }
    const d = document.createElement("div");
    d.id = "engram-global-dropdown";
    d.className = "engram-dropdown";
    document.body.appendChild(d);
    engramGlobalDropdown = d;
    return d;
  }

  function closeGlobalDropdown() {
    if (!engramGlobalDropdown) return;
    engramGlobalDropdown.classList.remove("engram-dropdown-open");
    if (typeof engramDropdownCleanup === "function") {
      engramDropdownCleanup();
      engramDropdownCleanup = null;
    }
  }

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (
      engramGlobalDropdown &&
      engramGlobalDropdown.classList.contains("engram-dropdown-open") &&
      !engramGlobalDropdown.contains(e.target) &&
      !e.target.closest(".engram-save-btn")
    ) {
      closeGlobalDropdown();
    }
  }, true);

  // Fetch teams via background (cross-origin credentialed fetch)
  async function loadTeamsCache() {
    if (!isContextAlive()) return;
    try {
      const resp = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GET_TEAMS" }, (r) => {
            if (chrome.runtime.lastError) return resolve({ ok: false });
            resolve(r);
          });
        } catch { resolve({ ok: false }); }
      });
      if (resp?.ok && Array.isArray(resp.teams)) cachedTeams = resp.teams;
    } catch {
      cachedTeams = [];
    }
  }

  // Returns ordered list of {el, role} for all messages in DOM order.
  // Uses a multi-strategy cascade per platform so DOM changes are handled.
  function gatherMessageEls() {
    const result = [];

    if (TOOL === "chatgpt") {
      // Strategy 1: data-message-author-role attribute (stable since 2023)
      const ASEL = '[data-message-author-role="assistant"]';
      const USEL = '[data-message-author-role="user"]';
      const byAttr = document.querySelectorAll(`${ASEL}, ${USEL}`);
      if (byAttr.length > 0) {
        byAttr.forEach((el) =>
          result.push({ el, role: el.matches(ASEL) ? "assistant" : "user" })
        );
      } else {
        // Strategy 2: article elements each containing a role attribute
        document.querySelectorAll("article").forEach((art) => {
          const roleEl = art.querySelector("[data-message-author-role]");
          if (roleEl) {
            const r = roleEl.getAttribute("data-message-author-role");
            result.push({ el: roleEl, role: r === "assistant" ? "assistant" : "user" });
          }
        });
      }
      // Strategy 3: last-resort data-testid scan
      if (result.length === 0) {
        document.querySelectorAll('[data-testid*="conversation-turn"]').forEach((el) => {
          const inner = el.querySelector("[data-message-author-role]");
          if (inner) {
            const r = inner.getAttribute("data-message-author-role");
            result.push({ el: inner, role: r === "assistant" ? "assistant" : "user" });
          }
        });
      }
    }

    if (TOOL === "claude") {
      // Strategy 1 (2025): data-testid="human-turn" / "ai-turn"
      const modernEls = document.querySelectorAll("[data-testid='human-turn'], [data-testid='ai-turn']");
      if (modernEls.length > 0) {
        modernEls.forEach((el) => {
          const isUser = el.getAttribute("data-testid") === "human-turn";
          result.push({ el, role: isUser ? "user" : "assistant" });
        });
      }
      // Strategy 2: older data-testid^="message" pattern
      if (result.length === 0) {
        document.querySelectorAll("[data-testid^='message']").forEach((el) => {
          const tid = el.getAttribute("data-testid") || "";
          result.push({ el, role: tid.includes("human") || tid.includes("user") ? "user" : "assistant" });
        });
      }
      // Strategy 3: class-based selectors
      if (result.length === 0) {
        document.querySelectorAll(".font-claude-message, .font-user-message").forEach((el) => {
          result.push({
            el,
            role: el.classList.contains("font-user-message") ? "user" : "assistant",
          });
        });
      }
      // Strategy 4: generic article scan (last resort)
      if (result.length === 0) {
        document.querySelectorAll("article").forEach((el) => {
          const text = el.innerText?.trim();
          if (text && text.length > 10) result.push({ el, role: "assistant" });
        });
      }
    }

    if (TOOL === "gemini") {
      // Strategy 1: Gemini custom elements — very stable
      document.querySelectorAll("user-query, model-response").forEach((el) => {
        result.push({
          el,
          role: el.tagName.toLowerCase() === "user-query" ? "user" : "assistant",
        });
      });
      // Strategy 2: data-testid for newer Gemini versions
      if (result.length === 0) {
        document.querySelectorAll("[data-testid='user-query'], [data-testid='model-response']")
          .forEach((el) => {
            const r = el.getAttribute("data-testid");
            result.push({ el, role: r === "user-query" ? "user" : "assistant" });
          });
      }
    }

    console.log(`[engram] gatherMessageEls: ${result.length} elements on ${TOOL}`);
    return result;
  }

  // Clean innerText from any element (fallback chain for text selectors)
  function getTextFromEl(el) {
    if (!el) return "";
    // Try to find the actual prose container; fall back to the whole element
    const prose =
      el.querySelector(".markdown") ||
      el.querySelector(".prose")    ||
      el.querySelector("message-content") ||
      el.querySelector(".query-text") ||
      el;
    return stripUiNoise(prose.innerText || "");
  }

  // Escape HTML for team names displayed in dropdown markup
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Send exactly one (user + assistant) pair to the chosen destination
  async function captureSpecificPair(userText, assistantText, mode, teamId) {
    if (!isContextAlive()) return { ok: false, error: "context_dead" };
    const pairs = [
      { role: "user",      content: userText      },
      { role: "assistant", content: assistantText },
    ];
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "CAPTURE_PAIR",
            payload: { pairs, tool: TOOL, url: location.href, mode,
                       teamId: teamId || undefined },
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              return resolve({ ok: false, error: chrome.runtime.lastError.message });
            }
            resolve(resp);
          }
        );
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  // Show the global dropdown anchored to the given button element
  function openDropdownFor(anchorBtn, userText, assistantText, triggerWrap) {
    const dd = ensureGlobalDropdown();

    // Rebuild dropdown contents for this button's context
    dd.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "engram-dropdown-header";
    header.innerHTML =
      `<span class="engram-dropdown-logo">ENGRAM</span>` +
      `<span class="engram-dropdown-subtitle">Route this response to…</span>`;
    dd.appendChild(header);

    // Helper: build a destination row
    function addDestRow(icon, label, badgeClass, badgeText, onClick) {
      const row = document.createElement("button");
      row.className = "engram-dropdown-item";
      row.innerHTML =
        `<span class="engram-item-icon">${icon}</span>` +
        `<span class="engram-item-label">${label}</span>` +
        `<span class="engram-item-badge ${badgeClass}">${badgeText}</span>`;
      row.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
      dd.appendChild(row);
    }

    // Personal
    addDestRow("🔒", "Personal", "engram-badge-personal", "private", () =>
      handleSave("personal", null, "Personal", anchorBtn, triggerWrap, userText, assistantText)
    );

    // Teams
    const sharedTeams = cachedTeams.filter((t) => !t.isPersonal);
    if (sharedTeams.length > 0) {
      const divider = document.createElement("div");
      divider.className = "engram-dropdown-divider";
      dd.appendChild(divider);
      const sec = document.createElement("div");
      sec.className = "engram-dropdown-section";
      sec.textContent = "Teams";
      dd.appendChild(sec);
      for (const team of sharedTeams) {
        const badgeCls   = team.role === "owner" ? "engram-badge-owner" : "engram-badge-team";
        const badgeLbl   = team.role === "owner" ? "owner" : (team.role || "member");
        addDestRow("👥", escapeHtml(team.name), badgeCls, badgeLbl, () =>
          handleSave("team", team.id, team.name, anchorBtn, triggerWrap, userText, assistantText)
        );
      }
    }

    // Position: fixed, above the button
    const rect = anchorBtn.getBoundingClientRect();
    dd.style.left   = `${Math.max(8, rect.left)}px`;
    dd.style.top    = "auto";
    dd.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    dd.style.right  = "auto";

    // Flip to below if not enough space above
    if (rect.top < 200) {
      dd.style.top    = `${rect.bottom + 6}px`;
      dd.style.bottom = "auto";
    }

    requestAnimationFrame(() => dd.classList.add("engram-dropdown-open"));

    // Cleanup: remove open class from wrap on close
    engramDropdownCleanup = () => {
      triggerWrap.classList.remove("engram-open");
      anchorBtn.setAttribute("aria-expanded", "false");
    };
  }

  // Handle a destination click: update button state, send, give feedback
  async function handleSave(mode, teamId, label, btn, wrap, userText, assistantText) {
    closeGlobalDropdown();

    // Saving state — keep wrap visible
    wrap.classList.add("engram-open");
    btn.classList.add("engram-btn-saving");
    const iconEl  = btn.querySelector(".engram-btn-icon");
    const labelEl = btn.querySelector(".engram-btn-label");
    const caretEl = btn.querySelector(".engram-btn-caret");
    labelEl.textContent = "Saving…";
    iconEl.innerHTML = `<span class="engram-spinner"></span>`;
    if (caretEl) caretEl.style.display = "none";

    const resp = await captureSpecificPair(userText, assistantText, mode, teamId);
    btn.classList.remove("engram-btn-saving");

    if (resp?.ok) {
      btn.classList.add("engram-btn-saved");
      iconEl.textContent  = "✓";
      labelEl.textContent = `Saved to ${label}`;
      setTimeout(() => {
        btn.classList.remove("engram-btn-saved");
        iconEl.textContent  = "⬡";
        labelEl.textContent = "Save to ENGRAM";
        if (caretEl) caretEl.style.display = "";
        wrap.classList.remove("engram-open");
      }, 3000);
    } else {
      btn.classList.add("engram-btn-error");
      iconEl.textContent  = "✕";
      labelEl.textContent = resp?.error?.includes("sign in") ? "Sign in first" : "Failed — retry?";
      if (caretEl) caretEl.style.display = "none";
      setTimeout(() => {
        btn.classList.remove("engram-btn-error");
        iconEl.textContent  = "⬡";
        labelEl.textContent = "Save to ENGRAM";
        if (caretEl) caretEl.style.display = "";
        wrap.classList.remove("engram-open");
      }, 4000);
    }
  }

  // Build and attach the pill button for one assistant element.
  // Injection strategy: find the prose/markdown container inside the element,
  // then insert the button wrap RIGHT AFTER it as a sibling. This avoids
  // being clipped by overflow:hidden on the root message container and puts
  // the button in the natural reading flow below the response text.
  function attachSaveButton(assistantEl, userText, assistantText) {
    // Mark before touching DOM to prevent double-inject
    assistantEl.dataset.engramBtn = "1";

    // ---- Build the button ----
    const wrap = document.createElement("div");
    wrap.className = "engram-save-wrap";

    const btn = document.createElement("button");
    btn.className = "engram-save-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      `<span class="engram-btn-icon">⬡</span>` +
      `<span class="engram-btn-label">Save to ENGRAM</span>` +
      `<span class="engram-btn-caret">▾</span>`;
    wrap.appendChild(btn);

    // ---- Find best injection anchor inside the assistant element ----
    // We prefer the innermost prose container so the button appears right
    // below the response text, before ChatGPT/Claude action buttons.
    const proseAnchor =
      assistantEl.querySelector(".markdown") ||
      assistantEl.querySelector('[class*="prose"]') ||
      assistantEl.querySelector('[class*="markdown"]') ||
      assistantEl.querySelector("message-content") ||
      assistantEl.querySelector(".query-text") ||
      null;

    if (proseAnchor && proseAnchor.parentElement) {
      // Insert wrap after the prose block, as a sibling inside its parent
      proseAnchor.insertAdjacentElement("afterend", wrap);
    } else {
      // Fallback: append at the end of the assistantEl itself
      assistantEl.appendChild(wrap);
    }

    // ---- Hover: bump to full opacity; revert on leave ----
    // Buttons are visible by default (CSS opacity: 0.45).
    // On hover of the containing article we go to full opacity.
    const hoverTarget = assistantEl.closest("article") || assistantEl;
    if (!hoverTarget.dataset.engramHoverBound) {
      hoverTarget.dataset.engramHoverBound = "1";
      hoverTarget.addEventListener("mouseenter", () => {
        hoverTarget.querySelectorAll(".engram-save-wrap").forEach((w) => {
          w.style.opacity = "1";
        });
      });
      hoverTarget.addEventListener("mouseleave", () => {
        if (engramGlobalDropdown?.classList.contains("engram-dropdown-open")) return;
        hoverTarget.querySelectorAll(".engram-save-wrap").forEach((w) => {
          if (!w.classList.contains("engram-open")) {
            w.style.opacity = ""; // revert to CSS default (0.45)
          }
        });
      });
    }

    // ---- Click: open the global dropdown ----
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const alreadyOpen =
        engramGlobalDropdown?.classList.contains("engram-dropdown-open") &&
        wrap.classList.contains("engram-open");

      closeGlobalDropdown();

      if (!alreadyOpen) {
        wrap.classList.add("engram-open");
        wrap.style.opacity = "1";
        btn.setAttribute("aria-expanded", "true");
        openDropdownFor(btn, userText, assistantText, wrap);
      }
    });
  }

  // Main injection pass — scans for undecorated AI responses
  function injectSaveButtons() {
    try {
      const allEls = gatherMessageEls();
      console.log(`[engram] injectSaveButtons: found ${allEls.length} message elements on ${TOOL}`);

      allEls.forEach(({ el, role }, idx) => {
        if (role !== "assistant") return;
        if (el.dataset.engramBtn) return;

        // Find nearest preceding user message
        let userEl = null;
        for (let i = idx - 1; i >= 0; i--) {
          if (allEls[i].role === "user") { userEl = allEls[i].el; break; }
        }

        const assistantText = getTextFromEl(el);
        const userText      = userEl ? getTextFromEl(userEl) : "";

        // Only require the assistant text to be non-empty
        if (!assistantText) return;

        attachSaveButton(el, userText, assistantText);
      });
    } catch (err) {
      console.error("[engram] injectSaveButtons error:", err);
    }
  }

  // Debounced version — called from MutationObserver
  function scheduleSaveButtonInjection() {
    if (injectTimer) clearTimeout(injectTimer);
    injectTimer = setTimeout(() => {
      injectTimer = null;
      injectSaveButtons();
    }, 1200);
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
  // Use nonce-based guard: each new injection installs its own listener,
  // replacing the dead one left by any previously orphaned context.
  if (window.__engramListenerInstalled !== ENGRAM_NONCE) {
    window.__engramListenerInstalled = ENGRAM_NONCE;
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!isContextAlive()) return false;
        if (msg?.type === "PING") {
          sendResponse({ ok: true, ready: true });
          return false;
        }
        if (msg?.type === "CAPTURE_NOW") {
          tryCapture({ reason: "manual", verbose: true, minPairs: 1 }).then(sendResponse);
          return true;
        }
        // GET_PAIRS — read-only DOM extraction for checkpoint + signal scoring
        if (msg?.type === "GET_PAIRS") {
          try {
            const pairs = extractPairs();
            const score = scoreConversation(pairs);
            sendResponse({ ok: true, pairs, tool: TOOL, score });
          } catch (e) {
            sendResponse({ ok: false, error: String(e), pairs: [], score: null });
          }
          return false;
        }
      });
    } catch (e) {
      console.warn("[engram] could not install message listener:", e);
    }
  }

  // ----- Boot -----
  async function boot() {
    // Nonce-based guard: if THIS exact injection already booted, skip.
    // If a DIFFERENT injection (e.g. old orphaned context) set the flag,
    // we take over — clean up its injected elements and re-run.
    const prevNonce = window.__engramBooted;
    if (prevNonce === ENGRAM_NONCE) return;
    window.__engramBooted = ENGRAM_NONCE;

    // If a previous injection left buttons on the page, remove them so we
    // can re-inject fresh ones with working event handlers.
    if (prevNonce) {
      try {
        document.querySelectorAll(".engram-save-wrap").forEach((el) => el.remove());
        document.querySelectorAll("[data-engram-btn]").forEach((el) => {
          delete el.dataset.engramBtn;
        });
        document.querySelectorAll("[data-engram-hover-bound]").forEach((el) => {
          delete el.dataset.engramHoverBound;
        });
        document.getElementById("engram-global-dropdown")?.remove();
        engramGlobalDropdown = null;
      } catch {}
    }

    if (!isContextAlive()) {
      console.warn("[engram] context already dead at boot — aborting");
      return;
    }

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
    // Heartbeat: every 5 minutes. Fingerprint check will short-circuit if nothing changed.
    setInterval(() => scheduleCapture("heartbeat"), 5 * 60_000);

    // Load teams for the inline save-button dropdown, then inject buttons
    // on all AI responses already present on the page.
    await loadTeamsCache();
    injectSaveButtons();

    console.log("[engram] v0.3.1 armed for", TOOL, `(nonce: ${ENGRAM_NONCE})`,
      stored ? "· known conversation" : "· new conversation");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
