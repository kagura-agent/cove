import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TaskRunStat } from "@cove/shared";
import { RunStatsChart } from "./RunStatsChart";

function stat(overrides: Partial<TaskRunStat>): TaskRunStat {
  return {
    run_id: "run",
    started_at: 1000,
    status: "completed",
    cost: 0.5,
    tool_calls: 2,
    tool_failures: 0,
    duration_ms: 60_000,
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 200,
    cache_write_tokens: 0,
    total_tokens: 350,
    ...overrides,
  };
}

describe("RunStatsChart", () => {
  it("renders nothing for an empty stats list", () => {
    expect(renderToStaticMarkup(createElement(RunStatsChart, { stats: [] }))).toBe("");
  });

  it("renders one SVG bar per run, oldest → newest", () => {
    const stats = [
      stat({ run_id: "old", started_at: 1000, cost: 0.2 }),
      stat({ run_id: "new", started_at: 2000, cost: 0.8 }),
    ];
    const html = renderToStaticMarkup(createElement(RunStatsChart, { stats }));
    expect(html).toContain("<svg");
    expect((html.match(/<rect/g) ?? []).length).toBe(2);
    // Oldest bar first (leftmost) — x of the first rect must be smaller.
    // Match the rect's own x attribute (not rx / other attributes).
    const xs = [...html.matchAll(/<rect[^>]*? x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(2);
    expect(xs[0]).toBeLessThan(xs[1]);
  });

  it("keeps metric legend buttons switchable with cost selected by default", () => {
    const html = renderToStaticMarkup(createElement(RunStatsChart, { stats: [stat({})] }));
    for (const label of ["cost", "failures", "duration", "tokens"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain("Per-run cost trend");
  });

  it("caps the number of rendered bars with maxRuns", () => {
    const stats = Array.from({ length: 10 }, (_, i) => stat({ run_id: `r${i}`, started_at: i }));
    const html = renderToStaticMarkup(createElement(RunStatsChart, { stats, maxRuns: 3 }));
    expect((html.match(/<rect/g) ?? []).length).toBe(3);
  });

  it("annotates failed runs with a dimmed bar on non-failure metrics", () => {
    const stats = [stat({ run_id: "bad", tool_failures: 2 })];
    const html = renderToStaticMarkup(createElement(RunStatsChart, { stats }));
    // Default metric is cost, so the failed run's bar is dimmed.
    expect(html).toContain('opacity="0.55"');
  });

  it("shows max value and run count in the footer", () => {
    const html = renderToStaticMarkup(createElement(RunStatsChart, { stats: [stat({ cost: 0.4 })] }));
    expect(html).toContain("1 run");
    expect(html).toContain("max $0.400");
  });
});
