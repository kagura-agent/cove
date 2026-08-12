import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRunTimeline } from "@cove/shared";
import * as api from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import { useMemberStore } from "../stores/useMemberStore";
import { ExecutionTimeline, elapsed } from "./AgentRunTimeline";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)",
  minHeight: "var(--space-xxl)", display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap",
};
const stopStyle: CSSProperties = { border: 0, background: "transparent", color: "var(--danger)", cursor: "pointer", padding: 0, lineHeight: 1.15, fontSize: "10px", fontWeight: 500 };

const dotKeyframes = `
@keyframes agentRunDot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}`;

function TypingDots() {
  return <><style>{dotKeyframes}</style><span aria-hidden="true" style={{ display: "inline-flex", gap: "var(--space-xxs)" }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: "var(--space-xs)", height: "var(--space-xs)", borderRadius: "50%", background: "currentColor", display: "inline-block", animation: "agentRunDot 1.4s infinite ease-in-out", animationDelay: `${i * 0.2}s` }} />)}
  </span></>;
}

type StopState = "stopping" | "denied" | "failed" | "already_finished";

/** Active work only; completed evidence remains attached to the agent's message. */
export function AgentRunCard({ channelId, threadId, guildId }: { channelId: string; threadId?: string; guildId?: string | null }) {
  const [timeline, setTimeline] = useState<AgentRunTimeline | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState<number | undefined>();
  const [stopState, setStopState] = useState<StopState | undefined>();
  const abortRequestIdRef = useRef<string | undefined>(undefined);
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
    return () => { alive = false; dispatcher.off("AGENT_RUN_UPDATED", update); window.clearInterval(clock); };
  }, [channelId, threadId]);
  useEffect(() => {
    const onResult = (data: { request_id: string; channel_id: string; target_user_id: string; status: "aborted" | "denied" | "failed" }) => {
      if (data.channel_id !== channelId || data.request_id !== abortRequestIdRef.current) return;
      if (data.status === "aborted") { setStopState(undefined); abortRequestIdRef.current = undefined; return; }
      setStopState(data.status === "denied" ? "denied" : "failed");
    };
    dispatcher.on("AGENT_ABORT_RESULT", onResult);
    return () => dispatcher.off("AGENT_ABORT_RESULT", onResult);
  }, [channelId]);
  const run = timeline?.run;
  if (!run || run.status !== "active") return null;
  const name = agentName ? `@${agentName}` : "Agent";
  const label = stopState === "stopping" ? "正在停止…" : stopState === "denied" ? "无权停止此运行" : stopState === "failed" ? "停止失败" : stopState === "already_finished" ? "运行已结束" : `${name} ${run.current_action ?? "working"} · ${elapsed(run, now)}`;
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
      <TypingDots />
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle agent execution timeline" style={{ border: 0, background: "transparent", color: "inherit", padding: 0, cursor: "pointer", fontSize: "inherit" }}>
        {label}
      </button>
      {canAbort && <button type="button" style={stopStyle} disabled={false} aria-label={`停止 ${name} 的运行`} title={`停止 ${name} 的运行`} onClick={stop}>停止</button>}
    </div>
    {open && <section aria-label="Active agent execution timeline" style={{ position: "absolute", zIndex: 20, bottom: "calc(100% + 4px)", left: "var(--space-md)", right: "var(--space-md)", maxHeight: 320, overflow: "auto", background: "var(--bg-floating)", border: "1px solid var(--border-subtle)", borderRadius: "var(--space-sm)", boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: "var(--space-sm)" }}>
      <ExecutionTimeline events={timeline?.events ?? []} />
    </section>}
  </div>;
}
