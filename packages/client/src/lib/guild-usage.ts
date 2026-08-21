import type { GuildDailyUsage } from "@cove/shared";

/** One row of the daily spend chart: date label + cost/tokens/calls/tasks +
 *  one numeric column per model (cost slice) for the stacked model chart. */
export interface DailyChartRow {
  date: string;
  fullDate: string;
  cost: number | null;
  tokens: number;
  calls: number;
  tasks: number;
  [model: string]: string | number | null;
}

/**
 * Flatten a daily usage series into chart rows. Models present on a day become
 * numeric columns (cost slice); days without a model column contribute 0 so
 * recharts stacks render continuously.
 */
export function flattenDailyForChart(daily: GuildDailyUsage[]): DailyChartRow[] {
  return daily.map((d) => {
    const row: DailyChartRow = {
      date: d.date.slice(5), // MM-DD
      fullDate: d.date,
      cost: d.cost,
      tokens: d.total_tokens,
      calls: d.calls,
      tasks: d.tasks,
    };
    for (const m of d.models) row[m.model] = m.cost ?? 0;
    return row;
  });
}

/** Rank models by total cost across the daily series; returns the top `limit`
 *  names (cost descending, ties alphabetical). Used to keep the stacked model
 *  chart readable when a guild spans many models (floway has 21). */
export function topModelsByCost(daily: GuildDailyUsage[], limit: number): string[] {
  const totals = new Map<string, number>();
  for (const d of daily) {
    for (const m of d.models) {
      if (m.cost == null) continue;
      totals.set(m.model, (totals.get(m.model) ?? 0) + m.cost);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([model]) => model);
}
