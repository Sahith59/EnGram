// src/core/sync.ts
// Syncs CLI local SQLite captures with the ENGRAM web app.

import { getUnsyncedSnapshots, markSynced, insertSnapshot, getMostRecent, ContextSnapshot } from '../storage/db';
import { loadConfig } from '../storage/config';

function getHeaders(config: ReturnType<typeof loadConfig>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.accessToken) {
    headers['Authorization'] = `Bearer ${config.accessToken}`;
  } else if (config.extensionSecret) {
    headers['x-engram-secret'] = config.extensionSecret;
  }
  return headers;
}

export async function pushUnsynced(): Promise<number> {
  const config = loadConfig();
  if (!config.engramApiUrl) return 0;

  const unsynced = await getUnsyncedSnapshots();
  let pushed = 0;

  for (const snap of unsynced) {
    try {
      const pairs = JSON.parse(snap.raw_pairs || '[]');
      const body: Record<string, unknown> = {
        pairs,
        tool: snap.ai_tool,
        url: `cli://session/${snap.id}`,
        mode: snap.visibility === 'team' ? 'team' : 'personal',
      };
      if (config.userId && !config.accessToken) {
        body.userId = config.userId;
      }

      const res = await fetch(`${config.engramApiUrl}/api/capture`, {
        method: 'POST',
        headers: getHeaders(config),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        await markSynced(snap.id);
        pushed++;
      }
    } catch {
      // Network unavailable — skip, retry next time
    }
  }

  return pushed;
}

export async function pullRemote(): Promise<number> {
  const config = loadConfig();
  if (!config.engramApiUrl || !config.accessToken) return 0;

  try {
    const res = await fetch(`${config.engramApiUrl}/api/resume`, {
      headers: getHeaders(config),
    });

    if (!res.ok) return 0;

    const json = await res.json() as { data?: WebAppSnapshot | null };
    if (!json.data) return 0;

    const remote = json.data;
    const existing = await getMostRecent();
    if (existing && existing.title === remote.title) return 0;

    await insertSnapshot({
      user_id: config.userId || null,
      title: remote.title,
      summary: remote.summary || null,
      decision: remote.decision || null,
      rationale: remote.rationale || null,
      raw_pairs: JSON.stringify(remote.raw_conversation || []),
      tags: JSON.stringify(remote.tags || []),
      ai_tool: remote.ai_tool || 'other',
      source: 'browser',
      visibility: 'personal',
    });
    return 1;
  } catch {
    return 0;
  }
}

export async function syncAll(): Promise<{ pushed: number; pulled: number }> {
  const [pushed, pulled] = await Promise.all([pushUnsynced(), pullRemote()]);
  return { pushed, pulled };
}

interface WebAppSnapshot {
  id: string;
  title: string;
  summary: string | null;
  decision: string | null;
  rationale: string | null;
  raw_conversation: Array<{ role: string; content: string }> | null;
  tags: string[] | null;
  ai_tool: string;
  visibility: string;
  created_at: string;
}
