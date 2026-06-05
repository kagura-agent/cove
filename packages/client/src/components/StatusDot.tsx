import type { CSSProperties } from "react";

interface StatusDotProps {
  online: boolean;
  borderColor?: string;
}

export function StatusDot({ online, borderColor = "var(--bg-secondary)" }: StatusDotProps) {
  const style: CSSProperties = {
    width: "var(--status-dot-size)", height: "var(--status-dot-size)", borderRadius: "50%",
    background: online ? "var(--status-online)" : "var(--status-offline)",
    border: `2px solid ${borderColor}`,
    position: "absolute", bottom: -1, right: -1,
  };
  return <div style={style} />;
}
