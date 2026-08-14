import { afterEach, describe, expect, it, vi } from "vitest";
import { CoveAgentRunLifecycleBridge, registerCoveAgentRunLifecycleHooks } from "./agent-run-lifecycle.js";

async function flushReports() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("native OpenClaw subagent lifecycle bridge", () => {
  afterEach(() => vi.useRealTimers());

  it("maps the real sessions_spawn api.on payload/context to the parent Cove thread run", async () => {
    vi.useFakeTimers();
    const bridge = new CoveAgentRunLifecycleBridge();
    const events: any[] = [];
    // This is the exact kind of thread session key Cove binds before dispatch.
    const parentSessionKey = "agent:kagura:cove:direct:1536591983689072640:thread:1536591983689072640";
    bridge.bindParent(parentSessionKey, "parent-run", (event) => { events.push(event); });
    const hooks = new Map<string, (event: any, context: any) => void | Promise<void>>();
    // OpenClaw's plugin API exposes api.on; registerHook does not exist here.
    registerCoveAgentRunLifecycleHooks({ on: (name, handler) => hooks.set(name, handler) }, bridge);

    expect([...hooks.keys()]).toEqual(["subagent_spawned", "subagent_ended", "agent_end"]);
    // Shape copied from OpenClaw's sessions_spawn call to runSubagentSpawned.
    await hooks.get("subagent_spawned")!({
      runId: "native-child-run", childSessionKey: "agent:kagura:subagent:child-1",
      agentId: "kagura", label: "Investigate", mode: "run", threadRequested: true,
      requester: { channel: "cove", accountId: "default", to: "1536591983689072640", threadId: "1536591983689072640" },
      resolvedModel: "floway-sg/gpt-5.6-terra", resolvedProvider: "floway-sg",
    }, { runId: "native-child-run", childSessionKey: "agent:kagura:subagent:child-1", requesterSessionKey: parentSessionKey });
    await flushReports();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "subagent_started", tool_call_id: "agent:kagura:subagent:child-1", detail: "OpenClaw child run native-child-run started" }),
      expect.objectContaining({ type: "subagent_progress", tool_call_id: "agent:kagura:subagent:child-1", detail: "Child session is active" }),
    ]));

    let parentMayFinish = false;
    const waiting = bridge.waitForChildren(parentSessionKey).then(() => { parentMayFinish = true; });
    await vi.advanceTimersByTimeAsync(25_000);
    await flushReports();
    expect(parentMayFinish).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent_progress", tool_call_id: "agent:kagura:subagent:child-1", detail: "Child session remains active (awaiting OpenClaw terminal hook)" }));

    // Exact agent_end payload/context from OpenClaw's native harness. One-shot
    // subagents complete here even when the registry has not emitted
    // subagent_ended yet.
    await hooks.get("agent_end")!({
      runId: "native-child-run", messages: [], success: true, durationMs: 42,
    }, { runId: "native-child-run", sessionKey: "agent:kagura:subagent:child-1", sessionId: "child-session" });
    await waiting; await flushReports();
    expect(parentMayFinish).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "subagent_finished", tool_call_id: "agent:kagura:subagent:child-1", detail: "Child run completed", status: "completed" }));

    // The registry may later emit its session-lifecycle hook; it must not
    // duplicate the terminal event after agent_end already released the child.
    await hooks.get("subagent_ended")!({
      targetSessionKey: "agent:kagura:subagent:child-1", targetKind: "subagent", reason: "subagent-complete",
      sendFarewell: true, accountId: "default", runId: "native-child-run", endedAt: 1_786_000_000_000, outcome: "ok",
    }, { runId: "native-child-run", childSessionKey: "agent:kagura:subagent:child-1", requesterSessionKey: parentSessionKey });
    await flushReports();
    expect(events.filter((event) => event.type === "subagent_finished")).toHaveLength(1);
  });

  it("records failed, cancelled, and session terminal outcomes without inventing child progress", async () => {
    const bridge = new CoveAgentRunLifecycleBridge(); const events: any[] = [];
    bridge.bindParent("parent", "parent-run", (event) => { events.push(event); });
    bridge.onSubagentSpawned({ childSessionKey: "failed-child", runId: "failed-run", mode: "run" }, { requesterSessionKey: "parent" });
    bridge.onAgentEnd({ runId: "failed-run", messages: [], success: false, error: "child cancelled" }, { runId: "failed-run", sessionKey: "failed-child" });
    await flushReports();
    expect(events.at(-1)).toMatchObject({ type: "subagent_failed", tool_call_id: "failed-child", detail: "child cancelled", status: "failed" });

    bridge.onSubagentSpawned({ childSessionKey: "killed-child", runId: "killed-run", mode: "session" }, { requesterSessionKey: "parent" });
    bridge.onSubagentEnded({ targetSessionKey: "killed-child", targetKind: "subagent", reason: "cancelled", outcome: "killed", error: "cancelled by requester" });
    await flushReports();
    expect(events.at(-1)).toMatchObject({ type: "subagent_failed", tool_call_id: "killed-child", detail: "cancelled by requester", status: "killed" });
  });
});
