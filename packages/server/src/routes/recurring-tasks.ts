import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import type { Repos } from "../repos/index.js";
import { parseJsonBody, validateFiniteNumber, validateString, validationError } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { PermissionBits, type RecurringScheduleType } from "@cove/shared";

const VALID_SCHEDULE_TYPES = new Set<RecurringScheduleType>(["interval", "on_complete"]);

function validateSchedule(scheduleType: unknown, intervalMs: unknown): string | null {
  if (typeof scheduleType !== "string" || !VALID_SCHEDULE_TYPES.has(scheduleType as RecurringScheduleType)) {
    return "schedule_type must be one of: interval, on_complete";
  }
  if (scheduleType === "interval") {
    const numberError = validateFiniteNumber(intervalMs, "interval_ms");
    if (numberError) return numberError;
    if (typeof intervalMs !== "number" || intervalMs <= 0) {
      return "interval_ms must be a positive number for interval schedule type";
    }
  }
  return null;
}

export function recurringTaskRoutes(repos: Repos): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/recurring-tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");
    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);
    if (channel.type === 11) return c.json({ message: "Cannot create recurring tasks inside a thread", code: 50035 }, 400);

    const body = await parseJsonBody<{ title: string; description?: string; assignee_id?: string; schedule_type: unknown; interval_ms?: unknown; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    const titleError = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleError) return validationError(c, titleError);
    const scheduleError = validateSchedule(body.schedule_type, body.interval_ms);
    if (scheduleError) return validationError(c, scheduleError);
    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) return c.json({ message: "Unknown Member", code: 10007 }, 404);

    const recurringTask = repos.recurringTasks.create({
      guild_id: channel.guild_id,
      channel_id: channelId,
      title: body.title.trim(),
      description: body.description,
      assignee_id: assigneeId,
      created_by: user.id,
      schedule_type: body.schedule_type as RecurringScheduleType,
      interval_ms: body.interval_ms as number | undefined,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });
    return c.json(recurringTask, 201);
  });

  app.get("/channels/:channelId/recurring-tasks", async (c) => {
    const channelId = c.req.param("channelId");
    await requireChannelPermission(repos, channelId, c.get("botUser").id, PermissionBits.VIEW_CHANNEL);
    return c.json(repos.recurringTasks.listByChannel(channelId));
  });

  app.get("/recurring-tasks/:id", async (c) => {
    const recurringTask = repos.recurringTasks.getById(c.req.param("id"));
    if (!recurringTask) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);
    await requireChannelPermission(repos, recurringTask.channel_id, c.get("botUser").id, PermissionBits.VIEW_CHANNEL);
    return c.json(recurringTask);
  });

  app.patch("/recurring-tasks/:id", async (c) => {
    const recurringTask = repos.recurringTasks.getById(c.req.param("id"));
    if (!recurringTask) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);
    const user = c.get("botUser");
    await requireChannelPermission(repos, recurringTask.channel_id, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    const body = await parseJsonBody<{ title?: unknown; description?: string; assignee_id?: string | null; schedule_type?: unknown; interval_ms?: unknown; enabled?: boolean; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    if (body.title !== undefined) {
      const titleError = validateString(body.title, "title", { required: true, maxLength: 200 });
      if (titleError) return validationError(c, titleError);
    }
    const scheduleType = body.schedule_type ?? recurringTask.schedule_type;
    const intervalMs = body.interval_ms ?? recurringTask.interval_ms;
    if (body.schedule_type !== undefined || body.interval_ms !== undefined) {
      const scheduleError = validateSchedule(scheduleType, intervalMs);
      if (scheduleError) return validationError(c, scheduleError);
    }
    if (body.assignee_id !== undefined && body.assignee_id !== null && !repos.members.exists(recurringTask.guild_id, body.assignee_id)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const updated = repos.recurringTasks.update(recurringTask.id, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      description: body.description,
      assignee_id: body.assignee_id,
      schedule_type: body.schedule_type as RecurringScheduleType | undefined,
      interval_ms: body.interval_ms as number | undefined,
      enabled: body.enabled,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });
    return c.json(updated);
  });

  app.delete("/recurring-tasks/:id", async (c) => {
    const recurringTask = repos.recurringTasks.getById(c.req.param("id"));
    if (!recurringTask) return c.json({ message: "Unknown Recurring Task", code: 10080 }, 404);
    const user = c.get("botUser");
    await requireChannelPermission(repos, recurringTask.channel_id, user.id, PermissionBits.VIEW_CHANNEL);
    if (recurringTask.created_by !== user.id) {
      try {
        await requireChannelPermission(repos, recurringTask.channel_id, user.id, PermissionBits.MANAGE_CHANNELS);
      } catch {
        return c.json({ message: "Missing Permissions", code: 50013 }, 403);
      }
    }
    repos.recurringTasks.delete(recurringTask.id);
    return c.json({ deleted: true });
  });

  return app;
}
