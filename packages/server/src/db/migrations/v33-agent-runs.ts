import type Database from "better-sqlite3";

/** Generic, lightweight index for file-backed agent execution evidence. */
export function migrateV33(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      run_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(task_id) ON DELETE SET NULL,
      trigger_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      parent_run_id TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('active','completed','failed','aborted','stale')),
      current_action TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER,
      expires_at INTEGER NOT NULL,
      log_manifest_ref TEXT NOT NULL,
      log_hash TEXT,
      log_event_count INTEGER NOT NULL DEFAULT 0,
      log_bytes INTEGER NOT NULL DEFAULT 0,
      redaction_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_channel_updated ON agent_runs(channel_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_updated ON agent_runs(thread_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_assistant_message ON agent_runs(assistant_message_id);
  `);
}
