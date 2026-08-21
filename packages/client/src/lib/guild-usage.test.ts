import { describe, expect, it } from "vitest";
import type { GuildDailyUsage } from "@cove/shared";
import { flattenDailyForChart, topModelsByCost } from "./guild-usage";

const day = (date: string, cost: number | null, tokens: number, calls: number, models: Array<{ model: string; cost: number | null }>, tasks = 0): GuildDailyUsage => ({
  date, cost, total_tokens: tokens, calls, tasks,
  models: models.map((m) => ({ model: m.model, cost: m.cost, calls, total_tokens: tokens })),
});

describe("flattenDailyForChart", () => {
  it("maps date to MM-DD and keeps full date", () => {
    const rows = flattenDailyForChart([day("2026-08-21", 0.01, 100, 1, [], 3)]);
    expect(rows[0]).toMatchObject({ date: "08-21", fullDate: "2026-08-21", cost: 0.01, tokens: 100, calls: 1, tasks: 3 });
  });

  it("leaves absent model columns undefined (recharts renders missing as 0 in stacks)", () => {
    const rows = flattenDailyForChart([
      day("2026-08-20", 0.01, 100, 1, [{ model: "m1", cost: 0.01 }]),
      day("2026-08-21", 0.02, 200, 2, [{ model: "m2", cost: 0.02 }]),
    ]);
    // Day 1 has m1 only; m2 is absent → undefined (stack treats as 0).
    expect(rows[0].m1).toBe(0.01);
    expect(rows[0].m2).toBeUndefined();
    expect(rows[1].m1).toBeUndefined();
    expect(rows[1].m2).toBe(0.02);
  });

  it("treats null-cost model slices as 0", () => {
    const rows = flattenDailyForChart([day("2026-08-21", null, 100, 1, [{ model: "m1", cost: null }])]);
    expect(rows[0].m1).toBe(0);
    expect(rows[0].cost).toBeNull();
  });
});

describe("topModelsByCost", () => {
  it("ranks models by total cost, ties alphabetical", () => {
    const daily = [
      day("2026-08-20", 0.1, 100, 1, [
        { model: "b-model", cost: 0.04 },
        { model: "a-model", cost: 0.06 },
      ]),
      day("2026-08-21", 0.05, 100, 1, [{ model: "c-model", cost: 0.05 }]),
    ];
    expect(topModelsByCost(daily, 2)).toEqual(["a-model", "c-model"]);
    expect(topModelsByCost(daily, 10)).toEqual(["a-model", "c-model", "b-model"]);
  });

  it("skips models with null cost", () => {
    const daily = [day("2026-08-21", null, 100, 1, [{ model: "free-model", cost: null }])];
    expect(topModelsByCost(daily, 5)).toEqual([]);
  });
});
