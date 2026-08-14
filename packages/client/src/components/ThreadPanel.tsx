import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useThreadStore } from "../stores/useThreadStore";
import { useMessageStore } from "../stores/useMessageStore";
import { useTaskStore } from "../stores/useTaskStore";
import { useMemberStore } from "../stores/useMemberStore";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ReplyBar } from "./ReplyBar";
import { MessageItem } from "./MessageItem";
import { TaskBadge } from "./TaskBadge";
import * as api from "../lib/api";
import type { Message, Channel } from "../types";
import { ThreadIcon } from "./ThreadIcon";
import { AgentRunCard } from "./AgentRunCard";
import { UsageChip } from "./UsageChip";
import { dispatcher } from "../lib/gateway-dispatcher";
import type { AgentRunUsage } from "@cove/shared";

interface ThreadPanelProps {
  threadId: string;
  onClose: () => void;
}

export function ThreadPanel({ threadId, onClose }: ThreadPanelProps) {
  const [thread, setThread] = useState<Channel | null>(null);
  const [parentMessage, setParentMessage] = useState<Message | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [usage, setUsage] = useState<AgentRunUsage | null | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const threadFetchRef = useRef<string | null>(null);
  const navigate = useNavigate();

  const byTaskId = useTaskStore((s) => s.byTaskId);
  const task = useMemo(
    () => Object.values(byTaskId).find((t) => t.thread_id === threadId) ?? null,
    [byTaskId, threadId],
  );

  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);
  const assigneeName = useMemo(() => {
    if (!task?.assignee_id || !thread?.guild_id) return null;
    const members = membersByGuildId[thread.guild_id];
    if (!members) return null;
    const member = members[task.assignee_id];
    if (!member) return null;
    return member.nick || member.user.global_name || member.user.username;
  }, [task?.assignee_id, thread?.guild_id, membersByGuildId]);

  // Ensure tasks are loaded for the parent channel so we can find the associated task
  useEffect(() => {
    if (!thread?.parent_id) return;
    // Only fetch if we don't already have a task for this thread
    const alreadyHave = Object.values(useTaskStore.getState().byTaskId).some((t) => t.thread_id === threadId);
    if (!alreadyHave) {
      useTaskStore.getState().fetchTasks(thread.parent_id);
    }
  }, [thread?.parent_id, threadId]);

  // Find thread in store or fetch it
  useEffect(() => {
    if (!threadId) return;
    // Read store imperatively to avoid reactive subscription triggering re-renders
    const threads = useThreadStore.getState().threads;
    let found: Channel | null = null;
    for (const channelThreads of Object.values(threads)) {
      const t = channelThreads.find((t) => t.id === threadId);
      if (t) { found = t; break; }
    }
    if (found) {
      setThread(found);
    } else {
      // Deep link: thread not in store yet, fetch it
      if (threadFetchRef.current === threadId) return;
      threadFetchRef.current = threadId;
      useThreadStore.getState().fetchThread(threadId).then((t) => {
        if (t) {
          useThreadStore.getState().addThread(t);
          setThread(t);
        }
      }).catch(() => setThread(null));
    }
  }, [threadId]);

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
        setConfirmDelete(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowMenu(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!thread?.message_id || !thread?.parent_id) {
      setParentMessage(null);
      return;
    }

    const parentId = thread.parent_id;
    const messageId = thread.message_id;

    // Try message store first
    const storeMessages = useMessageStore.getState().messages[parentId] ?? [];
    const found = storeMessages.find((m) => m.id === messageId);
    if (found) {
      setParentMessage(found);
      return;
    }

    // Fetch from API
    api
      .fetchMessage(parentId, messageId)
      .then((msg) => setParentMessage(msg))
      .catch(() => setParentMessage(null));
  }, [thread?.id, thread?.message_id, thread?.parent_id]);

  // Aggregated thread usage: spans all sessions/runs in this thread. Refresh
  // when the thread changes; live-refresh on usage events for this thread.
  useEffect(() => {
    const parentId = thread?.parent_id;
    const threadIdVal = thread?.id;
    if (!parentId || !threadIdVal) return;
    let alive = true;
    const refresh = () => {
      api.fetchThreadUsage(parentId, threadIdVal).then((u) => { if (alive) setUsage(u); }).catch(() => { if (alive) setUsage(null); });
    };
    refresh();
    const onUsage = (run: { channel_id: string; thread_id: string | null }) => {
      if (run.thread_id === threadIdVal) refresh();
    };
    dispatcher.on("AGENT_USAGE_UPDATED", onUsage);
    return () => { alive = false; dispatcher.off("AGENT_USAGE_UPDATED", onUsage); };
  }, [thread?.id, thread?.parent_id]);

  if (!thread) return null;

  async function handleArchive() {
    try {
      await api.updateChannel(thread!.id, { archived: true });
      useThreadStore.getState().removeThread(thread!.id);
    } catch (err) {
      console.error("archive thread:", err);
    }
    setShowMenu(false);
    onClose();
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteChannel(thread!.id);
      useThreadStore.getState().removeThread(thread!.id);
    } catch (err) {
      console.error("delete thread:", err);
    }
    setShowMenu(false);
    onClose();
  }

  const displayName = thread.name.length > 40
    ? thread.name.slice(0, 40) + "\u2026"
    : thread.name;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "0 var(--space-md)",
        height: "var(--header-height)",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
        background: "var(--bg-secondary)",
      }}>
        <ThreadIcon size={18} style={{ color: "var(--text-muted)" }} />
        <span style={{
          flex: 1,
          fontWeight: 600,
          fontSize: "var(--font-size-lg)",
          color: "var(--header-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>{displayName}</span>
        {task && (
          <TaskBadge
            taskId={task.task_id}
            status={task.status}
            seq={task.seq}
            assigneeName={assigneeName}
            onSeqClick={() => {
              const guildId = thread?.guild_id;
              if (guildId) {
                navigate(`/channels/${guildId}/${task.channel_id}/threads/${threadId}?tab=tasks`);
              }
            }}
          />
        )}
        {usage && <UsageChip usage={usage} scope="thread" />}
        <div style={{ position: "relative" }}>
          <button
            ref={menuBtnRef}
            onClick={() => { setShowMenu((v) => !v); setConfirmDelete(false); }}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "var(--font-size-xl)",
              cursor: "pointer",
              padding: "var(--space-xs)",
              lineHeight: 1,
            }}
          >&#x22EF;</button>
          {showMenu && (
            <div ref={menuRef} style={{
              position: "absolute",
              top: "100%",
              right: 0,
              zIndex: 1000,
              background: "var(--bg-floating)",
              borderRadius: "var(--space-xs)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              padding: "var(--space-xs) 0",
              minWidth: 180,
            }}>
              <div
                onClick={handleArchive}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                  color: "var(--text-normal)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-modifier-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >Archive Thread</div>
              <div style={{ height: 1, margin: "var(--space-xs) 0", background: "var(--border-subtle)" }} />
              <div
                onClick={handleDelete}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "var(--space-xs) var(--space-md)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                  color: "var(--status-danger, #ed4245)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--status-danger, #ed4245) 15%, transparent)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >{confirmDelete ? "Confirm Delete" : "Delete Thread"}</div>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "var(--font-size-xl)",
            cursor: "pointer",
            padding: "var(--space-xs)",
            lineHeight: 1,
          }}
        >&#10005;</button>
      </div>

      {/* Message area: parent message + thread messages in one scroll flow */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", background: "var(--bg-primary)" }}>
        <MessageList channelId={thread.id} parentMessage={parentMessage} />
      </div>

      {/* Reuse the exact same input as main chat */}
      <div style={{ flexShrink: 0, background: "var(--bg-secondary)" }}>
        <ReplyBar channelId={thread.id} />
        {thread.guild_id && <AgentRunCard channelId={thread.parent_id ?? thread.id} threadId={thread.id} guildId={thread.guild_id} />}
        <MessageInput channelId={thread.id} />
      </div>
    </div>
  );
}
