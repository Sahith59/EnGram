// ============================================================
// ENGRAM — Popup
// ============================================================

const dot = document.getElementById("status-dot");
const text = document.getElementById("status-text");
const captureBtn = document.getElementById("capture-btn");
const apiUrlInput = document.getElementById("api-url");
const toast = document.getElementById("toast");

const SUPPORTED = ["chat.openai.com", "chatgpt.com", "claude.ai", "gemini.google.com"];

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function showToast(message, kind = "ok") {
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  setTimeout(() => toast.classList.remove("show"), 4500);
}

function setStatus(state, html) {
  dot.classList.remove("ok", "warn", "err");
  text.classList.remove("muted");
  if (state === "ok") dot.classList.add("ok");
  else if (state === "warn") {
    dot.classList.add("warn");
    text.classList.add("muted");
  } else if (state === "err") dot.classList.add("err");
  text.innerHTML = html;
}

async function refreshIdentity() {
  setStatus("warn", "Checking…");
  const ident = await send({ type: "GET_IDENTITY", force: true });
  const { url: apiUrl } = await send({ type: "GET_API_URL" });
  apiUrlInput.value = apiUrl;

  if (ident?.connected) {
    const label = ident.user.full_name || ident.user.email || "Connected";
    setStatus("ok", `Connected · <span class="muted">${label}</span>`);
  } else {
    setStatus(
      "warn",
      `Not connected · <a href="${apiUrl}/login" target="_blank">Sign in to ENGRAM</a>`
    );
  }
}

async function refreshTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : "";
  const isSupported = SUPPORTED.some((h) => host.includes(h));
  captureBtn.disabled = !isSupported;
  captureBtn.textContent = isSupported
    ? "Capture this conversation"
    : "Open ChatGPT, Claude, or Gemini";
  return tab;
}

document.getElementById("dashboard-btn").addEventListener("click", async () => {
  const { url } = await send({ type: "GET_API_URL" });
  chrome.tabs.create({ url: `${url}/dashboard` });
});

document.getElementById("ask-btn").addEventListener("click", async () => {
  const { url } = await send({ type: "GET_API_URL" });
  chrome.tabs.create({ url: `${url}/ask` });
});

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_NOW" });
    if (result?.ok) {
      showToast(`Saved: ${result.data?.title ?? "snapshot"}`, "ok");
    } else {
      showToast(result?.error ?? "Capture failed", "err");
    }
  } catch (err) {
    showToast(`Page not ready — reload and retry. (${err.message})`, "err");
  }
  await refreshTabContext();
});

document.getElementById("save-api").addEventListener("click", async () => {
  const url = apiUrlInput.value.trim();
  if (!url) return showToast("Enter a valid URL", "err");
  await send({ type: "SET_API_URL", url });
  showToast("Saved. Re-checking…", "ok");
  await refreshIdentity();
  await send({ type: "DRAIN_QUEUE" });
});

(async function init() {
  await refreshTabContext();
  await refreshIdentity();
})();
