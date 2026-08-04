import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { PermissionBits, TASK_STATUSES, type TaskStatus } from "@cove/shared";
import { createTaskOccurrence } from "../services/task-occurrence.js";

const VALID_STATUSES = new Set(TASK_STATUSES);

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

    const result = repos.db.transaction(() => createTaskOccurrence(repos, {
      channel,
      creator: user,
      title: body.title,
      description: body.description,
      assigneeId,
      heartbeatIntervalMs: body.heartbeat_interval_ms,
    }))();

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

  app.get("/tasks/by-thread/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    const task = repos.tasks.getByThreadId(threadId);
    if (!task) return c.json(null, 200);

    const user = c.get("botUser");
    await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.VIEW_CHANNEL);

    return c.json(task);
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

    if (body.status !== undefined && !VALID_STATUSES.has(body.status as TaskStatus)) {
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
    await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.VIEW_CHANNEL);

    if (task.created_by !== user.id && task.assignee_id !== user.id) {
      try {
        await requireChannelPermission(repos, task.channel_id, user.id, PermissionBits.MANAGE_CHANNELS);
      } catch {
        return c.json({ message: "Missing Permissions", code: 50013 }, 403);
      }
    }

    repos.tasks.delete(taskId);
    dispatcher?.taskDeleted(task);

    return c.json({ deleted: true });
  });

  return app;
}
