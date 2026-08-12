import type { AgentRun, AgentRunEvent, AgentRunStatus } from "@cove/shared";
import type { CSSProperties } from "react";

export type ExecutionPhase = "Plan & analysis" | "Tools" | "Child agents" | "Changes" | "Final status";

type Summary = { events: number; children: number; files: number };
export type LifecycleOperation = {
  key: string;
  phase: "Tools" | "Child agents";
  events: AgentRunEvent[];
  action: string;
  detail: string | null;
  state: { icon: string; color: string; label: string };
  duration_ms: number | null;
  exit_code: number | null;
  status: string | null;
};

const phaseForEvent: Record<AgentRunEvent["type"], ExecutionPhase> = {
  run_started: "Plan & analysis", tool_progress: "Plan & analysis", approval_requested: "Plan & analysis",
  tool_started: "Tools", tool_finished: "Tools", tool_failed: "Tools", command_output: "Tools",
  subagent_started: "Child agents", subagent_progress: "Child agents", subagent_finished: "Child agents", subagent_failed: "Child agents",
  patch_summary: "Changes", run_finished: "Final status", run_failed: "Final status", run_aborted: "Final status",
};
const phaseOrder: ExecutionPhase[] = ["Plan & analysis", "Tools", "Child agents", "Changes", "Final status"];

const statusStyle: Record<AgentRunStatus, { icon: string; color: string; label: string }> = {
  active: { icon: "●", color: "var(--color-brand, #8b5cf6)", label: "Working" },
  completed: { icon: "✓", color: "var(--color-success, #22a06b)", label: "Completed" },
  failed: { icon: "!", color: "var(--color-danger, #d83c3e)", label: "Failed" },
  aborted: { icon: "−", color: "var(--color-warning, #d97706)", label: "Aborted" },
  stale: { icon: "◌", color: "var(--text-muted)", label: "No longer active" },
};

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function elapsed(run: AgentRun, now?: number): string {
  // updated_at is a stable first-render fallback; active cards refresh this once per second.
  return formatDuration((run.finished_at ?? now ?? run.updated_at) - run.started_at);
}

export function executionSummary(events: AgentRunEvent[]): Summary {
  const childIds = new Set(events.filter((event) => event.type.startsWith("subagent_")).map((event) => event.tool_call_id ?? event.action).filter(Boolean));
  const files = new Set<string>();
  for (const event of events) {
    if (event.type !== "patch_summary" || !event.detail) continue;
    for (const match of event.detail.matchAll(/(?:^|[\s,;])([\w@./-]+\.(?:[a-z0-9]+))(?=$|[\s,;])/gim)) files.add(match[1]);
  }
  return { events: events.length, children: childIds.size, files: files.size };
}

export function conciseAction(event: AgentRunEvent): string {
  if (event.action) return event.action;
  return ({ run_started: "Started", run_finished: "Completed", run_failed: "Failed", run_aborted: "Aborted", tool_started: "Tool started", tool_progress: "Plan update", tool_finished: "Tool finished", tool_failed: "Tool failed", command_output: "Command output", patch_summary: "Changes recorded", approval_requested: "Approval requested", subagent_started: "Child agent started", subagent_progress: "Child agent update", subagent_finished: "Child agent finished", subagent_failed: "Child agent failed" } as Record<AgentRunEvent["type"], string>)[event.type];
}

function eventState(event: AgentRunEvent): { icon: string; color: string; label: string } {
  if (event.type.endsWith("failed") || event.type === "run_failed" || event.exit_code && event.exit_code !== 0 || event.status === "failed") return { icon: "!", color: "var(--color-danger, #d83c3e)", label: "Failed" };
  if (event.type === "run_aborted" || event.status === "aborted") return { icon: "−", color: "var(--color-warning, #d97706)", label: "Aborted" };
  if (["completed", "success", "succeeded", "done", "ok"].includes(event.status ?? "")) return { icon: "✓", color: "var(--color-success, #22a06b)", label: "Done" };
  if (event.type.endsWith("started") || event.type.endsWith("progress") || event.type === "approval_requested") return { icon: "●", color: "var(--color-brand, #8b5cf6)", label: "In progress" };
  return { icon: "✓", color: "var(--color-success, #22a06b)", label: "Done" };
}

function phaseFor(event: AgentRunEvent): ExecutionPhase {
  // Item events use tool_progress for both plan updates and tool lifecycle
  // updates. A call ID is the durable signal that this belongs to a tool.
  if (event.type === "tool_progress" && event.tool_call_id) return "Tools";
  return phaseForEvent[event.type];
}

function lifecyclePhase(event: AgentRunEvent): "Tools" | "Child agents" | null {
  const phase = phaseFor(event);
  return phase === "Tools" || phase === "Child agents" ? phase : null;
}

function isTerminal(event: AgentRunEvent): boolean {
  return event.type === "tool_finished" || event.type === "tool_failed" || event.type === "command_output" || event.type === "subagent_finished" || event.type === "subagent_failed" || ["completed", "success", "succeeded", "done", "ok", "failed", "aborted"].includes(event.status ?? "");
}

function conciseDetail(detail: string | null): string | null {
  if (!detail) return null;
  const flattened = detail.replace(/\s+/g, " ").trim();
  return flattened.length > 140 ? `${flattened.slice(0, 137)}…` : flattened;
}

/**
 * Collapses a single lifecycle into one presentational operation without losing its
 * raw events. IDs may safely correlate non-adjacent updates; no-ID events only
 * join an immediately preceding, matching action while that operation is open.
 */
export function aggregateLifecycleEvents(events: AgentRunEvent[]): LifecycleOperation[] {
  const operations: Array<LifecycleOperation & { lastIndex: number }> = [];
  const identified = new Map<string, LifecycleOperation & { lastIndex: number }>();

  events.forEach((event, index) => {
    const phase = lifecyclePhase(event);
    if (!phase) return;
    // OpenClaw's item/progress callbacks decorate the same call id as `tool:`
    // or `command:`. Normalize those transport prefixes so one exec lifecycle
    // remains one summarized operation.
    const callId = event.tool_call_id?.replace(/^(?:tool|command):/, "") ?? null;
    const identity = callId ? `${phase}:${callId}` : null;
    let operation = identity ? identified.get(identity) : undefined;

    if (!operation && !identity) {
      const previous = operations.at(-1);
      // Fallback deliberately requires adjacency, an explicit matching action,
      // and an unfinished previous operation so separate same-named tools stay separate.
      if (previous && previous.phase === phase && previous.lastIndex === index - 1 && !isTerminal(previous.events.at(-1)!) && !event.type.endsWith("started") && event.action && previous.events.at(-1)?.action === event.action) operation = previous;
    }

    if (!operation) {
      operation = { key: identity ?? `${phase}:${event.event_id}`, phase, events: [], action: conciseAction(event), detail: null, state: eventState(event), duration_ms: null, exit_code: null, status: null, lastIndex: index };
      operations.push(operation);
      if (identity) identified.set(identity, operation);
    }

    operation.events.push(event);
    operation.lastIndex = index;
    // The terminal update has the final state/facts. For in-flight operations,
    // the most recent update remains the best available summary.
    const latest = operation.events.at(-1)!;
    operation.state = eventState(latest);
    operation.status = latest.status;
    operation.duration_ms = latest.duration_ms ?? operation.duration_ms;
    operation.exit_code = latest.exit_code ?? operation.exit_code;
    operation.action = latest.action ?? operation.action;
    // Starts normally carry the concise command; terminal command output often does not.
    operation.detail = conciseDetail(operation.events.find((item) => item.detail)?.detail ?? latest.detail);
  });

  return operations.map(({ lastIndex: _lastIndex, ...operation }) => operation);
}

export function ExecutionChip({ run, events, now }: { run: AgentRun; events: AgentRunEvent[]; now?: number }) {
  const status = statusStyle[run.status];
  const summary = executionSummary(events);
  const parts = [status.label, `${summary.events} event${summary.events === 1 ? "" : "s"}`, elapsed(run, now)];
  if (summary.children) parts.push(`${summary.children} child agent${summary.children === 1 ? "" : "s"}`);
  if (summary.files) parts.push(`${summary.files} file${summary.files === 1 ? "" : "s"}`);
  return <><span aria-hidden="true" style={{ color: status.color, fontWeight: 700 }}>{status.icon}</span><span>{parts.join(" · ")}</span></>;
}

/** Event detail is already server-redacted. Keep it subordinate so execution output never dominates chat. */
export function ExecutionTimeline({ events }: { events: AgentRunEvent[] }) {
  const lifecycle = aggregateLifecycleEvents(events);
  const groups = new Map<ExecutionPhase, Array<AgentRunEvent | LifecycleOperation>>();
  for (const event of events) {
    const phase = phaseFor(event);
    if (phase === "Tools" || phase === "Child agents") continue;
    groups.set(phase, [...(groups.get(phase) ?? []), event]);
  }
  for (const operation of lifecycle) groups.set(operation.phase, [...(groups.get(operation.phase) ?? []), operation]);
  if (!events.length) return <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No safe execution detail has arrived yet.</span>;
  return <>{phaseOrder.flatMap((phase) => {
    const phaseEvents = groups.get(phase);
    if (!phaseEvents?.length) return [];
    return <section key={phase} aria-label={phase} style={{ padding: "var(--space-xs) 0" }}>
      <h4 style={{ margin: "0 0 2px", color: "var(--text-muted)", fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{phase}</h4>
      {phaseEvents.map((item) => "events" in item ? <LifecycleRow key={item.key} operation={item} /> : <TimelineRow key={item.event_id} event={item} />)}
    </section>;
  })}</>;
}

function LifecycleRow({ operation }: { operation: LifecycleOperation }) {
  const facts = [operation.duration_ms !== null ? formatDuration(operation.duration_ms) : null, operation.exit_code !== null ? `exit ${operation.exit_code}` : null].filter(Boolean).join(" · ");
  return <article style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", gap: "var(--space-xs)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
    <span title={operation.state.label} aria-label={operation.state.label} style={{ color: operation.state.color, fontWeight: 700 }}>{operation.state.icon}</span>
    <div style={{ minWidth: 0 }}><div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{operation.action}{operation.detail && <span style={{ fontWeight: 400 }}> · {operation.detail}</span>}{facts && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {facts}</span>}</div>
      <details style={{ marginTop: 2 }}><summary style={{ color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>Lifecycle ({operation.events.length})</summary>
        {operation.events.map((event) => <TimelineRow key={event.event_id} event={event} />)}
      </details>
    </div>
  </article>;
}

function TimelineRow({ event }: { event: AgentRunEvent }) {
  const state = eventState(event);
  const facts = [event.status, event.duration_ms !== null ? formatDuration(event.duration_ms) : null, event.exit_code !== null ? `exit ${event.exit_code}` : null].filter(Boolean).join(" · ");
  return <article style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", gap: "var(--space-xs)", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
    <span title={state.label} aria-label={state.label} style={{ color: state.color, fontWeight: 700 }}>{state.icon}</span>
    <div style={{ minWidth: 0 }}><div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{conciseAction(event)}{facts && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {facts}</span>}</div>
      {event.detail && <details style={{ marginTop: 2 }}><summary style={{ color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>Safe detail</summary><pre style={detailStyle}>{event.detail}</pre></details>}
    </div>
  </article>;
}

const detailStyle: CSSProperties = { margin: "3px 0 0", maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)" };
