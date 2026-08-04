import { describe, expect, it } from "vitest";
import { REPEAT_INTERVAL_OPTIONS, repeatIntervalMs } from "./CreateTaskDialog";

describe("repeatIntervalMs", () => {
  it("exposes every custom interval unit", () => {
    expect(REPEAT_INTERVAL_OPTIONS).toEqual([
      { value: "minutes", label: "minutes" },
      { value: "hours", label: "hours" },
      { value: "days", label: "days" },
      { value: "weeks", label: "weeks" },
    ]);
  });

  it("converts every custom interval unit to milliseconds", () => {
    expect(repeatIntervalMs(5, "minutes")).toBe(5 * 60_000);
    expect(repeatIntervalMs(2, "hours")).toBe(2 * 3_600_000);
    expect(repeatIntervalMs(3, "days")).toBe(3 * 86_400_000);
    expect(repeatIntervalMs(4, "weeks")).toBe(4 * 7 * 86_400_000);
  });
});
