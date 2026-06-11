import { parseChatMarkdown } from "./chat-markdown";

const sampleMessage = `好！来一波测试：

# Heading 1
## Heading 2
### Heading 3

**加粗文字** 和 *斜体文字* 还有 ~~删除线~~

行内代码 \`const x = 42\`

代码块：
\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}! 🐾\`;
}

const issues = [146, 147, 148, 149, 150, 152, 153, 154];
console.log(\`Today we opened \${issues.length} issues!\`);
\`\`\`

链接：[Cove Repo](https://github.com/kagura-agent/cove)

列表：
- 第一项
- 第二项

有序列表：
1. Markdown 渲染
2. 图片上传

> 这是一段引用
> 可以多行

表格：
| Issue | 标题 | 状态 |
|-------|------|------|
| #146 | Markdown 渲染 | Done |

---
Luna 看看哪些渲染对了哪些没对！🐾`;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}:`, e); throw e; }
}

test("parses sample message without hanging", () => {
  const start = Date.now();
  const tokens = parseChatMarkdown(sampleMessage);
  const elapsed = Date.now() - start;
  if (elapsed > 1000) throw new Error(`Took ${elapsed}ms — too slow`);
  if (tokens.length === 0) throw new Error("No tokens produced");
});

test("parses code block with nested backticks", () => {
  const tokens = parseChatMarkdown(sampleMessage);
  const codeBlock = tokens.find((t) => t.type === "codeBlock");
  if (!codeBlock) throw new Error("No code block found");
  if (codeBlock.type === "codeBlock" && !codeBlock.text.includes("greet"))
    throw new Error("Code block content missing");
});

test("parses table", () => {
  const tokens = parseChatMarkdown(sampleMessage);
  const table = tokens.find((t) => t.type === "tableBlock");
  if (!table) throw new Error("No table found");
});

test("handles 50 copies without OOM", () => {
  const bigContent = Array(50).fill(sampleMessage).join("\n\n---\n\n");
  const start = Date.now();
  const tokens = parseChatMarkdown(bigContent);
  const elapsed = Date.now() - start;
  if (elapsed > 5000) throw new Error(`50 copies took ${elapsed}ms`);
  if (tokens.length === 0) throw new Error("No tokens");
});

console.log("All tests passed");

// --- Edge case & security tests ---

test("empty string", () => {
  const tokens = parseChatMarkdown("");
  if (tokens.length !== 0) throw new Error("expected no tokens");
});

test("only newlines", () => {
  const tokens = parseChatMarkdown("\n\n\n\n\n");
  for (const t of tokens) {
    if (t.type !== "br") throw new Error(`unexpected: ${t.type}`);
  }
});

test("only spaces", () => {
  const tokens = parseChatMarkdown("   ");
  if (tokens[0].type !== "text") throw new Error("expected text");
});

test("unclosed bold", () => {
  const tokens = parseChatMarkdown("**bold without close");
  if (tokens[0].type !== "text") throw new Error("expected text fallback");
});

test("1000 backticks", () => {
  const input = "`".repeat(1000);
  const tokens = parseChatMarkdown(input);
  if (tokens.length === 0) throw new Error("expected tokens");
});

test("10000 char plain text", () => {
  const input = "a".repeat(10000);
  const start = Date.now();
  const tokens = parseChatMarkdown(input);
  if (Date.now() - start > 1000) throw new Error("too slow");
  if (tokens[0].type !== "text") throw new Error("expected text");
});

test("nested formatting", () => {
  const tokens = parseChatMarkdown("**bold *italic* bold**");
  if (tokens[0].type !== "bold") throw new Error("expected bold");
});

test("malformed table not parsed as table", () => {
  const tokens = parseChatMarkdown("| just |\n| no sep |\n| row |");
  for (const t of tokens) {
    if (t.type === "tableBlock") throw new Error("should not be table");
  }
});

test("ambiguous *** does not crash", () => {
  parseChatMarkdown("***");
});

test("deep nesting does not stack overflow", () => {
  const input = "**".repeat(50) + "x" + "**".repeat(50);
  const tokens = parseChatMarkdown(input);
  if (tokens.length === 0) throw new Error("expected tokens");
});

test("autolink rejects non-http", () => {
  const tokens = parseChatMarkdown("ftp://evil.com");
  if (tokens[0].type === "autolink") throw new Error("should not match ftp");
});

console.log("Edge case tests passed");

// ── Underscore word-boundary tests ───────────────────────────────────

test("underscore italic at word boundary works", () => {
  const tokens = parseChatMarkdown("_hello_");
  if (tokens.length !== 1 || tokens[0].type !== "italic") throw new Error("should be italic");
});

test("underscore italic with leading space works", () => {
  const tokens = parseChatMarkdown("say _hello_ world");
  if (!tokens.some(t => t.type === "italic")) throw new Error("should contain italic");
});

test("mid-word underscores do NOT trigger italic", () => {
  const tokens = parseChatMarkdown("VIEW_CHANNEL");
  if (tokens.length !== 1 || tokens[0].type !== "text") throw new Error("should be plain text, got " + tokens.map(t => t.type).join(","));
  if ((tokens[0] as any).text !== "VIEW_CHANNEL") throw new Error("text should be VIEW_CHANNEL");
});

test("multiple mid-word underscores stay literal", () => {
  const tokens = parseChatMarkdown("abc_def_ghi");
  if (tokens.length !== 1 || tokens[0].type !== "text") throw new Error("should be plain text");
  if ((tokens[0] as any).text !== "abc_def_ghi") throw new Error("text should be abc_def_ghi");
});

test("SNAKE_CASE in sentence stays literal", () => {
  const tokens = parseChatMarkdown("use MANAGE_WEBHOOKS permission");
  const allText = tokens.every(t => t.type === "text" || t.type === "br");
  if (!allText) throw new Error("should all be text, got " + tokens.map(t => t.type).join(","));
});
