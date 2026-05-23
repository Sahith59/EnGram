"use client";

import { AskSession } from "@/hooks/useAskSessions";
import { PlusIcon, ChevronLeftIcon, ChevronRightIcon, TrashIcon, MessageSquareIcon } from "lucide-react";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  sessions: AskSession[];
  activeSessionId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  collapsed,
  onToggle,
  onSelect,
  onNew,
  onDelete,
}: Props) {
  return (
    <div
      className="relative flex flex-col shrink-0 border-r border-white/10 bg-[#111111] transition-all duration-200"
      style={{ width: collapsed ? 52 : 260 }}
    >
      <div className="flex items-center gap-2 px-2 py-3 border-b border-white/10">
        {!collapsed && (
          <span className="flex-1 text-xs font-semibold text-zinc-400 tracking-widest uppercase pl-2">
            Chats
          </span>
        )}
        <button
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
        >
          {collapsed ? (
            <ChevronRightIcon className="w-4 h-4" />
          ) : (
            <ChevronLeftIcon className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="px-2 py-2">
        <button
          onClick={onNew}
          className="flex items-center gap-2 w-full px-2 py-2 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-white/10 transition-colors border border-white/10 hover:border-purple-500/40"
          title="New chat"
        >
          <PlusIcon className="w-4 h-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4">
        {sessions.length === 0 && !collapsed && (
          <p className="text-xs text-zinc-600 px-2 py-4 text-center leading-relaxed">
            No chats yet.
            <br />
            Ask something to begin.
          </p>
        )}
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div key={session.id} className="group relative">
              <button
                onClick={() => onSelect(session.id)}
                title={session.title}
                className={`flex items-center gap-2 w-full px-2 py-2 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-purple-600/20 text-white border border-purple-500/30"
                    : "text-zinc-400 hover:text-white hover:bg-white/8 border border-transparent"
                }`}
              >
                <MessageSquareIcon
                  className={`w-4 h-4 shrink-0 ${isActive ? "text-purple-400" : "text-zinc-600"}`}
                />
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate leading-snug">{session.title}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {relativeTime(session.updated_at)} · {session.messages.length} msg
                      {session.messages.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                )}
              </button>
              {!collapsed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  title="Delete chat"
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
