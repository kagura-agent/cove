import { describe, expect, it } from "vitest";
import { isValidCronExpression, mergeRecurringTasks, recurrenceEditorSettingsFromTemplate, recurrenceSaveAction, recurrenceScheduleFromInterval, recurrenceScheduleLabel, recurrenceSeriesLabel, recurrenceUpdateFields, repeatScheduleIntervalMs } from "./recurrence";

describe("recurrence intervals", () => {
  it("converts quick and custom schedules to milliseconds", () => {
    expect(repeatScheduleIntervalMs("hourly", 1, "days")).toBe(3_600_000);
    expect(repeatScheduleIntervalMs("daily", 1, "days")).toBe(86_400_000);
    expect(repeatScheduleIntervalMs("weekly", 1, "days")).toBe(7 * 86_400_000);
    expect(repeatScheduleIntervalMs("custom", 5, "minutes")).toBe(5 * 60_000);
  });

  it("decodes stored intervals for recurrence editing", () => {
    expect(recurrenceScheduleFromInterval(3_600_000)).toEqual({ schedule: "hourly", value: 1, unit: "hours" });
    expect(recurrenceScheduleFromInterval(2 * 86_400_000)).toEqual({ schedule: "custom", value: 2, unit: "days" });
    expect(recurrenceScheduleFromInterval(90 * 60_000)).toEqual({ schedule: "custom", value: 90, unit: "minutes" });
  });

  it("retains a disabled template's cadence and occurrence mode for editing", () => {
    expect(recurrenceEditorSettingsFromTemplate({
      enabled: false,
      interval_ms: 86_400_000,
      occurrence_mode: "new_task",
    })).toEqual({
      enabled: false,
      schedule: "daily",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "new_task",
    });
  });

  it("patches only enabled when toggling a configured recurrence", () => {
    expect(recurrenceUpdateFields({
      enabled: false,
      schedule: "daily",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "new_task",
      storedIntervalMs: 86_400_000,
      storedOccurrenceMode: "new_task",
    })).toEqual({ enabled: false });
    expect(recurrenceUpdateFields({
      enabled: true,
      schedule: "daily",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "new_task",
      storedIntervalMs: 86_400_000,
      storedOccurrenceMode: "new_task",
    })).toEqual({ enabled: true });
  });

  it("enables and patches only repeat settings that changed", () => {
    expect(recurrenceUpdateFields({
      enabled: true,
      schedule: "custom",
      intervalValue: 2,
      intervalUnit: "days",
      occurrenceMode: "new_task",
      storedIntervalMs: 86_400_000,
      storedOccurrenceMode: "same_task",
    })).toEqual({
      enabled: true,
      interval_ms: 2 * 86_400_000,
      occurrence_mode: "new_task",
    });
  });

  it("deletes recurrence configuration only when Never is selected", () => {
    const settings = {
      intervalValue: 1,
      intervalUnit: "days" as const,
      occurrenceMode: "new_task" as const,
      storedIntervalMs: 86_400_000,
      storedOccurrenceMode: "new_task" as const,
    };

    expect(recurrenceSaveAction({ ...settings, enabled: false, schedule: "daily" })).toEqual({
      type: "update",
      fields: { enabled: false },
    });
    expect(recurrenceSaveAction({ ...settings, enabled: false, schedule: "never" })).toEqual({ type: "delete" });
  });

  it("labels only new-task occurrences as a series", () => {
    expect(recurrenceSeriesLabel(3, { occurrence_mode: "new_task" })).toBe("Repeat #3");
    expect(recurrenceSeriesLabel(3, { occurrence_mode: "same_task" })).toBeNull();
    expect(recurrenceSeriesLabel(3, undefined)).toBeNull();
  });

  it("detects cron templates and decodes them for the editor", () => {
    expect(recurrenceEditorSettingsFromTemplate({
      enabled: true,
      interval_ms: 0,
      occurrence_mode: "new_task",
      cron_expr: "15,45 8-22 * * *",
      cron_tz: "Asia/Shanghai",
      catch_up: "run",
    })).toEqual({
      enabled: true,
      schedule: "cron",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "new_task",
      cronExpr: "15,45 8-22 * * *",
      cronTz: "Asia/Shanghai",
      catchUp: "run",
    });

    // interval templates stay on the interval path
    expect(recurrenceEditorSettingsFromTemplate({
      enabled: true,
      interval_ms: 86_400_000,
      occurrence_mode: "same_task",
    })).toEqual({
      enabled: true,
      schedule: "daily",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "same_task",
    });
  });

  it("patches only cron fields that changed and keeps stored cadence", () => {
    expect(recurrenceUpdateFields({
      enabled: true,
      schedule: "cron",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "same_task",
      cronExpr: "15,45 8-22 * * *",
      cronTz: "Asia/Shanghai",
      catchUp: "skip",
      storedIntervalMs: 0,
      storedOccurrenceMode: "same_task",
      storedCronExpr: "15,45 8-22 * * *",
      storedCronTz: "Asia/Shanghai",
      storedCatchUp: "skip",
    })).toEqual({ enabled: true });

    expect(recurrenceUpdateFields({
      enabled: true,
      schedule: "cron",
      intervalValue: 1,
      intervalUnit: "days",
      occurrenceMode: "new_task",
      cronExpr: "0 20 * * 0",
      cronTz: "UTC",
      catchUp: "run",
      storedIntervalMs: 0,
      storedOccurrenceMode: "same_task",
      storedCronExpr: "15,45 8-22 * * *",
      storedCronTz: "Asia/Shanghai",
      storedCatchUp: "skip",
    })).toEqual({
      enabled: true,
      cron_expr: "0 20 * * 0",
      cron_tz: "UTC",
      catch_up: "run",
      occurrence_mode: "new_task",
    });
  });

  it("defaults missing cron fields to Asia/Shanghai and skip", () => {
    expect(recurrenceEditorSettingsFromTemplate({
      enabled: true,
      interval_ms: 0,
      occurrence_mode: "same_task",
      cron_expr: "0 9 * * *",
    })).toMatchObject({ cronTz: "Asia/Shanghai", catchUp: "skip" });
  });

  it("renders human-readable schedule labels for lists", () => {
    expect(recurrenceScheduleLabel({ interval_ms: 3_600_000, cron_expr: null, cron_tz: null })).toBe("Every hour");
    expect(recurrenceScheduleLabel({ interval_ms: 86_400_000, cron_expr: null, cron_tz: null })).toBe("Every day");
    expect(recurrenceScheduleLabel({ interval_ms: 2 * 86_400_000, cron_expr: null, cron_tz: null })).toBe("Every 2 days");
    expect(recurrenceScheduleLabel({ interval_ms: 0, cron_expr: "15,45 8-22 * * *", cron_tz: "Asia/Shanghai" })).toBe("cron 15,45 8-22 * * *");
    expect(recurrenceScheduleLabel({ interval_ms: 0, cron_expr: "0 20 * * 0", cron_tz: "UTC" })).toBe("cron 0 20 * * 0 · UTC");
    expect(recurrenceScheduleLabel(undefined)).toBeNull();
  });

  it("validates cron expressions loosely client-side", () => {
    expect(isValidCronExpression("15,45 8-22 * * *")).toBe(true);
    expect(isValidCronExpression("0 20 * * 0")).toBe(true);
    expect(isValidCronExpression("0 8 * * 1")).toBe(true);
    expect(isValidCronExpression("*/15 * * * *")).toBe(true);
    expect(isValidCronExpression("not a cron")).toBe(false);
    expect(isValidCronExpression("0 9")).toBe(false);
    expect(isValidCronExpression("0 9 * *")).toBe(false);
  });

  it("keeps newer template data when an older fetch completes after a save", () => {
    expect(mergeRecurringTasks(
      { "recurring-1": { id: "recurring-1", updated_at: 20, occurrence_mode: "new_task" } },
      [{ id: "recurring-1", updated_at: 10, occurrence_mode: "same_task" }],
    )).toEqual({ "recurring-1": { id: "recurring-1", updated_at: 20, occurrence_mode: "new_task" } });
  });
});
