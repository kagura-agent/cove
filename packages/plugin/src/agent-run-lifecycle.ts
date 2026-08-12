import type { AgentRunEventType } from "@cove/shared";

/**
 * Bridges OpenClaw's native subagent hooks to the Cove run that owns the
 * requester session. OpenClaw's typed plugin API registers these lifecycle
 * hooks through `api.on(name, handler)`, not `api.registerHook`. At runtime,
 * `subagent_spawned` supplies childSessionKey/runId and its second context
 * supplies requesterSessionKey; `subagent_ended` identifies that child as
 * targetSessionKey (and supplies the same context when available). ReplyOptions
 * onItemEvent has neither a requester nor child session key.
 * There is no native child-progress hook. Child runs are therefore not created
 * here: the parent ledger stores stable child-session evidence and only reports
 * liveness observed from an un-ended native lifecycle (never invented work).
 */
type RunEvent = { type: AgentRunEventType; tool_call_id?: string; action?: string; detail?: string; status?: string };
type Reporter = (event: RunEvent) => Promise<unknown> | unknown;
type NativeSpawned = { childSessionKey: string; runId: string; label?: string; mode: "run" | "session" };
type NativeEnded = { targetSessionKey: string; targetKind: "subagent" | "acp"; reason: string; outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted"; error?: string };
type NativeContext = { requesterSessionKey?: string; childSessionKey?: string };

type Parent = { runId: string; report: Reporter; children: Set<string>; queue: Promise<void> };
type Child = { parentSessionKey: string; label: string; timer?: ReturnType<typeof setInterval> };

const HEARTBEAT_MS = 25_000;

export class CoveAgentRunLifecycleBridge {
  private parents = new Map<string, Parent>();
  private children = new Map<string, Child>();
  private waiters = new Map<string, Set<() => void>>();

  bindParent(sessionKey: string, runId: string, report: Reporter): void {
    this.parents.set(sessionKey, { runId, report, children: new Set(), queue: Promise.resolve() });
  }

  unbindParent(sessionKey: string): void {
    const parent = this.parents.get(sessionKey);
    if (!parent) return;
    for (const childKey of parent.children) this.stopChild(childKey);
    this.parents.delete(sessionKey);
    this.resolveWaiters(sessionKey);
  }

  onSubagentSpawned(event: NativeSpawned, context: NativeContext): void {
    const parentKey = context.requesterSessionKey;
    const parent = parentKey ? this.parents.get(parentKey) : undefined;
    if (!parent || this.children.has(event.childSessionKey)) return;
    const label = event.label || "Subagent";
    parent.children.add(event.childSessionKey);
    this.children.set(event.childSessionKey, { parentSessionKey: parentKey!, label });
    // `runId` is a native child run id; the stable session key is used in Cove
    // evidence because Cove cannot create/own that OpenClaw child run.
    this.report(parent, { type: "subagent_started", tool_call_id: event.childSessionKey, action: label, detail: `OpenClaw child run ${event.runId} started`, status: "running" });
    this.report(parent, { type: "subagent_progress", tool_call_id: event.childSessionKey, action: label, detail: "Child session is active", status: "running" });
    const child = this.children.get(event.childSessionKey)!;
    child.timer = setInterval(() => {
      const currentParent = this.parents.get(child.parentSessionKey);
      if (currentParent?.children.has(event.childSessionKey)) {
        // This is liveness observed from an un-ended OpenClaw child lifecycle,
        // not invented work detail.
        this.report(currentParent, { type: "subagent_progress", tool_call_id: event.childSessionKey, action: child.label, detail: "Child session remains active (awaiting OpenClaw terminal hook)", status: "running" });
      }
    }, HEARTBEAT_MS);
  }

  onSubagentEnded(event: NativeEnded, _context?: NativeContext): void {
    if (event.targetKind !== "subagent") return;
    const child = this.children.get(event.targetSessionKey);
    if (!child) return;
    const parent = this.parents.get(child.parentSessionKey);
    this.stopChild(event.targetSessionKey);
    if (!parent) return;
    const succeeded = event.outcome === "ok";
    this.report(parent, {
      type: succeeded ? "subagent_finished" : "subagent_failed",
      tool_call_id: event.targetSessionKey,
      action: child.label,
      detail: event.error ?? `Child ended: ${event.reason}${event.outcome ? ` (${event.outcome})` : ""}`,
      status: event.outcome ?? (succeeded ? "completed" : "failed"),
    });
  }

  async waitForChildren(sessionKey: string, abortSignal?: AbortSignal): Promise<void> {
    const parent = this.parents.get(sessionKey);
    if (!parent?.children.size || abortSignal?.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => { abortSignal?.removeEventListener("abort", done); resolve(); };
      const set = this.waiters.get(sessionKey) ?? new Set<() => void>();
      set.add(done); this.waiters.set(sessionKey, set);
      abortSignal?.addEventListener("abort", done, { once: true });
      if (!this.parents.get(sessionKey)?.children.size) done();
    });
    // The terminal hook queues its event before it releases waiters. Drain it
    // so dispatch cannot append run_finished ahead of subagent_finished/failed.
    await parent.queue;
  }

  private report(parent: Parent, event: RunEvent): void {
    // The dispatch reporter already serializes HTTP writes. Invoke it now so a
    // native spawn is immediately visible locally, while retaining a settled
    // promise for cleanup and preventing hook failures from escaping.
    parent.queue = Promise.resolve(parent.report(event)).then(() => undefined).catch(() => undefined);
  }

  private stopChild(childKey: string): void {
    const child = this.children.get(childKey); if (!child) return;
    if (child.timer) clearInterval(child.timer);
    this.children.delete(childKey);
    const parent = this.parents.get(child.parentSessionKey);
    parent?.children.delete(childKey);
    if (!parent?.children.size) this.resolveWaiters(child.parentSessionKey);
  }

  private resolveWaiters(sessionKey: string): void {
    const waiters = this.waiters.get(sessionKey); this.waiters.delete(sessionKey);
    waiters?.forEach(resolve => resolve());
  }
}

export const coveAgentRunLifecycleBridge = new CoveAgentRunLifecycleBridge();

/**
 * Register the documented OpenClaw typed lifecycle hooks.
 *
 * OpenClaw's plugin loader exposes `api.on`, and `sessions_spawn` calls its
 * global hook runner with `(event, { requesterSessionKey, childSessionKey,
 * runId })`. Registering a non-existent `registerHook` API silently skipped
 * both handlers in production, which left Cove with only run_started/finished.
 */
export function registerCoveAgentRunLifecycleHooks(api: { on?: (name: "subagent_spawned" | "subagent_ended", handler: (event: any, context: any) => void | Promise<void>) => void }, bridge = coveAgentRunLifecycleBridge): void {
  if (typeof api.on !== "function") return;
  api.on("subagent_spawned", (event: NativeSpawned, context: NativeContext) => bridge.onSubagentSpawned(event, context));
  api.on("subagent_ended", (event: NativeEnded, context: NativeContext) => bridge.onSubagentEnded(event, context));
}
