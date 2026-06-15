import type { CSSProperties } from 'react';

export function ThreadIcon({ size = 16, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-flex', flexShrink: 0, ...style }}>
      <path d="M5.43 21a.996.996 0 0 1-.98-.8l-.87-4.36A5.99 5.99 0 0 1 2 11c0-3.31 2.69-6 6-6h8c3.31 0 6 2.69 6 6s-2.69 6-6 6h-4.17l-4.4 3.7c-.36.3-.83.4-1.28.3H5.43ZM8 7a4 4 0 0 0-4 4c0 1.2.53 2.3 1.46 3.04l.39.31.58 2.89 3.17-2.67.27-.23H16a4 4 0 0 0 0-8H8Zm1 3h6v1.5H9V10Zm0 3h4v1.5H9V13Z" />
    </svg>
  );
}
