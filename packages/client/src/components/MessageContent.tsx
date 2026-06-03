import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MessageContentProps {
  content: string;
}

export function MessageContent({ content }: MessageContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith("language-");
          if (isBlock) {
            return (
              <pre style={{ background: "var(--bg-code)", padding: "var(--space-sm)", borderRadius: "var(--input-radius)", overflowX: "auto", margin: "var(--space-xs) 0" }}>
                <code className={className} {...props}>{children}</code>
              </pre>
            );
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
        p: ({ children }) => <span>{children}</span>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
