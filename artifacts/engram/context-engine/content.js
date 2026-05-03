// ============================================================
// ENGRAM — Content Script
// Runs in ChatGPT / Claude / Gemini pages. Extracts the
// conversation, listens for capture commands, and shows toasts.
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
  ];

  let lastAutoCaptureAt = 0;

  // ----- Extraction -----
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

  function toast({ kind = "ok", title, body }) {
    const c = ensureToastContainer();
    const t = document.createElement("div");
    t.className = `engram-toast engram-toast-${kind}`;
    t.innerHTML = `
      <div class="engram-toast-head">
        <span class="engram-logo-mini">ENGRAM</span>
        <span class="engram-toast-kind">${kind === "ok" ? "Captured" : "Error"}</span>
        <button class="engram-toast-close" aria-label="Dismiss">×</button>
      </div>
      <div class="engram-toast-title">${(title ?? "").replace(/</g, "&lt;")}</div>
      ${body ? `<div class="engram-toast-body">${String(body).replace(/</g, "&lt;")}</div>` : ""}
    `;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add("engram-toast-in"));
    t.querySelector(".engram-toast-close")?.addEventListener("click", () => t.remove());
    setTimeout(() => {
      t.classList.remove("engram-toast-in");
      setTimeout(() => t.remove(), 300);
    }, 6000);
  }

  // ----- Capture flow -----
  async function captureNow() {
    const pairs = extractPairs();
    if (pairs.length < 2) {
      toast({
        kind: "err",
        title: "Nothing to capture yet",
        body: "Have a back-and-forth conversation first.",
      });
      return { ok: false, error: "Empty conversation" };
    }
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "CAPTURE",
          payload: { pairs, tool: TOOL, url: location.href },
        },
        (resp) => {
          if (resp?.ok) {
            toast({ kind: "ok", title: resp.data?.title ?? "Snapshot saved", body: resp.data?.summary });
          } else {
            toast({ kind: "err", title: "Capture failed", body: resp?.error });
          }
          resolve(resp);
        }
      );
    });
  }

  async function periodicCapture() {
    const pairs = extractPairs();
    if (pairs.length < 4) return;
    const now = Date.now();
    if (now - lastAutoCaptureAt < 5 * 60_000) return;
    lastAutoCaptureAt = now;
    chrome.runtime.sendMessage({
      type: "CAPTURE",
      payload: { pairs, tool: TOOL, url: location.href },
    });
  }

  async function checkContextLimit() {
    if (!detectLimitPhrase()) return;
    const now = Date.now();
    if (now - lastAutoCaptureAt < 60_000) return;
    lastAutoCaptureAt = now;
    chrome.runtime.sendMessage(
      {
        type: "CAPTURE",
        payload: { pairs: extractPairs(), tool: TOOL, url: location.href },
      },
      (resp) => {
        if (resp?.ok) {
          toast({
            kind: "ok",
            title: "Context saved before limit",
            body: "Open ENGRAM to resume in a fresh chat.",
          });
        }
      }
    );
  }

  // ----- Message listener (for "Capture now" from popup) -----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CAPTURE_NOW") {
      captureNow().then(sendResponse);
      return true;
    }
  });

  setInterval(checkContextLimit, 5000);
  setInterval(periodicCapture, 90_000);

  console.log("[engram] content script loaded for", TOOL);
})();
