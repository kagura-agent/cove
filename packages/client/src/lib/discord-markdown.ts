export type Token =
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

const INLINE_RULES: Array<{ pattern: RegExp; parse: (match: RegExpMatchArray) => { token: Token; length: number } }> = [
  {
    pattern: /^```(?:(\w+)\n)?([\s\S]*?)```/,
    parse: (m) => ({ token: { type: "codeBlock", lang: m[1] || "", text: m[2] }, length: m[0].length }),
  },
  {
    pattern: /^`([^`]+)`/,
    parse: (m) => ({ token: { type: "code", text: m[1] }, length: m[0].length }),
  },
  {
    pattern: /^\|\|(.+?)\|\|/,
    parse: (m) => ({ token: { type: "spoiler", children: parseInline(m[1]) }, length: m[0].length }),
  },
  {
    pattern: /^\*\*(.+?)\*\*/s,
    parse: (m) => ({ token: { type: "bold", children: parseInline(m[1]) }, length: m[0].length }),
  },
  {
    pattern: /^\*([^*]+?)\*/,
    parse: (m) => ({ token: { type: "italic", children: parseInline(m[1]) }, length: m[0].length }),
  },
  {
    pattern: /^_([^_]+?)_/,
    parse: (m) => ({ token: { type: "italic", children: parseInline(m[1]) }, length: m[0].length }),
  },
  {
    pattern: /^~~(.+?)~~/s,
    parse: (m) => ({ token: { type: "strikethrough", children: parseInline(m[1]) }, length: m[0].length }),
  },
  {
    pattern: /^\[([^\]]+)\]\(([^)]+)\)/,
    parse: (m) => ({ token: { type: "link", text: m[1], href: m[2] }, length: m[0].length }),
  },
  {
    pattern: /^(https?:\/\/[^\s<>]+)/,
    parse: (m) => ({ token: { type: "autolink", href: m[1] }, length: m[0].length }),
  },
];

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

export function parseDiscordMarkdown(content: string): Token[] {
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
