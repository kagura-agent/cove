import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { generateSnowflake, PermissionBits, type Message, type Task } from "@cove/shared";

const VALID_STATUSES = new Set(["open", "in_progress", "in_review", "done"]);

export function taskRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    if (channel.type === 11) {
      return c.json({ message: "Cannot create tasks inside a thread", code: 50035 }, 400);
    }

    const body = await parseJsonBody<{ title: string; assignee_id?: string; description?: string; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleErr) return validationError(c, titleErr);

    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const result = repos.db.transaction(() => {
      const seq = repos.tasks.getNextSeq(channelId);
      const now = Date.now();
      const messageId = generateSnowflake();
      const taskId = generateSnowflake();
      const title = body.title.trim();

      // 1. Card message — skip_agent_notify so it doesn't trigger agent sessions
      const cardContent = JSON.stringify({ title, status: "open", assignee_id: assigneeId, seq });
      const cardMetadata = JSON.stringify({ content_type: "task", skip_agent_notify: true });
      repos.db.prepare(
        "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(messageId, channelId, user.id, user.username, cardContent, now, cardMetadata, null);
      const cardMessage: Message = {
        id: messageId,
        channel_id: channelId,
        content: cardContent,
        author: { id: user.id, username: user.username, bot: user.bot, avatar: user.avatar ?? null, discriminator: user.discriminator ?? "0", global_name: user.global_name ?? null },
        timestamp: new Date(now).toISOString(),
        edited_timestamp: null,
        type: 0,
        attachments: [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        pinned: false,
        tts: false,
        mention_everyone: false,
        metadata: cardMetadata,
      };

      // 2. Derive thread from card message (name: first 30 chars by codepoint)
      const threadName = [...title].slice(0, 30).join("");
      const thread = repos.threads.createFromMessage(
        channel.guild_id,
        channelId,
        messageId,
        threadName,
        user.id,
      );

      // 3. Add assignee to thread members
      if (assigneeId && assigneeId !== user.id) {
        repos.threads.addMember(thread.id, assigneeId);
      }
      // Add channel owner if they are still a guild member and not already in thread
      if (channel.owner_id && channel.owner_id !== user.id && channel.owner_id !== assigneeId) {
        if (repos.members.exists(channel.guild_id, channel.owner_id)) {
          repos.threads.addMember(thread.id, channel.owner_id);
        }
      }

      // 4. Assignment message in thread — this is the signal that wakes the agent.
      //    DB stores real author; WS frame rewrites to "system" (see below).
      //    Preamble carries all instructions so agent doesn't need to understand "task".
      const assignmentNow = Date.now();
      const assignmentId = generateSnowflake();
      const preamble = [
        `This is a task assignment (task_id: ${taskId}).`,
        `Title: ${title}`,
        `工作属于这个 thread，就在这里做。`,
        `开工时用 cove_task 工具设 status 为 in_progress（action: "update", taskId: "${taskId}", status: "in_progress"）。`,
        `完成后用 cove_task 设 status 为 in_review 并 @通知相关人验收。`,
        `不要用 curl 调 REST API，用 cove_task 工具。`,
      ].join("\n");
      const assignmentContent = preamble;
      const assignmentMetadata = JSON.stringify({ content_type: "task_assignment" });
      repos.db.prepare(
        "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(assignmentId, thread.id, user.id, user.username, assignmentContent, assignmentNow, assignmentMetadata, null);

      // Build the WS frame for assignment — rewrite author to "system"
      // so agent's self-loop filter doesn't discard it when agent assigns to itself
      const assignmentMessage: Message = {
        id: assignmentId,
        channel_id: thread.id,
        content: assignmentContent,
        author: { id: "system", username: "System", bot: false, avatar: null, discriminator: "0", global_name: "System" },
        timestamp: new Date(assignmentNow).toISOString(),
        edited_timestamp: null,
        type: 0,
        attachments: [],
        embeds: [],
        mentions: [],
        mention_roles: [],
        pinned: false,
        tts: false,
        mention_everyone: false,
        metadata: assignmentMetadata,
      };

      // 5. Task row — written last. Agent may receive message before this exists.
      const task = repos.tasks.create(taskId, channelId, thread.id, messageId, assigneeId, title, seq, { guild_id: channel.guild_id, description: body.description ?? "", created_by: user.id });

      // Set heartbeat if requested
      if (body.heartbeat_interval_ms && body.heartbeat_interval_ms > 0) {
        repos.tasks.update(taskId, { heartbeat_interval_ms: body.heartbeat_interval_ms, heartbeat_last_at: Date.now() });
        task.heartbeat_interval_ms = body.heartbeat_interval_ms;
        task.heartbeat_last_at = Date.now();
      }

      return { cardMessage, thread, assignmentMessage, task };
    })();

    // Broadcast outside transaction
    dispatcher?.messageCreate(result.cardMessage);   // skip_agent_notify in metadata
    dispatcher?.threadCreate(result.thread);
    dispatcher?.messageCreate(result.assignmentMessage);  // this wakes the agent
    dispatcher?.taskCreated(result.task);

    return c.json(result.task, 201);
  });

  app.get("/channels/:channelId/tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    await requireChannelPermission(repos, channelId, user.id, PermissionBits.VIEW_CHANNEL);

    const tasks = repos.tasks.listByChannel(channelId);
    return c.json(tasks);
  });

  app.get("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const task = repos.tasks.getById(taskId);
    if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.VIEW_CHANNEL);

    return c.json(task);
  });

  app.patch("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const task = repos.tasks.getById(taskId);
    if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    const body = await parseJsonBody<{ status?: string; assignee_id?: string | null; title?: string; description?: string; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return validationError(c, "status must be one of: open, in_progress, in_review, done");
    }

    if (body.title !== undefined) {
      const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
      if (titleErr) return validationError(c, titleErr);
    }

    if (body.assignee_id !== undefined && body.assignee_id !== null) {
      const channel = repos.channels.getById(task.channel_id);
      if (channel && !repos.members.exists(channel.guild_id, body.assignee_id)) {
        return c.json({ message: "Unknown Member", code: 10007 }, 404);
      }
    }

    const updated = repos.tasks.update(taskId, {
      status: body.status,
      assignee_id: body.assignee_id,
      title: body.title?.trim(),
      description: body.description,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });

    if (updated) {
      dispatcher?.taskUpdated(updated);
    }

    return c.json(updated);
  });

  app.delete("/tasks/:taskId", async (c) => {
    const taskId = c.req.param("taskId");
    const task = repos.tasks.getById(taskId);
    if (!task) return c.json({ message: "Unknown Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    repos.tasks.delete(taskId);
    dispatcher?.taskDeleted(task);

    return c.json({ deleted: true });
  });

  return app;
}
