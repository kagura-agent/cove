import { Cron } from "croner";
import type { RecurringCatchUp, RecurringTask } from "@cove/shared";

/** Default IANA timezone for cron expressions. */
export const DEFAULT_CRON_TZ = "Asia/Shanghai";

const VALID_CATCH_UP = new Set<RecurringCatchUp>(["skip", "run"]);

export interface ParsedCron {
  cron: Cron;
  timezone: string;
}

export function validateCatchUp(value: unknown, name = "catch_up"): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !VALID_CATCH_UP.has(value as RecurringCatchUp)) {
    return `${name} must be one of: skip, run`;
  }
  return null;
}

/**
 * Parses and validates a cron expression + IANA timezone.
 * Returns an error message string, or null when valid.
 *
 * croner validates the pattern at construction, but a bad IANA timezone only
 * throws on the first `nextRun` evaluation — so we evaluate once here.
 */
export function validateCronExpression(expr: unknown, tz: unknown): string | null {
  if (typeof expr !== "string" || expr.trim() === "") return "cron_expr must be a non-empty string";
  const timezone = typeof tz === "string" && tz.trim() !== "" ? tz : DEFAULT_CRON_TZ;
  try {
    const cron = new Cron(expr.trim(), { timezone });
    cron.nextRun(new Date());
    return null;
  } catch (error) {
    return `Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Computes the next fire time (epoch ms) strictly after `from` for a cron
 * schedule evaluated in its timezone. Returns null when the pattern never
 * fires again.
 */
export function nextCronFireTime(expr: string, timezone: string | null | undefined, from: number): number | null {
  const cron = new Cron(expr.trim(), { timezone: timezone && timezone.trim() !== "" ? timezone : DEFAULT_CRON_TZ });
  const next = cron.nextRun(new Date(from));
  return next ? next.getTime() : null;
}

/** True when the template uses a cron schedule (vs interval). */
export function isCronScheduled(template: Pick<RecurringTask, "cron_expr" | "interval_ms">): boolean {
  return template.cron_expr !== null && template.cron_expr !== undefined && template.cron_expr.trim() !== "";
}

/**
 * Advances a cron template's next_run_at after a spawn.
 *
 * - catch_up = skip (default): land on the next fire time strictly after
 *   `now` — missed runs during downtime are skipped, so the worker spawns at
 *   most one run and the template lands on the next scheduled wall-clock time.
 * - catch_up = run: advance exactly one fire (the next fire after the one just
 *   processed, `from`). If that is still in the past the worker will spawn
 *   again on the next tick, backfilling one run per missed fire.
 */
export function advanceCronNextRun(template: Pick<RecurringTask, "cron_expr" | "cron_tz" | "catch_up">, from: number, now: number): number | null {
  if (!template.cron_expr) return null;
  if (template.catch_up === "run") {
    return nextCronFireTime(template.cron_expr, template.cron_tz, from);
  }
  return nextCronFireTime(template.cron_expr, template.cron_tz, now);
}
