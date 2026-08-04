export type RepeatIntervalUnit = "minutes" | "hours" | "days" | "weeks";
export type RepeatSchedule = "never" | "hourly" | "daily" | "weekly" | "custom";

const REPEAT_INTERVAL_MS: Record<RepeatIntervalUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

export const REPEAT_INTERVAL_OPTIONS: Array<{ value: RepeatIntervalUnit; label: string }> = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
];

export const REPEAT_SCHEDULE_OPTIONS: Array<{ value: RepeatSchedule; label: string }> = [
  { value: "never", label: "Never" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "custom", label: "Custom" },
];

export function repeatIntervalMs(value: number, unit: RepeatIntervalUnit): number {
  return value * REPEAT_INTERVAL_MS[unit];
}

export function repeatScheduleIntervalMs(schedule: RepeatSchedule, value: number, unit: RepeatIntervalUnit): number {
  if (schedule === "hourly") return REPEAT_INTERVAL_MS.hours;
  if (schedule === "daily") return REPEAT_INTERVAL_MS.days;
  if (schedule === "weekly") return REPEAT_INTERVAL_MS.weeks;
  return schedule === "custom" ? repeatIntervalMs(value, unit) : 0;
}

export function recurrenceSeriesLabel(recurringSeq: number, recurringTask: { occurrence_mode: "same_task" | "new_task" } | undefined): string | null {
  return recurringTask?.occurrence_mode === "new_task" ? `Repeat #${recurringSeq}` : null;
}

export function mergeRecurringTasks<T extends { id: string; updated_at: number }>(existing: Record<string, T>, incoming: Iterable<T>): Record<string, T> {
  const merged = { ...existing };
  for (const recurringTask of incoming) {
    if (!merged[recurringTask.id] || recurringTask.updated_at > merged[recurringTask.id].updated_at) {
      merged[recurringTask.id] = recurringTask;
    }
  }
  return merged;
}

export function recurrenceScheduleFromInterval(intervalMs: number): { schedule: RepeatSchedule; value: number; unit: RepeatIntervalUnit } {
  if (intervalMs === REPEAT_INTERVAL_MS.hours) return { schedule: "hourly", value: 1, unit: "hours" };
  if (intervalMs === REPEAT_INTERVAL_MS.days) return { schedule: "daily", value: 1, unit: "days" };
  if (intervalMs === REPEAT_INTERVAL_MS.weeks) return { schedule: "weekly", value: 1, unit: "weeks" };

  for (const unit of ["weeks", "days", "hours", "minutes"] as const) {
    if (intervalMs % REPEAT_INTERVAL_MS[unit] === 0) {
      return { schedule: "custom", value: intervalMs / REPEAT_INTERVAL_MS[unit], unit };
    }
  }

  return { schedule: "custom", value: intervalMs / REPEAT_INTERVAL_MS.minutes, unit: "minutes" };
}
