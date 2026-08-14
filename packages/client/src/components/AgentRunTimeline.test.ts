import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@cove/shared";
import { aggregateLifecycleEvents, conciseAction, executionSummary, ExecutionTimeline, formatDuration, formatTokens, formatUsd, usageLabel } from "./AgentRunTimeline";

function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  return { event_id: "event", run_id: "run", tool_call_id: null, type: "tool_started", action: null, detail: null, status: null, exit_code: null, duration_ms: null, cwd: null, created_at: 0, ...overrides };
}

describe("agent execution presentation", () => {
  it("derives compact child-agent and changed-file counts from safe events", () => {
    expect(executionSummary([
      event({ type: "subagent_started", tool_call_id: "child-1" }),
      event({ type: "subagent_finished", tool_call_id: "child-1" }),
      event({ type: "patch_summary", detail: "modified: src/a.ts, src/b.ts; deleted: docs/readme.md" }),
    ])).toEqual({ actions: 2, children: 1, files: 3 });
  });

  it("keeps row labels concise and formats available durations", () => {
    expect(conciseAction(event({ type: "tool_failed" }))).toBe("Tool failed");
    expect(conciseAction(event({ action: "Run client build" }))).toBe("Run client build");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  it("summarizes a correlated tool lifecycle while retaining its raw events", () => {
    const events = [
      event({ event_id: "start", tool_call_id: "call-1", action: "Exec", detail: "pnpm test", status: "running" }),
      event({ event_id: "running", tool_call_id: "tool:call-1", type: "tool_progress", action: "Exec", detail: "still running", status: "running" }),
      event({ event_id: "done", tool_call_id: "command:call-1", type: "command_output", action: "Exec", detail: "all tests passed", status: "completed", duration_ms: 1_200, exit_code: 0 }),
    ];
    const [operation] = aggregateLifecycleEvents(events);

    expect(operation).toMatchObject({ action: "Exec", detail: "pnpm test", duration_ms: 1_200, exit_code: 0, state: { icon: "✓", label: "Done" } });
    expect(operation.events).toEqual(events);

    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events }));
    expect(html).toContain("pnpm test");
    expect(html).toContain("exit 0");
    expect(html).toContain("Lifecycle (3)");
  });

  it("does not merge ambiguous consecutive no-ID tools with the same action", () => {
    const operations = aggregateLifecycleEvents([
      event({ event_id: "first", action: "Exec", detail: "one" }),
      event({ event_id: "second", action: "Exec", detail: "two" }),
      event({ event_id: "finished", type: "tool_finished", action: "Exec", status: "completed" }),
    ]);
    expect(operations.map((operation) => operation.events.length)).toEqual([1, 2]);
  });

  it("keeps collapsed lifecycle operations in the append-only event order", () => {
    const events = [
      event({ event_id: "start", type: "run_started", action: "Starting" }),
      event({ event_id: "tool", tool_call_id: "call-1", action: "Exec", detail: "pnpm test", status: "running" }),
      event({ event_id: "done", tool_call_id: "command:call-1", type: "command_output", action: "Exec", status: "completed", exit_code: 0 }),
      event({ event_id: "finish", type: "run_finished", action: "Completed" }),
    ];
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events }));
    expect(html.indexOf("Starting")).toBeLessThan(html.indexOf("pnpm test"));
    expect(html.indexOf("pnpm test")).toBeLessThan(html.indexOf("Completed"));
  });

  it("renders the sequence as a vertical axis: ol/li rows with connected spine nodes", () => {
    const events = [
      event({ event_id: "one", type: "run_started", action: "Starting", detail: "Let me dig in." }),
      event({ event_id: "two", type: "tool_progress", action: "Plan update", detail: "First pass done." }),
      event({ event_id: "three", type: "run_finished", action: "Completed" }),
    ];
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events }));
    // Rows are list items inside an ordered list.
    expect(html.match(/<ol/g)).not.toBeNull();
    expect((html.match(/<li/g) ?? []).length).toBe(3);
    // Every row contributes a spine node (aria-hidden axis column).
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBe(3);
    // The spine is dashed, faint, and uses negative offsets so it crosses the
    // row padding — one continuous axis rather than per-row segments.
    expect(html).toContain("position:absolute");
    expect(html).toContain("border-left:2px dashed");
    expect(html).toContain("opacity:0.3");
    expect(html).toContain("bottom:-4px");
    expect(html).not.toContain("borderBottom");
  });

  it("keeps state glyphs as the node semantics (done/failed/in-progress)", () => {
    const events = [
      event({ event_id: "ok", type: "tool_finished", action: "Build", status: "completed" }),
      event({ event_id: "bad", type: "tool_failed", action: "Test", status: "failed" }),
      event({ event_id: "running", type: "tool_started", action: "Deploy", status: "running" }),
    ];
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events }));
    expect(html).toContain("aria-label=\"Done\"");
    expect(html).toContain("aria-label=\"Failed\"");
    expect(html).toContain("aria-label=\"In progress\"");
    expect(html).toContain("✓");
    expect(html).toContain("!");
    expect(html).toContain("●");
  });

  it("renders Preamble content directly without the label heading", () => {
    const events = [
      event({ event_id: "pre", type: "run_started", action: "Preamble", detail: "We need to fix the flaky CI before shipping." }),
      event({ event_id: "after", type: "tool_progress", action: "Plan update", detail: "Proposed two fixes." }),
    ];
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events }));
    expect(html).toContain("We need to fix the flaky CI before shipping.");
    expect(html).not.toContain("Preamble");
    expect(html).toContain("Proposed two fixes.");
    // The opener content is rendered as a heading-weight row (bold), not a muted detail line.
    expect(html).toContain("font-weight:600");
  });

  it("treats an opener without detail as a normal labeled row", () => {
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { events: [event({ event_id: "bare", type: "run_started", action: "Preamble", detail: null })] }));
    // The action label is kept as the row heading when there is no content to stand in for it.
    expect(html).toContain("font-weight:600");
    expect(html).toContain("Preamble");
  });

  it("formats token counts and costs for the execution chip", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(3_200_000)).toBe("3.2M");
    expect(formatUsd(0.004)).toBe("$0.0040");
    expect(formatUsd(0.0312)).toBe("$0.031");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(usageLabel(null)).toBeNull();
    expect(usageLabel({ calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 0, cost: null, currency: "USD", cost_source: "none", models: [] })).toBeNull();
    expect(usageLabel({ calls: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12_400, cost: null, currency: "USD", cost_source: "none", models: [] })).toBe("12.4k tok");
    expect(usageLabel({ calls: 1, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12_400, cost: 0.0312, currency: "USD", cost_source: "price_table", models: [] })).toBe("12.4k tok · $0.031");
  });
});
