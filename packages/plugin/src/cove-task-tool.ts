/**
 * Cove Task tool — standalone agent tool for task operations.
 *
 * Registered via registerFull hook, NOT as a message action.
 * Host message action vocabulary is closed; custom actions get rejected.
 * This tool owns its own JSON Schema and routes through the plugin's REST client.
 */

import { Type } from "typebox";
import { resolveAccount, getRestClient } from "./channel.js";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], details: data };
}

export function createCoveTaskTool(opts: { cfg: any }) {
  return {
    name: "cove_task",
    label: "Cove Task",
    description: "Manage tasks and recurring task templates in Cove channels. Actions: create, list, get, update, recurring_create, recurring_list, recurring_get, recurring_update, recurring_delete. Use this tool — do not call Cove's REST API directly for tasks.",
    parameters: Type.Object({
      action: Type.String({ description: "Task action or recurring task action: create, list, get, update, recurring_create, recurring_list, recurring_get, recurring_update, recurring_delete" }),
      channelId: Type.Optional(Type.String({ description: "Channel ID (required for create, list, recurring_create, recurring_list)" })),
      taskId: Type.Optional(Type.String({ description: "Task ID (required for get, update)" })),
      recurringTaskId: Type.Optional(Type.String({ description: "Recurring task template ID (required for recurring_get, recurring_update, recurring_delete)" })),
      scheduleType: Type.Optional(Type.String({ description: "Recurring schedule type: interval or on_complete" })),
      intervalMs: Type.Optional(Type.Number({ description: "Recurring interval in ms (required for interval schedules)" })),
      occurrenceMode: Type.Optional(Type.String({ description: "Recurring occurrence mode: same_task or new_task" })),
      enabled: Type.Optional(Type.Boolean({ description: "Whether a recurring template is enabled" })),
      title: Type.Optional(Type.String({ description: "Task title (required for create)" })),
      assigneeId: Type.Optional(Type.String({ description: "User ID to assign the task to" })),
      status: Type.Optional(Type.String({ description: "Task status: open, in_progress, in_review, done, cancelled (for update)" })),
      heartbeatIntervalMs: Type.Optional(Type.Number({ description: "Heartbeat interval in ms. 0 = disabled (for update)" })),
      description: Type.Optional(Type.String({ description: "Task description (optional for create)" })),
    }, { additionalProperties: false }),
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = String(rawParams.action ?? "");
      const channelId = rawParams.channelId as string | undefined;
      const taskId = rawParams.taskId as string | undefined;
      const recurringTaskId = rawParams.recurringTaskId as string | undefined;
      const title = rawParams.title as string | undefined;
      const assigneeId = rawParams.assigneeId as string | undefined;
      const status = rawParams.status as string | undefined;
      const description = rawParams.description as string | undefined;
      const scheduleType = rawParams.scheduleType as "interval" | "on_complete" | undefined;
      const intervalMs = rawParams.intervalMs as number | undefined;
      const occurrenceMode = rawParams.occurrenceMode as "same_task" | "new_task" | undefined;
      const enabled = rawParams.enabled as boolean | undefined;
      const heartbeatIntervalMs = rawParams.heartbeatIntervalMs as number | undefined;

      let account;
      try {
        account = resolveAccount(opts.cfg, null);
      } catch (err: any) {
        return jsonResult({ ok: false, error: err.message });
      }
      const client = getRestClient(account.baseUrl, account.token);

      switch (action) {
        case "create": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for create" });
          if (!title) return jsonResult({ ok: false, error: "title is required for create" });
          const task = await client.createTask(channelId, title, assigneeId, description);
          return jsonResult({
            ok: true,
            action: "create",
            task,
            _hint: "Task created successfully. Reply to the user confirming the task was created, then stop. Do not start working on the task here — the assignee will handle it in the task thread.",
          });
        }
        case "list": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for list" });
          const tasks = await client.getTasks(channelId);
          return jsonResult({ ok: true, action: "list", tasks });
        }
        case "get": {
          if (!taskId) return jsonResult({ ok: false, error: "taskId is required for get" });
          const task = await client.getTask(taskId);
          return jsonResult({ ok: true, action: "get", task });
        }
        case "update": {
          if (!taskId) return jsonResult({ ok: false, error: "taskId is required for update" });
          const fields: Record<string, unknown> = {};
          if (status) fields.status = status;
          if (assigneeId !== undefined) fields.assignee_id = assigneeId;
          if (title) fields.title = title;
          if (description !== undefined) fields.description = description;
          if (heartbeatIntervalMs !== undefined) fields.heartbeat_interval_ms = heartbeatIntervalMs;
          const task = await client.updateTask(taskId, fields as any);
          return jsonResult({ ok: true, action: "update", task });
        }
        case "recurring_create": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for recurring_create" });
          if (!title) return jsonResult({ ok: false, error: "title is required for recurring_create" });
          if (scheduleType !== "interval" && scheduleType !== "on_complete") return jsonResult({ ok: false, error: "scheduleType must be interval or on_complete for recurring_create" });
          if (occurrenceMode !== undefined && occurrenceMode !== "same_task" && occurrenceMode !== "new_task") return jsonResult({ ok: false, error: "occurrenceMode must be same_task or new_task for recurring_create" });
          if (scheduleType === "interval" && (!intervalMs || intervalMs <= 0)) return jsonResult({ ok: false, error: "intervalMs must be positive for interval schedules" });
          const recurringTask = await client.createRecurringTask(channelId, {
            title,
            description,
            assignee_id: assigneeId,
            schedule_type: scheduleType,
            interval_ms: intervalMs,
            occurrence_mode: occurrenceMode,
            heartbeat_interval_ms: heartbeatIntervalMs,
          });
          return jsonResult({ ok: true, action: "recurring_create", recurringTask });
        }
        case "recurring_list": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for recurring_list" });
          const recurringTasks = await client.getRecurringTasks(channelId);
          return jsonResult({ ok: true, action: "recurring_list", recurringTasks });
        }
        case "recurring_get": {
          if (!recurringTaskId) return jsonResult({ ok: false, error: "recurringTaskId is required for recurring_get" });
          const recurringTask = await client.getRecurringTask(recurringTaskId);
          return jsonResult({ ok: true, action: "recurring_get", recurringTask });
        }
        case "recurring_update": {
          if (!recurringTaskId) return jsonResult({ ok: false, error: "recurringTaskId is required for recurring_update" });
          if (scheduleType !== undefined && scheduleType !== "interval" && scheduleType !== "on_complete") return jsonResult({ ok: false, error: "scheduleType must be interval or on_complete" });
          if (occurrenceMode !== undefined && occurrenceMode !== "same_task" && occurrenceMode !== "new_task") return jsonResult({ ok: false, error: "occurrenceMode must be same_task or new_task" });
          if (intervalMs !== undefined && intervalMs <= 0) return jsonResult({ ok: false, error: "intervalMs must be positive" });
          const fields: Record<string, unknown> = {};
          if (title !== undefined) fields.title = title;
          if (description !== undefined) fields.description = description;
          if (assigneeId !== undefined) fields.assignee_id = assigneeId;
          if (scheduleType !== undefined) fields.schedule_type = scheduleType;
          if (intervalMs !== undefined) fields.interval_ms = intervalMs;
          if (occurrenceMode !== undefined) fields.occurrence_mode = occurrenceMode;
          if (enabled !== undefined) fields.enabled = enabled;
          if (heartbeatIntervalMs !== undefined) fields.heartbeat_interval_ms = heartbeatIntervalMs;
          const recurringTask = await client.updateRecurringTask(recurringTaskId, fields);
          return jsonResult({ ok: true, action: "recurring_update", recurringTask });
        }
        case "recurring_delete": {
          if (!recurringTaskId) return jsonResult({ ok: false, error: "recurringTaskId is required for recurring_delete" });
          await client.deleteRecurringTask(recurringTaskId);
          return jsonResult({ ok: true, action: "recurring_delete" });
        }
        default:
          return jsonResult({ ok: false, error: `Unknown action: ${action}. Use one of: create, list, get, update, recurring_create, recurring_list, recurring_get, recurring_update, recurring_delete` });
      }
    },
  };
}
