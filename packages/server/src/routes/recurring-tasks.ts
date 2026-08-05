import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import { parseJsonBody, validateString, validationError } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import { PermissionBits, type RecurringTaskOccurrenceMode } from "@cove/shared";
import { createRecurringTaskOccurrence, validateInterval, validateOccurrenceMode } from "../services/task-recurrence.js";

export function recurringTaskRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/recurring-tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");
    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);
    if (channel.type === 11) return c.json({ message: "Cannot create recurring tasks inside a thread", code: 50035 }, 400);

    const body = await parseJsonBody<{ title: string; description?: string; assignee_id?: string; interval_ms?: unknown; occurrence_mode?: unknown; enabled?: unknown; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    const titleError = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleError) return validationError(c, titleError);
    const intervalError = validateInterval(body.interval_ms);
    if (intervalError) return validationError(c, intervalError);
    const occurrenceMode = body.occurrence_mode ?? "same_task";
    const occurrenceModeError = validateOccurrenceMode(occurrenceMode);
    if (occurrenceModeError) return validationError(c, occurrenceModeError);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return validationError(c, "enabled must be a boolean");
    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) return c.json({ message: "Unknown Member", code: 10007 }, 404);

    const result = repos.db.transaction(() => createRecurringTaskOccurrence(repos, {
      channel,
      creator: user,
      title: body.title,
      description: body.description,
      assigneeId,
      heartbeatIntervalMs: body.heartbeat_interval_ms,
      recurrence: {
        interval_ms: body.interval_ms as number,
        occurrence_mode: occurrenceMode as RecurringTaskOccurrenceMode,
        enabled: body.enabled as boolean | undefined,
      },
    }))();

    dispatcher?.messageCreate(result.occurrence.cardMessage);
    dispatcher?.threadCreate(result.occurrence.thread);
    dispatcher?.messageCreate(result.occurrence.assignmentMessage);
    dispatcher?.taskCreated(result.occurrence.task);

    return c.json(result.recurringTask, 201);
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

    const body = await parseJsonBody<{ title?: unknown; description?: string; assignee_id?: string | null; interval_ms?: unknown; occurrence_mode?: unknown; enabled?: unknown; heartbeat_interval_ms?: number }>(c);
    if (!body) return validationError(c, "Invalid JSON");
    if (body.title !== undefined) {
      const titleError = validateString(body.title, "title", { required: true, maxLength: 200 });
      if (titleError) return validationError(c, titleError);
    }
    if (body.interval_ms !== undefined) {
      const intervalError = validateInterval(body.interval_ms);
      if (intervalError) return validationError(c, intervalError);
    }
    if (body.occurrence_mode !== undefined) {
      const occurrenceModeError = validateOccurrenceMode(body.occurrence_mode);
      if (occurrenceModeError) return validationError(c, occurrenceModeError);
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") return validationError(c, "enabled must be a boolean");
    if (body.assignee_id !== undefined && body.assignee_id !== null && !repos.members.exists(recurringTask.guild_id, body.assignee_id)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const updated = repos.recurringTasks.update(recurringTask.id, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      description: body.description,
      assignee_id: body.assignee_id,
      interval_ms: body.interval_ms as number | undefined,
      occurrence_mode: body.occurrence_mode as RecurringTaskOccurrenceMode | undefined,
      enabled: body.enabled as boolean | undefined,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    });
    if (updated) {
      for (const occurrence of repos.tasks.listByRecurringId(updated.id)) dispatcher?.taskUpdated(occurrence);
    }
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
    const affected = repos.db.transaction(() => {
      const taskIds = repos.tasks.listByRecurringId(recurringTask.id).map((task) => task.task_id);
      repos.tasks.clearRecurrenceAssociation(recurringTask.id);
      repos.recurringTasks.delete(recurringTask.id);
      return taskIds.map((taskId) => repos.tasks.getById(taskId)!);
    })();
    for (const task of affected) dispatcher?.taskUpdated(task);
    return c.json({ deleted: true });
  });

  return app;
}
