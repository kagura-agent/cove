import { Hono } from "hono";
import type { Repos } from "../repos/index.js";
import type { GatewayDispatcher } from "../ws/dispatcher.js";
import type { AppEnv } from "../auth.js";
import { validateString, validationError, parseJsonBody } from "../validation.js";
import { requireChannelPermission } from "./helpers.js";
import {
  PermissionBits,
  TASK_STATUSES,
  type CreateTaskFields,
  type CreateTaskRecurrence,
  type TaskStatus,
  type UpdateTaskFields,
  type UpdateTaskRecurrence,
} from "@cove/shared";
import { createTaskOccurrence } from "../services/task-occurrence.js";
import { createRecurringTaskOccurrence, validateTaskRecurrence } from "../services/task-recurrence.js";

const VALID_STATUSES = new Set(TASK_STATUSES);

function hasField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function taskRoutes(repos: Repos, dispatcher?: GatewayDispatcher): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/channels/:channelId/tasks", async (c) => {
    const channelId = c.req.param("channelId");
    const user = c.get("botUser");

    const channel = await requireChannelPermission(repos, channelId, user.id, PermissionBits.SEND_MESSAGES | PermissionBits.VIEW_CHANNEL);

    if (channel.type === 11) {
      return c.json({ message: "Cannot create tasks inside a thread", code: 50035 }, 400);
    }

    const body = await parseJsonBody<CreateTaskFields>(c);
    if (!body) return validationError(c, "Invalid JSON");

    const titleErr = validateString(body.title, "title", { required: true, maxLength: 200 });
    if (titleErr) return validationError(c, titleErr);

    const hasRecurrence = hasField(body, "recurrence");
    if (hasRecurrence) {
      const recurrenceError = validateTaskRecurrence(body.recurrence, true);
      if (recurrenceError) return validationError(c, recurrenceError);
    }

    const assigneeId = body.assignee_id ?? null;
    if (assigneeId && !repos.members.exists(channel.guild_id, assigneeId)) {
      return c.json({ message: "Unknown Member", code: 10007 }, 404);
    }

    const result = repos.db.transaction(() => {
      if (hasRecurrence) {
        return createRecurringTaskOccurrence(repos, {
          channel,
          creator: user,
          title: body.title,
          description: body.description,
          assigneeId,
          heartbeatIntervalMs: body.heartbeat_interval_ms,
          recurrence: body.recurrence as CreateTaskRecurrence,
        }).occurrence;
      }
      return createTaskOccurrence(repos, {
        channel,
        creator: user,
        title: body.title,
        description: body.description,
        assigneeId,
        heartbeatIntervalMs: body.heartbeat_interval_ms,
      });
    })();

    dispatcher?.messageCreate(result.cardMessage);
    dispatcher?.threadCreate(result.thread);
    dispatcher?.messageCreate(result.assignmentMessage);
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

    const body = await parseJsonBody<UpdateTaskFields>(c);
    if (!body) return validationError(c, "Invalid JSON");

    if (body.status !== undefined && !VALID_STATUSES.has(body.status as TaskStatus)) {
      return validationError(c, "status must be one of: open, in_progress, in_review, done, cancelled");
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

    const hasRecurrence = hasField(body, "recurrence");
    const recurrence = body.recurrence;
    if (hasRecurrence && recurrence !== null) {
      const recurrenceError = validateTaskRecurrence(recurrence, !task.recurrence);
      if (recurrenceError) return validationError(c, recurrenceError);
    }
    if (hasRecurrence && task.recurrence && task.recurrence.root_task_id !== taskId) {
      return validationError(c, "recurrence must be updated through its root task");
    }

    const taskFields = {
      status: body.status,
      assignee_id: body.assignee_id,
      title: body.title?.trim(),
      description: body.description,
      heartbeat_interval_ms: body.heartbeat_interval_ms,
    };
    const templateFields = {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
      ...(body.heartbeat_interval_ms !== undefined ? { heartbeat_interval_ms: body.heartbeat_interval_ms } : {}),
    };

    const result = repos.db.transaction(() => {
      const updatedTask = repos.tasks.update(taskId, taskFields)!;
      const linkedRecurrence = task.recurrence;

      if (!hasRecurrence) {
        if (linkedRecurrence && linkedRecurrence.root_task_id === taskId) repos.recurringTasks.update(linkedRecurrence.id, templateFields);
        return { task: repos.tasks.getById(taskId)!, affected: [repos.tasks.getById(taskId)!] };
      }

      if (recurrence === null) {
        if (!linkedRecurrence) return { task: repos.tasks.getById(taskId)!, affected: [repos.tasks.getById(taskId)!] };
        const affectedTaskIds = repos.tasks.listByRecurringId(linkedRecurrence.id).map((occurrence) => occurrence.task_id);
        repos.tasks.clearRecurrenceAssociation(linkedRecurrence.id);
        repos.recurringTasks.delete(linkedRecurrence.id);
        const affected = affectedTaskIds.map((occurrenceId) => repos.tasks.getById(occurrenceId)!).filter(Boolean);
        return { task: repos.tasks.getById(taskId)!, affected };
      }

      const recurrenceFields = recurrence as UpdateTaskRecurrence;
      let recurrenceId = linkedRecurrence?.id;
      if (recurrenceId) {
        repos.recurringTasks.update(recurrenceId, { ...templateFields, ...recurrenceFields });
      } else {
        const template = repos.recurringTasks.create({
          guild_id: updatedTask.guild_id,
          channel_id: updatedTask.channel_id,
          title: updatedTask.title,
          description: updatedTask.description,
          assignee_id: updatedTask.assignee_id,
          created_by: updatedTask.created_by,
          interval_ms: recurrenceFields.interval_ms!,
          occurrence_mode: recurrenceFields.occurrence_mode,
          enabled: recurrenceFields.enabled,
          heartbeat_interval_ms: updatedTask.heartbeat_interval_ms,
        });
        repos.tasks.associateRecurrence(taskId, template.id);
        repos.recurringTasks.update(template.id, {
          last_task_id: taskId,
          last_spawned_at: Date.now(),
        });
        recurrenceId = template.id;
      }
      const affected = repos.tasks.listByRecurringId(recurrenceId);
      return { task: repos.tasks.getById(taskId)!, affected };
    })();

    for (const affectedTask of result.affected) dispatcher?.taskUpdated(affectedTask);
    return c.json(result.task);
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
