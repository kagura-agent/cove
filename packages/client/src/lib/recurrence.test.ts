import { describe, expect, it } from "vitest";
import { mergeRecurringTasks, recurrenceScheduleFromInterval, recurrenceSeriesLabel, repeatScheduleIntervalMs } from "./recurrence";

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
