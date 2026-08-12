import { useEffect, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";

/** Compact generic execution card used by channels, DMs, and task threads. */
export function AgentRunCard({ channelId, threadId }: { channelId: string; threadId?: string }) {
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null); const [open, setOpen] = useState(false);
  useEffect(() => { let alive = true; const refresh = () => api.fetchLatestAgentRun(channelId, threadId).then(v => alive && setTimeline(v)).catch(() => {}); refresh(); const update = (run: NonNullable<AgentRunTimeline["run"]>) => { if (run.channel_id === channelId && (!threadId || run.thread_id === threadId)) refresh(); }; dispatcher.on("AGENT_RUN_UPDATED", update); return () => { alive = false; dispatcher.off("AGENT_RUN_UPDATED", update); }; }, [channelId, threadId]);
  const run = timeline?.run; if (!run || (run.status !== "active" && !timeline?.events.length)) return null;
  return <div style={{ position: "relative", padding: "0 var(--space-md) var(--space-xs)", background: "var(--bg-secondary)" }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ border: "1px solid var(--border-subtle)", borderRadius: 999, background: "var(--bg-primary)", color: "var(--text-normal)", padding: "5px 10px", cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
      {run.status === "active" ? "🌸 Working" : "✓ " + run.status}{run.current_action ? ` · ${run.current_action}` : ""}
    </button>
    {open && <section aria-label="Agent execution timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", padding: "var(--space-sm)" }}>
      {timeline?.events.map(event => <article key={event.event_id} style={{ padding: "var(--space-xs) 0", borderBottom: "1px solid var(--border-subtle)" }}><b>{event.action ?? event.type}</b>{event.detail && <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{event.detail}</pre>}</article>)}
    </section>}
  </div>;
}
