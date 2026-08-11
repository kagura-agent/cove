import { useEffect, useMemo, useState } from "react";
import type { TaskRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";

function elapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Compact, non-message execution surface for a task thread. Server data is already redacted/bounded. */
export function TaskRunCard({ taskId, assigneeName }: { taskId: string; assigneeName: string | null }) {
  const [timeline, setTimeline] = useState<TaskRunTimeline | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const run = timeline?.run;

  useEffect(() => {
    let alive = true;
    const refresh = () => api.fetchTaskRunTimeline(taskId).then((value) => { if (alive) setTimeline(value); }).catch(() => {});
    refresh();
    const onRun = (value: TaskRunTimeline & { task_id: string }) => { if (value.task_id === taskId) setTimeline(value); };
    dispatcher.on("TASK_RUN_UPDATED", onRun);
    const interval = window.setInterval(refresh, 30_000); // also turns an expired lease into a visible stale state after reconnect
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { alive = false; dispatcher.off("TASK_RUN_UPDATED", onRun); window.clearInterval(interval); window.clearInterval(clock); };
  }, [taskId]);

  const label = useMemo(() => {
    if (!run) return null;
    if (run.status === "active") return `${assigneeName ?? "Agent"} · ${run.current_action ?? "Working"} · ${elapsed(run.started_at)}`;
    return `${assigneeName ?? "Agent"} · ${run.status === "completed" ? "Completed" : run.status === "aborted" ? "Aborted" : run.status === "failed" ? "Failed" : "No longer active"}`;
  // now triggers elapsed display without relying on a stateful formatting helper.
  }, [run, assigneeName, now]);

  if (!run || (run.status !== "active" && timeline?.events.length === 0)) return null;
  return <div style={{ position: "relative", padding: "0 var(--space-md) var(--space-xs)", background: "var(--bg-secondary)" }}>
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      aria-label="Show task run details"
      style={{ border: "1px solid var(--border-subtle)", borderRadius: 999, background: "var(--bg-primary)", color: "var(--text-normal)", padding: "5px 10px", cursor: "pointer", fontSize: "var(--font-size-sm)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >{run.status === "active" ? "🌸 " : "✓ "}{label}</button>
    {expanded && <section aria-label="Task run event timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>
      {timeline?.events.length ? timeline.events.map((event) => <article key={event.event_id} style={{ padding: "var(--space-xs) 0", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ fontWeight: 600, fontSize: "var(--font-size-sm)" }}>{event.action ?? event.type}{event.status ? ` · ${event.status}` : ""}{event.exit_code !== null ? ` · exit ${event.exit_code}` : ""}</div>
        {event.detail && <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: "var(--text-muted)" }}>{event.detail}</pre>}
      </article>) : <span style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>No safe execution detail has arrived yet.</span>}
    </section>}
  </div>;
}
