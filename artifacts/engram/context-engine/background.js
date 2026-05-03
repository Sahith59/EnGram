// ============================================================
// ENGRAM — Background Service Worker
// ============================================================
// Handles: configuration, identity resolution, capture forwarding,
// and resume lookup. Auth uses session cookies via credentials:'include'.
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
  // 10 minute cache so we don't hammer /api/me on every capture
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
        teamId: ident.team_id,
        mode: payload.mode === "team" ? "team" : "personal",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await queueLocal(payload);
      await setBadge("!", "#eab308", 4000);
      return { ok: false, error: data?.error ?? `Backend ${res.status}`, queued: true };
    }

    await setBadge("✓", "#22c55e", 4000);
    try {
      // Notifications API requires an icon — skip silently if unavailable
      if (chrome.notifications?.create) {
        chrome.notifications.create({
          type: "basic",
          iconUrl:
            "data:image/svg+xml;base64," +
            btoa(
              '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="10" fill="#7c3aed"/><text x="24" y="32" text-anchor="middle" font-family="monospace" font-size="14" font-weight="700" fill="white">E</text></svg>'
            ),
          title: "ENGRAM — captured",
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
      .then(() => chrome.storage.local.remove("engram_identity"))
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "DRAIN_QUEUE") {
    drainQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[engram] extension installed");
  await fetchIdentity({ force: true });
});

// Periodically retry the queue
setInterval(drainQueue, 5 * 60_000);
