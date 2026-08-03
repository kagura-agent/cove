import { TASK_STATUSES, type TaskStatus } from "@cove/shared";
import { FileTextOutlined, SyncOutlined, EyeOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";

export { TASK_STATUSES };

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "var(--text-muted)",
  in_progress: "#5865f2",
  in_review: "#e67e22",
  done: "#3ba55c",
  cancelled: "var(--text-muted)",
};

export const STATUS_ICON_COMPONENTS: Record<TaskStatus, React.ReactNode> = {
  open: <FileTextOutlined style={{ color: STATUS_COLORS.open }} />,
  in_progress: <SyncOutlined spin style={{ color: STATUS_COLORS.in_progress }} />,
  in_review: <EyeOutlined style={{ color: STATUS_COLORS.in_review }} />,
  done: <CheckCircleOutlined style={{ color: STATUS_COLORS.done }} />,
  cancelled: <CloseCircleOutlined style={{ color: STATUS_COLORS.cancelled }} />,
};

export const STATUS_TITLE_STYLE: Record<TaskStatus, React.CSSProperties | undefined> = {
  open: undefined,
  in_progress: undefined,
  in_review: undefined,
  done: undefined,
  cancelled: { textDecoration: 'line-through', color: 'var(--text-muted)' },
};

export function getStatusSelectOptions() {
  return TASK_STATUSES.map((s: TaskStatus) => ({
    label: (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {STATUS_ICON_COMPONENTS[s]} {STATUS_LABELS[s]}
      </span>
    ),
    value: s,
  }));
}

export function getStatusFilterOptions() {
  return TASK_STATUSES.map((s: TaskStatus) => ({ text: STATUS_LABELS[s], value: s }));
}

export function getStatusLabelOptions() {
  return TASK_STATUSES.map((s: TaskStatus) => ({ label: STATUS_LABELS[s], value: s }));
}
