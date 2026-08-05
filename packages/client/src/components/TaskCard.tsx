import type { CSSProperties } from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import type { Message } from "../types";
import type { TaskStatus } from "@cove/shared";
import { useTaskStore } from "../stores/useTaskStore";
import { useMemberStore } from "../stores/useMemberStore";
import { useActiveIds } from "../hooks/useActiveIds";
import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import * as api from "../lib/api";
import { STATUS_ICON_COMPONENTS, STATUS_COLORS, STATUS_LABELS, TASK_STATUSES } from "../lib/taskStatusConfig";
import { TaskBadge } from "./TaskBadge";

export { STATUS_ICON_COMPONENTS };

interface TaskSnapshot {
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  seq: number;
  thread_id?: string;
}

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
          {TASK_STATUSES.map((s) => (
            <div
              key={s}
              onClick={() => {
                setOpen(false);
                api.updateTask(taskId, { status: s }).catch((err) => {
                  console.error("Failed to update task status:", err);
                });
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
  const { guildId } = useActiveIds();
  const membersByGuildId = useMemberStore((s) => s.membersByGuildId);

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
    <div style={{ display: "inline-block", marginTop: "4px" }}>
      <TaskBadge taskId={taskId} status={status} seq={seq} assigneeName={assigneeName} />
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

export function taskAssignmentSummary(content: string): string {
  const title = content.match(/Title:\s*(.+)/)?.[1]?.trim() || "Task";
  const assignee = content.match(/Assigned to:\s*(.+)/)?.[1]?.trim();
  return assignee ? `${title} — assigned to ${assignee}` : `${title} — assigned`;
}

export function TaskAssignmentMessage({ message }: { message: Message }) {
  return (
    <div style={{
      textAlign: "center",
      padding: "6px 0",
      fontSize: "var(--font-size-sm)",
      color: "var(--text-muted)",
      fontStyle: "italic",
    }}>
      {taskAssignmentSummary(message.content)}
    </div>
  );
}

export function TaskHeartbeatMessage({ message, collapsedCount }: { message: Message; collapsedCount?: number }) {
  return (
    <div style={{
      padding: "2px 0",
      fontSize: "12px",
      color: "var(--text-muted)",
      textAlign: "center",
    }}>
      Heartbeat: status update requested · {new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{collapsedCount && collapsedCount > 0 ? ` (${collapsedCount} previous)` : ""}
    </div>
  );
}
