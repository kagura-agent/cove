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

    const body = await parseJsonBody<{ title: string; assignee_id?: string }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleErr) return validationError(c, titleErr);

    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const task = repos.db.transaction(() => {
      const seq = repos.tasks.getNextSeq(channelId);
      const now = Date.now();
      const messageId = generateSnowflake();

      const cardContent = JSON.stringify({ title: body.title.trim(), status: "open", assignee_id: assigneeId, seq });
      const metadata = JSON.stringify({ content_type: "task" });
      repos.db.prepare(
        "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(messageId, channelId, user.id, user.username, cardContent, now, metadata, null);
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
        metadata,
      };

      const thread = repos.threads.createFromMessage(
        channel.guild_id,
        channelId,
        messageId,
        body.title.trim(),
        user.id,
      );

      if (assigneeId && assigneeId !== user.id) {
        repos.threads.addMember(thread.id, assigneeId);
      }

      const assignmentNow = Date.now();
      const assignmentId = generateSnowflake();
      const assignmentContent = assigneeId
        ? `Task #${seq} assigned`
        : `Task #${seq} created`;
      repos.db.prepare(
        "INSERT INTO messages (id, channel_id, sender, sender_name, content, timestamp, metadata, edited_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(assignmentId, thread.id, user.id, user.username, assignmentContent, assignmentNow, JSON.stringify({ content_type: "task_assignment" }), null);

      const task = repos.tasks.create(channelId, thread.id, messageId, assigneeId, body.title.trim(), seq);

      dispatcher?.messageCreate(cardMessage);
      dispatcher?.threadCreate(thread);
      dispatcher?.taskCreated(task);

      return task;
    })();

    return c.json(task, 201);
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

    const body = await parseJsonBody<{ status?: string; assignee_id?: string | null; title?: string }>(c);
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
    });

    if (updated) {
      dispatcher?.taskUpdated(updated);
    }

    return c.json(updated);
  });

  return app;
}
