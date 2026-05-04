// ============================================================
// ENGRAM — Popup
// ============================================================

const dot = document.getElementById("status-dot");
const text = document.getElementById("status-text");
const captureBtn = document.getElementById("capture-btn");
const apiUrlInput = document.getElementById("api-url");
const toast = document.getElementById("toast");

// Detected-project card elements
const detectedProjectCard = document.getElementById("detected-project");
const dpRepo = document.getElementById("dp-repo");
const dpProjectName = document.getElementById("dp-project-name");
const dpConfidence = document.getElementById("dp-confidence");
const dpBar = document.getElementById("dp-bar");
const dpChangeBtn = document.getElementById("dp-change-btn");
const dpWrongLabel = document.getElementById("dp-wrong-label");
const projectPickerWrap = document.getElementById("project-picker-wrap");
const projectPicker = document.getElementById("project-picker");
const reassignConfirm = document.getElementById("reassign-confirm");

const SUPPORTED = ["chat.openai.com", "chatgpt.com", "claude.ai", "gemini.google.com"];

// ── F-01: Signal badge ────────────────────────────────────────────────────────
const signalBadge = document.getElementById("signal-badge");
const signalIcon = document.getElementById("signal-icon");
const signalLabelEl = document.getElementById("signal-label");
const signalScoreEl = document.getElementById("signal-score");
const signalSuggestionEl = document.getElementById("signal-suggestion");

function showSignalBadge(score) {
  if (!score || score.label === "low") { signalBadge.style.display = "none"; return; }
  const isHigh = score.label === "high";
  signalIcon.textContent = isHigh ? "🔴" : "🟡";
  signalLabelEl.textContent = isHigh ? "High-value decisions detected" : "Capture-worthy context";
  signalScoreEl.textContent = `(${score.total}/100)`;
  signalSuggestionEl.textContent = score.suggestion ?? "";
  signalBadge.style.display = "block";
  signalBadge.style.borderColor = isHigh ? "rgba(248,113,113,0.3)" : "rgba(234,179,8,0.3)";
  signalBadge.style.background = isHigh ? "rgba(248,113,113,0.06)" : "rgba(234,179,8,0.06)";
  signalLabelEl.style.color = isHigh ? "#fca5a5" : "#fde68a";
}

async function checkSignal(tab) {
  if (!tab) return;
  const host = tab?.url ? new URL(tab.url).hostname : "";
  if (!SUPPORTED.some((h) => host.includes(h))) return;
  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) return;
    const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAIRS" });
    if (result?.ok && result.pairs?.length >= 2) {
      showSignalBadge(result.score ?? null);
    }
  } catch { /* silent — signal check is best-effort */ }
}

// Track the last captured snapshot id for reassignment
let lastSnapshotId = null;
let lastDetectedProjectId = null;

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

// ── Detected Project Card ─────────────────────────────────────────────────────

/**
 * Show the "Routed to project" card after a successful capture.
 * @param {{ id, name, repo, score, confident } | null} project
 * @param {string} snapshotId
 */
function showDetectedProject(project, snapshotId) {
  lastSnapshotId = snapshotId;
  lastDetectedProjectId = project?.id ?? null;

  if (!project) {
    detectedProjectCard.classList.remove("show", "confident", "ambiguous");
    return;
  }

  // Repo name (monospace, prominent)
  dpRepo.childNodes[0].textContent = project.repo || project.name;
  dpProjectName.textContent = project.repo ? `Project: ${project.name}` : "";

  // Confidence score
  const pct = Math.round(project.score * 100);
  const isConfident = project.confident && project.score >= 0.45;

  dpConfidence.textContent = `${pct}% match`;
  dpConfidence.className = `dp-confidence ${isConfident ? "high" : "low"}`;

  dpBar.style.width = `${Math.min(pct, 100)}%`;
  dpBar.className = `dp-bar ${isConfident ? "" : "low"}`;

  detectedProjectCard.className = `detected-project show ${isConfident ? "confident" : "ambiguous"}`;
  // Reset picker state
  projectPickerWrap.classList.remove("show");
  dpChangeBtn.textContent = "Change ▾";

  if (!isConfident) {
    dpWrongLabel.textContent = "Low confidence — correct if needed";
  } else {
    dpWrongLabel.textContent = "Wrong project?";
  }
}

// "Change ▾" button — toggle project picker
dpChangeBtn.addEventListener("click", async () => {
  const isOpen = projectPickerWrap.classList.contains("show");
  if (isOpen) {
    projectPickerWrap.classList.remove("show");
    dpChangeBtn.textContent = "Change ▾";
    return;
  }

  dpChangeBtn.textContent = "Loading…";
  await loadProjectsIntoPicker();
  projectPickerWrap.classList.add("show");
  dpChangeBtn.textContent = "Close ✕";
});

async function loadProjectsIntoPicker() {
  projectPicker.innerHTML = '<option value="">Loading…</option>';
  reassignConfirm.disabled = true;

  const result = await send({ type: "GET_PROJECTS" });
  const projects = result?.projects ?? [];

  if (projects.length === 0) {
    projectPicker.innerHTML = '<option value="">No indexed projects found</option>';
    return;
  }

  projectPicker.innerHTML =
    '<option value="">— choose a project —</option>' +
    projects
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}"${p.id === lastDetectedProjectId ? " selected" : ""}>${escapeHtml(
            p.repo_full_name ? `${p.repo_full_name} (${p.name})` : p.name
          )}</option>`
      )
      .join("");

  reassignConfirm.disabled = false;
}

projectPicker.addEventListener("change", () => {
  reassignConfirm.disabled = !projectPicker.value;
});

reassignConfirm.addEventListener("click", async () => {
  const targetProjectId = projectPicker.value;
  if (!targetProjectId || !lastSnapshotId) return;

  reassignConfirm.disabled = true;
  reassignConfirm.textContent = "Moving…";

  const result = await send({
    type: "REASSIGN_SNAPSHOT",
    snapshotId: lastSnapshotId,
    projectId: targetProjectId,
  });

  if (result?.ok) {
    const projectName = result.project?.name ?? "selected project";
    showToast(`Moved to: ${projectName}`, "ok");
    lastDetectedProjectId = targetProjectId;
    projectPickerWrap.classList.remove("show");
    dpChangeBtn.textContent = "Change ▾";
    dpProjectName.textContent = `Project: ${projectName}`;
    dpWrongLabel.textContent = "Wrong project?";
  } else {
    showToast(result?.error ?? "Reassign failed", "err");
  }

  reassignConfirm.disabled = false;
  reassignConfirm.textContent = "Move capture";
});

// ── Identity & Teams ──────────────────────────────────────────────────────────

async function refreshIdentity() {
  setStatus("warn", "Checking…");
  const ident = await send({ type: "GET_IDENTITY", force: true });
  const { url: apiUrl } = await send({ type: "GET_API_URL" });
  apiUrlInput.value = apiUrl;

  if (ident?.connected) {
    const label = ident.user.full_name || ident.user.email || "Connected";
    setStatus("ok", `Connected · <span class="muted">${label}</span>`);
    await refreshTeams(apiUrl, ident);
  } else {
    setStatus(
      "warn",
      `Not connected · <a href="${apiUrl}/login" target="_blank">Sign in to ENGRAM</a>`
    );
  }
}

let knownTeams = [];

async function refreshTeams(apiUrl, ident) {
  try {
    const res = await fetch(`${apiUrl}/api/teams`, { credentials: "include" });
    if (!res.ok) { knownTeams = []; return; }
    const data = await res.json();
    knownTeams = (data?.teams ?? []).filter((t) => !t.isPersonal);

    const { engram_team_id } = await chrome.storage.local.get("engram_team_id");
    const stillMember = engram_team_id && knownTeams.some((t) => t.id === engram_team_id);
    if (!stillMember) {
      const fallback = knownTeams[0]?.id ?? ident?.team_id ?? null;
      if (fallback) {
        await chrome.storage.local.set({ engram_team_id: fallback });
      } else {
        await chrome.storage.local.remove("engram_team_id");
      }
    }
  } catch {
    knownTeams = [];
  }
  await paintTeamPicker();
}

const teamPickerField = document.getElementById("team-picker-field");
const teamPicker = document.getElementById("team-picker");
const teamPickerHint = document.getElementById("team-picker-hint");

async function paintTeamPicker() {
  const { engram_capture_mode, engram_team_id } = await chrome.storage.local.get([
    "engram_capture_mode",
    "engram_team_id",
  ]);
  const mode = engram_capture_mode === "team" ? "team" : "personal";

  if (mode !== "team" || knownTeams.length === 0) {
    teamPickerField.style.display = "none";
    return;
  }

  teamPickerField.style.display = "block";

  if (knownTeams.length === 1) {
    teamPicker.innerHTML = `<option value="${knownTeams[0].id}">${escapeHtml(knownTeams[0].name)}</option>`;
    teamPicker.disabled = true;
    teamPickerHint.textContent = "Captures shared with this team.";
  } else {
    teamPicker.disabled = false;
    teamPicker.innerHTML = knownTeams
      .map(
        (t) =>
          `<option value="${t.id}"${t.id === engram_team_id ? " selected" : ""}>${escapeHtml(t.name)}${
            t.role !== "member" ? ` (${t.role})` : ""
          }</option>`
      )
      .join("");
    teamPickerHint.textContent = "Pick which team should receive this capture.";
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

teamPicker.addEventListener("change", async () => {
  const next = teamPicker.value;
  if (!next) return;
  await chrome.storage.local.set({ engram_team_id: next });
  const team = knownTeams.find((t) => t.id === next);
  if (team) showToast(`Team mode → ${team.name}`, "ok");
});

// ── Tab context ───────────────────────────────────────────────────────────────

const checkpointBtn = document.getElementById("checkpoint-btn");
const checkpointPanel = document.getElementById("checkpoint-panel");
const checkpointBrief = document.getElementById("checkpoint-brief");
const checkpointTokenEst = document.getElementById("checkpoint-token-est");
const checkpointCopy = document.getElementById("checkpoint-copy");
const checkpointOpen = document.getElementById("checkpoint-open");
const checkpointDismiss = document.getElementById("checkpoint-dismiss");
const checkpointProjectLabel = document.getElementById("checkpoint-project-label");
let lastCheckpointProjectId = null;

checkpointDismiss.addEventListener("click", () => {
  checkpointPanel.style.display = "none";
});

checkpointCopy.addEventListener("click", async () => {
  const text = checkpointBrief.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    checkpointCopy.textContent = "✓ Copied!";
    setTimeout(() => { checkpointCopy.textContent = "Copy & paste into new tab"; }, 2500);
  } catch {
    checkpointBrief.select();
    document.execCommand("copy");
    checkpointCopy.textContent = "✓ Copied!";
    setTimeout(() => { checkpointCopy.textContent = "Copy & paste into new tab"; }, 2500);
  }
});

checkpointOpen.addEventListener("click", async () => {
  const { url } = await send({ type: "GET_API_URL" });
  const dest = lastCheckpointProjectId
    ? `${url}/projects/${lastCheckpointProjectId}?tab=brief`
    : `${url}/projects`;
  chrome.tabs.create({ url: dest });
});

async function refreshTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab?.url ? new URL(tab.url).hostname : "";
  const isSupported = SUPPORTED.some((h) => host.includes(h));
  captureBtn.disabled = !isSupported;
  checkpointBtn.disabled = !isSupported;
  captureBtn.textContent = isSupported
    ? "Capture this conversation"
    : "Open ChatGPT, Claude, or Gemini";
  // Hide signal badge when not on a supported page
  if (!isSupported) signalBadge.style.display = "none";
  return tab;
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.getElementById("dashboard-btn").addEventListener("click", async () => {
  const { url } = await send({ type: "GET_API_URL" });
  chrome.tabs.create({ url: `${url}/dashboard` });
});

document.getElementById("ask-btn").addEventListener("click", async () => {
  const { url } = await send({ type: "GET_API_URL" });
  chrome.tabs.create({ url: `${url}/ask` });
});

// ── Content-script injection ──────────────────────────────────────────────────

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      await new Promise((r) => setTimeout(r, 300));
      return true;
    } catch (e) {
      console.warn("[engram] inject failed", e);
      return false;
    }
  }
}

// ── Capture ───────────────────────────────────────────────────────────────────

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing…";

  // Hide previous routing result while new capture is in progress
  detectedProjectCard.classList.remove("show", "confident", "ambiguous");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      showToast("Could not inject capture agent on this page.", "err");
    } else {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_NOW" });
      if (result?.ok) {
        const dp = result.data?.detectedProject ?? null;
        const snapshotId = result.data?.id ?? null;

        if (dp) {
          // Show routing card — content-based match found
          showDetectedProject(dp, snapshotId);
          showToast(`Saved · ${dp.repo}`, "ok");
        } else {
          // Generic conversation — no indexed repo match
          showToast(`Saved: ${result.data?.title ?? "snapshot"}`, "ok");
        }
      } else {
        showToast(result?.error ?? "Capture failed", "err");
      }
    }
  } catch (err) {
    showToast(`Capture failed — ${err.message}`, "err");
  }
  await refreshTabContext();
});

// ── Checkpoint ────────────────────────────────────────────────────────────────

checkpointBtn.addEventListener("click", async () => {
  checkpointBtn.disabled = true;
  checkpointBtn.textContent = "⏳ Generating continuation brief…";
  checkpointPanel.style.display = "none";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      showToast("Could not read conversation from this page.", "err");
      checkpointBtn.disabled = false;
      checkpointBtn.textContent = "⚡ Save Checkpoint & Get Continuation Brief";
      return;
    }

    // Get pairs from content script (read-only, no fingerprint check)
    const pairsResult = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAIRS" });
    if (!pairsResult?.ok || !pairsResult.pairs?.length) {
      showToast("No conversation found to checkpoint.", "err");
      checkpointBtn.disabled = false;
      checkpointBtn.textContent = "⚡ Save Checkpoint & Get Continuation Brief";
      return;
    }

    // Send to background → /api/checkpoint (synchronous brief generation)
    const result = await send({
      type: "CHECKPOINT",
      payload: {
        pairs: pairsResult.pairs,
        tool: pairsResult.tool,
        url: tab.url,
      },
    });

    if (result?.ok && result.data?.continuation_brief) {
      const d = result.data;
      checkpointBrief.value = d.continuation_brief;
      checkpointTokenEst.textContent = `~${(d.token_estimate ?? 0).toLocaleString()} tokens`;
      lastCheckpointProjectId = d.project_id ?? null;
      checkpointProjectLabel.textContent = d.project_name
        ? `Project: ${d.project_name}${d.claim_count > 0 ? ` · ${d.claim_count} ENGRAM claims included` : ""}`
        : "No project context detected — session summary only";
      checkpointPanel.style.display = "block";
      showToast("Checkpoint saved — brief ready to copy!", "ok");
    } else {
      showToast(result?.error ?? "Checkpoint failed. Try again.", "err");
    }
  } catch (err) {
    showToast(`Checkpoint failed — ${err.message}`, "err");
  }

  checkpointBtn.disabled = false;
  checkpointBtn.textContent = "⚡ Save Checkpoint & Get Continuation Brief";
  await refreshTabContext();
});

// ── Settings ──────────────────────────────────────────────────────────────────

document.getElementById("save-api").addEventListener("click", async () => {
  const url = apiUrlInput.value.trim();
  if (!url) return showToast("Enter a valid URL", "err");
  await send({ type: "SET_API_URL", url });
  showToast("Saved. Re-checking…", "ok");
  await refreshIdentity();
  await send({ type: "DRAIN_QUEUE" });
});

const modeButtons = document.querySelectorAll(".mode-btn");
const modeHint = document.getElementById("mode-hint");

const MODE_HINTS = {
  personal: "Private to you. Raw chat never shared.",
  team: "Brief shared with team. Raw chat stays yours.",
};

function paintModeButtons(active) {
  modeButtons.forEach((btn) => {
    const isActive = btn.dataset.mode === active;
    btn.classList.toggle("active", isActive);
    btn.style.borderColor = isActive ? "var(--engram)" : "var(--border)";
    btn.style.color = isActive ? "var(--text)" : "var(--muted)";
    btn.style.background = isActive ? "#1c222b" : "var(--card)";
  });
  if (modeHint) modeHint.textContent = MODE_HINTS[active] || MODE_HINTS.personal;
}

async function loadCaptureMode() {
  const { engram_capture_mode } = await chrome.storage.local.get("engram_capture_mode");
  const mode = engram_capture_mode === "team" ? "team" : "personal";
  paintModeButtons(mode);
}

modeButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const next = btn.dataset.mode === "team" ? "team" : "personal";
    await chrome.storage.local.set({ engram_capture_mode: next });
    paintModeButtons(next);
    await paintTeamPicker();
    if (next === "team" && knownTeams.length === 0) {
      showToast("You're not in any shared team yet. Create one in the dashboard.", "err");
    } else {
      showToast(
        next === "team"
          ? "Team mode — briefs will be shared with your team."
          : "Personal mode — captures stay private to you.",
        "ok"
      );
    }
  });
});

// ── F-12: Health display ──────────────────────────────────────────────────────

async function applyHealthToStatus() {
  const health = await send({ type: "GET_HEALTH" });
  if (!health || health.status === "unknown" || !health.checked_at) return;
  // If ENGRAM is degraded/offline, append a warning to the existing status text
  if (health.status !== "ok") {
    const current = text.innerHTML;
    const warning = health.status === "degraded"
      ? ' · <span style="color:var(--yellow)">⚠️ Degraded</span>'
      : ' · <span style="color:var(--red)">⚠️ Offline</span>';
    if (!current.includes("Degraded") && !current.includes("Offline")) {
      text.innerHTML = current + warning;
      dot.classList.remove("ok");
      dot.classList.add(health.status === "degraded" ? "warn" : "err");
    }
  }
  // Show last-checked time
  if (health.checked_at) {
    const ago = Math.round((Date.now() - health.checked_at) / 60000);
    const checkedInfo = document.createElement("span");
    checkedInfo.style.cssText = "display:block;font-size:10px;color:var(--muted);margin-top:3px;";
    checkedInfo.textContent = `API: ${health.status} · ${ago < 1 ? "just now" : `${ago}m ago`}`;
    const existing = document.getElementById("health-time");
    if (!existing) {
      checkedInfo.id = "health-time";
      document.querySelector(".status")?.appendChild(checkedInfo);
    }
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const tab = await refreshTabContext();
  await refreshIdentity();
  await loadCaptureMode();
  // Health check (non-blocking)
  applyHealthToStatus().catch(() => {});
  // Signal check (non-blocking — check if current conversation is worth capturing)
  checkSignal(tab).catch(() => {});
})();
