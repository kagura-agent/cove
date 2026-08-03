import { Dropdown } from "antd";
import type { MenuProps } from "antd";
import type { TaskStatus } from "@cove/shared";
import * as api from "../lib/api";
import { STATUS_COLORS, STATUS_LABELS, STATUS_ICON_COMPONENTS, TASK_STATUSES } from "../lib/taskStatusConfig";

interface TaskBadgeProps {
  taskId: string | null;
  status: TaskStatus;
  seq: number;
  assigneeName?: string | null;
  /** Called when #seq is clicked. If omitted, #seq is not clickable. */
  onSeqClick?: () => void;
}

/**
 * Shared task status badge with dropdown to change status.
 * Used in both message TaskStatusBar and thread header.
 */
export function TaskBadge({ taskId, status, seq, assigneeName, onSeqClick }: TaskBadgeProps) {
  const statusMenuItems: MenuProps["items"] = TASK_STATUSES.map((s) => ({
    key: s,
    label: (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {STATUS_ICON_COMPONENTS[s]} {STATUS_LABELS[s]}
      </span>
    ),
    style: s === status ? { background: STATUS_COLORS[s], color: "#fff", borderRadius: 4 } : undefined,
    onClick: () => {
      if (taskId) api.updateTask(taskId, { status: s }).catch(console.error);
    },
  }));

  return (
    <Dropdown menu={{ items: statusMenuItems }} trigger={["click"]} disabled={!taskId} placement="bottomLeft">
      <button
        aria-label={`Task #${seq} status: ${STATUS_LABELS[status]}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 10px",
          borderRadius: "6px",
          border: "none",
          background: STATUS_COLORS[status],
          color: "#fff",
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          cursor: taskId ? "pointer" : "default",
          userSelect: "none",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
      >
        <span style={{ display: "flex", alignItems: "center" }}>{STATUS_ICON_COMPONENTS[status]}</span>
        <span
          onClick={onSeqClick ? (e) => { e.stopPropagation(); onSeqClick(); } : undefined}
          style={{ cursor: onSeqClick ? "pointer" : "inherit", textDecoration: onSeqClick ? "underline" : "none" }}
        >#{seq}</span>
        {assigneeName && <span>@{assigneeName}</span>}
      </button>
    </Dropdown>
  );
}
