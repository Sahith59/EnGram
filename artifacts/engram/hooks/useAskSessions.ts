"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MessageRecord {
  question: string;
  answer: string;
  sources: AnswerSource[];
  related: RelatedSource[];
  confidence: number | null;
  scope: string;
  ts: number;
}

export interface AnswerSource {
  ref: number;
  id: string;
  title: string;
  ai_tool: string;
  created_at: string;
  visibility: string;
  author_handle: string | null;
}

export interface RelatedSource {
  id: string;
  title: string;
  row?: { id: string; title: string };
}

export interface AskSession {
  id: string;
  title: string;
  messages: MessageRecord[];
  scope: string;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  favorite?: boolean;
}

const STORAGE_KEY = "engram_ask_sessions_v2";
const ACTIVE_KEY = "engram_ask_active_session_v2";

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadLocal(): AskSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocal(sessions: AskSession[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

function loadActiveId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

export function sortSessions(sessions: AskSession[]): AskSession[] {
  const pinned = sessions.filter((s) => s.pinned).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  const rest = sessions.filter((s) => !s.pinned).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  return [...pinned, ...rest];
}

export function useAskSessions() {
  const [sessions, setSessions] = useState<AskSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const syncInFlight = useRef(false);

  useEffect(() => {
    const local = loadLocal();
    setSessions(sortSessions(local));
    const savedActive = loadActiveId();
    if (savedActive && local.find((s) => s.id === savedActive)) {
      setActiveSessionIdState(savedActive);
    }
    fetchRemoteSessions();
  }, []);

  async function fetchRemoteSessions() {
    try {
      const res = await fetch("/api/ask/sessions");
      if (!res.ok) return;
      const { sessions: remote } = await res.json() as { sessions: AskSession[] };
      if (!remote?.length) return;
      setSessions((local) => {
        const localIds = new Set(local.map((s) => s.id));
        const merged = [...local];
        for (const r of remote) {
          if (!localIds.has(r.id)) merged.push(r);
        }
        const sorted = sortSessions(merged);
        saveLocal(sorted);
        return sorted;
      });
    } catch {}
  }

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
    saveActiveId(id);
  }, []);

  const createSession = useCallback((firstQuestion: string, scope: string): AskSession => {
    const now = new Date().toISOString();
    const session: AskSession = {
      id: uuid(),
      title: firstQuestion.slice(0, 60) + (firstQuestion.length > 60 ? "…" : ""),
      messages: [],
      scope,
      created_at: now,
      updated_at: now,
    };
    setSessions((prev) => {
      const next = sortSessions([session, ...prev]);
      saveLocal(next);
      return next;
    });
    setActiveSessionId(session.id);
    fetch("/api/ask/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, title: session.title, scope }),
    }).catch(() => {});
    return session;
  }, [setActiveSessionId]);

  const addMessage = useCallback((sessionId: string, msg: MessageRecord) => {
    setSessions((prev) => {
      const next = sortSessions(prev.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: [...s.messages, msg], updated_at: new Date().toISOString() };
      }));
      saveLocal(next);
      const updated = next.find((s) => s.id === sessionId);
      if (updated && !syncInFlight.current) {
        syncInFlight.current = true;
        fetch(`/api/ask/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: updated.messages }),
        })
          .catch(() => {})
          .finally(() => { syncInFlight.current = false; });
      }
      return next;
    });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      saveLocal(next);
      return next;
    });
    setActiveSessionIdState((prev) => {
      const next = prev === sessionId ? null : prev;
      saveActiveId(next);
      return next;
    });
    fetch(`/api/ask/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const renameSession = useCallback((sessionId: string, newTitle: string) => {
    const title = newTitle.trim();
    if (!title) return;
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === sessionId ? { ...s, title } : s));
      saveLocal(next);
      return next;
    });
  }, []);

  const togglePin = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = sortSessions(
        prev.map((s) => (s.id === sessionId ? { ...s, pinned: !s.pinned } : s))
      );
      saveLocal(next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId ? { ...s, favorite: !s.favorite } : s
      );
      saveLocal(next);
      return next;
    });
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    createSession,
    addMessage,
    deleteSession,
    renameSession,
    togglePin,
    toggleFavorite,
  };
}
