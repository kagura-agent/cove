export type Token =
  | { type: "text"; text: string }
  | { type: "bold"; children: Token[] }
  | { type: "italic"; children: Token[] }
  | { type: "strikethrough"; children: Token[] }
  | { type: "code"; text: string }
  | { type: "codeBlock"; lang: string; text: string }
  | { type: "tableBlock"; headers: string[]; rows: string[][] }
  | { type: "link"; href: string; text: string }
  | { type: "autolink"; href: string }
  | { type: "blockquote"; children: Token[] }
  | { type: "spoiler"; children: Token[] }
  | { type: "br" };

const INLINE_RULES: Array<{ pattern: RegExp; parse: (match: RegExpMatchArray) => { token: Token; length: number } }> = [
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

function tryParseTable(lines: string[]): { headers: string[]; rows: string[][]; lineCount: number } | null {
  if (lines.length < 3) return null;
  const headerLine = lines[0];
  const sepLine = lines[1];
  if (!headerLine.includes("|") || !sepLine.includes("|")) return null;
  if (!/^\|?[\s-:|]+\|[\s-:|]+\|?$/.test(sepLine)) return null;

  const headers = headerLine.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const rows: string[][] = [];
  let i = 2;
  while (i < lines.length && lines[i].includes("|")) {
    rows.push(lines[i].replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    i++;
  }
  if (rows.length === 0) return null;
  return { headers, rows, lineCount: i };
}

export function parseChatMarkdown(content: string): Token[] {
  const segments: Array<{ type: "code"; lang: string; text: string } | { type: "text"; text: string }> = [];
  const codeBlockRe = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = codeBlockRe.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", lang: match[1] || "", text: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }

  const tokens: Token[] = [];

  for (const seg of segments) {
    if (seg.type === "code") {
      tokens.push({ type: "codeBlock", lang: seg.lang, text: seg.text });
      continue;
    }

    const lines = seg.text.split("\n");
    let quoteLines: string[] = [];

    function flushQuote() {
      if (quoteLines.length > 0) {
        tokens.push({ type: "blockquote", children: parseInline(quoteLines.join("\n")) });
        quoteLines = [];
      }
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith("> ")) {
        quoteLines.push(line.slice(2));
        i++;
      } else if (line === ">" && quoteLines.length > 0) {
        quoteLines.push("");
        i++;
      } else {
        flushQuote();

        const table = tryParseTable(lines.slice(i));
        if (table) {
          if (tokens.length > 0) tokens.push({ type: "br" });
          tokens.push({ type: "tableBlock", headers: table.headers, rows: table.rows });
          i += table.lineCount;
          continue;
        }

        if (i > 0 && tokens.length > 0) {
          tokens.push({ type: "br" });
        }
        if (line === "") {
          continue;
        }
        tokens.push(...parseInline(line));
        i++;
      }
    }
    flushQuote();
  }
  return tokens;
}
