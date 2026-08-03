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
    description: "Manage tasks in Cove channels. Actions: create, list, get, update, create_recurring, list_recurring, update_recurring, delete_recurring. Use this tool — do not call Cove's REST API directly for tasks.",
    parameters: Type.Object({
      action: Type.String({ description: "One of: create, list, get, update, create_recurring, list_recurring, update_recurring, delete_recurring" }),
      channelId: Type.Optional(Type.String({ description: "Channel ID (required for create, list, create_recurring, list_recurring)" })),
      taskId: Type.Optional(Type.String({ description: "Task ID (required for get, update)" })),
      recurringTaskId: Type.Optional(Type.String({ description: "Recurring task template ID (required for update_recurring, delete_recurring)" })),
      title: Type.Optional(Type.String({ description: "Task title (required for create, create_recurring)" })),
      assigneeId: Type.Optional(Type.String({ description: "User ID to assign the task to" })),
      status: Type.Optional(Type.String({ description: "Task status: open, in_progress, in_review, done, cancelled (for update)" })),
      heartbeatIntervalMs: Type.Optional(Type.Number({ description: "Heartbeat interval in ms. 0 = disabled (for update)" })),
      description: Type.Optional(Type.String({ description: "Task description (optional for create)" })),
      scheduleType: Type.Optional(Type.String({ description: "Schedule type: interval or on_complete (required for create_recurring)" })),
      intervalMs: Type.Optional(Type.Number({ description: "Interval in ms between task spawns (required for interval schedule type)" })),
      enabled: Type.Optional(Type.Boolean({ description: "Enable/disable recurring task (for update_recurring)" })),
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
          const heartbeatInterval = rawParams.heartbeatIntervalMs as number | undefined;
          if (heartbeatInterval !== undefined) fields.heartbeat_interval_ms = heartbeatInterval;
          const task = await client.updateTask(taskId, fields as any);
          return jsonResult({ ok: true, action: "update", task });
        }
        case "create_recurring": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for create_recurring" });
          if (!title) return jsonResult({ ok: false, error: "title is required for create_recurring" });
          const scheduleType = rawParams.scheduleType as string | undefined;
          if (!scheduleType) return jsonResult({ ok: false, error: "scheduleType is required for create_recurring (interval or on_complete)" });
          const intervalMs = rawParams.intervalMs as number | undefined;
          const rt = await client.createRecurringTask(channelId, {
            title,
            description,
            assignee_id: assigneeId,
            schedule_type: scheduleType,
            interval_ms: intervalMs,
            heartbeat_interval_ms: rawParams.heartbeatIntervalMs as number | undefined,
          });
          return jsonResult({ ok: true, action: "create_recurring", recurringTask: rt });
        }
        case "list_recurring": {
          if (!channelId) return jsonResult({ ok: false, error: "channelId is required for list_recurring" });
          const rts = await client.getRecurringTasks(channelId);
          return jsonResult({ ok: true, action: "list_recurring", recurringTasks: rts });
        }
        case "update_recurring": {
          if (!recurringTaskId) return jsonResult({ ok: false, error: "recurringTaskId is required for update_recurring" });
          const fields: Record<string, unknown> = {};
          if (title) fields.title = title;
          if (description !== undefined) fields.description = description;
          if (assigneeId !== undefined) fields.assignee_id = assigneeId;
          const intervalMsVal = rawParams.intervalMs as number | undefined;
          if (intervalMsVal !== undefined) fields.interval_ms = intervalMsVal;
          const enabledVal = rawParams.enabled as boolean | undefined;
          if (enabledVal !== undefined) fields.enabled = enabledVal;
          const hbMs = rawParams.heartbeatIntervalMs as number | undefined;
          if (hbMs !== undefined) fields.heartbeat_interval_ms = hbMs;
          const rt = await client.updateRecurringTask(recurringTaskId, fields as any);
          return jsonResult({ ok: true, action: "update_recurring", recurringTask: rt });
        }
        case "delete_recurring": {
          if (!recurringTaskId) return jsonResult({ ok: false, error: "recurringTaskId is required for delete_recurring" });
          await client.deleteRecurringTask(recurringTaskId);
          return jsonResult({ ok: true, action: "delete_recurring", deleted: true });
        }
        default:
          return jsonResult({ ok: false, error: `Unknown action: ${action}. Use one of: create, list, get, update, create_recurring, list_recurring, update_recurring, delete_recurring` });
      }
    },
  };
}
