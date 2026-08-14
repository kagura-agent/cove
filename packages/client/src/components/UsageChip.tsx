import type { AgentRunUsage } from "@cove/shared";
import { usageLabel } from "./AgentRunTimeline";

interface UsageChipProps {
  usage: AgentRunUsage | null | undefined;
  /** Optional tooltip override; defaults to a calls-aware summary. */
  title?: string | null;
  /** True when this chip represents a whole channel (chat + all threads). */
  scope?: "channel" | "thread" | "task";
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
 */
export function UsageChip({ usage, title, scope }: UsageChipProps) {
  const label = usageLabel(usage);
  if (!label) return null;
  const calls = usage?.calls ?? 0;
  const tooltip = title ?? (scope ? SCOPE_TITLE[scope] : `Aggregate usage (${calls} call${calls === 1 ? "" : "s"})`);
  return (
    <span
      title={tooltip}
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
      }}
    >{label}</span>
  );
}
