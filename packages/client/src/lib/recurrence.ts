export type RepeatIntervalUnit = "minutes" | "hours" | "days" | "weeks";
export type RepeatSchedule = "never" | "hourly" | "daily" | "weekly" | "custom" | "cron";

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
  { value: "cron", label: "Cron expression" },
];

export const CRON_CATCH_UP_OPTIONS: Array<{ value: "skip" | "run"; label: string }> = [
  { value: "skip", label: "Skip missed runs" },
  { value: "run", label: "Catch up missed runs" },
];

/** Default IANA timezone for cron schedules (matches the server default). */
export const DEFAULT_CRON_TZ = "Asia/Shanghai";

/** Loose client-side validation for a cron expression (server does the strict check). */
export function isValidCronExpression(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  return fields.every((field) => /^[0-9*\/,\-]+$/.test(field));
}

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

type RecurrenceOccurrenceMode = "same_task" | "new_task";
export type RecurrenceCatchUp = "skip" | "run";

/** Shape of a recurrence as exposed on tasks/recurring templates. */
export type RecurrenceTemplateLike = {
  enabled: boolean;
  interval_ms: number;
  occurrence_mode: RecurrenceOccurrenceMode;
  cron_expr?: string | null;
  cron_tz?: string | null;
  catch_up?: RecurrenceCatchUp;
};

export type RecurrenceEditorSettings = {
  enabled: boolean;
  schedule: RepeatSchedule;
  intervalValue: number;
  intervalUnit: RepeatIntervalUnit;
  occurrenceMode: RecurrenceOccurrenceMode;
  cronExpr?: string;
  cronTz?: string;
  catchUp?: RecurrenceCatchUp;
};

/** True when the template uses a cron schedule (vs interval). */
export function isCronSchedule(template: Pick<RecurrenceTemplateLike, "cron_expr">): boolean {
  return template.cron_expr !== null && template.cron_expr !== undefined && template.cron_expr.trim() !== "";
}

export function recurrenceEditorSettingsFromTemplate(template: RecurrenceTemplateLike): RecurrenceEditorSettings {
  if (isCronSchedule(template)) {
    return {
      enabled: template.enabled,
      schedule: "cron",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: template.occurrence_mode,
      cronExpr: template.cron_expr ?? "",
      cronTz: template.cron_tz ?? DEFAULT_CRON_TZ,
      catchUp: template.catch_up ?? "skip",
    };
  }
  const { schedule, value, unit } = recurrenceScheduleFromInterval(template.interval_ms);
  return {
    enabled: template.enabled,
    schedule,
    intervalValue: value,
    intervalUnit: unit,
    occurrenceMode: template.occurrence_mode,
  };
}

type RecurrenceEditorSaveSettings = RecurrenceEditorSettings & {
  storedIntervalMs: number;
  storedOccurrenceMode: RecurrenceOccurrenceMode;
  storedCronExpr?: string | null;
  storedCronTz?: string | null;
  storedCatchUp?: RecurrenceCatchUp;
};

export type RecurrenceUpdateFieldsResult = {
  enabled: boolean;
  interval_ms?: number;
  cron_expr?: string;
  cron_tz?: string;
  catch_up?: RecurrenceCatchUp;
  occurrence_mode?: RecurrenceOccurrenceMode;
};

export function recurrenceUpdateFields(settings: RecurrenceEditorSaveSettings): RecurrenceUpdateFieldsResult {
  if (!settings.enabled) return { enabled: false };

  if (settings.schedule === "cron") {
    const cronExpr = settings.cronExpr?.trim() ?? "";
    const cronTz = settings.cronTz?.trim() || DEFAULT_CRON_TZ;
    const catchUp = settings.catchUp ?? "skip";
    return {
      enabled: true,
      ...(cronExpr !== (settings.storedCronExpr ?? "") ? { cron_expr: cronExpr } : {}),
      ...(cronTz !== (settings.storedCronTz ?? DEFAULT_CRON_TZ) ? { cron_tz: cronTz } : {}),
      ...(catchUp !== (settings.storedCatchUp ?? "skip") ? { catch_up: catchUp } : {}),
      ...(settings.occurrenceMode !== settings.storedOccurrenceMode ? { occurrence_mode: settings.occurrenceMode } : {}),
    };
  }

  const intervalMs = repeatScheduleIntervalMs(settings.schedule, settings.intervalValue, settings.intervalUnit);
  return {
    enabled: true,
    ...(intervalMs !== settings.storedIntervalMs ? { interval_ms: intervalMs } : {}),
    ...(settings.occurrenceMode !== settings.storedOccurrenceMode ? { occurrence_mode: settings.occurrenceMode } : {}),
  };
}

export function recurrenceSaveAction(settings: RecurrenceEditorSaveSettings):
  | { type: "delete" }
  | { type: "update"; fields: RecurrenceUpdateFieldsResult } {
  if (settings.schedule === "never") return { type: "delete" };
  return { type: "update", fields: recurrenceUpdateFields(settings) };
}

/** Human-readable schedule summary for list/task displays, or null when not recurring. */
export function recurrenceScheduleLabel(recurrence: Pick<RecurrenceTemplateLike, "interval_ms" | "cron_expr" | "cron_tz"> | undefined): string | null {
  if (!recurrence) return null;
  if (isCronSchedule(recurrence)) {
    const tz = recurrence.cron_tz && recurrence.cron_tz !== DEFAULT_CRON_TZ ? ` · ${recurrence.cron_tz}` : "";
    return `cron ${recurrence.cron_expr}${tz}`;
  }
  if (recurrence.interval_ms <= 0) return null;
  const { schedule, value, unit } = recurrenceScheduleFromInterval(recurrence.interval_ms);
  switch (schedule) {
    case "hourly": return "Every hour";
    case "daily": return "Every day";
    case "weekly": return "Every week";
    case "custom": return `Every ${value} ${unit}`;
    default: return null;
  }
}
