import { useEffect, useMemo, useState } from "react";
import { useTypingStore } from "../stores/useTypingStore";
import { requestAgentAbort } from "../lib/api";
import { dispatcher } from "../lib/gateway-dispatcher";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)",
  minHeight: "var(--space-xxl)", display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "wrap",
};
const stopStyle: CSSProperties = { border: "1px solid color-mix(in srgb, var(--danger) 65%, transparent)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--danger)", cursor: "pointer", padding: "1px 5px", lineHeight: 1.2, fontSize: "11px", fontWeight: 500 };

const dotKeyframes = `
@keyframes typingDot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}`;

function TypingDots() {
  return <><style>{dotKeyframes}</style><span aria-hidden="true" style={{ display: "inline-flex", gap: "var(--space-xxs)", marginRight: "var(--space-xs)" }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: "var(--space-xs)", height: "var(--space-xs)", borderRadius: "50%", background: "currentColor", display: "inline-block", animation: "typingDot 1.4s infinite ease-in-out", animationDelay: `${i * 0.2}s` }} />)}
  </span></>;
}

type StopState = "stopping" | "denied" | "failed" | "already_finished";

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsersRaw = useTypingStore((s) => s.typingUsers[channelId]);
  const clearTyping = useTypingStore((s) => s.clearTyping);
  const typingUsers = useMemo(() => typingUsersRaw ?? [], [typingUsersRaw]);
  const [states, setStates] = useState<Record<string, StopState>>({});
  const [requests, setRequests] = useState<Record<string, string>>({});

  useEffect(() => {
    const onResult = (data: { request_id: string; channel_id: string; target_user_id: string; status: "aborted" | "denied" | "failed" }) => {
      if (data.channel_id !== channelId) return;
      const runId = Object.entries(requests).find(([, requestId]) => requestId === data.request_id)?.[0];
      if (!runId) return;
      if (data.status === "aborted") {
        clearTyping(channelId, data.target_user_id);
        setStates(({ [runId]: _, ...rest }) => rest);
        return;
      }
      const stopState: Extract<StopState, "denied" | "failed"> = data.status === "denied" ? "denied" : "failed";
      setStates((current) => ({ ...current, [runId]: stopState }));
    };
    dispatcher.on("AGENT_ABORT_RESULT", onResult);
    return () => dispatcher.off("AGENT_ABORT_RESULT", onResult);
  }, [channelId, clearTyping, requests]);

  async function stop(userId: string, runId: string) {
    setStates((current) => ({ ...current, [runId]: "stopping" }));
    try {
      const result = await requestAgentAbort(channelId, userId, runId);
      if (result.status === "requested") setRequests((current) => ({ ...current, [runId]: result.requestId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStates((current) => ({ ...current, [runId]: message.includes("409") ? "already_finished" : "failed" }));
    }
  }

  if (typingUsers.length === 0) return <div style={barStyle} />;
  return <div style={barStyle} aria-live="polite">
    <TypingDots />
    {typingUsers.map((user, index) => {
      const state = user.runId ? states[user.runId] : undefined;
      const label = state === "stopping" ? "正在停止…" : state === "denied" ? "无权停止此运行" : state === "failed" ? "停止失败" : state === "already_finished" ? "运行已结束" : `${user.username} 正在输入…`;
      const canAbort = Boolean(user.abortable && user.runId);
      return <span key={user.userId} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xxs)" }}>
        {index > 0 && <span aria-hidden="true">·</span>}
        <span>{label}</span>
        {canAbort && <button type="button" style={stopStyle} disabled={state === "stopping"} aria-label={`停止 ${user.username} 的运行`} title={`停止 ${user.username} 的运行`} onClick={() => stop(user.userId, user.runId!)}>⏹ 停止</button>}
      </span>;
    })}
  </div>;
}
