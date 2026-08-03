import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { PermissionBits, type RecurringScheduleType } from "@cove/shared";

const VALID_SCHEDULE_TYPES = new Set<string>(["interval", "on_complete"]);

export function recurringTaskRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/recurring-tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    if (channel.type === 11) {
      return c.json({ message: "Cannot create recurring tasks inside a thread", code: 50035 }, 400);
    }

    const body = await parseJsonBody<{
      title: string;
      description?: string;
      assignee_id?: string;
      schedule_type: string;
      interval_ms?: number;
      heartbeat_interval_ms?: number;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleErr) return validationError(c, titleErr);

    if (!body.schedule_type || !VALID_SCHEDULE_TYPES.has(body.schedule_type)) {
      return validationError(c, "schedule_type must be one of: interval, on_complete");
    }

    if (body.schedule_type === "interval" && (!body.interval_ms || body.interval_ms <= 0)) {
      return validationError(c, "interval_ms must be a positive number for interval schedule type");
    }

    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const recurringTask = repos.recurringTasks.create({
      guild_id: channel.guild_id,
      channel_id: channelId,
      title: body.title.trim(),
      description: body.description,
      assignee_id: assigneeId,
      created_by: user.id,
      schedule_type: body.schedule_type as RecurringScheduleType,
      interval_ms: body.interval_ms,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });

    return c.json(recurringTask, 201);
  });

  app.get("/channels/:channelId/recurring-tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    await requireChannelPermission(repos, channelId, user.id, PermissionBits.VIEW_CHANNEL);

    const tasks = repos.recurringTasks.listByChannel(channelId);
    return c.json(tasks);
  });

  app.get("/recurring-tasks/:id", async (c) => {
    const id = c.req.param("id");
    const rt = repos.recurringTasks.getById(id);
    if (!rt) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, rt.channel_id, user.id, PermissionBits.VIEW_CHANNEL);

    return c.json(rt);
  });

  app.patch("/recurring-tasks/:id", async (c) => {
    const id = c.req.param("id");
    const rt = repos.recurringTasks.getById(id);
    if (!rt) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, rt.channel_id, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    const body = await parseJsonBody<{
      title?: string;
      description?: string;
      assignee_id?: string | null;
      interval_ms?: number;
      enabled?: boolean;
      heartbeat_interval_ms?: number;
    }>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.title !== undefined) {
      const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
      if (titleErr) return validationError(c, titleErr);
    }

    if (body.assignee_id !== undefined && body.assignee_id !== null) {
      const channel = repos.channels.getById(rt.channel_id);
      if (channel && !repos.members.exists(channel.guild_id, body.assignee_id)) {
        return c.json({ message: "Unknown Member", code: 10007 }, 404);
      }
    }

    const updated = repos.recurringTasks.update(id, {
      title: body.title?.trim(),
      description: body.description,
      assignee_id: body.assignee_id,
      interval_ms: body.interval_ms,
      enabled: body.enabled,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });

    return c.json(updated);
  });

  app.delete("/recurring-tasks/:id", async (c) => {
    const id = c.req.param("id");
    const rt = repos.recurringTasks.getById(id);
    if (!rt) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);

    const user = c.get("botUser");
    await requireChannelPermission(repos, rt.channel_id, user.id, PermissionBits.VIEW_CHANNEL);

    if (rt.created_by !== user.id) {
      try {
        await requireChannelPermission(repos, rt.channel_id, user.id, PermissionBits.MANAGE_CHANNELS);
      } catch {
        return c.json({ message: "Missing Permissions", code: 50013 }, 403);
      }
    }

    repos.recurringTasks.delete(id);

    return c.json({ deleted: true });
  });

  return app;
}
