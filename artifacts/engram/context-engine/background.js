const ENGRAM_API = "http://localhost:3000";
const ENGRAM_SECRET = "engram_ext_secret_2026";

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

async function getUser() {
  const { engram_user_id, engram_team_id } = await chrome.storage.local.get([
    "engram_user_id",
    "engram_team_id",
  ]);
  return { userId: engram_user_id, teamId: engram_team_id };
}

async function storeLocal(payload) {
  const { engram_local_captures = [] } = await chrome.storage.local.get(
    "engram_local_captures"
  );
  engram_local_captures.unshift({ ...payload, captured_at: Date.now() });
  await chrome.storage.local.set({
    engram_local_captures: engram_local_captures.slice(0, 50),
  });
}

async function captureToBackend(payload) {
  await setBadge("…", "#7c3aed");
  const { userId, teamId } = await getUser();

  try {
    const res = await fetch(`${ENGRAM_API}/api/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-engram-secret": ENGRAM_SECRET,
      },
      body: JSON.stringify({
        pairs: payload.pairs,
        tool: payload.tool,
        url: payload.url,
        userId: userId ?? "anonymous",
        teamId: teamId ?? undefined,
      }),
    });

    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();

    await setBadge("✓", "#22c55e", 4000);
    return { ok: true, data };
  } catch (err) {
    console.warn("[engram] backend unreachable, storing locally", err);
    await storeLocal(payload);
    await setBadge("!", "#eab308", 4000);
    return { ok: false, error: String(err), stored: "local" };
  }
}

async function getResume(tool) {
  try {
    const url = new URL(`${ENGRAM_API}/api/resume`);
    if (tool) url.searchParams.set("tool", tool);
    const res = await fetch(url.toString(), {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Resume ${res.status}`);
    return { ok: true, data: (await res.json()).data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "CAPTURE") {
    captureToBackend(msg.payload).then(sendResponse);
    return true;
  }
  if (msg?.type === "GET_RESUME") {
    getResume(msg.tool).then(sendResponse);
    return true;
  }
  if (msg?.type === "SUMMARIZE") {
    captureToBackend(msg.payload).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[engram] extension installed");
});
