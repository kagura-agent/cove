import type Database from "better-sqlite3";
import { hasColumn, tableExists } from "./util.js";

/**
 * V40 — cron / time-of-day scheduling for recurring tasks (#533).
 *
 * Adds cron_expr, cron_tz and catch_up columns to recurring_tasks. Existing
 * interval-based templates are untouched (cron columns stay NULL). The
 * schedule is interval-based when interval_ms > 0, cron-based when
 * cron_expr is non-NULL; the two are mutually exclusive at the API layer.
 */
export function migrateV40(db: Database.Database): void {
  // Some test fixtures model pre-V29 databases that never created the table.
  if (!tableExists(db, "recurring_tasks")) return;
  if (!hasColumn(db, "recurring_tasks", "cron_expr")) {
    db.exec("ALTER TABLE recurring_tasks ADD COLUMN cron_expr TEXT DEFAULT NULL");
  }
  if (!hasColumn(db, "recurring_tasks", "cron_tz")) {
    db.exec("ALTER TABLE recurring_tasks ADD COLUMN cron_tz TEXT DEFAULT NULL");
  }
  if (!hasColumn(db, "recurring_tasks", "catch_up")) {
    db.exec("ALTER TABLE recurring_tasks ADD COLUMN catch_up TEXT NOT NULL DEFAULT 'skip'");
  }
}
