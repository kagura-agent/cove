import { memo, type ReactNode } from "react";

interface MessageContentProps {
  content: string;
}

/** Token types produced by the lexer */
type Token =
  | { type: "text"; text: string }
  | { type: "bold"; children: Token[] }
  | { type: "italic"; children: Token[] }
  | { type: "strikethrough"; children: Token[] }
  | { type: "code"; text: string }
  | { type: "codeBlock"; lang: string; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "autolink"; href: string }
  | { type: "blockquote"; children: Token[] }
  | { type: "spoiler"; children: Token[] }
  | { type: "br" };

/** Patterns matched in order — first match wins */
const INLINE_RULES: Array<{ pattern: RegExp; parse: (match: RegExpMatchArray) => { token: Token; length: number } }> = [
  // Code block: ```lang\ncode```
  {
    pattern: /^```(?:(\w+)\n)?([\s\S]*?)```/,
    parse: (m) => ({ token: { type: "codeBlock", lang: m[1] || "", text: m[2] }, length: m[0].length }),
  },
  // Inline code: `code`
  {
    pattern: /^`([^`]+)`/,
    parse: (m) => ({ token: { type: "code", text: m[1] }, length: m[0].length }),
  },
  // Spoiler: ||text||
  {
    pattern: /^\|\|(.+?)\|\|/,
    parse: (m) => ({ token: { type: "spoiler", children: parseInline(m[1]) }, length: m[0].length }),
  },
  // Bold: **text**
  {
    pattern: /^\*\*(.+?)\*\*/s,
    parse: (m) => ({ token: { type: "bold", children: parseInline(m[1]) }, length: m[0].length }),
  },
  // Italic: *text* (but not **)
  {
    pattern: /^\*([^*]+?)\*/,
    parse: (m) => ({ token: { type: "italic", children: parseInline(m[1]) }, length: m[0].length }),
  },
  // Italic: _text_ (but not __)
  {
    pattern: /^_([^_]+?)_/,
    parse: (m) => ({ token: { type: "italic", children: parseInline(m[1]) }, length: m[0].length }),
  },
  // Strikethrough: ~~text~~
  {
    pattern: /^~~(.+?)~~/s,
    parse: (m) => ({ token: { type: "strikethrough", children: parseInline(m[1]) }, length: m[0].length }),
  },
  // Link: [text](url)
  {
    pattern: /^\[([^\]]+)\]\(([^)]+)\)/,
    parse: (m) => ({ token: { type: "link", text: m[1], href: m[2] }, length: m[0].length }),
  },
  // Auto-link: https://... or http://...
  {
    pattern: /^(https?:\/\/[^\s<>]+)/,
    parse: (m) => ({ token: { type: "autolink", href: m[1] }, length: m[0].length }),
  },
];

/** Parse inline content into tokens */
function parseInline(text: string): Token[] {
  const tokens: Token[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    let matched = false;
    for (const rule of INLINE_RULES) {
      const m = remaining.match(rule.pattern);
      if (m) {
        const { token, length } = rule.parse(m);
        tokens.push(token);
        remaining = remaining.slice(length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Consume one character as text
      const lastToken = tokens[tokens.length - 1];
      if (lastToken?.type === "text") {
        lastToken.text += remaining[0];
      } else {
        tokens.push({ type: "text", text: remaining[0] });
      }
      remaining = remaining.slice(1);
    }
  }
  return tokens;
}

/** Parse full message content — handles blockquotes and line breaks */
function parseMessage(content: string): Token[] {
  const lines = content.split("\n");
  const tokens: Token[] = [];
  let quoteLines: string[] = [];

  function flushQuote() {
    if (quoteLines.length > 0) {
      tokens.push({ type: "blockquote", children: parseInline(quoteLines.join("\n")) });
      quoteLines = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("> ")) {
      quoteLines.push(line.slice(2));
    } else if (line === ">" && quoteLines.length > 0) {
      quoteLines.push("");
    } else {
      flushQuote();
      if (i > 0 && tokens.length > 0) {
        tokens.push({ type: "br" });
      }
      const lineTokens = parseInline(line);
      tokens.push(...lineTokens);
    }
  }
  flushQuote();
  return tokens;
}

/** Render a token tree to React elements */
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

function MessageContentInner({ content }: MessageContentProps) {
  const tokens = parseMessage(content);
  return <>{renderTokens(tokens)}</>;
}

export const MessageContent = memo(MessageContentInner);
