import { afterEach, describe, expect, it, vi } from "vitest";
import { CoveAgentRunLifecycleBridge, registerCoveAgentRunLifecycleHooks } from "./agent-run-lifecycle.js";

async function flushReports() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("native OpenClaw subagent lifecycle bridge", () => {
  afterEach(() => vi.useRealTimers());

  it("claims fresh only for Cove-created thread/subagent sessions and consumes once (#551)", async () => {
    const bridge = new CoveAgentRunLifecycleBridge();
    // Thread sessions (new channel per task) are claimed fresh at dispatch.
    const parentSessionKey = "agent:kagura:cove:direct:1536591983689072640:thread:1536591983689072640";
    bridge.bindParent(parentSessionKey, "parent-run", () => {});
    expect(bridge.consumeFreshSession(parentSessionKey)).toBe(true);
    expect(bridge.consumeFreshSession(parentSessionKey)).toBe(false);

    // A spawned child session is also claimed fresh (one-shot subagents fire a
    // single agent_end — their whole usage must be reported, not baselined).
    bridge.onSubagentSpawned({ childSessionKey: "agent:kagura:subagent:child-1", runId: "native-run", mode: "run" }, { requesterSessionKey: parentSessionKey });
    expect(bridge.consumeFreshSession("agent:kagura:subagent:child-1")).toBe(true);
    expect(bridge.consumeFreshSession("agent:kagura:subagent:child-1")).toBe(false);

    // Persistent channel/group sessions are NOT fresh even when this process
    // dispatches them — their first observation must stay a silent baseline so
    // pre-existing history is not double counted.
    bridge.bindParent("agent:kagura:cove:channel:123", "chan-run", () => {});
    bridge.bindParent("agent:kagura:cove:group:456", "group-run", () => {});
    expect(bridge.consumeFreshSession("agent:kagura:cove:channel:123")).toBe(false);
    expect(bridge.consumeFreshSession("agent:kagura:cove:group:456")).toBe(false);

    // unbindParent drops the parent claim; a re-bound session of the same key
    // is a new run and claims fresh again (new task thread turn).
    bridge.unbindParent(parentSessionKey);
    expect(bridge.consumeFreshSession(parentSessionKey)).toBe(false);
    bridge.bindParent(parentSessionKey, "parent-run-2", () => {});
    expect(bridge.consumeFreshSession(parentSessionKey)).toBe(true);
  });

  it("keeps the child fresh-claim until parent unbind so hook order cannot starve usage (#551)", async () => {
    const bridge = new CoveAgentRunLifecycleBridge();
    const parentKey = "agent:kagura:cove:direct:1:thread:1";
    const childKey = "agent:kagura:subagent:child-9";
    bridge.bindParent(parentKey, "parent-run", () => {});
    bridge.onSubagentSpawned({ childSessionKey: childKey, runId: "native-run", mode: "run" }, { requesterSessionKey: parentKey });
    expect(bridge.consumeFreshSession(childKey)).toBe(true);
    expect(bridge.consumeFreshSession(childKey)).toBe(false);

    // Second child: lifecycle handler may run BEFORE the usage collector on
    // agent_end. stopChild must not delete the claim — the collector still sees
    // it and reports the one-shot child's usage.
    const childKey2 = "agent:kagura:subagent:child-10";
    bridge.onSubagentSpawned({ childSessionKey: childKey2, runId: "native-run-2", mode: "run" }, { requesterSessionKey: parentKey });
    bridge.onAgentEnd({ runId: "native-run-2", messages: [], success: true }, { runId: "native-run-2", sessionKey: childKey2 });
    // stopChild ran (child finished), but the claim survives for the collector.
    expect(bridge.consumeFreshSession(childKey2)).toBe(true);

    // unbindParent cleans up any unconsumed claims.
    const childKey3 = "agent:kagura:subagent:child-11";
    bridge.onSubagentSpawned({ childSessionKey: childKey3, runId: "native-run-3", mode: "run" }, { requesterSessionKey: parentKey });
    bridge.unbindParent(parentKey);
    expect(bridge.consumeFreshSession(childKey3)).toBe(false);
  });

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
