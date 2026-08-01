import type { AgentToolResult } from "openclaw/plugin-sdk/agent-core";
import type { ChannelMessageActionContext } from "openclaw/plugin-sdk/channel-contract";
import { readStringParam, readPositiveIntegerParam, jsonResult } from "openclaw/plugin-sdk/channel-actions";
import { resolveAccount, getRestClient } from "./channel.js";

export async function handleCoveMessageAction(ctx: ChannelMessageActionContext): Promise<AgentToolResult<unknown>> {
  const { action, params, cfg, accountId } = ctx;
  const account = resolveAccount(cfg, accountId);
  const client = getRestClient(account.baseUrl, account.token);
  const target = readStringParam(params, "target")
    ?? readStringParam(params, "channelId")
    ?? readStringParam(params, "to");

  switch (action) {
    // P0: core actions
    case "react": {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      const emoji = readStringParam(params, "emoji", { required: true })!;
      await client.addReaction(target!, messageId, emoji);
      return jsonResult({ ok: true, action: "react", messageId, emoji });
    }
    case "read": {
      const limit = readPositiveIntegerParam(params, "limit") ?? 50;
      const before = readStringParam(params, "before");
      const after = readStringParam(params, "after");
      const messages = await client.getMessages(target!, { limit, before, after });
      return jsonResult({ ok: true, action: "read", messages });
    }
    case "edit": {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      const message = readStringParam(params, "message", { required: true })!;
      const result = await client.editMessage(target!, messageId, message);
      return jsonResult({ ok: true, action: "edit", message: result });
    }
    case "delete": {
      const messageId = readStringParam(params, "messageId", { required: true })!;
      await client.deleteMessage(target!, messageId);
      return jsonResult({ ok: true, action: "delete", messageId });
    }
    // P1: thread actions
    case "thread-create": {
      const threadName = readStringParam(params, "threadName", { required: true })!;
      const messageId = readStringParam(params, "messageId");
      const autoArchiveMin = readPositiveIntegerParam(params, "autoArchiveMin");
      const thread = messageId
        ? await client.createThreadFromMessage(target!, messageId, threadName, autoArchiveMin)
        : await client.createThread(target!, threadName, autoArchiveMin);
      return jsonResult({ ok: true, action: "thread-create", thread });
    }
    case "thread-list": {
      const result = await client.listActiveThreads(target!);
      return jsonResult({ ok: true, action: "thread-list", threads: result.threads });
    }
    // P1: channel info
    case "channel-info": {
      const channel = await client.getChannel(target!);
      return jsonResult({ ok: true, action: "channel-info", channel });
    }
    case "channel-list": {
      if (!account.guildId) throw new Error("Cove: guildId required for channel-list");
      const channels = await client.getChannels(account.guildId);
      return jsonResult({ ok: true, action: "channel-list", channels });
    }
    // Task actions
    case "task-create" as string: {
      const title = readStringParam(params, "title", { required: true })!;
      const assigneeId = readStringParam(params, "assigneeId");
      const task = await client.createTask(target!, title, assigneeId ?? undefined);
      return jsonResult({ ok: true, action: "task-create", task });
    }
    case "task-list" as string: {
      const tasks = await client.getTasks(target!);
      return jsonResult({ ok: true, action: "task-list", tasks });
    }
    case "task-get" as string: {
      const taskId = readStringParam(params, "taskId", { required: true })!;
      const task = await client.getTask(taskId);
      return jsonResult({ ok: true, action: "task-get", task });
    }
    case "task-update" as string: {
      const taskId = readStringParam(params, "taskId", { required: true })!;
      const status = readStringParam(params, "status");
      const assigneeId = readStringParam(params, "assigneeId");
      const title = readStringParam(params, "title");
      const task = await client.updateTask(taskId, {
        ...(status ? { status } : {}),
        ...(assigneeId !== undefined ? { assignee_id: assigneeId } : {}),
        ...(title ? { title } : {}),
      });
      return jsonResult({ ok: true, action: "task-update", task });
    }
    default:
      throw new Error(`cove: unsupported message action: ${action}`);
  }
}
