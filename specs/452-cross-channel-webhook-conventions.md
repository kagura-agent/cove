# Spec: Cross-channel webhook 使用规范 & 平台认知注入

**Issue:** #452
**Status:** Draft

## Problem

Agent 在 Cove 平台上跨 channel 发消息时，没有自动使用 webhook，而是直接用 bot token POST message。导致：
1. 消息以 bot 自身身份出现，无法区分来源 channel
2. 目标 channel 的 bot session 无法收到消息（bot 不处理自己发的消息）

根因：plugin 注入的系统 prompt 只有 `cove.md`（channel rules），没有平台级操作认知。Agent 不知道"在 Cove 上跨 channel 该用 webhook"。

## Current State

`dispatch.ts` 注入到 `GroupSystemPrompt` 的内容：
```
Channel rules from cove.md (channel-editable):

[cove.md 内容]
```

仅此而已。没有平台操作指引。

## Proposal

### 1. Plugin 注入平台认知

在 `dispatch.ts` 构建 `GroupSystemPrompt` 时，在 cove.md 内容之后追加一行平台指引：

```
Cove: cross-channel messaging uses webhooks, not direct bot messages. Read the cove-ops skill for API details.
```

精简一行，参考 OpenClaw 框架对 Discord 的做法（`"Discord: wrap bare URLs like <url> to suppress embeds."`），只注入影响行为的关键规则，详细 API 引导到 cove-ops skill。

### 2. Webhook username 命名规范

webhook 发送时 `username` 字段标明来源 channel：
- 格式：`From #channel-name`
- 例：`"username": "From #cove-spec"`

### 3. 依赖 #451

#451 为每个 channel 自动创建 system webhook，这样不需要手动管理 webhook。本 spec 的规范可以先定，实现等 #451 完成后一起做。

## Scope

- `packages/plugin/src/dispatch.ts`: 修改 `GroupSystemPrompt` 注入逻辑，追加平台认知一行
- 更新 `cove-ops` skill，加入 webhook username 命名规范
- 不涉及 webhook 创建逻辑（由 #451 处理）

## Decision Log

- ✅ 问题确认：agent 跨 channel 发消息未走 webhook，根因是缺少平台认知注入
- ✅ 注入位置：Cove plugin 层（`dispatch.ts` 的 `GroupSystemPrompt`），不改 OpenClaw 核心代码
- ✅ 注入内容：一行精简指引，参考 Discord 模式，详细 API 引导到 cove-ops skill
- ✅ webhook username 格式：`From #channel-name`
