import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import type { Task, TaskStatus } from "@cove/shared";
import { useActiveIds } from "../hooks/useActiveIds";
import { useTaskStore } from "../stores/useTaskStore";
import { routes } from "../lib/routes";

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

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panelStyle: CSSProperties = {
  width: 480,
  maxHeight: "70vh",
  background: "var(--bg-floating, var(--bg-secondary))",
  borderRadius: "var(--space-sm)",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "var(--space-md)",
  borderBottom: "1px solid var(--border-subtle)",
  gap: "var(--space-sm)",
};

const closeBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: "var(--font-size-xl)",
  cursor: "pointer",
  padding: "var(--space-xs)",
  lineHeight: 1,
};

const newBtnStyle: CSSProperties = {
  background: "var(--accent, #5865f2)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--space-xs)",
  padding: "var(--space-xs) var(--space-md)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 600,
  cursor: "pointer",
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "var(--space-sm)",
};

const taskItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-md)",
  borderRadius: "var(--space-xs)",
  cursor: "pointer",
  transition: "background 0.15s",
  fontSize: "var(--font-size-md)",
  color: "var(--text-normal)",
};

interface Props {
  channelId: string;
  onClose: () => void;
  onNewTask: () => void;
}

export function TaskPanel({ channelId, onClose, onNewTask }: Props) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { guildId } = useActiveIds();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const tasks = useTaskStore((s) => s.getTasksForChannel(channelId));

  useEffect(() => {
    setLoading(true);
    fetchTasks(channelId).finally(() => setLoading(false));
  }, [channelId, fetchTasks]);

  function handleClick(task: Task) {
    if (guildId) navigate(routes.thread(guildId, channelId, task.thread_id));
    onClose();
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--header-primary)", flex: 1 }}>
            Tasks
          </span>
          <button style={newBtnStyle} onClick={onNewTask}>+ New Task</button>
          <button style={closeBtnStyle} onClick={onClose}>✕</button>
        </div>
        <div style={listStyle} className="scroll-container">
          {loading && (
            <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>Loading...</div>
          )}
          {!loading && tasks.length === 0 && (
            <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--text-muted)" }}>
              No tasks yet
            </div>
          )}
          {tasks.map((t) => (
            <div
              key={t.task_id}
              style={taskItemStyle}
              onClick={() => handleClick(t)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-modifier-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: STATUS_COLORS[t.status],
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.title}
              </span>
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontWeight: 600,
                  color: "#fff",
                  background: STATUS_COLORS[t.status],
                }}
              >
                {STATUS_LABELS[t.status]}
              </span>
              <span style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>#{t.seq}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
