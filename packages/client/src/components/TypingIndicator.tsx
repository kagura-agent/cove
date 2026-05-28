import React from "react";
import { useTypingStore } from "../stores/useTypingStore";

interface Props {
  channelId: string;
}

export const TypingIndicator: React.FC<Props> = ({ channelId }) => {
  const typingUsers = useTypingStore((s) => s.typingUsers[channelId] ?? []);

  if (typingUsers.length === 0) return null;

  const text =
    typingUsers.length === 1
      ? `${typingUsers[0].username} is typing`
      : typingUsers.length === 2
        ? `${typingUsers[0].username} and ${typingUsers[1].username} are typing`
        : "Several people are typing";

  return (
    <div style={styles.container}>
      <span style={styles.dots}>
        <span style={styles.dot}>●</span>
        <span style={{ ...styles.dot, animationDelay: "0.2s" }}>●</span>
        <span style={{ ...styles.dot, animationDelay: "0.4s" }}>●</span>
      </span>
      <span style={styles.text}>{text}…</span>
      <style>{keyframes}</style>
    </div>
  );
};

const keyframes = `
@keyframes cove-typing-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}
`;

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "4px 16px",
    fontSize: 12,
    color: "#888",
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 20,
  },
  dots: {
    display: "flex",
    gap: 2,
  },
  dot: {
    animation: "cove-typing-bounce 1.2s infinite",
    fontSize: 10,
  },
  text: {
    fontStyle: "italic",
  },
};
