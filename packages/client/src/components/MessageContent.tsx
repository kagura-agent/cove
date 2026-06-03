import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageContentProps {
  content: string;
}

function MessageContentInner({ content }: MessageContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Discord does not render headings — show as plain text
        h1: ({ children }) => <div>{children}</div>,
        h2: ({ children }) => <div>{children}</div>,
        h3: ({ children }) => <div>{children}</div>,
        h4: ({ children }) => <div>{children}</div>,
        h5: ({ children }) => <div>{children}</div>,
        h6: ({ children }) => <div>{children}</div>,
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
        img: ({ src, alt }) => (
          <img src={src} alt={alt} style={{ maxWidth: "100%", borderRadius: "var(--input-radius)" }} />
        ),
        table: ({ children }) => (
          <div style={{ overflowX: "auto", margin: "var(--space-xs) 0" }}>
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export const MessageContent = memo(MessageContentInner);
