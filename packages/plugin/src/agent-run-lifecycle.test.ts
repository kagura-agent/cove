import { afterEach, describe, expect, it, vi } from "vitest";
import { CoveAgentRunLifecycleBridge, registerCoveAgentRunLifecycleHooks } from "./agent-run-lifecycle.js";

async function flushReports() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("native OpenClaw subagent lifecycle bridge", () => {
  afterEach(() => vi.useRealTimers());

  it("registers documented hooks and keeps the parent active through child progress and terminal outcome", async () => {
    vi.useFakeTimers();
    const bridge = new CoveAgentRunLifecycleBridge();
    const events: any[] = [];
    bridge.bindParent("agent:cove:channel:parent", "parent-run", (event) => { events.push(event); });
    const hooks = new Map<string, (event: any, context: any) => void>();
    registerCoveAgentRunLifecycleHooks({ registerHook: (name, handler) => hooks.set(name as string, handler) }, bridge);

    expect([...hooks.keys()]).toEqual(["subagent_spawned", "subagent_ended"]);
    hooks.get("subagent_spawned")!({ childSessionKey: "child-session", runId: "native-child-run", label: "Investigate", mode: "run" }, { requesterSessionKey: "agent:cove:channel:parent" });
    await flushReports();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "subagent_started", tool_call_id: "child-session", detail: "OpenClaw child run native-child-run started" }),
      expect.objectContaining({ type: "subagent_progress", tool_call_id: "child-session", detail: "Child session is active" }),
    ]));

    let parentMayFinish = false;
    const waiting = bridge.waitForChildren("agent:cove:channel:parent").then(() => { parentMayFinish = true; });
    await vi.advanceTimersByTimeAsync(25_000);
    await flushReports();
    expect(parentMayFinish).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent_progress", tool_call_id: "child-session", detail: "Child session remains active (awaiting OpenClaw terminal hook)" }));

    hooks.get("subagent_ended")!({ targetSessionKey: "child-session", targetKind: "subagent", reason: "completed", outcome: "ok" }, {});
    await waiting; await flushReports();
    expect(parentMayFinish).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent_finished", tool_call_id: "child-session", status: "ok" }));
  });

  it("records an observed failed child terminal outcome without inventing child progress", async () => {
    const bridge = new CoveAgentRunLifecycleBridge(); const events: any[] = [];
    bridge.bindParent("parent", "parent-run", (event) => { events.push(event); });
    bridge.onSubagentSpawned({ childSessionKey: "child", runId: "run", mode: "session" }, { requesterSessionKey: "parent" });
    bridge.onSubagentEnded({ targetSessionKey: "child", targetKind: "subagent", reason: "cancelled", outcome: "killed", error: "cancelled by requester" });
    await flushReports();
    expect(events.at(-1)).toMatchObject({ type: "subagent_failed", tool_call_id: "child", detail: "cancelled by requester", status: "killed" });
  });
});
