import { useEffect, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";

/** Lazy, message-scoped evidence viewer. No per-message request is made until opened. */
export function MessageAgentRunDetails({ channelId, messageId }: { channelId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [checked, setChecked] = useState(false);
  const load = () => api.fetchMessageAgentRun(channelId, messageId).then((value) => { setTimeline(value); setChecked(true); }).catch(() => setChecked(true));
  useEffect(() => {
    const onUpdate = (run: NonNullable<AgentRunTimeline["run"]>) => {
      if (run.assistant_message_id === messageId && (run.thread_id === channelId || (!run.thread_id && run.channel_id === channelId))) load();
    };
    dispatcher.on("AGENT_RUN_UPDATED", onUpdate);
    return () => dispatcher.off("AGENT_RUN_UPDATED", onUpdate);
  }, [channelId, messageId]);
  const toggle = () => { const next = !open; setOpen(next); if (next && !checked) load(); };
  // Before an associated update arrives, bots offer a lazy check rather than
  // issuing one request for every historical message in the scrollback.
  if (checked && !timeline?.run) return null;
  return <div style={{ marginTop: "var(--space-xs)" }}>
    <button type="button" onClick={toggle} aria-expanded={open} style={{ border: "1px solid var(--border-subtle)", borderRadius: 999, background: "transparent", color: "var(--text-muted)", padding: "3px 8px", cursor: "pointer", fontSize: "var(--font-size-xs)" }}>
      {timeline?.run?.status === "active" ? "🌸 Execution in progress" : "Execution details"}
    </button>
    {open && timeline?.run && <section aria-label="Agent execution details" style={{ marginTop: 4, maxHeight: 260, overflow: "auto", borderLeft: "2px solid var(--border-subtle)", paddingLeft: "var(--space-sm)" }}>
      {timeline.events.map((event) => <article key={event.event_id} style={{ padding: "var(--space-xs) 0", borderBottom: "1px solid var(--border-subtle)" }}><b>{event.action ?? event.type}</b>{event.detail && <pre style={{ margin: "3px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 }}>{event.detail}</pre>}</article>)}
    </section>}
  </div>;
}
