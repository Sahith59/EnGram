"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Star,
  StarOff,
  Trash2,
  SquarePen,
} from "lucide-react";
import { AskSession } from "@/hooks/useAskSessions";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface SessionRowProps {
  session: AskSession;
  isActive: boolean;
  isMenuOpen: boolean;
  onSelect: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}

function SessionRow({
  session,
  isActive,
  isMenuOpen,
  onSelect,
  onOpenMenu,
  onCloseMenu,
  onRename,
  onPin,
  onFavorite,
  onDelete,
}: SessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming) {
      setRenameVal(session.title);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [renaming, session.title]);

  function commitRename() {
    onRename(renameVal.trim() || session.title);
    setRenaming(false);
  }

  function handleRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setRenaming(false);
  }

  return (
    <div className="group relative">
      {renaming ? (
        <div className="px-2 py-1">
          <input
            ref={inputRef}
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            className="w-full bg-white/8 border border-purple-500/50 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none"
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
            isActive
              ? "bg-white/8 text-white border-l-2 border-l-purple-500 pl-[10px]"
              : "text-zinc-400 hover:text-white hover:bg-white/5 border-l-2 border-l-transparent pl-[10px]"
          }`}
        >
          <MessageSquare
            className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-purple-400" : "text-zinc-600 group-hover:text-zinc-400"}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              {session.pinned && <Pin className="w-2.5 h-2.5 text-blue-400 shrink-0" />}
              {session.favorite && <Star className="w-2.5 h-2.5 text-amber-400 shrink-0 fill-amber-400" />}
              <span className="text-[12.5px] font-medium truncate leading-snug">
                {session.title}
              </span>
            </div>
            <span className="text-[10px] text-zinc-600 group-hover:text-zinc-500">
              {relativeTime(session.updated_at)}
              {session.messages.length > 0 && (
                <> · {session.messages.length} msg{session.messages.length !== 1 ? "s" : ""}</>
              )}
            </span>
          </div>
        </button>
      )}

      {/* Three-dot menu button */}
      {!renaming && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            isMenuOpen ? onCloseMenu() : onOpenMenu();
          }}
          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-all ${
            isMenuOpen
              ? "opacity-100 bg-white/10 text-white"
              : "opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white hover:bg-white/10"
          }`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Floating context menu */}
      {isMenuOpen && !renaming && (
        <div
          ref={menuRef}
          className="absolute right-2 top-full mt-1 z-50 w-44 bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<Pencil className="w-3.5 h-3.5" />}
            label="Rename"
            onClick={() => { setRenaming(true); onCloseMenu(); }}
          />
          <MenuItem
            icon={session.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            label={session.pinned ? "Unpin" : "Pin to top"}
            onClick={() => { onPin(); onCloseMenu(); }}
          />
          <MenuItem
            icon={session.favorite
              ? <StarOff className="w-3.5 h-3.5" />
              : <Star className="w-3.5 h-3.5" />}
            label={session.favorite ? "Remove favourite" : "Mark as favourite"}
            onClick={() => { onFavorite(); onCloseMenu(); }}
          />
          <div className="border-t border-white/8 mt-1 pt-1">
            <MenuItem
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label="Delete"
              onClick={() => { onDelete(); onCloseMenu(); }}
              danger
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors ${
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-zinc-300 hover:text-white hover:bg-white/8"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface Props {
  sessions: AskSession[];
  activeSessionId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onFavorite: (id: string) => void;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  collapsed,
  onToggle,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onPin,
  onFavorite,
}: Props) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenuId) return;
    function handleClick(e: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuId]);

  const pinnedSessions = sessions.filter((s) => s.pinned);
  const unpinnedSessions = sessions.filter((s) => !s.pinned);

  return (
    <div
      ref={sidebarRef}
      className="relative flex flex-col shrink-0 bg-[#111111] border-r border-white/[0.07] transition-all duration-200"
      style={{ width: collapsed ? 52 : 256 }}
    >
      {/* Header */}
      <div
        className={`flex items-center border-b border-white/[0.07] ${
          collapsed ? "justify-center py-3.5 px-2" : "justify-between px-3 py-3"
        }`}
      >
        {!collapsed && (
          <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-zinc-500 select-none">
            Chats
          </span>
        )}
        <div className={`flex items-center ${collapsed ? "flex-col gap-2" : "gap-1"}`}>
          {!collapsed && (
            <button
              onClick={onNew}
              title="New chat"
              className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
            >
              <SquarePen className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onToggle}
            title={collapsed ? "Expand" : "Collapse"}
            className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* New Chat (collapsed state: icon only) */}
      {collapsed && (
        <div className="px-2 py-2">
          <button
            onClick={onNew}
            title="New chat"
            className="flex items-center justify-center w-full p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
          >
            <SquarePen className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Expanded: New Chat button */}
      {!collapsed && (
        <div className="px-2 pt-2 pb-1">
          <button
            onClick={onNew}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-white hover:bg-white/6 transition-colors border border-white/[0.06] hover:border-white/10"
          >
            <SquarePen className="w-3.5 h-3.5" />
            <span className="text-[12.5px]">New chat</span>
          </button>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 mt-1">
        {!collapsed && sessions.length === 0 && (
          <p className="text-[11px] text-zinc-700 text-center py-8 leading-relaxed px-3">
            No conversations yet.
            <br />
            Start one above.
          </p>
        )}

        {/* Pinned section */}
        {!collapsed && pinnedSessions.length > 0 && (
          <>
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600 px-3 pt-2 pb-1 select-none">
              Pinned
            </p>
            {pinnedSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isMenuOpen={openMenuId === session.id}
                onSelect={() => onSelect(session.id)}
                onOpenMenu={() => setOpenMenuId(session.id)}
                onCloseMenu={() => setOpenMenuId(null)}
                onRename={(t) => onRename(session.id, t)}
                onPin={() => onPin(session.id)}
                onFavorite={() => onFavorite(session.id)}
                onDelete={() => onDelete(session.id)}
              />
            ))}
            {unpinnedSessions.length > 0 && (
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-zinc-600 px-3 pt-3 pb-1 select-none">
                Recent
              </p>
            )}
          </>
        )}

        {/* Unpinned / all sessions */}
        {collapsed
          ? sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelect(session.id)}
                title={session.title}
                className={`flex items-center justify-center w-full py-2 rounded-lg transition-colors ${
                  session.id === activeSessionId
                    ? "bg-white/8 text-purple-400"
                    : "text-zinc-600 hover:text-zinc-300 hover:bg-white/5"
                }`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            ))
          : unpinnedSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isMenuOpen={openMenuId === session.id}
                onSelect={() => onSelect(session.id)}
                onOpenMenu={() => setOpenMenuId(session.id)}
                onCloseMenu={() => setOpenMenuId(null)}
                onRename={(t) => onRename(session.id, t)}
                onPin={() => onPin(session.id)}
                onFavorite={() => onFavorite(session.id)}
                onDelete={() => onDelete(session.id)}
              />
            ))}
      </div>
    </div>
  );
}
