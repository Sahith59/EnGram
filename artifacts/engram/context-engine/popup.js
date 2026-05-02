const ENGRAM_API = "http://localhost:3000";

async function init() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");

  const { engram_user_id } = await chrome.storage.local.get("engram_user_id");

  if (engram_user_id) {
    dot.classList.add("ok");
    text.classList.remove("muted");
    text.textContent = `Connected · ${engram_user_id.slice(0, 8)}…`;
  } else {
    dot.classList.add("warn");
    text.innerHTML = `Not connected · <a href="${ENGRAM_API}/login" target="_blank">Sign in</a>`;
  }

  document.getElementById("dashboard-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: `${ENGRAM_API}/dashboard` });
  });

  document.getElementById("resume-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: `${ENGRAM_API}/resume` });
  });

  document.getElementById("ask-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: `${ENGRAM_API}/ask` });
  });
}

init();
