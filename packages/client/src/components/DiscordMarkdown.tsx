import { memo, type CSSProperties, type ReactNode } from "react";
import { parseDiscordMarkdown, type Token } from "../lib/discord-markdown";

interface DiscordMarkdownProps {
  content: string;
  className?: string;
  style?: CSSProperties;
}

function renderTokens(tokens: Token[], key = ""): ReactNode[] {
  return tokens.map((token, i) => {
    const k = `${key}${i}`;
    switch (token.type) {
      case "text":
        return <span key={k}>{token.text}</span>;
      case "bold":
        return <strong key={k}>{renderTokens(token.children, `${k}-`)}</strong>;
      case "italic":
        return <em key={k}>{renderTokens(token.children, `${k}-`)}</em>;
      case "strikethrough":
        return <del key={k}>{renderTokens(token.children, `${k}-`)}</del>;
      case "code":
        return (
          <code key={k} style={{ background: "var(--bg-code)", padding: "1px 4px", borderRadius: 3, fontSize: "0.85em" }}>
            {token.text}
          </code>
        );
      case "codeBlock":
        return (
          <pre key={k} style={{ background: "var(--bg-code)", padding: "var(--space-sm)", borderRadius: "var(--input-radius)", overflowX: "auto", margin: "var(--space-xs) 0", fontSize: "var(--font-size-sm)", fontFamily: "Consolas, Monaco, monospace" }}>
            <code>{token.text}</code>
          </pre>
        );
      case "tableBlock":
        return (
          <table key={k} style={{ borderCollapse: "collapse", margin: "var(--space-xs) 0", fontSize: "var(--font-size-sm)" }}>
            <thead>
              <tr>
                {token.headers.map((h, hi) => (
                  <th key={hi} style={{ border: "1px solid var(--border-subtle)", padding: "var(--space-xs) var(--space-sm)", background: "var(--bg-code)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ border: "1px solid var(--border-subtle)", padding: "var(--space-xs) var(--space-sm)" }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      case "link":
        return (
          <a key={k} href={token.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {token.text}
          </a>
        );
      case "autolink":
        return (
          <a key={k} href={token.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {token.href}
          </a>
        );
      case "blockquote":
        return (
          <div key={k} style={{ borderLeft: "3px solid var(--text-muted)", paddingLeft: "var(--space-sm)", margin: "var(--space-xs) 0", color: "var(--text-muted)" }}>
            {renderTokens(token.children, `${k}-`)}
          </div>
        );
      case "spoiler":
        return (
          <span key={k} className="spoiler" style={{ background: "var(--bg-code)", borderRadius: 3, padding: "0 2px", cursor: "pointer" }}>
            {renderTokens(token.children, `${k}-`)}
          </span>
        );
      case "br":
        return <br key={k} />;
      default:
        return null;
    }
  });
}

function DiscordMarkdownInner({ content, className, style }: DiscordMarkdownProps) {
  const tokens = parseDiscordMarkdown(content);
  return (
    <span className={className} style={style}>
      {renderTokens(tokens)}
    </span>
  );
}

export const DiscordMarkdown = memo(DiscordMarkdownInner);
