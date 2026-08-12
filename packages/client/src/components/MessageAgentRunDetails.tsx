import { useCallback, useEffect, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { ExecutionChip, ExecutionTimeline } from "./AgentRunTimeline";

/** Lazy, message-scoped evidence viewer. No per-message request is made until opened. */
export function MessageAgentRunDetails({ channelId, messageId }: { channelId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  const load = useCallback(() => api.fetchMessageAgentRun(channelId, messageId).then((value) => { setTimeline(value); setChecked(true); }).catch(() => setChecked(true)), [channelId, messageId]);
  useEffect(() => {
    const onUpdate = (run: NonNullable<AgentRunTimeline["run"]>) => {
      if (run.assistant_message_id === messageId && (run.thread_id === channelId || (!run.thread_id && run.channel_id === channelId))) load();
    };
    dispatcher.on("AGENT_RUN_UPDATED", onUpdate);
    return () => dispatcher.off("AGENT_RUN_UPDATED", onUpdate);
  }, [channelId, messageId, load]);
  useEffect(() => {
    if (timeline?.run?.status !== "active") return;
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, [timeline?.run?.status]);
  const toggle = () => { const next = !open; setOpen(next); if (next && !checked) load(); };
  // Before an associated update arrives, bots offer a lazy check rather than
  // issuing one request for every historical message in the scrollback.
  if (checked && !timeline?.run) return null;
  const run = timeline?.run;
  return <div style={{ marginTop: "var(--space-xs)" }}>
    <button type="button" onClick={toggle} aria-expanded={open} aria-label="Show execution details" style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border-subtle)", borderRadius: 999, background: "transparent", color: "var(--text-muted)", padding: "3px 8px", cursor: "pointer", fontSize: "var(--font-size-xs)", maxWidth: "100%" }}>
      {run ? <ExecutionChip run={run} events={timeline?.events ?? []} now={now} /> : <>◌ <span>Execution details</span></>}
    </button>
    {open && run && <section aria-label="Agent execution details" style={{ marginTop: 4, maxHeight: 340, overflow: "auto", borderLeft: "2px solid var(--border-subtle)", paddingLeft: "var(--space-sm)" }}>
      <ExecutionTimeline events={timeline?.events ?? []} />
    </section>}
  </div>;
}
