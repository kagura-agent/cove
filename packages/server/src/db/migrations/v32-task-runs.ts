import type Database from "better-sqlite3";

export function migrateV32(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_runs (
      run_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','completed','failed','aborted','stale')),
      current_action TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_runs_task_active ON task_runs(task_id, status, expires_at);
    CREATE TABLE IF NOT EXISTS task_run_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES task_runs(run_id) ON DELETE CASCADE,
      tool_call_id TEXT,
      type TEXT NOT NULL,
      action TEXT,
      detail TEXT,
      status TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      cwd TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_events_run_created ON task_run_events(run_id, created_at);
  `);
}
