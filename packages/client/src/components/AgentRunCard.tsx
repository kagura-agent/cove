import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { useMemberStore } from "../stores/useMemberStore";
import { ExecutionTimeline, elapsed, narrativeOpenerText } from "./AgentRunTimeline";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)",
  minHeight: "var(--space-xxl)", display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "nowrap",
};
// The action label may be arbitrarily long; it must ellipsis-truncate instead
// of pushing the time/usage (and the bar's single-line height) onto a new line.
const labelStyle: CSSProperties = { border: 0, background: "transparent", color: "inherit", padding: 0, cursor: "pointer", fontSize: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 };
// Time is a fixed-width fact: never shrink or wrap, so the bar stays one line.
const factStyle: CSSProperties = { flexShrink: 0, whiteSpace: "nowrap" };
const stopStyle: CSSProperties = { border: 0, background: "transparent", color: "var(--danger)", cursor: "pointer", padding: 0, lineHeight: 1.15, fontSize: "10px", fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 };

type StopState = "stopping" | "denied" | "failed" | "already_finished";

/** Active work only; completed evidence remains attached to the agent's message. */
export function AgentRunCard({ channelId, threadId, guildId }: { channelId: string; threadId?: string; guildId?: string | null }) {
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  const [stopState, setStopState] = useState<StopState | undefined>();
  const abortRequestIdRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const members = useMemberStore((s) => guildId ? s.membersByGuildId[guildId] : undefined);
  const agentName = useMemo(() => {
    const run = timeline?.run;
    if (!members || !run) return null;
    const member = Object.values(members).find((m) => m.user.id === run.agent_id);
    return member?.user.username ?? member?.user.global_name ?? null;
  }, [members, timeline?.run?.agent_id]);
  useEffect(() => {
    let alive = true;
    const refresh = () => api.fetchLatestAgentRun(channelId, threadId).then(v => { if (alive) setTimeline(v); }).catch(() => {});
    refresh();
    const update = (run: NonNullable<AgentRunTimeline["run"]>) => { if (run.channel_id === channelId && (!threadId || run.thread_id === threadId)) refresh(); };
    dispatcher.on("AGENT_RUN_UPDATED", update);
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    // Fallback poll: WS events can be missed during gateway reconnect/restart.
    // Once the server marks the run terminal (or a newer active run replaces it)
    // the card unmounts itself; this just guarantees the UI converges.
    const poll = window.setInterval(() => refresh(), 15_000);
    return () => { alive = false; dispatcher.off("AGENT_RUN_UPDATED", update); window.clearInterval(clock); window.clearInterval(poll); };
  }, [channelId, threadId]);
  useEffect(() => {
    const onResult = (data: { request_id: string; channel_id: string; target_user_id: string; status: "aborted" | "denied" | "failed" }) => {
      // The abort is forwarded to the scope the dispatch runs in (thread id for
      // a thread run), so the result event's channel_id may be the thread id
      // even though the card is anchored to the parent channel.
      const matchesScope = data.channel_id === channelId || (threadId != null && data.channel_id === threadId);
      if (!matchesScope || data.request_id !== abortRequestIdRef.current) return;
      if (data.status === "aborted") { setStopState(undefined); abortRequestIdRef.current = undefined; return; }
      setStopState(data.status === "denied" ? "denied" : "failed");
    };
    dispatcher.on("AGENT_ABORT_RESULT", onResult);
    return () => dispatcher.off("AGENT_ABORT_RESULT", onResult);
  }, [channelId]);
  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: "auto" }); }, [open, timeline?.events.length]);
  const run = timeline?.run;
  if (!run || run.status !== "active") return null;
  const name = agentName ? `@${agentName}` : "Agent";
  // Narrative openers ("Preamble") carry their readable text in the event detail;
  // show that content in the bar instead of the bare action label.
  const actionText = narrativeOpenerText(timeline?.events ?? [], run.current_action) ?? run.current_action ?? "working";
  const label = stopState === "stopping" ? "Stopping…" : stopState === "denied" ? "Cannot stop this run" : stopState === "failed" ? "Stop failed" : stopState === "already_finished" ? "Run already finished" : `${name} ${actionText}`;
  const elapsedText = !stopState ? elapsed(run, now) : null;
  const canAbort = !stopState || stopState === "failed";
  async function stop() {
    setStopState("stopping");
    try {
      const result = await api.requestAgentAbort(channelId, run!.agent_id, run!.run_id);
      if (result.status === "requested") abortRequestIdRef.current = result.requestId;
    } catch (error) {
      setStopState((error instanceof Error && error.message.includes("409")) ? "already_finished" : "failed");
    }
  }
  return <div style={{ position: "relative" }}>
    <div style={barStyle} aria-live="polite">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle agent execution timeline" style={labelStyle}>
        {label}
      </button>
      <span style={{ flex: 1 }} />
      {elapsedText && <span style={factStyle}>{elapsedText}</span>}
      {canAbort && <button type="button" style={stopStyle} aria-label={`Stop ${name}`} title={`Stop ${name}`} onClick={stop}>stop</button>}
    </div>
    {open && <section aria-label="Active agent execution timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>
      <ExecutionTimeline events={timeline?.events ?? []} />
      <div ref={bottomRef} />
    </section>}
  </div>;
}
