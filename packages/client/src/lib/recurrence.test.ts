import { describe, expect, it } from "vitest";
import { mergeRecurringTasks, recurrenceEditorSettingsFromTemplate, recurrenceSaveAction, recurrenceScheduleFromInterval, recurrenceSeriesLabel, recurrenceUpdateFields, repeatScheduleIntervalMs } from "./recurrence";

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

  it("keeps newer template data when an older fetch completes after a save", () => {
    expect(mergeRecurringTasks(
      { "recurring-1": { id: "recurring-1", updated_at: 20, occurrence_mode: "new_task" } },
      [{ id: "recurring-1", updated_at: 10, occurrence_mode: "same_task" }],
    )).toEqual({ "recurring-1": { id: "recurring-1", updated_at: 20, occurrence_mode: "new_task" } });
  });
});
