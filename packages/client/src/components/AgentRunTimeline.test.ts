import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@cove/shared";
import { conciseAction, executionSummary, formatDuration } from "./AgentRunTimeline";

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
});
