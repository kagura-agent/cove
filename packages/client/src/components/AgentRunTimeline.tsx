import type { AgentRun, AgentRunEvent, AgentRunStatus, AgentRunUsage } from "@cove/shared";
import type { CSSProperties } from "react";

export type ExecutionPhase = "Plan & analysis" | "Tools" | "Child agents" | "Changes" | "Final status";

type Summary = { actions: number; children: number; files: number };
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

const NODE_SIZE = 18;
/** Narrative openers carry their own readable text; the action label is redundant noise. */
const NARRATIVE_OPENER_ACTIONS = new Set(["preamble", "introduction", "intro"]);

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
  // Count the collapsed operations the timeline actually renders (one row per
  // tool/child-agent lifecycle, plus any unmerged narrative events), not the raw
  // event stream. Users read "actions", so the chip number should match the
  // visible rows rather than the internal event count.
  const actions = aggregateLifecycleEvents(events).length + events.filter((event) => lifecyclePhase(event) === null).length;
  return { actions, children: childIds.size, files: files.size };
}

export function conciseAction(event: AgentRunEvent): string {
  if (event.action) return event.action;
  return ({ run_started: "Started", run_finished: "Completed", run_failed: "Failed", run_aborted: "Aborted", tool_started: "Tool started", tool_progress: "Plan update", tool_finished: "Tool finished", tool_failed: "Tool failed", command_output: "Command output", patch_summary: "Changes recorded", approval_requested: "Approval requested", subagent_started: "Child agent started", subagent_progress: "Child agent update", subagent_finished: "Child agent finished", subagent_failed: "Child agent failed" } as Record<AgentRunEvent["type"], string>)[event.type];
}

function eventState(event: AgentRunEvent): { icon: string; color: string; label: string } {
  if (event.type.endsWith("failed") || event.type === "run_failed" || event.exit_code && event.exit_code !== 0 || event.status === "failed") return { icon: "!", color: "var(--color-danger, #d83c3e)", label: "Failed" };
  if (event.type === "run_aborted" || event.status === "aborted") return { icon: "−", color: "var(--color-warning, #d97706)", label: "Aborted" };
  if (["completed", "success", "succeeded", "done", "ok"].includes(event.status ?? "")) return { icon: "✓", color: "var(--color-success, #22a06b)", label: "Done" };
  // A non-null duration indicates a terminal event; treat it as done even when
  // the event type suffix would otherwise suggest "in progress".
  if (event.duration_ms != null) return { icon: "✓", color: "var(--color-success, #22a06b)", label: "Done" };
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

function isNarrativeOpener(event: AgentRunEvent): boolean {
  // "Preamble", "Preamble:", etc. — the content itself is the label.
  const normalized = (event.action ?? "").trim().toLowerCase().replace(/[\s:]+$/u, "");
  return NARRATIVE_OPENER_ACTIONS.has(normalized);
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

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function formatUsd(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function usageLabel(usage: AgentRunUsage | null | undefined): string | null {
  if (!usage || usage.calls === 0) return null;
  const tokens = formatTokens(usage.total_tokens);
  if (usage.cost === null) return `${tokens} tok`;
  return `${tokens} tok · ${formatUsd(usage.cost)}`;
}

export function ExecutionChip({ run, events, now, usage }: { run: AgentRun; events: AgentRunEvent[]; now?: number; usage?: AgentRunUsage | null }) {
  const status = statusStyle[run.status];
  const summary = executionSummary(events);
  const parts = [status.label, `${summary.actions} action${summary.actions === 1 ? "" : "s"}`, elapsed(run, now)];
  if (summary.children) parts.push(`${summary.children} child agent${summary.children === 1 ? "" : "s"}`);
  if (summary.files) parts.push(`${summary.files} file${summary.files === 1 ? "" : "s"}`);
  const usageText = usageLabel(usage);
  if (usageText) parts.push(usageText);
  return <><span aria-hidden="true" style={{ color: status.color, fontWeight: 700 }}>{status.icon}</span><span>{parts.join(" · ")}</span></>;
}

/** Event detail is already server-redacted. Keep it subordinate so execution output never dominates chat. */
export function ExecutionTimeline({ events }: { events: AgentRunEvent[] }) {
  const lifecycle = aggregateLifecycleEvents(events);
  const operationForEvent = new Map<string, LifecycleOperation>();
  for (const operation of lifecycle) for (const event of operation.events) operationForEvent.set(event.event_id, operation);
  const renderedOperations = new Set<string>();
  const ordered: Array<AgentRunEvent | LifecycleOperation> = [];

  // The log is an append-only time series. A collapsed lifecycle occupies the
  // position of its first event; categorization must never reorder the sequence.
  for (const event of events) {
    const operation = operationForEvent.get(event.event_id);
    if (!operation) {
      ordered.push(event);
      continue;
    }
    if (!renderedOperations.has(operation.key)) {
      ordered.push(operation);
      renderedOperations.add(operation.key);
    }
  }

  if (!events.length) return <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No execution detail available.</span>;
  return <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
    {ordered.map((item, index) => {
      const first = index === 0;
      const last = index === ordered.length - 1;
      return "events" in item
        ? <LifecycleRow key={item.key} operation={item} first={first} last={last} />
        : <TimelineRow key={item.event_id} event={item} first={first} last={last} />;
    })}
  </ol>;
}

/**
 * A timeline node: the state glyph sits on the vertical spine. The spine is
 * drawn as one continuous line across rows — each row contributes the segment
 * from its top edge to the node center, or from the node center to its bottom
 * edge — so collapsed sequences still read as a connected axis.
 */
function TimelineNode({ state, first, last }: { state: { icon: string; color: string; label: string }; first: boolean; last: boolean }) {
  const spine: CSSProperties = first && last
    ? { display: "none" }
    : {
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        width: 2,
        borderRadius: 1,
        background: "var(--text-muted)",
        opacity: 0.35,
        ...(first ? { top: NODE_SIZE / 2 } : { top: 0 }),
        ...(last ? { height: NODE_SIZE / 2 } : { bottom: 0 }),
      };
  return <div style={{ position: "relative", alignSelf: "stretch", display: "flex", justifyContent: "center" }}>
    <div aria-hidden="true" style={spine} />
    <span title={state.label} aria-label={state.label} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: NODE_SIZE, height: NODE_SIZE, borderRadius: "50%", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", color: state.color, fontWeight: 700, fontSize: 12, lineHeight: 1 }}>{state.icon}</span>
  </div>;
}

function LifecycleRow({ operation, first, last }: { operation: LifecycleOperation; first: boolean; last: boolean }) {
  const facts = [operation.duration_ms !== null ? formatDuration(operation.duration_ms) : null, operation.exit_code !== null ? `exit ${operation.exit_code}` : null].filter(Boolean).join(" · ");
  return <li style={{ display: "grid", gridTemplateColumns: `${NODE_SIZE + 4}px minmax(0, 1fr)`, alignItems: "start", gap: "var(--space-xs)", padding: "4px 0" }}>
    <TimelineNode state={operation.state} first={first} last={last} />
    <div style={{ minWidth: 0 }}><div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{operation.action}{operation.detail && <span style={{ fontWeight: 400 }}> · {operation.detail}</span>}{facts && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {facts}</span>}</div>
      <details style={{ marginTop: 2 }}><summary style={{ color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>Lifecycle ({operation.events.length})</summary>
        <ol style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
          {operation.events.map((event, index) => <TimelineRow key={event.event_id} event={event} first={index === 0} last={index === operation.events.length - 1} />)}
        </ol>
      </details>
    </div>
  </li>;
}

function TimelineRow({ event, first, last }: { event: AgentRunEvent; first: boolean; last: boolean }) {
  const state = eventState(event);
  const facts = [event.status, event.duration_ms !== null ? formatDuration(event.duration_ms) : null, event.exit_code !== null ? `exit ${event.exit_code}` : null].filter(Boolean).join(" · ");
  // Narrative events (preamble, plan updates, run status, child-agent lifecycle)
  // carry human-meaningful text that should be visible at a glance, not hidden
  // behind a disclosure. Tool output stays collapsed so execution dumps never
  // dominate the chat surface.
  const inlineDetail = phaseFor(event) !== "Tools";
  // Narrative openers ("Preamble") already read as full sentences; the content
  // is the label, so render it directly instead of a heading + body pair.
  const opener = isNarrativeOpener(event) && !!event.detail;
  return <li style={{ display: "grid", gridTemplateColumns: `${NODE_SIZE + 4}px minmax(0, 1fr)`, alignItems: "start", gap: "var(--space-xs)", padding: "4px 0" }}>
    <TimelineNode state={state} first={first} last={last} />
    <div style={{ minWidth: 0 }}>{opener
      ? <div style={{ fontSize: "var(--font-size-sm)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{conciseDetail(event.detail)}</div>
      : <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{conciseAction(event)}{facts && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {facts}</span>}</div>}
      {event.detail && !opener && (inlineDetail
        ? <div style={{ color: "var(--text-muted)", fontSize: "var(--font-size-xs)", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 2 }}>{conciseDetail(event.detail)}</div>
        : <details style={{ marginTop: 2 }}><summary style={{ color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>Safe detail</summary><pre style={detailStyle}>{event.detail}</pre></details>)}
    </div>
  </li>;
}

const detailStyle: CSSProperties = { margin: "3px 0 0", maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)" };
