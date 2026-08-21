import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskEfficiencyReport } from "@cove/shared";
import { TaskHealthLine } from "./TaskHealthLine";

function report(overrides: Partial<TaskEfficiencyReport> = {}): TaskEfficiencyReport {
  return {
    task_id: "task-1",
    has_data: true,
    cost: { calls: 11, input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1500, cost: 1.37, currency: "usd", cost_source: "price_table", models: [] },
    tool_health: { tool_calls: 11, failures: 5, failure_rate: 5 / 11, top_failing_commands: [], repeated_commands: [] },
    run_health: { runs: 13, sessions: 1, completed: 12, failed: 1, aborted: 0, stale: 0, active: 0, completion_rate: 12 / 13, duration_ms_median: 60_000, duration_ms_total: 780_000 },
    baseline: { scope: "channel", tasks_included: 7, median_cost: 0.5, median_failure_rate: 0.2 },
    cost_delta_vs_median: 0.87,
    failure_rate_delta_vs_median: 5 / 11 - 0.2,
    ...overrides,
  };
}

describe("TaskHealthLine", () => {
  it("renders the compact health summary (cost · calls · failures · done%)", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report() }));
    expect(html).toContain("$1.37");
    expect(html).toContain("11 calls");
    expect(html).toContain("5 failed");
    expect(html).toContain("92% done");
  });

  it("hides the row entirely for zero-data tasks", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ has_data: false, cost: null, tool_health: null, run_health: null }) }));
    expect(html).toBe("");
  });

  it("renders nothing when no report is available", () => {
    expect(renderToStaticMarkup(createElement(TaskHealthLine, { report: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(TaskHealthLine, { report: undefined }))).toBe("");
  });

  it("renders the placeholder instead of nothing when emptyPlaceholder is set", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ has_data: false, cost: null, tool_health: null, run_health: null }), emptyPlaceholder: "—" }));
    expect(html).toContain("—");
    const noReport = renderToStaticMarkup(createElement(TaskHealthLine, { report: null, emptyPlaceholder: "—" }));
    expect(noReport).toContain("—");
  });

  it("keeps the real health summary when emptyPlaceholder is set but data exists", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report(), emptyPlaceholder: "—" }));
    expect(html).toContain("$1.37");
    expect(html).not.toContain("—");
  });

  it("colors the cost delta red when above the channel median, green when below", () => {
    const above = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ cost_delta_vs_median: 0.87 }) }));
    expect(above).toContain("+$0.870 vs median"); // formatUsd: <$1 → 3 decimals
    expect(above).toContain("color:var(--status-danger, #ed4245)");
    const below = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ cost_delta_vs_median: -0.20 }) }));
    expect(below).toContain("−$0.200 vs median");
    expect(below).toContain("color:#23a55a");
  });

  it("omits the delta when hideDelta is set (no baseline siblings)", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report(), hideDelta: true }));
    expect(html).not.toContain("vs median");
  });

  it("hides a delta that rounds to zero instead of rendering −0pp / −$0.000", () => {
    const tinyFailure = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ failure_rate_delta_vs_median: -0.004 }) }));
    expect(tinyFailure).not.toContain("pp fail vs median");
    // With both deltas near zero, no "vs median" text appears at all.
    const tinyBoth = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ cost_delta_vs_median: 0.0004, failure_rate_delta_vs_median: -0.004 }) }));
    expect(tinyBoth).not.toContain("vs median");
  });

  it("omits the failure segment when there are no failures", () => {
    const html = renderToStaticMarkup(createElement(TaskHealthLine, { report: report({ tool_health: { tool_calls: 3, failures: 0, failure_rate: 0, top_failing_commands: [], repeated_commands: [] } }) }));
    expect(html).not.toContain("failed");
  });
});
