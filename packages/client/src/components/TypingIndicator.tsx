import { useMemo } from "react";
import { useTypingStore } from "../stores/useTypingStore";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)", fontSize: "var(--font-size-sm)", color: "var(--text-muted)",
  minHeight: "var(--space-xxl)", display: "flex", alignItems: "center", gap: "var(--space-xs)", flexWrap: "nowrap",
};

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

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsersRaw = useTypingStore((s) => s.typingUsers[channelId]);
  const typingUsers = useMemo(() => typingUsersRaw ?? [], [typingUsersRaw]);

  if (typingUsers.length === 0) return <div style={barStyle} />;
  return <div style={barStyle} aria-live="polite">
    <TypingDots />
    {typingUsers.map((user, index) => (
      <span key={user.userId} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xxs)" }}>
        {index > 0 && <span aria-hidden="true">·</span>}
        <span>{user.username} 正在输入…</span>
      </span>
    ))}
  </div>;
}
