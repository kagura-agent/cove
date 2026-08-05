import type { Channel, CreateTaskRecurrence, RecurringTask, RecurringTaskOccurrenceMode, User } from "@cove/shared";
import type { Repos } from "../repos/index.js";
import { validateFiniteNumber } from "../validation.js";
import { createTaskOccurrence, type TaskOccurrence } from "./task-occurrence.js";

const VALID_OCCURRENCE_MODES = new Set<RecurringTaskOccurrenceMode>(["same_task", "new_task"]);

export function validateInterval(intervalMs: unknown, name = "interval_ms"): string | null {
  const numberError = validateFiniteNumber(intervalMs, name);
  if (numberError) return numberError;
  if (typeof intervalMs !== "number" || intervalMs <= 0) return `${name} must be a positive number`;
  return null;
}

export function validateOccurrenceMode(occurrenceMode: unknown, name = "occurrence_mode"): string | null {
  if (typeof occurrenceMode !== "string" || !VALID_OCCURRENCE_MODES.has(occurrenceMode as RecurringTaskOccurrenceMode)) {
    return `${name} must be one of: same_task, new_task`;
  }
  return null;
}

export function validateTaskRecurrence(value: unknown, requireInterval: boolean): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "recurrence must be an object";
  const recurrence = value as Record<string, unknown>;
  if (requireInterval && recurrence.interval_ms === undefined) return "recurrence.interval_ms is required";
  if (recurrence.interval_ms !== undefined) {
    const error = validateInterval(recurrence.interval_ms, "recurrence.interval_ms");
    if (error) return error;
  }
  if (recurrence.occurrence_mode !== undefined) {
    const error = validateOccurrenceMode(recurrence.occurrence_mode, "recurrence.occurrence_mode");
    if (error) return error;
  }
  if (recurrence.enabled !== undefined && typeof recurrence.enabled !== "boolean") return "recurrence.enabled must be a boolean";
  return null;
}

export interface CreateRecurringTaskOccurrenceInput {
  channel: Channel;
  creator: User;
  title: string;
  description?: string;
  assigneeId?: string | null;
  heartbeatIntervalMs?: number;
  recurrence: CreateTaskRecurrence;
}

export interface RecurringTaskOccurrenceResult {
  recurringTask: RecurringTask;
  occurrence: TaskOccurrence;
}

export function createRecurringTaskOccurrence(repos: Repos, input: CreateRecurringTaskOccurrenceInput): RecurringTaskOccurrenceResult {
  const recurringTask = repos.recurringTasks.create({
    guild_id: input.channel.guild_id,
    channel_id: input.channel.id,
    title: input.title.trim(),
    description: input.description,
    assignee_id: input.assigneeId,
    created_by: input.creator.id,
    interval_ms: input.recurrence.interval_ms,
    occurrence_mode: input.recurrence.occurrence_mode,
    enabled: input.recurrence.enabled,
    heartbeat_interval_ms: input.heartbeatIntervalMs,
  });
  const occurrence = createTaskOccurrence(repos, {
    channel: input.channel,
    creator: input.creator,
    title: recurringTask.title,
    description: recurringTask.description,
    assigneeId: recurringTask.assignee_id,
    heartbeatIntervalMs: recurringTask.heartbeat_interval_ms,
    recurring: { id: recurringTask.id, seq: 1 },
  });
  const updatedRecurringTask = repos.recurringTasks.update(recurringTask.id, {
    last_task_id: occurrence.task.task_id,
    last_spawned_at: Date.now(),
  })!;
  return {
    recurringTask: updatedRecurringTask,
    occurrence: { ...occurrence, task: repos.tasks.getById(occurrence.task.task_id)! },
  };
}
