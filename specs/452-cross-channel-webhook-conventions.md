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

在 `dispatch.ts` 的 `ctxPayload` 中，除了 `GroupSystemPrompt`（cove.md），额外注入一段固定的平台操作指引。

注入方式：追加到 `GroupSystemPrompt` 的 cove.md 内容之后（或作为独立字段），内容包括：

```
## Cove Platform Guide

You are on the Cove platform. Key rules:

- **Cross-channel messaging**: Use webhooks, not direct bot messages. Webhook messages show the source channel identity and are received by the target channel's bot session.
  Helper: `node ~/.openclaw/workspace-ruantang/cove/skills/cove-webhook/scripts/cove-webhook-send.mjs --to TARGET --from SOURCE --message "..."`
- **cove.md**: Each channel has a cove.md file auto-injected into context. Update it to evolve channel rules.
- **Channel files**: Each channel has independent file storage (text, max 100KB).
- **For full API reference**: Read the cove-ops skill.
```

### 2. Webhook username 命名规范

webhook 发送时 `username` 字段应标明来源：
- 格式：`From #channel-name` 或 `#channel-name`
- 例：`"username": "From #cove-spec"`

❓ 是否需要更复杂的格式（比如 `Kagura via #cove-spec`）？

### 3. 依赖 #451

#451 为每个 channel 自动创建 system webhook，这样不需要手动管理 webhook。本 spec 的规范可以先定，实现等 #451 完成后一起做。

## Scope

- `packages/plugin/src/dispatch.ts`: 修改 `GroupSystemPrompt` 注入逻辑，追加平台认知
- 更新 `cove-ops` skill，加入 webhook username 命名规范
- 不涉及 webhook 创建逻辑（由 #451 处理）

## Decision Log

- ✅ 问题确认：agent 跨 channel 发消息未走 webhook，根因是缺少平台认知注入
- ❓ 注入内容的具体措辞和格式
- ❓ webhook username 命名格式
