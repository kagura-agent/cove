import { memo, type CSSProperties, type ReactNode } from "react";
import { parseChatMarkdown, type Token } from "../lib/chat-markdown";
import { router } from "../lib/router";
import { getGuildForChannel } from "../lib/router";
import { routes } from "../lib/routes";

interface ChatMarkdownProps {
  content: string;
  className?: string;
  style?: CSSProperties;
  /** Map of user IDs to usernames for rendering mentions */
  mentionUsers?: Map<string, string>;
  /** Map of channel IDs to channel names for rendering channel mentions */
  mentionChannels?: Map<string, string>;
}

const mentionStyle: CSSProperties = {
  background: "color-mix(in srgb, var(--accent) 30%, transparent)",
  color: "var(--accent)",
  borderRadius: "3px",
  padding: "0 2px",
  fontWeight: 500,
  cursor: "pointer",
};

const SAFE_PROTO = /^(https?:|mailto:)/i;

function renderTokens(tokens: Token[], key = "", mentionUsers?: Map<string, string>, mentionChannels?: Map<string, string>): ReactNode[] {
  return tokens.map((token, i) => {
    const k = `${key}${i}`;
    switch (token.type) {
      case "text":
        return <span key={k}>{token.text}</span>;
      case "bold":
        return <strong key={k}>{renderTokens(token.children, `${k}-`, mentionUsers, mentionChannels)}</strong>;
      case "italic":
        return <em key={k}>{renderTokens(token.children, `${k}-`, mentionUsers, mentionChannels)}</em>;
      case "strikethrough":
        return <del key={k}>{renderTokens(token.children, `${k}-`, mentionUsers, mentionChannels)}</del>;
      case "code":
        return (
          <code key={k} style={{ background: "var(--bg-code)", padding: "1px var(--space-xs)", borderRadius: "var(--space-xxs)", fontSize: "0.85em" }}>
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
      case "link": {
        if (!SAFE_PROTO.test(token.href)) {
          return <span key={k}>{token.text}</span>;
        }
        return (
          <a key={k} href={token.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {token.text}
          </a>
        );
      }
      case "autolink": {
        if (!SAFE_PROTO.test(token.href)) {
          return <span key={k}>{token.href}</span>;
        }
        return (
          <a key={k} href={token.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {token.href}
          </a>
        );
      }
      case "blockquote":
        return (
          <div key={k} style={{ borderLeft: "3px solid var(--text-muted)", paddingLeft: "var(--space-sm)", margin: "var(--space-xs) 0", color: "var(--text-muted)" }}>
            {renderTokens(token.children, `${k}-`, mentionUsers, mentionChannels)}
          </div>
        );
      case "spoiler":
        return (
          <span key={k} className="spoiler" style={{ background: "var(--bg-code)", borderRadius: "var(--space-xxs)", padding: "0 var(--space-xxs)", cursor: "pointer" }}>
            {renderTokens(token.children, `${k}-`, mentionUsers, mentionChannels)}
          </span>
        );
      case "mention": {
        const username = mentionUsers?.get(token.userId) ?? "Unknown User";
        return (
          <span key={k} style={mentionStyle}>@{username}</span>
        );
      }
      case "channelMention": {
        const channelName = mentionChannels?.get(token.channelId) ?? "unknown-channel";
        return (
          <span
            key={k}
            style={{ ...mentionStyle, cursor: "pointer" }}
            onClick={() => {
              const guildId = getGuildForChannel(token.channelId);
              if (guildId) {
                router.navigate(routes.channel(guildId, token.channelId));
              }
            }}
          >#{channelName}</span>
        );
      }
      case "br":
        return <br key={k} />;
      default:
        return null;
    }
  });
}

function ChatMarkdownInner({ content, className, style, mentionUsers, mentionChannels }: ChatMarkdownProps) {
  const tokens = parseChatMarkdown(content);
  return (
    <div className={className} style={{ display: "inline", ...style }}>
      {renderTokens(tokens, "", mentionUsers, mentionChannels)}
    </div>
  );
}

export const ChatMarkdown = memo(ChatMarkdownInner);
