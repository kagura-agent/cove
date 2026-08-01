import type { CSSProperties } from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import type { Message } from "../types";
import type { TaskStatus } from "@cove/shared";
import { useTaskStore } from "../stores/useTaskStore";
import { useMemberStore } from "../stores/useMemberStore";
import { useActiveIds } from "../hooks/useActiveIds";
import * as api from "../lib/api";

interface TaskSnapshot {
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  seq: number;
  thread_id?: string;
}

const STATUS_ICONS: Record<TaskStatus, string> = {
  open: "📋",
  in_progress: "🔧",
  in_review: "👀",
  done: "✅",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "var(--text-muted)",
  in_progress: "#5865f2",
  in_review: "#e67e22",
  done: "#3ba55c",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const ALL_STATUSES: TaskStatus[] = ["open", "in_progress", "in_review", "done"];

function TaskStatusPill({ status, taskId }: { status: TaskStatus; taskId: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pillStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "var(--font-size-xs)",
    fontWeight: 600,
    color: "#fff",
    background: STATUS_COLORS[status],
    cursor: taskId ? "pointer" : "default",
    position: "relative",
    userSelect: "none",
  };

  return (
    <div ref={ref} style={{ display: "inline-block", position: "relative" }}>
      <span style={pillStyle} onClick={() => taskId && setOpen(!open)}>
        {STATUS_LABELS[status]}
      </span>
      {open && taskId && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: 4,
          background: "var(--bg-secondary)",
          border: "1px solid var(--bg-modifier-hover)",
          borderRadius: 6,
          padding: 4,
          zIndex: 100,
          minWidth: 120,
        }}>
          {ALL_STATUSES.map((s) => (
            <div
              key={s}
              onClick={() => {
                setOpen(false);
                api.updateTask(taskId, { status: s });
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: "var(--font-size-sm)",
                color: s === status ? "#fff" : "var(--text-normal)",
                background: s === status ? STATUS_COLORS[s] : "transparent",
              }}
              onMouseEnter={(e) => {
                if (s !== status) (e.currentTarget.style.background = "var(--bg-modifier-hover)");
              }}
              onMouseLeave={(e) => {
                if (s !== status) (e.currentTarget.style.background = "transparent");
              }}
            >
              {STATUS_LABELS[s]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskStatusBar({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  let snapshot: TaskSnapshot;
  try {
    snapshot = JSON.parse(message.content);
  } catch {
    return null;
  }

  const liveTask = useTaskStore((s) => {
    for (const t of Object.values(s.byTaskId)) {
      if (t.message_id === message.id) return t;
    }
    return null;
  });

  const status = liveTask?.status ?? snapshot.status;
  const seq = liveTask?.seq ?? snapshot.seq;
  const assigneeId = liveTask?.assignee_id ?? snapshot.assignee_id;
  const taskId = liveTask?.task_id ?? null;

  const assigneeName = useMemo(() => {
    if (!assigneeId || !guildId) return null;
    const members = membersByGuildId[guildId];
    if (!members) return null;
    const member = members[assigneeId];
    if (!member) return null;
    return member.nick || member.user.global_name || member.user.username;
  }, [assigneeId, guildId, membersByGuildId]);

  return (
    <div ref={ref} style={{ display: "inline-block", position: "relative", marginTop: "4px" }}>
      <button
        onClick={() => taskId && setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 10px",
          borderRadius: "6px",
          border: "1px solid var(--bg-modifier-hover)",
          background: "var(--bg-secondary)",
          color: "var(--text-normal)",
          fontSize: "var(--font-size-sm)",
          cursor: taskId ? "pointer" : "default",
          userSelect: "none",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-modifier-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-secondary)")}
      >
        <span>{STATUS_ICONS[status]}</span>
        <span style={{ color: "var(--text-muted)" }}>#{seq}</span>
        {assigneeName && <span>@{assigneeName}</span>}
      </button>
      {open && taskId && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: 0,
          marginBottom: 4,
          background: "var(--bg-secondary)",
          border: "1px solid var(--bg-modifier-hover)",
          borderRadius: 6,
          padding: 4,
          zIndex: 100,
          minWidth: 140,
        }}>
          {ALL_STATUSES.map((s) => (
            <div
              key={s}
              onClick={() => {
                setOpen(false);
                api.updateTask(taskId, { status: s });
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: "var(--font-size-sm)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                color: s === status ? "#fff" : "var(--text-normal)",
                background: s === status ? STATUS_COLORS[s] : "transparent",
              }}
              onMouseEnter={(e) => {
                if (s !== status) (e.currentTarget.style.background = "var(--bg-modifier-hover)");
              }}
              onMouseLeave={(e) => {
                if (s !== status) (e.currentTarget.style.background = "transparent");
              }}
            >
              <span>{STATUS_ICONS[s]}</span>
              <span>{STATUS_LABELS[s]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function parseTaskTitle(content: string): string {
  try {
    const data = JSON.parse(content);
    return data.title ?? content;
  } catch {
    return content;
  }
}

export function TaskAssignmentMessage({ message }: { message: Message }) {
  return (
    <div style={{
      textAlign: "center",
      padding: "4px 0",
      fontSize: "var(--font-size-sm)",
      color: "var(--text-muted)",
    }}>
      {message.content}
    </div>
  );
}

export function TaskHeartbeatMessage({ message }: { message: Message }) {
  return (
    <div style={{
      padding: "2px 0",
      fontSize: "var(--font-size-xs)",
      color: "var(--text-muted)",
      opacity: 0.6,
    }}>
      {message.content}
    </div>
  );
}
