import { useEffect, useMemo, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { useMemberStore } from "../stores/useMemberStore";
import { ExecutionTimeline, elapsed } from "./AgentRunTimeline";

/** Active work only; completed evidence remains attached to the agent's message. */
export function AgentRunCard({ channelId, threadId }: { channelId: string; threadId?: string }) {
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  const agentName = useMemberStore((s) => {
    const members = s.membersByGuildId[channelId];
    const run = timeline?.run;
    if (!members || !run) return null;
    const member = Object.values(members).find((m) => m.user.id === run.agent_id);
    return member?.user.username ?? member?.user.global_name ?? null;
  });
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
  const name = agentName ? `@${agentName}` : "Agent";
  return <div style={{ position: "relative", padding: "var(--space-xs) var(--content-pad)" }}>
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Show active agent execution" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", border: 0, background: "transparent", color: "var(--text-muted)", padding: 0, cursor: "pointer", fontSize: "var(--font-size-sm)" }}>
      <span aria-hidden="true" style={{ color: "var(--color-brand, #8b5cf6)" }}>●</span> {name} {run.current_action ?? "working"} · {elapsed(run, now)}
    </button>
    {open && <section aria-label="Active agent execution timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>
      <ExecutionTimeline events={timeline?.events ?? []} />
    </section>}
  </div>;
}
