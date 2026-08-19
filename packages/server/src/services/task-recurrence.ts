import type { Channel, CreateTaskRecurrence, RecurringTask, RecurringTaskOccurrenceMode, User } from "@cove/shared";
import type { Repos } from "../repos/index.js";
import { validateFiniteNumber } from "../validation.js";
import { validateCatchUp, validateCronExpression } from "./recurrence-schedule.js";
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

/**
 * Validates a recurrence schedule object. Exactly one of interval_ms and
 * cron_expr must be provided (mutually exclusive); cron_tz/catch_up only
 * apply to cron schedules.
 */
export function validateTaskRecurrence(value: unknown, requireSchedule: boolean): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "recurrence must be an object";
  const recurrence = value as Record<string, unknown>;
  const hasInterval = recurrence.interval_ms !== undefined;
  const hasCron = recurrence.cron_expr !== undefined;
  if (hasInterval && hasCron) return "recurrence.interval_ms and recurrence.cron_expr are mutually exclusive";
  if (requireSchedule && !hasInterval && !hasCron) return "recurrence.interval_ms or recurrence.cron_expr is required";
  if (hasInterval) {
    const error = validateInterval(recurrence.interval_ms, "recurrence.interval_ms");
    if (error) return error;
  }
  if (hasCron) {
    const error = validateCronExpression(recurrence.cron_expr, recurrence.cron_tz);
    if (error) return `recurrence.${error}`;
  }
  if (recurrence.cron_tz !== undefined && typeof recurrence.cron_tz !== "string") return "recurrence.cron_tz must be a string";
  if (hasCron && recurrence.cron_tz !== undefined && recurrence.cron_tz.trim() === "") return "recurrence.cron_tz must not be empty when provided";
  const catchUpError = validateCatchUp(recurrence.catch_up, "recurrence.catch_up");
  if (catchUpError) return catchUpError;
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
    interval_ms: input.recurrence.interval_ms ?? 0,
    cron_expr: input.recurrence.cron_expr,
    cron_tz: input.recurrence.cron_tz,
    catch_up: input.recurrence.catch_up,
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
