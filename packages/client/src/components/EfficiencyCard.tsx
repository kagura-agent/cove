import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { TaskEfficiencyReport, TaskRunStat } from "@cove/shared";
import { formatDuration, formatTokens, formatUsd } from "./AgentRunTimeline";
import { RunStatsChart } from "./RunStatsChart";
import * as api from "../lib/api";

interface EfficiencyCardProps {
  report: TaskEfficiencyReport | null | undefined;
  /** Task whose per-run chart should be loaded (when provided and report has data). */
  taskId?: string | null;
  /** When set, the whole card is rendered inline (no popover). */
  inline?: boolean;
  onClose?: () => void;
}

const MUTED = "var(--text-muted)";
const GOOD = "#23a55a";
const BAD = "var(--status-danger, #ed4245)";

function deltaColor(delta: number | null): string | null {
  if (delta === null || delta === 0) return null;
  return delta > 0 ? BAD : GOOD;
}

function Delta({ delta, format }: { delta: number | null; format: (v: number) => string }) {
  if (delta === null) return <span style={{ color: MUTED }}>— vs median</span>;
  const color = deltaColor(delta);
  const sign = delta > 0 ? "+" : "";
  return (
    <span style={{ color: color ?? MUTED, fontWeight: 600 }}>
      {sign}{format(delta)} vs median
    </span>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "3px 0", fontSize: "var(--font-size-sm)" }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: "var(--text-normal)", fontWeight: 500, whiteSpace: "nowrap" }}>{value}</span>
      {sub && <span style={{ fontSize: "var(--font-size-xs)", color: MUTED, whiteSpace: "nowrap" }}>{sub}</span>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: MUTED, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function cachePct(usage: { cache_read_tokens: number; cache_write_tokens: number; total_tokens: number } | null | undefined): string | null {
  if (!usage || usage.total_tokens === 0) return null;
  return `${Math.round(((usage.cache_read_tokens + usage.cache_write_tokens) / usage.total_tokens) * 100)}%`;
}

/**
 * Full task efficiency card — the #574 Phase 2 drill-down. Four metric groups:
 * cost, tool health, run health, baseline deltas — plus the per-run trend
 * chart. Reuses UsageChip's label formatting (usageLabel / formatUsd /
 * formatTokens). Rendered inside a popover from UsageChip or inline in the
 * thread panel.
 */
export function EfficiencyCard({ report, taskId, inline, onClose }: EfficiencyCardProps) {
  const [runStats, setRunStats] = useState<TaskRunStat[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRunStats(null);
    if (report?.has_data && taskId) {
      api.fetchTaskRunStats(taskId).then((stats) => { if (alive) setRunStats(stats); }).catch(() => { if (alive) setRunStats([]); });
    }
    return () => { alive = false; };
  }, [report?.has_data, taskId]);

  if (!report) return null;
  if (!report.has_data) {
    return (
      <div style={{ padding: "var(--space-md)", fontSize: "var(--font-size-sm)", color: MUTED }}>
        No efficiency data for this task yet.
      </div>
    );
  }

  const { cost, tool_health: tool, run_health: run, baseline } = report;
  const cache = cachePct(cost);
  const topFailing = tool?.top_failing_commands ?? [];

  return (
    <div style={{ minWidth: 280, maxWidth: 420, maxHeight: "70vh", overflowY: "auto" }}>
      {inline && onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px 0" }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, cursor: "pointer", fontSize: "var(--font-size-lg)", lineHeight: 1 }}>×</button>
        </div>
      )}
      <Group title="Cost">
        <MetricRow label="Total" value={cost?.cost != null ? formatUsd(cost.cost) : "—"} />
        <MetricRow label="Calls" value={String(cost?.calls ?? 0)} />
        <MetricRow
          label="Tokens"
          value={`${formatTokens(cost?.input_tokens ?? 0)} in · ${formatTokens(cost?.output_tokens ?? 0)} out · ${formatTokens(cost?.cache_read_tokens ?? 0)} cache`}
        />
        {cache && <MetricRow label="Cache rate" value={cache} />}
      </Group>
      <Group title="Tool health">
        <MetricRow
          label="Calls · failures"
          value={`${tool?.tool_calls ?? 0} · ${tool?.failures ?? 0}`}
          sub={tool?.failure_rate != null ? `${(tool.failure_rate * 100).toFixed(0)}% fail` : undefined}
        />
        {topFailing.length > 0 && (
          <div style={{ marginTop: 4, fontSize: "var(--font-size-xs)", color: MUTED }}>
            {topFailing.slice(0, 3).map((t) => (
              <div key={t.command} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "1px 0" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{t.command}</span>
                <span style={{ color: BAD, flexShrink: 0 }}>×{t.failures}</span>
              </div>
            ))}
          </div>
        )}
      </Group>
      <Group title="Run health">
        <MetricRow label="Runs · sessions" value={`${run?.runs ?? 0} · ${run?.sessions ?? 0}`} />
        <MetricRow
          label="Completion"
          value={run?.completion_rate != null ? `${Math.round(run.completion_rate * 100)}%` : "—"}
          sub={run ? `${run.completed} done / ${run.failed} failed / ${run.aborted} aborted / ${run.stale} stale` : undefined}
        />
        <MetricRow
          label="Duration median"
          value={run?.duration_ms_median != null ? formatDuration(run.duration_ms_median) : "—"}
          sub={run?.duration_ms_total != null ? `${formatDuration(run.duration_ms_total)} total` : undefined}
        />
      </Group>
      <Group title="Baseline">
        <MetricRow
          label="Cost"
          value={baseline.median_cost != null ? formatUsd(baseline.median_cost) : "—"}
          sub={<Delta delta={report.cost_delta_vs_median} format={formatUsd} />}
        />
        <MetricRow
          label="Failure rate"
          value={baseline.median_failure_rate != null ? `${(baseline.median_failure_rate * 100).toFixed(0)}%` : "—"}
          sub={<Delta delta={report.failure_rate_delta_vs_median} format={(v) => `${(v * 100).toFixed(0)}pp`} />}
        />
        <div style={{ fontSize: "var(--font-size-xs)", color: MUTED, paddingTop: 2 }}>
          vs {baseline.tasks_included} sibling task{baseline.tasks_included === 1 ? "" : "s"} ({baseline.scope})
        </div>
      </Group>
      {runStats && runStats.length > 0 && (
        <Group title="Per-run trend">
          <RunStatsChart stats={runStats} />
        </Group>
      )}
    </div>
  );
}
