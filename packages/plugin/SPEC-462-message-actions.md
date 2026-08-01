# Spec: Issue #462 — ChannelMessageActionAdapter for Cove Plugin

## 目标

替换当前的 `createChannelMessageAdapterFromOutbound` 简化适配器，实现完整的 `ChannelMessageActionAdapter`，让 agent 能通过 `openclaw message <action> --channel cove` 统一操作 Cove 消息。

## 现状

- `channel.ts` 使用 `createChannelMessageAdapterFromOutbound({ id: "cove", outbound: { sendText } })` 仅支持基础 send
- `CoveRestClient` 已有: sendMessage, editMessage, deleteMessage, getMessage, getMessages, getChannels, getChannel, sendTyping, reactions (server routes), webhooks, channel-files
- Cove server 已有 routes: reactions, threads, messages CRUD, channels, permissions, roles, webhooks, channel-files
- Cove server **缺少**: pins (无 DB schema, 无 route)

## Discord 插件学习要点

参考文件: `openclaw/dist/channel-actions-CVD_Zv2g.js` + `channel-actions.runtime-BNoHjFMT.js`

1. **Discovery gate 模式** — `describeMessageTool` 按 config feature flag 动态开关 actions
2. **Lazy runtime** — `handleAction` 用 `createLazyRuntimeModule` 延迟加载 runtime 模块，减少启动开销
3. **Local vs Gateway execution** — send/upload 等发送类 = "local"(CLI 可执行)，read/react/pin = "gateway"(需 bot 连接)
4. **参数读取** — 统一用 SDK 的 `readStringParam`/`readBooleanParam`/`readStringArrayParam`/`readPositiveIntegerParam`
5. **`prepareSendPayload`** — send 特殊走 durable pipeline(persist/retry)，其他 action 不需要
6. **Handler 分发** — 大 if/else 链，每个 action 独立解析参数 → 调用底层 API

## 架构设计

参照 Discord 的模式，但适当简化（Cove 无需 gate 因为 feature 全开，send 保留走 outbound adapter）：

```
src/message-actions.ts        ← 新文件：adapter 对象 (describeMessageTool + resolveExecutionMode + handleAction)
src/message-actions.runtime.ts ← 新文件：lazy-loaded runtime，实际 action handler 实现
src/rest-client.ts            ← 扩展：addReaction/removeReaction/pin/thread/search 方法
src/channel.ts                ← 修改：用新 adapter 替换 createChannelMessageAdapterFromOutbound
```

## ChannelMessageActionAdapter 实现

```typescript
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/channel-lifecycle";
import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk/channel-contract";

// Local execution: send (走 outbound adapter 的 durable pipeline)
// Gateway execution: 其余所有 action (需要 bot 连接/REST client)
const LOCAL_ACTIONS = new Set(["send"]);

const loadRuntime = createLazyRuntimeModule(
  () => import("./message-actions.runtime.js")
);

export const coveMessageActionAdapter: ChannelMessageActionAdapter = {
  describeMessageTool({ cfg, accountId }) {
    // Cove 全量开放，不需要 gate — 直接返回支持的 actions
    const actions: string[] = [
      "send",
      // P0
      "react", "read", "edit", "delete",
      // P1
      "pin", "unpin", "list-pins",
      "thread-create", "thread-list", "thread-reply",
      "channel-info", "channel-list",
      // P2
      "member-info", "search",
    ];
    return { actions, capabilities: [] };
  },

  resolveExecutionMode({ action }) {
    return LOCAL_ACTIONS.has(action) ? "local" : "gateway";
  },

  async handleAction(ctx) {
    const { handleCoveMessageAction } = await loadRuntime();
    return handleCoveMessageAction(ctx);
  },
};
```

## Action 优先级分层

### P0 — Must Have (react/read/edit/delete)

Note: `send` 保留走 outbound adapter 的 durable pipeline（与 Discord 一致），不需要在 handleAction 处理。

| Action | Cove REST | 说明 |
|--------|-----------|------|
| `react` | `PUT /channels/:ch/messages/:msg/reactions/:emoji/@me` | 已有 server route |
| `read` | `GET /channels/:id/messages` | 支持 limit, before/after |
| `edit` | `PATCH /channels/:ch/messages/:msg` | 已有 |
| `delete` | `DELETE /channels/:ch/messages/:msg` | 已有 |

### P1 — Should Have (pin/unpin/pins/thread/channel-info)

| Action | Cove REST | 说明 |
|--------|-----------|------|
| `pin` | `PUT /channels/:ch/pins/:msg` | ⚠️ **server 需新增** |
| `unpin` | `DELETE /channels/:ch/pins/:msg` | ⚠️ **server 需新增** |
| `list-pins` | `GET /channels/:ch/pins` | ⚠️ **server 需新增** |
| `thread-create` | `POST /channels/:ch/messages/:msg/threads` | 已有 server route |
| `thread-list` | `GET /channels/:ch/threads` | 已有 server route |
| `thread-reply` | `POST /channels/:id/messages` (threadId) | 同 send |
| `channel-info` | `GET /channels/:id` | 已有 |
| `channel-list` | `GET /guilds/:guildId/channels` | 已有 |

**Pins server-side 实现** (作为前置 PR 或同 PR):
- DB: `messages` 表添加 `pinned BOOLEAN DEFAULT FALSE` + `pinned_at TIMESTAMP`
- Routes: pin/unpin/list-pins 三个 endpoint
- Gateway event: `CHANNEL_PINS_UPDATE`

### P2 — Nice to Have (member/search/permissions)

| Action | Cove REST | 说明 |
|--------|-----------|------|
| `member-info` | `GET /guilds/:guildId/members/:userId` | 已有 members repo |
| `search` | `GET /channels/:ch/messages/search?q=...` | ⚠️ **server 需新增** |
| `permissions` | 基于 `computePermissions()` | 读取当前 bot 权限 |

## REST Client 扩展

```typescript
// P0 additions
async sendMessageWithMedia(channelId: string, content: string, media: Buffer, filename: string): Promise<Message>;
async addReaction(channelId: string, messageId: string, emoji: string): Promise<void>;
async removeReaction(channelId: string, messageId: string, emoji: string): Promise<void>;

// P1 additions  
async pinMessage(channelId: string, messageId: string): Promise<void>;
async unpinMessage(channelId: string, messageId: string): Promise<void>;
async getPinnedMessages(channelId: string): Promise<Message[]>;
async createThread(channelId: string, messageId: string, name: string): Promise<Channel>;
async listThreads(channelId: string): Promise<Channel[]>;

// P2 additions
async getMember(guildId: string, userId: string): Promise<Member>;
async searchMessages(channelId: string, query: string, limit?: number): Promise<Message[]>;
```

## handleAction 路由

```typescript
async function handleAction(ctx: ChannelMessageActionContext): Promise<AgentToolResult<unknown>> {
  const { action, args, cfg, accountId } = ctx;
  const account = resolveAccount(cfg, accountId);
  const client = getRestClient(account.baseUrl, account.token);
  const target = readStringParam(args, "target"); // channelId

  switch (action) {
    case "send": return handleSend(client, target, args);
    case "react": return handleReact(client, target, args);
    case "read": return handleRead(client, target, args);
    case "edit": return handleEdit(client, target, args);
    case "delete": return handleDelete(client, target, args);
    case "pin": return handlePin(client, target, args);
    case "unpin": return handleUnpin(client, target, args);
    case "list-pins": return handleListPins(client, target, args);
    case "thread-create": return handleThreadCreate(client, target, args);
    case "thread-list": return handleThreadList(client, target, args);
    case "thread-reply": return handleThreadReply(client, target, args);
    case "channel-info": return handleChannelInfo(client, target, args);
    case "channel-list": return handleChannelList(client, account, args);
    case "member-info": return handleMemberInfo(client, account, args);
    case "search": return handleSearch(client, target, args);
    default: throw new Error(`Unsupported action: ${action}`);
  }
}
```

## 实施计划

### Phase 1: P0 Actions (本 PR)
1. 新建 `src/message-actions.ts` — adapter 主体 + P0 handlers
2. 扩展 `src/rest-client.ts` — addReaction/removeReaction
3. 修改 `src/channel.ts` — 替换 adapter
4. 测试: unit tests for each P0 action handler

### Phase 2: P1 Actions (后续 PR)
1. Server-side: pins DB + routes (独立 PR 或 monorepo 同 PR)
2. Plugin: pin/unpin/list-pins + thread actions
3. channel-info/channel-list handlers

### Phase 3: P2 Actions (独立 PR)
1. Server-side: search endpoint
2. Plugin: member-info/search/permissions

## 关键设计决策

1. **`resolveExecutionMode` = "gateway"** — 所有 action 在 gateway 进程执行（plugin 有 REST client 实例），不需要 CLI 另起连接
2. **media send** — 先检查 Cove server 是否支持 multipart upload；如不支持，Phase 1 只支持 text send + 在 action result 中标注 "media not yet supported"
3. **`describeMessageTool`** — 只声明已实现的 actions，未实现的不注册（避免 agent 调用 404）
4. **error handling** — `CoveApiError` 统一包装为 `AgentToolResult` 的 error 格式
5. **target resolution** — action 的 `target` 参数 = channelId（与 Discord 插件行为一致）

## 测试策略

- Unit test: mock REST client, 验证每个 handler 的参数解析和返回格式
- Integration: 用真实 Cove server (localhost:3400) 验证 roundtrip
- 手动验证: `openclaw message react --channel cove --target <ch> --messageId <id> --emoji 👍`

## 风险

- **media upload**: Cove server messages route 可能不支持 multipart — 需确认或先跳过
- **pins**: server 无 pin 支持 — P1 需要先做 server-side PR
- **search**: server 无 full-text search — P2 可能需要 SQLite FTS5 or simple LIKE

---

**Status**: 待确认方案后开始 Phase 1 实现
