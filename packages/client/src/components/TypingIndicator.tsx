import { useMemo } from "react";
import { useTypingStore } from "../stores/useTypingStore";
import type { CSSProperties } from "react";

const barStyle: CSSProperties = {
  padding: "var(--space-xs) var(--content-pad)",
  fontSize: "var(--font-size-sm)",
  color: "var(--text-muted)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const dotKeyframes = `
@keyframes typingDot {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}`;

function TypingDots() {
  return (
    <>
      <style>{dotKeyframes}</style>
      <span style={{ display: "inline-flex", gap: "var(--space-xxs)", marginRight: "var(--space-xs)" }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: "var(--space-xs)", height: "var(--space-xs)", borderRadius: "50%", background: "currentColor",
            display: "inline-block", animation: "typingDot 1.4s infinite ease-in-out",
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </span>
    </>
  );
}

export function TypingIndicator({ channelId }: { channelId: string }) {
  const typingUsersRaw = useTypingStore((s) => s.typingUsers[channelId]);
  const typingUsers = useMemo(() => typingUsersRaw ?? [], [typingUsersRaw]);

  const typingLabel = typingUsers.length === 1
    ? `${typingUsers[0].username} is typing`
    : typingUsers.length === 2
    ? `${typingUsers[0].username} and ${typingUsers[1].username} are typing`
    : typingUsers.length > 2
    ? "Several people are typing"
    : null;

  if (!typingLabel) return null;

  return (
    <div style={barStyle}>
      <TypingDots />{typingLabel}…
    </div>
  );
}
