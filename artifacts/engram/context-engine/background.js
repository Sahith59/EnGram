// ============================================================
// ENGRAM — Background Service Worker
// ============================================================
// Handles: configuration, identity resolution, capture forwarding,
// resume lookup, project listing, and snapshot reassignment.
// Auth uses session cookies via credentials:'include'.
// ============================================================

const DEFAULT_API =
  "https://35cc1161-d3be-4571-ba44-45b2cbf37965-00-1d7y2w5ur2vjj.spock.replit.dev:3000";

// ----- Storage helpers -----
async function getApiUrl() {
  const { engram_api_url } = await chrome.storage.local.get("engram_api_url");
  return (engram_api_url || DEFAULT_API).replace(/\/$/, "");
}

async function setBadge(text, color, ttlMs) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    if (ttlMs) {
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), ttlMs);
    }
  } catch (e) {
    console.warn("[engram] setBadge failed", e);
  }
}

async function cacheIdentity(identity) {
  await chrome.storage.local.set({
    engram_identity: identity,
    engram_identity_at: Date.now(),
  });
}

async function loadCachedIdentity() {
  const { engram_identity, engram_identity_at } = await chrome.storage.local.get([
    "engram_identity",
    "engram_identity_at",
  ]);
  // 10 minute cache
  if (engram_identity && engram_identity_at && Date.now() - engram_identity_at < 600_000) {
    return engram_identity;
  }
  return null;
}

// ----- Identity resolution via /api/me + session cookie -----
async function fetchIdentity({ force } = { force: false }) {
  if (!force) {
    const cached = await loadCachedIdentity();
    if (cached?.connected) return cached;
  }
  const api = await getApiUrl();
  try {
    const res = await fetch(`${api}/api/me`, {
      credentials: "include",
      headers: { "Cache-Control": "no-cache" },
    });
    if (res.status === 401) {
      const ident = { connected: false, reason: "not_signed_in" };
      await cacheIdentity(ident);
      return ident;
    }
    if (!res.ok) {
      return { connected: false, reason: `http_${res.status}` };
    }
    const data = await res.json();
    await cacheIdentity(data);
    return data;
  } catch (err) {
    return { connected: false, reason: "network_error", message: String(err) };
  }
}

// ----- Local fallback queue -----
async function queueLocal(payload) {
  const { engram_queue = [] } = await chrome.storage.local.get("engram_queue");
  engram_queue.unshift({ ...payload, queued_at: Date.now() });
  await chrome.storage.local.set({ engram_queue: engram_queue.slice(0, 50) });
}

// ----- Capture -----
async function capture(payload) {
  await setBadge("…", "#7c3aed");
  const api = await getApiUrl();
  const ident = await fetchIdentity();

  if (!ident?.connected) {
    await queueLocal(payload);
    await setBadge("!", "#eab308", 4000);
    return {
      ok: false,
      error: "Not signed in. Open the ENGRAM dashboard and sign in.",
      queued: true,
    };
  }

  let resolvedTeamId = ident.team_id;
  if (payload.mode === "team") {
    const { engram_team_id } = await chrome.storage.local.get("engram_team_id");
    if (engram_team_id) resolvedTeamId = engram_team_id;
  }

  try {
    const res = await fetch(`${api}/api/capture`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairs: payload.pairs,
        tool: payload.tool,
        url: payload.url,
        userId: ident.user.id,
        teamId: resolvedTeamId,
        mode: payload.mode === "team" ? "team" : "personal",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await queueLocal(payload);
      await setBadge("!", "#eab308", 4000);
      return { ok: false, error: data?.error ?? `Backend ${res.status}`, queued: true };
    }

    // Badge: purple dot if ambiguous routing, green if confident
    const dp = data?.detectedProject;
    if (dp?.confident) {
      await setBadge("✓", "#22c55e", 4000);
    } else if (dp) {
      await setBadge("?", "#7c3aed", 5000); // routed but low confidence
    } else {
      await setBadge("✓", "#22c55e", 4000);
    }

    try {
      if (chrome.notifications?.create) {
        const repoLabel = dp?.repo ? ` → ${dp.repo}` : "";
        chrome.notifications.create({
          type: "basic",
          iconUrl:
            "data:image/svg+xml;base64," +
            btoa(
              '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="10" fill="#7c3aed"/><text x="24" y="32" text-anchor="middle" font-family="monospace" font-size="14" font-weight="700" fill="white">E</text></svg>'
            ),
          title: "ENGRAM — captured" + repoLabel,
          message: data.title ?? "Conversation snapshot saved",
        });
      }
    } catch {}
    return { ok: true, data };
  } catch (err) {
    await queueLocal(payload);
    await setBadge("!", "#eab308", 4000);
    return { ok: false, error: String(err), queued: true };
  }
}

// ----- Resume lookup -----
async function getResume(tool) {
  const api = await getApiUrl();
  try {
    const url = new URL(`${api}/api/resume`);
    if (tool) url.searchParams.set("tool", tool);
    const res = await fetch(url.toString(), { credentials: "include" });
    if (!res.ok) return { ok: false, error: `Resume ${res.status}` };
    return { ok: true, data: (await res.json()).data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ----- Projects list (for popup "Wrong repo?" picker) -----
async function getProjects() {
  const api = await getApiUrl();
  try {
    const res = await fetch(`${api}/api/projects`, { credentials: "include" });
    if (!res.ok) return { ok: false, projects: [] };
    const data = await res.json();
    // Normalize: support both { projects: [...] } and { data: [...] }
    const raw = data?.projects ?? data?.data ?? [];
    // Return a lightweight list: id, name, repo_full_name
    const projects = raw.map((p) => ({
      id: p.id,
      name: p.name,
      repo_full_name: p.repo?.repo_full_name ?? p.repo_full_name ?? null,
    }));
    return { ok: true, projects };
  } catch (err) {
    return { ok: false, projects: [], error: String(err) };
  }
}

// ----- Snapshot reassignment (extension "Wrong repo?" correction) -----
async function reassignSnapshot({ snapshotId, projectId }) {
  const api = await getApiUrl();
  try {
    const res = await fetch(`${api}/api/capture/reassign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshotId, projectId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error ?? `Reassign failed (${res.status})` };
    }
    return { ok: true, project: data.project };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ----- Checkpoint: save + generate continuation brief -----
async function checkpoint(payload) {
  await setBadge("⚡", "#7c3aed");
  const api = await getApiUrl();
  const ident = await fetchIdentity();

  if (!ident?.connected) {
    await setBadge("!", "#eab308", 4000);
    return {
      ok: false,
      error: "Not signed in. Open the ENGRAM dashboard and sign in.",
    };
  }

  let resolvedTeamId = ident.team_id;
  const { engram_team_id } = await chrome.storage.local.get("engram_team_id");
  if (engram_team_id) resolvedTeamId = engram_team_id;

  try {
    const res = await fetch(`${api}/api/checkpoint`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairs: payload.pairs,
        tool: payload.tool,
        url: payload.url,
        userId: ident.user.id,
        teamId: resolvedTeamId,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await setBadge("!", "#eab308", 4000);
      return { ok: false, error: data?.error ?? `Checkpoint failed (${res.status})` };
    }

    await setBadge("⚡", "#22c55e", 5000);
    return { ok: true, data };
  } catch (err) {
    await setBadge("!", "#eab308", 4000);
    return { ok: false, error: String(err) };
  }
}

// ----- Drain queued captures opportunistically -----
async function drainQueue() {
  const { engram_queue = [] } = await chrome.storage.local.get("engram_queue");
  if (engram_queue.length === 0) return;
  const ident = await fetchIdentity({ force: true });
  if (!ident?.connected) return;
  const remaining = [];
  for (const item of engram_queue) {
    const result = await capture(item);
    if (!result.ok) remaining.push(item);
  }
  await chrome.storage.local.set({ engram_queue: remaining });
}

// ----- Message routing -----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE" || msg?.type === "SUMMARIZE") {
    capture(msg.payload).then(sendResponse);
    return true;
  }
  if (msg?.type === "GET_RESUME") {
    getResume(msg.tool).then(sendResponse);
    return true;
  }
  if (msg?.type === "GET_IDENTITY") {
    fetchIdentity({ force: msg.force }).then(sendResponse);
    return true;
  }
  if (msg?.type === "GET_API_URL") {
    getApiUrl().then((url) => sendResponse({ url }));
    return true;
  }
  if (msg?.type === "SET_API_URL") {
    chrome.storage.local
      .set({ engram_api_url: (msg.url || "").trim().replace(/\/$/, "") })
      .then(() =>
        chrome.storage.local.remove(["engram_identity", "engram_team_id"])
      )
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "DRAIN_QUEUE") {
    drainQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "GET_TEAMS") {
    getApiUrl().then(async (api) => {
      try {
        const res = await fetch(`${api}/api/teams`, { credentials: "include" });
        if (!res.ok) { sendResponse({ ok: false, teams: [] }); return; }
        const data = await res.json();
        sendResponse({ ok: true, teams: data.teams ?? [] });
      } catch {
        sendResponse({ ok: false, teams: [] });
      }
    });
    return true;
  }
  // GET_PROJECTS — lightweight list for "Wrong repo?" popup picker
  if (msg?.type === "GET_PROJECTS") {
    getProjects().then(sendResponse);
    return true;
  }
  // REASSIGN_SNAPSHOT — move capture to a different project (1-click correction)
  if (msg?.type === "REASSIGN_SNAPSHOT") {
    reassignSnapshot({ snapshotId: msg.snapshotId, projectId: msg.projectId }).then(
      sendResponse
    );
    return true;
  }
    // Single-pair capture
  if (msg?.type === "CAPTURE_PAIR") {
    capture(msg.payload).then(sendResponse);
    return true;
  }
  // CHECKPOINT — save session + return continuation brief synchronously
  if (msg?.type === "CHECKPOINT") {
    checkpoint(msg.payload).then(sendResponse);
    return true;
  }
  // HEALTH_CHECK — force an immediate heartbeat and return result
  if (msg?.type === "HEALTH_CHECK") {
    heartbeat().then(sendResponse);
    return true;
  }
  // GET_HEALTH — return cached health status
  if (msg?.type === "GET_HEALTH") {
    chrome.storage.local.get("engram_health").then(({ engram_health }) => {
      sendResponse(engram_health ?? { status: "unknown", checked_at: null });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[engram] extension installed / updated");
  await fetchIdentity({ force: true });
  await heartbeat();
});

// ── F-12: Health heartbeat ────────────────────────────────────────────────────

async function heartbeat() {
  const api = await getApiUrl();
  const startMs = Date.now();
  try {
    const res = await fetch(`${api}/api/health`, {
      credentials: "include",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(8000),
    });
    const data = res.ok ? await res.json().catch(() => ({})) : {};
    const health = {
      status: res.ok ? (data.status ?? "ok") : "error",
      supabase: data.supabase ?? false,
      ai: data.ai ?? false,
      latency_ms: Date.now() - startMs,
      checked_at: Date.now(),
    };
    await chrome.storage.local.set({ engram_health: health });

    // Update badge color to reflect health when no other badge is showing
    const { engram_badge_expiry } = await chrome.storage.local.get("engram_badge_expiry");
    if (!engram_badge_expiry || Date.now() > engram_badge_expiry) {
      if (health.status === "ok") {
        await chrome.action.setBadgeText({ text: "" }); // clean badge = healthy
      } else {
        await setBadge("!", "#eab308"); // yellow = degraded/error
      }
    }
    return health;
  } catch {
    const health = { status: "error", supabase: false, ai: false, latency_ms: Date.now() - startMs, checked_at: Date.now() };
    await chrome.storage.local.set({ engram_health: health });
    return health;
  }
}

// Periodically retry the queue and run heartbeat
setInterval(drainQueue, 5 * 60_000);
setInterval(heartbeat, 5 * 60_000);

// Run heartbeat on install/startup
chrome.runtime.onInstalled.removeListener?.(() => {});
heartbeat().catch(() => {});
