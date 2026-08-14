import type Database from "better-sqlite3";

/** Per-run LLM usage ledger. One row per model call, bounded by the same
 * retention story as the agent-runs event ledger. */
export function migrateV34(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      cost_source TEXT NOT NULL DEFAULT 'none' CHECK(cost_source IN ('provider','price_table','none')),
      called_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_usage_run ON agent_run_usage(run_id);
  `);
}
