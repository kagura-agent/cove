import type { AgentRunEventType } from "@cove/shared";
import type { CoveRestClient } from "./rest-client.js";

/**
 * Bridges OpenClaw's native subagent hooks to the Cove run that owns the
 * requester session. OpenClaw's typed plugin API registers these lifecycle
 * hooks through `api.on(name, handler)`, not `api.registerHook`. At runtime,
 * `subagent_spawned` supplies childSessionKey/runId and its second context
 * supplies requesterSessionKey. `subagent_ended` identifies a session as
 * targetSessionKey, but the native agent harness's `agent_end` is the reliable
 * per-run terminal signal for one-shot child work: it carries the same runId
 * and child sessionKey in its context. ReplyOptions onItemEvent has neither a
 * requester nor child session key.
 * There is no native child-progress hook. Child runs are therefore not created
 * here: the parent ledger stores stable child-session evidence and only reports
 * liveness observed from an un-ended native lifecycle (never invented work).
 */
type RunEvent = { type: AgentRunEventType; tool_call_id?: string; action?: string; detail?: string; status?: string };
type Reporter = (event: RunEvent) => Promise<unknown> | unknown;
type NativeSpawned = { childSessionKey: string; runId: string; label?: string; mode: "run" | "session" };
type NativeEnded = { targetSessionKey: string; targetKind: "subagent" | "acp"; reason: string; outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted"; error?: string };
type NativeAgentEnded = { runId?: string; messages: unknown[]; success: boolean; error?: string; durationMs?: number };
type NativeContext = { runId?: string; sessionKey?: string; requesterSessionKey?: string; childSessionKey?: string };

type UsageRest = Pick<CoveRestClient, "recordRunUsage">;

type Parent = { runId: string; report: Reporter; children: Set<string>; queue: Promise<void>; rest?: UsageRest };
type Child = { parentSessionKey: string; runId: string; label: string; timer?: ReturnType<typeof setInterval>; finished?: boolean };

const HEARTBEAT_MS = 25_000;

/**
 * True for session kinds Cove creates fresh per run: task-thread sessions
 * (`agent:<id>:cove:direct:<threadId>:thread:<threadId>`) are new channels per
 * task, so their first observed turn has no pre-existing history; subagent
 * child sessions are always UUID-new. Persistent channel/group sessions stay
 * out of the fresh set — their first observation after a plugin upgrade must
 * keep establishing a silent baseline to avoid double counting history (#551).
 */
function isFreshCoveSessionKey(sessionKey: string): boolean {
  return sessionKey.includes(":thread:");
}

export class CoveAgentRunLifecycleBridge {
  private parents = new Map<string, Parent>();
  private children = new Map<string, Child>();
  private waiters = new Map<string, Set<() => void>>();
  /** Session keys created by a Cove run in this process (bindParent at dispatch
   * start, subagent spawn) whose first agent_end has not been consumed yet. The
   * usage collector consumes these claims so a brand-new session's first turn
   * is reported from a zero baseline instead of being silently dropped (#551).
   * Entries are consumed by the collector on first observation or removed on
   * unbind/stop, so the set never grows with historical sessions. */
  private freshSessions = new Set<string>();

  bindParent(sessionKey: string, runId: string, report: Reporter, rest?: UsageRest): void {
    // Only thread sessions (new channels per task) are claimed fresh: their
    // first turn has no history. Persistent channel/group sessions are not
    // fresh even though this process dispatches them. (#551)
    if (isFreshCoveSessionKey(sessionKey)) this.freshSessions.add(sessionKey);
    this.parents.set(sessionKey, { runId, report, children: new Set(), queue: Promise.resolve(), rest });
  }

  unbindParent(sessionKey: string): void {
    const parent = this.parents.get(sessionKey);
    if (!parent) return;
    // Snapshot before stopChild mutates parent.children.
    const childKeys = [...parent.children];
    for (const childKey of childKeys) this.stopChild(childKey);
    // Children entries are intentionally kept alive until parent unbind (see
    // stopChild) so the usage collector can resolve parentSessionFor during a
    // child's agent_end regardless of hook ordering. Clean them all up here.
    for (const childKey of childKeys) {
      this.children.delete(childKey);
      this.freshSessions.delete(childKey);
    }
    this.parents.delete(sessionKey);
    this.freshSessions.delete(sessionKey);
    this.resolveWaiters(sessionKey);
  }

  /** Consumes and returns the fresh-claim for a session. True exactly once per
   * session when the session was created by a Cove run in this process and no
   * agent_end has been observed yet — its first observation is the first turn,
   * so the collector must report the full totals rather than a silent baseline. */
  consumeFreshSession(sessionKey: string): boolean {
    return this.freshSessions.delete(sessionKey);
  }

  onSubagentSpawned(event: NativeSpawned, context: NativeContext): void {
    const parentKey = context.requesterSessionKey;
    const parent = parentKey ? this.parents.get(parentKey) : undefined;
    if (!parent || this.children.has(event.childSessionKey)) return;
    const label = event.label || "Subagent";
    parent.children.add(event.childSessionKey);
    // Subagent child session keys are always fresh (UUID per spawn) — one-shot
    // children fire a single agent_end whose whole usage must be reported.
    this.freshSessions.add(event.childSessionKey);
    this.children.set(event.childSessionKey, { parentSessionKey: parentKey!, runId: event.runId, label });
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
    const succeeded = event.outcome === "ok";
    this.finishChild(event.targetSessionKey, succeeded, event.outcome ?? (succeeded ? "completed" : "failed"), event.error ?? `Child ended: ${event.reason}${event.outcome ? ` (${event.outcome})` : ""}`);
  }

  onAgentEnd(event: NativeAgentEnded, context: NativeContext): void {
    // OpenClaw's agent_end event is emitted for every completed child run. Match
    // both immutable identifiers so a later turn in a persistent child session
    // cannot close the original spawned run.
    const childKey = context.sessionKey;
    const child = childKey ? this.children.get(childKey) : undefined;
    const runId = event.runId ?? context.runId;
    if (!child || !runId || child.runId !== runId) return;
    const status = event.success ? "completed" : "failed";
    this.finishChild(childKey!, event.success, status, event.error ?? (event.success ? "Child run completed" : "Child run failed"));
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

  /** Cove run id owning this session, or null when the session is not a live Cove turn. */
  runForSession(sessionKey: string): string | null {
    return this.parents.get(sessionKey)?.runId ?? null;
  }

  /** Parent Cove session key for a child (subagent) session, when tracked. */
  parentSessionFor(sessionKey: string): string | null {
    return this.children.get(sessionKey)?.parentSessionKey ?? null;
  }

  /** REST client registered with the owning run (for usage writes), when known. */
  restForSession(sessionKey: string): UsageRest | null {
    return this.parents.get(sessionKey)?.rest ?? null;
  }

  private report(parent: Parent, event: RunEvent): void {
    // The dispatch reporter already serializes HTTP writes. Invoke it now so a
    // native spawn is immediately visible locally, while retaining a settled
    // promise for cleanup and preventing hook failures from escaping.
    parent.queue = Promise.resolve(parent.report(event)).then(() => undefined).catch(() => undefined);
  }

  private finishChild(childKey: string, succeeded: boolean, status: string, detail: string): void {
    const child = this.children.get(childKey);
    // The child entry stays in the map until parent unbind so the usage
    // collector can still resolve parentSessionFor on the same agent_end; the
    // finished flag prevents duplicate terminal reports from repeated hooks.
    if (!child || child.finished) return;
    child.finished = true;
    const parent = this.parents.get(child.parentSessionKey);
    this.stopChild(childKey);
    if (!parent) return;
    this.report(parent, {
      type: succeeded ? "subagent_finished" : "subagent_failed",
      tool_call_id: childKey,
      action: child.label,
      detail,
      status,
    });
  }

  private stopChild(childKey: string): void {
    const child = this.children.get(childKey); if (!child) return;
    if (child.timer) clearInterval(child.timer);
    // Deliberately NOT deleting the children entry or fresh claim here. agent_end
    // handlers run in registration order (lifecycle finish first, usage
    // collector second); the collector resolves the parent via parentSessionFor
    // which reads this map, so the entry must outlive both handlers. Entries are
    // removed on parent unbind (#551).
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
export function registerCoveAgentRunLifecycleHooks(api: { on?: (name: "subagent_spawned" | "subagent_ended" | "agent_end", handler: (event: any, context: any) => void | Promise<void>) => void }, bridge = coveAgentRunLifecycleBridge): void {
  if (typeof api.on !== "function") return;
  api.on("subagent_spawned", (event: NativeSpawned, context: NativeContext) => bridge.onSubagentSpawned(event, context));
  api.on("subagent_ended", (event: NativeEnded, context: NativeContext) => bridge.onSubagentEnded(event, context));
  api.on("agent_end", (event: NativeAgentEnded, context: NativeContext) => bridge.onAgentEnd(event, context));
}
