import type { CSSProperties } from "react";

export function ThreadIcon({ size = 16, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: "inline-flex", flexShrink: 0, verticalAlign: "middle", ...style }}>
      <path d="M12 2C6.48 2 2 5.58 2 10c0 2.24 1.12 4.27 2.94 5.72L4 20l4.47-2.24C9.58 18.06 10.77 18.2 12 18.2c5.52 0 10-3.58 10-8 S17.52 2 12 2Z" />
    </svg>
  );
}
