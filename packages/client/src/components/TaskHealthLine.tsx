import { useMemo } from "react";
import type { TaskEfficiencyReport } from "@cove/shared";
import { formatUsd } from "./AgentRunTimeline";

interface TaskHealthLineProps {
  report: TaskEfficiencyReport | null | undefined;
  /** When true, delta coloring is suppressed (e.g. no baseline siblings). */
  hideDelta?: boolean;
}

const MUTED = "var(--text-muted)";
const GOOD = "#23a55a";       // green — below channel median (cheaper / fewer failures)
const BAD = "var(--status-danger, #ed4245)"; // red — above channel median

function deltaColor(delta: number | null, invert: boolean): string | null {
  if (delta === null || delta === 0) return null;
  const positive = delta > 0;
  // Cost/failure deltas: positive = worse (red). Inverted metrics (completion)
  // flip the polarity.
  return (positive !== invert) ? BAD : GOOD;
}

function pct(rate: number | null): string | null {
  if (rate === null) return null;
  return `${Math.round(rate * 100)}% done`;
}

/**
 * One compact row of task health on a task card:
 *   `$1.37 · 11 calls · 5 failed · 92% done` + delta vs channel median.
 * Zero-data tasks render nothing (the caller hides the row entirely).
 */
export function TaskHealthLine({ report, hideDelta }: TaskHealthLineProps) {
  const parts = useMemo(() => {
    const out: string[] = [];
    const cost = report?.cost?.cost;
    if (cost != null) out.push(formatUsd(cost));
    const calls = report?.cost?.calls;
    if (calls != null && calls > 0) out.push(`${calls} call${calls === 1 ? "" : "s"}`);
    const failures = report?.tool_health?.failures;
    if (failures != null && failures > 0) out.push(`${failures} failed`);
    const done = pct(report?.run_health?.completion_rate ?? null);
    if (done) out.push(done);
    return out;
  }, [report]);

  if (!report?.has_data || parts.length === 0) return null;

  const costDelta = hideDelta ? null : report.cost_delta_vs_median;
  const failureDelta = hideDelta ? null : report.failure_rate_delta_vs_median;
  const costColor = deltaColor(costDelta, false);
  const failureColor = deltaColor(failureDelta, false);
  const deltas: Array<{ text: string; color: string | null }> = [];
  if (costColor && costDelta !== null) {
    const abs = Math.abs(costDelta);
    // Skip display when the delta rounds to zero (would render "−$0.0000").
    if (abs >= 0.001) {
      deltas.push({ text: `${costDelta > 0 ? "+" : "−"}${formatUsd(abs)} vs median`, color: costColor });
    }
  }
  if (failureColor && failureDelta !== null) {
    const pp = Math.round(Math.abs(failureDelta) * 100);
    // Skip display when the delta rounds to zero (would render "−0pp").
    if (pp > 0) {
      deltas.push({ text: `${failureDelta > 0 ? "+" : "−"}${pp}pp fail vs median`, color: failureColor });
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "2px 8px",
        fontSize: "var(--font-size-xs)",
        color: MUTED,
        marginTop: 4,
        lineHeight: 1.4,
      }}
    >
      <span>{parts.join(" · ")}</span>
      {deltas.map((d, i) => (
        <span key={i} style={{ color: d.color ?? MUTED, fontWeight: 600 }}>
          ↑ {d.text}
        </span>
      ))}
    </div>
  );
}
