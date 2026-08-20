import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskEfficiencyReport } from "@cove/shared";
import { EfficiencyCard } from "./EfficiencyCard";

function report(overrides: Partial<TaskEfficiencyReport>): TaskEfficiencyReport {
  return {
    task_id: "task-1",
    has_data: true,
    cost: { calls: 11, input_tokens: 10_000, output_tokens: 5_000, cache_read_tokens: 20_000, cache_write_tokens: 0, total_tokens: 35_000, cost: 1.37, currency: "usd", cost_source: "price_table", models: [] },
    tool_health: {
      tool_calls: 11,
      failures: 5,
      failure_rate: 5 / 11,
      top_failing_commands: [{ command: "gh pr checks 529 --repo kagura-agent/cove", failures: 5 }],
      repeated_commands: [],
    },
    run_health: { runs: 13, sessions: 1, completed: 12, failed: 1, aborted: 0, stale: 0, active: 0, completion_rate: 12 / 13, duration_ms_median: 60_000, duration_ms_total: 780_000 },
    baseline: { scope: "channel", tasks_included: 7, median_cost: 0.5, median_failure_rate: 0.2 },
    cost_delta_vs_median: 0.87,
    failure_rate_delta_vs_median: 5 / 11 - 0.2,
    ...overrides,
  };
}

describe("EfficiencyCard", () => {
  it("renders the four metric groups: cost, tool health, run health, baseline", () => {
    const html = renderToStaticMarkup(createElement(EfficiencyCard, { report: report() }));
    for (const group of ["Cost", "Tool health", "Run health", "Baseline"]) {
      expect(html).toContain(`>${group}</div>`);
    }
    // Cost group: $ + calls + in/out/cache tokens + cache %
    expect(html).toContain("$1.37");
    expect(html).toContain("11");
    expect(html).toContain("10.0k in · 5.0k out · 20.0k cache");
    expect(html).toContain("57%"); // (20k+0)/35k cache rate
    // Tool health: calls · failures · rate · top failing command
    expect(html).toContain("11 · 5");
    expect(html).toContain("45% fail");
    expect(html).toContain("gh pr checks 529");
    expect(html).toContain("×5");
    // Run health: runs · sessions · completion · duration median
    expect(html).toContain("13 · 1");
    expect(html).toContain("92%");
    expect(html).toContain("1m 0s");
    expect(html).toContain("13m 0s total");
    // Baseline deltas
    expect(html).toContain("+$0.870 vs median"); // formatUsd: <$1 → 3 decimals
    expect(html).toContain("25pp vs median"); // 45% - 20%
  });

  it("shows a friendly empty state for zero-data tasks", () => {
    const html = renderToStaticMarkup(createElement(EfficiencyCard, { report: report({ has_data: false, cost: null, tool_health: null, run_health: null }) }));
    expect(html).toContain("No efficiency data for this task yet.");
  });

  it("renders nothing when the report is absent", () => {
    expect(renderToStaticMarkup(createElement(EfficiencyCard, { report: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(EfficiencyCard, { report: undefined }))).toBe("");
  });
});
