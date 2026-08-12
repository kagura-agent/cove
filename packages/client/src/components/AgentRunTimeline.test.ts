import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@cove/shared";
import { aggregateLifecycleEvents, conciseAction, executionSummary, ExecutionTimeline, formatDuration } from "./AgentRunTimeline";

function event(overrides: Partial<AgentRunEvent>): AgentRunEvent {
  return { event_id: "event", run_id: "run", tool_call_id: null, type: "tool_started", action: null, detail: null, status: null, exit_code: null, duration_ms: null, cwd: null, created_at: 0, ...overrides };
}

describe("agent execution presentation", () => {
  it("derives compact child-agent and changed-file counts from safe events", () => {
    expect(executionSummary([
      event({ type: "subagent_started", tool_call_id: "child-1" }),
      event({ type: "subagent_finished", tool_call_id: "child-1" }),
      event({ type: "patch_summary", detail: "modified: src/a.ts, src/b.ts; deleted: docs/readme.md" }),
    ])).toEqual({ events: 3, children: 1, files: 3 });
  });

  it("keeps row labels concise and formats available durations", () => {
    expect(conciseAction(event({ type: "tool_failed" }))).toBe("Tool failed");
    expect(conciseAction(event({ action: "Run client build" }))).toBe("Run client build");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });

  it("summarizes a correlated tool lifecycle while retaining its raw events", () => {
    const events = [
      event({ event_id: "start", tool_call_id: "call-1", action: "Exec", detail: "pnpm test", status: "running" }),
      event({ event_id: "running", tool_call_id: "call-1", type: "tool_progress", action: "Exec", detail: "still running", status: "running" }),
      event({ event_id: "done", tool_call_id: "call-1", type: "command_output", action: "Exec", detail: "all tests passed", status: "completed", duration_ms: 1_200, exit_code: 0 }),
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
});
