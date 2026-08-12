import { useEffect, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { ExecutionTimeline, elapsed } from "./AgentRunTimeline";

/** Active work only; completed evidence remains attached to the agent's message. */
export function AgentRunCard({ channelId, threadId }: { channelId: string; threadId?: string }) {
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  useEffect(() => {
    let alive = true;
    const refresh = () => api.fetchLatestAgentRun(channelId, threadId).then(v => { if (alive) setTimeline(v); }).catch(() => {});
    refresh();
    const update = (run: NonNullable<AgentRunTimeline["run"]>) => { if (run.channel_id === channelId && (!threadId || run.thread_id === threadId)) refresh(); };
    dispatcher.on("AGENT_RUN_UPDATED", update);
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { alive = false; dispatcher.off("AGENT_RUN_UPDATED", update); window.clearInterval(clock); };
  }, [channelId, threadId]);
  const run = timeline?.run;
  if (!run || run.status !== "active") return null;
  return <div style={{ position: "relative", padding: "0 var(--space-md) var(--space-xs)", background: "var(--bg-secondary)" }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Show active agent execution" style={{ border: "1px solid var(--border-subtle)", borderRadius: 999, background: "var(--bg-primary)", color: "var(--text-normal)", padding: "5px 10px", cursor: "pointer", fontSize: "var(--font-size-sm)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ color: "var(--color-brand, #8b5cf6)" }}>●</span> Agent · {run.current_action ?? "Working"} · {elapsed(run, now)} <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    {open && <section aria-label="Active agent execution timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>
      <ExecutionTimeline events={timeline?.events ?? []} />
    </section>}
  </div>;
}
