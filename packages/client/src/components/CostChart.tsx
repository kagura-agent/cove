import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  type TooltipContentProps,
} from "recharts";
import { formatUsd, formatTokens } from "./AgentRunTimeline";

/**
 * CostChart — thin dark-theme wrapper around recharts for the guild cost
 * overview (#584). One source of truth for axis/tooltip/grid colors so every
 * chart on the page matches the app theme without repeating styling.
 *
 * Re-exported chart primitives keep the import surface small; the page
 * composes them as needed (bar / composed bar+line / stacked bars).
 */

// Palette for model slices — dark-theme friendly, distinct hues.
export const MODEL_PALETTE = [
  "#f4a261", // accent brand
  "#5865f2", // blurple
  "#23a55a", // green
  "#eb459e", // fuchsia
  "#f0b232", // gold
  "#3b82f6", // blue
  "#a06cd5", // purple
  "#e05c5c", // red
  "#2dd4bf", // teal
  "#94a3b8", // slate
  "#f97316", // orange
  "#84cc16", // lime
  "#eab308", // yellow
  "#0ea5e9", // sky
  "#ec4899", // pink
  "#14b8a6", // cyan
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#64748b", // gray
  "#22c55e", // emerald
  "#a855f7",
];

const AXIS = "var(--text-muted)";
const GRID = "var(--border-subtle)";
const TOOLTIP_BG = "var(--bg-floating)";
const TOOLTIP_BORDER = "var(--border-subtle)";

export const costChartTheme = {
  axis: AXIS,
  grid: GRID,
  tooltipBg: TOOLTIP_BG,
  tooltipBorder: TOOLTIP_BORDER,
};

/** Format an axis tick: compact usd for cost axes. */
export function costTick(value: number | string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  return `$${(n / 1000).toFixed(1)}k`;
}

/** Format a tick for the token axis (compact). */
export function tokenTick(value: number | string): string {
  return formatTokens(Number(value));
}

interface CostTooltipProps {
  /** Optional formatter override; default renders $ + calls + tokens. */
  valueFormatter?: (value: string | number) => string;
  /** Extra lines from the payload entry (e.g. token count). */
  renderEntry?: (entry: { name?: string | number; value?: string | number; color?: string }) => ReactNode;
}

export function CostTooltip({ active, payload, label, valueFormatter, renderEntry }: Partial<TooltipContentProps<number, string>> & CostTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const fmt = (v: string | number) => (valueFormatter ? valueFormatter(v) : formatUsd(Number(v)));
  return (
    <div
      style={{
        background: TOOLTIP_BG,
        border: `1px solid ${TOOLTIP_BORDER}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: "var(--font-size-xs)",
        color: "var(--text-normal)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
      }}
    >
      {label != null && <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 0" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color ?? "#5865f2", flexShrink: 0 }} />
          <span style={{ color: "var(--text-muted)" }}>{entry.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {fmt(entry.value as string | number)}
          </span>
        </div>
      ))}
      {renderEntry && payload[0] && renderEntry(payload[0] as unknown as { name?: string | number; value?: string | number; color?: string })}
    </div>
  );
}

/** Shared chart container with dark-theme grid + axes. */
export function CostChartFrame({ children, height = 220 }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

export const CostGrid = () => <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />;
export const CostXAxis = (props: { dataKey?: string; tickFormatter?: (v: string | number) => string; interval?: number | "preserveStartEnd" }) => (
  <XAxis dataKey={props.dataKey} tickFormatter={props.tickFormatter} interval={props.interval} stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} />
);
export const CostYAxis = (props: { tickFormatter?: (v: string | number) => string; width?: number; yAxisId?: string; orientation?: "left" | "right" }) => (
  <YAxis yAxisId={props.yAxisId} orientation={props.orientation} tickFormatter={props.tickFormatter} width={props.width ?? 56} stroke={AXIS} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
);
export const CostLegend = () => <Legend wrapperStyle={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }} />;

/** Full tooltip wrapper with dark-theme content pre-wired. Use this in charts:
 *  <CostTooltipBox /> — cursor/trigger props pass through to recharts Tooltip. */
export function CostTooltipBox(props: { cursor?: { fill?: string } }) {
  return <Tooltip content={<CostTooltip />} cursor={props.cursor} />;
}

/** Convenience re-exports so the page never imports recharts directly. */
export { Bar, BarChart, ComposedChart, Line, ResponsiveContainer };

/**
 * Deterministic color for a model name (stable across renders and across the
 * two model charts on the page).
 */
export function modelColor(model: string): string {
  let hash = 0;
  for (let i = 0; i < model.length; i++) hash = (hash * 31 + model.charCodeAt(i)) >>> 0;
  return MODEL_PALETTE[hash % MODEL_PALETTE.length];
}
