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
}

const STORAGE_KEY = "engram_ask_sessions_v1";
const ACTIVE_KEY = "engram_ask_active_session_v1";

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

export function useAskSessions() {
  const [sessions, setSessions] = useState<AskSession[]>([]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const syncInFlight = useRef(false);

  useEffect(() => {
    const local = loadLocal();
    setSessions(local);
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
        merged.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        saveLocal(merged);
        return merged;
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
      const next = [session, ...prev];
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
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        const updated: AskSession = {
          ...s,
          messages: [...s.messages, msg],
          updated_at: new Date().toISOString(),
        };
        return updated;
      });
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
    // Use the raw state setter with functional form so we get the latest value
    setActiveSessionIdState((prev) => {
      const next = prev === sessionId ? null : prev;
      saveActiveId(next);
      return next;
    });
    fetch(`/api/ask/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
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
  };
}
