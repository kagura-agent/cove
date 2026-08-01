import type { CSSProperties } from "react";
import { useState, useRef, useEffect } from "react";
import type { Message } from "../types";
import type { TaskStatus } from "@cove/shared";
import { useTaskStore } from "../stores/useTaskStore";
import * as api from "../lib/api";

interface TaskSnapshot {
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  seq: number;
}

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

export function TaskCard({ message }: { message: Message }) {
  let snapshot: TaskSnapshot;
  try {
    snapshot = JSON.parse(message.content);
  } catch {
    return <div style={{ color: "var(--text-muted)" }}>Invalid task card</div>;
  }

  const liveTask = useTaskStore((s) => {
    for (const t of Object.values(s.byTaskId)) {
      if (t.message_id === message.id) return t;
    }
    return null;
  });

  const title = liveTask?.title ?? snapshot.title;
  const status = liveTask?.status ?? snapshot.status;
  const seq = liveTask?.seq ?? snapshot.seq;
  const taskId = liveTask?.task_id ?? null;

  const cardStyle: CSSProperties = {
    background: "var(--bg-secondary)",
    border: "1px solid var(--bg-modifier-hover)",
    borderLeft: `3px solid ${STATUS_COLORS[status]}`,
    borderRadius: 8,
    padding: "10px 14px",
    maxWidth: 480,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--header-primary)" }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--font-size-sm)", color: "var(--text-muted)" }}>
        <TaskStatusPill status={status} taskId={taskId} />
        <span>#{seq}</span>
      </div>
    </div>
  );
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
