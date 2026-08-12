import type { AgentRun, AgentRunEvent, AgentRunStatus } from "@cove/shared";
import type { CSSProperties } from "react";

export type ExecutionPhase = "Plan & analysis" | "Tools" | "Child agents" | "Changes" | "Final status";

type Summary = { events: number; children: number; files: number };

const phaseForEvent: Record<AgentRunEvent["type"], ExecutionPhase> = {
  run_started: "Plan & analysis", tool_progress: "Plan & analysis", approval_requested: "Plan & analysis",
  tool_started: "Tools", tool_finished: "Tools", tool_failed: "Tools", command_output: "Tools",
  subagent_started: "Child agents", subagent_progress: "Child agents", subagent_finished: "Child agents", subagent_failed: "Child agents",
  patch_summary: "Changes", run_finished: "Final status", run_failed: "Final status", run_aborted: "Final status",
};

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
  if (event.type.endsWith("failed") || event.type === "run_failed" || event.exit_code && event.exit_code !== 0) return { icon: "!", color: "var(--color-danger, #d83c3e)", label: "Failed" };
  if (event.type.endsWith("started") || event.type.endsWith("progress") || event.type === "approval_requested") return { icon: "●", color: "var(--color-brand, #8b5cf6)", label: "In progress" };
  return { icon: "✓", color: "var(--color-success, #22a06b)", label: "Done" };
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
  const groups = new Map<ExecutionPhase, AgentRunEvent[]>();
  for (const event of events) {
    const phase = phaseForEvent[event.type];
    groups.set(phase, [...(groups.get(phase) ?? []), event]);
  }
  if (!events.length) return <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No safe execution detail has arrived yet.</span>;
  return <>{Array.from(groups, ([phase, phaseEvents]) => <section key={phase} aria-label={phase} style={{ padding: "var(--space-xs) 0" }}>
    <h4 style={{ margin: "0 0 2px", color: "var(--text-muted)", fontSize: "var(--font-size-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{phase}</h4>
    {phaseEvents.map((event) => <TimelineRow key={event.event_id} event={event} />)}
  </section>)}</>;
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
