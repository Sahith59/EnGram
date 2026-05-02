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

  let lastCaptureAt = 0;
  let bannerShown = false;

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
        document.querySelectorAll("article, .font-claude-message, .font-user-message").forEach((el) => {
          const role = el.classList.contains("font-user-message") ? "user" : "assistant";
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

  function showResumeBanner(snapshot) {
    if (bannerShown) return;
    bannerShown = true;

    const wrap = document.createElement("div");
    wrap.id = "engram-resume-banner";
    wrap.innerHTML = `
      <div class="engram-banner-inner">
        <div class="engram-banner-head">
          <span class="engram-logo">ENGRAM</span>
          <span class="engram-tag">Context saved</span>
          <button class="engram-close" aria-label="Dismiss">×</button>
        </div>
        <div class="engram-banner-title">${(snapshot?.title ?? "Conversation captured").replace(/</g, "&lt;")}</div>
        <div class="engram-banner-body">Your context was summarized and saved. Open ENGRAM to resume in a new chat.</div>
        <a class="engram-resume-btn" href="http://localhost:3000/resume" target="_blank" rel="noreferrer">Resume →</a>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector(".engram-close")?.addEventListener("click", () => wrap.remove());
  }

  async function summarizeNow() {
    const pairs = extractPairs();
    if (pairs.length < 2) return;

    const now = Date.now();
    if (now - lastCaptureAt < 60_000) return;
    lastCaptureAt = now;

    chrome.runtime.sendMessage(
      {
        type: "SUMMARIZE",
        payload: { pairs, tool: TOOL, url: location.href },
      },
      (resp) => {
        if (resp?.ok) showResumeBanner(resp.data);
      }
    );
  }

  async function periodicCapture() {
    const pairs = extractPairs();
    if (pairs.length < 4) return;
    const now = Date.now();
    if (now - lastCaptureAt < 5 * 60_000) return;
    lastCaptureAt = now;
    chrome.runtime.sendMessage({
      type: "CAPTURE",
      payload: { pairs, tool: TOOL, url: location.href },
    });
  }

  setInterval(() => {
    if (detectLimitPhrase()) summarizeNow();
  }, 5000);

  setInterval(periodicCapture, 90_000);

  console.log("[engram] content script loaded for", TOOL);
})();
