import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageContentProps {
  content: string;
}

/** Escape Markdown syntax that Discord does not render.
 * Preserves: bold, italic, strikethrough, code, links, blockquotes.
 * Escapes: headings (#), lists (- / * / 1.), hr (---), images (![]). */
function escapeNonDiscordMarkdown(text: string): string {
  return text
    .split('\n')
    .map(line => {
      // Escape heading syntax: # at start of line
      if (/^#{1,6}\s/.test(line)) {
        return line.replace(/^(#{1,6})\s/, '$1\\. ');
      }
      // Escape unordered list: - or * at start (but not --- which is hr, or ** which is bold)
      if (/^\s*[-]\s/.test(line)) {
        return line.replace(/^(\s*)[-]\s/, '$1\\- ');
      }
      if (/^\s*[*]\s(?![*])/.test(line)) {
        return line.replace(/^(\s*)[*]\s/, '$1\\* ');
      }
      // Escape ordered list: 1. 2. etc at start
      if (/^\s*\d+\.\s/.test(line)) {
        return line.replace(/^(\s*)(\d+)\.\s/, '$1$2\\. ');
      }
      // Escape horizontal rule: --- or *** or ___ alone on line
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        return '\\' + line.trimStart();
      }
      // Escape image syntax: ![alt](url) → \![alt](url)
      return line.replace(/^!\[/, '\\![');
    })
    .join('\n');
}

function MessageContentInner({ content }: MessageContentProps) {
  const processed = escapeNonDiscordMarkdown(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {children}
          </a>
        ),
        pre: ({ children }) => (
          <pre style={{ background: "var(--bg-code)", padding: "var(--space-sm)", borderRadius: "var(--input-radius)", overflowX: "auto", margin: "var(--space-xs) 0" }}>
            {children}
          </pre>
        ),
        code: ({ className, children, ...props }) => {
          // Fenced code blocks are already wrapped in <pre> by react-markdown
          // Only style inline code here
          if (className) {
            return <code className={className} {...props}>{children}</code>;
          }
          return (
            <code style={{ background: "var(--bg-code)", padding: "1px 4px", borderRadius: 3, fontSize: "0.85em" }} {...props}>
              {children}
            </code>
          );
        },
        blockquote: ({ children }) => (
          <blockquote style={{ borderLeft: "3px solid var(--text-muted)", paddingLeft: "var(--space-sm)", margin: "var(--space-xs) 0", color: "var(--text-muted)" }}>
            {children}
          </blockquote>
        ),
        p: ({ children }) => <div style={{ margin: 0 }}>{children}</div>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export const MessageContent = memo(MessageContentInner);
