import type { AgentRunUsage } from "@cove/shared";
import { usageLabel } from "./AgentRunTimeline";

interface UsageChipProps {
  usage: AgentRunUsage | null | undefined;
  /** Optional tooltip override; defaults to a calls-aware summary. */
  title?: string | null;
  /** True when this chip represents a whole channel (chat + all threads). */
  scope?: "channel" | "thread" | "task";
  /** When set, the chip becomes clickable (e.g. opens the efficiency card). */
  onClick?: () => void;
}

const SCOPE_TITLE: Record<NonNullable<UsageChipProps["scope"]>, string> = {
  channel: "Aggregate usage for this channel (chat + all threads)",
  thread: "Aggregate usage for this thread",
  task: "Aggregate usage for this task",
};

/**
 * Compact usage pill (tokens · cost) used in channel/thread headers and the
 * task table. Sized and styled to sit next to TaskBadge without looking
 * mismatched: same padding, radius and font-size, muted colors.
 * Pass `onClick` to make it interactive (opens the efficiency card).
 */
export function UsageChip({ usage, title, scope, onClick }: UsageChipProps) {
  const label = usageLabel(usage);
  if (!label) return null;
  const calls = usage?.calls ?? 0;
  const tooltip = title ?? (scope ? SCOPE_TITLE[scope] : `Aggregate usage (${calls} call${calls === 1 ? "" : "s"})`);
  return (
    <span
      title={tooltip}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "6px",
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-tertiary, rgba(255,255,255,0.04))",
        color: "var(--text-muted)",
        fontSize: "var(--font-size-sm)",
        fontWeight: 500,
        whiteSpace: "nowrap",
        flexShrink: 0,
        userSelect: "none",
        lineHeight: 1.2,
        cursor: onClick ? "pointer" : undefined,
        ...(onClick ? { transition: "border-color 0.15s, color 0.15s" } : {}),
      }}
      onMouseEnter={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--accent, #5865f2)"; e.currentTarget.style.color = "var(--header-primary)"; } : undefined}
      onMouseLeave={onClick ? (e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.color = "var(--text-muted)"; } : undefined}
    >{label}</span>
  );
}
