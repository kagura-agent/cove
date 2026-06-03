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
