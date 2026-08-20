import type Database from "better-sqlite3";

/**
 * V41 — per-run efficiency stats (#572 Phase 1.5).
 *
 * Derived cache: one row per run with the tool-health / cost / duration facts
 * that TaskEfficiencyRepo aggregates. The events.jsonl files + agent_run_usage
 * remain the source of truth; this table is rebuildable (a missing row is
 * lazily backfilled from those sources on query). Only additive — no existing
 * table or column is touched.
 */
export function migrateV41(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_stats (
      run_id TEXT PRIMARY KEY REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      tool_calls INTEGER NOT NULL DEFAULT 0,
      tool_failures INTEGER NOT NULL DEFAULT 0,
      failure_rate REAL,
      top_failing_commands TEXT,
      repeated_commands TEXT,
      cost REAL,
      usage_calls INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      usage_finalized INTEGER NOT NULL DEFAULT 0,
      computed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_stats_status ON agent_run_stats(status);
  `);
}
