import { useMemo, useState } from "react";
import type { TaskRunStat } from "@cove/shared";
import { formatDuration, formatTokens, formatUsd } from "./AgentRunTimeline";

interface RunStatsChartProps {
  stats: TaskRunStat[];
  /** Chart height in px (default 120). */
  height?: number;
  /** Number of runs to show (default all). */
  maxRuns?: number;
}

type Metric = "cost" | "tool_failures" | "duration_ms" | "total_tokens";

const METRICS: Array<{ key: Metric; label: string; format: (v: number) => string; color: string }> = [
  { key: "cost", label: "cost", format: (v) => formatUsd(v), color: "#5865f2" },
  { key: "tool_failures", label: "failures", format: (v) => String(v), color: "#ed4245" },
  { key: "duration_ms", label: "duration", format: (v) => formatDuration(v), color: "#f0b232" },
  { key: "total_tokens", label: "tokens", format: (v) => formatTokens(v), color: "#23a55a" },
];

function maxValue(metric: Metric, stats: TaskRunStat[]): number {
  let max = 0;
  for (const s of stats) {
    const v = s[metric];
    if (v == null) continue;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Per-run trend chart (X = runs in time order, oldest → newest). Hand-rolled
 * SVG bars — zero new dependencies. One bar per run per metric; metric is
 * switchable from the legend row. Bars are plain <rect>s with a native title
 * tooltip, so no chart library is needed.
 */
export function RunStatsChart({ stats, height = 120, maxRuns }: RunStatsChartProps) {
  const [metric, setMetric] = useState<Metric>("cost");
  const rows = useMemo(() => {
    const ordered = [...stats].sort((a, b) => a.started_at - b.started_at);
    return maxRuns && ordered.length > maxRuns ? ordered.slice(-maxRuns) : ordered;
  }, [stats, maxRuns]);

  const chart = useMemo(() => {
    const W = 320;
    const H = height;
    const padTop = 8;
    const padBottom = 18;
    const plotH = H - padTop - padBottom;
    const n = rows.length;
    const barGap = n > 1 ? 3 : 0;
    const barW = n > 0 ? Math.max(2, Math.min(14, (W - 8) / n - barGap)) : 0;
    const max = maxValue(metric, rows);
    const bars = rows.map((s, i) => {
      const v = s[metric] ?? 0;
      const h = max > 0 ? Math.max(1, (v / max) * plotH) : 0;
      const x = 4 + i * (barW + barGap);
      const y = padTop + plotH - h;
      const active = METRICS.find((m) => m.key === metric)!;
      const tooltip = `${active.label}: ${active.format(v)}\n${new Date(s.started_at).toLocaleString()}`;
      return { x, y, h, tooltip, failed: s.tool_failures > 0, status: s.status };
    });
    const midLine = max > 0 ? padTop + plotH / 2 : padTop + plotH;
    return { W, H, padTop, plotH, barW, barGap, max, bars, midLine };
  }, [rows, metric, height]);

  if (rows.length === 0) return null;
  const active = METRICS.find((m) => m.key === metric)!;

  return (
    <div style={{ width: "100%", userSelect: "none" }}>
      <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", marginBottom: 4 }}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            style={{
              background: m.key === metric ? "color-mix(in srgb, var(--accent, #5865f2) 18%, transparent)" : "transparent",
              border: "1px solid " + (m.key === metric ? "var(--accent, #5865f2)" : "var(--border-subtle)"),
              borderRadius: 10,
              padding: "1px 8px",
              fontSize: "var(--font-size-xs)",
              color: m.key === metric ? "var(--header-primary)" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${chart.W} ${chart.H}`} width="100%" height={chart.H} role="img" aria-label={`Per-run ${active.label} trend`}>
        {chart.bars.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={chart.barW}
            height={b.h}
            rx={1.5}
            fill={active.color}
            opacity={b.failed && active.key !== "tool_failures" ? 0.55 : 0.9}
          >
            <title>{b.tooltip}</title>
          </rect>
        ))}
        {/* Baseline dashed midline at 50% of the visible max */}
        <line x1={4} y1={chart.midLine} x2={chart.W - 4} y2={chart.midLine} stroke="var(--border-subtle)" strokeDasharray="3 3" strokeWidth={1} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}>
        <span>{rows.length} run{rows.length === 1 ? "" : "s"} · oldest → newest</span>
        <span>max {active.format(chart.max)}</span>
      </div>
    </div>
  );
}
