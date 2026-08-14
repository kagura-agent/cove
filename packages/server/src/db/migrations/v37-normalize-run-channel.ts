import type Database from "better-sqlite3";

/**
 * Normalize agent_runs.channel_id semantics.
 *
 * Old plugin behavior anchored a thread run with channel_id = thread's own id
 * (so channel_id === thread_id). The correct model: channel_id is always the
 * permission/index anchor — for a thread run that is the PARENT channel, with
 * thread_id marking which thread actually happened.
 *
 * This backfills existing rows where channel_id points at a type-11 thread,
 * rewriting channel_id to the thread's parent_id. Channel runs (channel_id is
 * a real channel, type != 11) are untouched.
 */
export function migrateV37(db: Database.Database): void {
  db.exec(`
    UPDATE agent_runs
    SET channel_id = (
      SELECT c.parent_id FROM channels c WHERE c.id = agent_runs.channel_id
    )
    WHERE agent_runs.channel_id IN (SELECT id FROM channels WHERE type = 11)
      AND EXISTS (
        SELECT 1 FROM channels c
        WHERE c.id = agent_runs.channel_id AND c.type = 11 AND c.parent_id IS NOT NULL
      );
  `);
}
