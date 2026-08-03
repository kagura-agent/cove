# Recurring Tasks — Phase 1 MVP

## Summary

Native recurring task support: define a template once, instances auto-create on schedule.

## Phase 1 Scope

- **Schedule types**: `interval` (ms after last instance completed) + `on_complete` (next spawns immediately when current reaches done/cancelled)
- **No cron type** (Phase 2)
- **No UI** (API + cove_task tool only)
- **Skip on overlap**: if previous instance still active, skip

## Schema

### New table: `recurring_tasks`

```sql
CREATE TABLE recurring_tasks (
  id              TEXT PRIMARY KEY,
  guild_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by      TEXT NOT NULL,
  schedule_type   TEXT NOT NULL,          -- 'interval' | 'on_complete'
  interval_ms     INTEGER NOT NULL DEFAULT 0,  -- for 'interval' type
  enabled         INTEGER NOT NULL DEFAULT 1,  -- 0 = paused
  last_task_id    TEXT,                   -- most recent spawned task
  last_spawned_at INTEGER NOT NULL DEFAULT 0,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 300000,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_recurring_tasks_channel ON recurring_tasks(channel_id);
CREATE INDEX idx_recurring_tasks_guild ON recurring_tasks(guild_id);
```

### New columns on `tasks` table

```sql
ALTER TABLE tasks ADD COLUMN recurring_id TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN recurring_seq INTEGER NOT NULL DEFAULT 0;
```

## API

### POST /channels/:channelId/recurring-tasks
Create a recurring task template.

Body:
```json
{
  "title": "Daily standup",
  "description": "...",
  "assignee_id": "...",
  "schedule_type": "interval",
  "interval_ms": 86400000,
  "heartbeat_interval_ms": 300000
}
```

### GET /channels/:channelId/recurring-tasks
List all recurring task templates for a channel.

### GET /recurring-tasks/:id
Get a single recurring task template.

### PATCH /recurring-tasks/:id
Update template fields (title, description, assignee_id, interval_ms, enabled, heartbeat_interval_ms).

### DELETE /recurring-tasks/:id
Delete a recurring task template.

## Worker: RecurringTaskWorker

- 30s tick loop (configurable via `RECURRING_TASK_TICK_MS`)
- Each tick:
  1. Query all enabled recurring_tasks
  2. For each template:
     - If `schedule_type === 'on_complete'`: check if `last_task_id` is done/cancelled → spawn next
     - If `schedule_type === 'interval'`: check if `last_spawned_at + interval_ms <= now` AND `last_task_id` is done/cancelled (or null) → spawn next
     - If previous instance still active (not done/cancelled): skip (overlap protection)
  3. Spawn = create a normal task (reusing existing task creation logic) with `recurring_id` and incrementing `recurring_seq`

## cove_task Tool Extension

Add actions to the OpenClaw plugin's cove_task handler:
- `create_recurring`: Create a recurring task template
- `list_recurring`: List recurring templates for a channel
- `update_recurring`: Update a recurring template (enable/disable/change interval)
- `delete_recurring`: Delete a recurring template

## Implementation Files

1. `packages/server/src/db/migrations/v27-recurring-tasks.ts` — migration
2. `packages/server/src/db/migrations/index.ts` — register v27
3. `packages/shared/src/types.ts` — RecurringTask type + RecurringScheduleType
4. `packages/server/src/repos/recurring-tasks.ts` — RecurringTasksRepo
5. `packages/server/src/repos/index.ts` — add recurringTasks
6. `packages/server/src/routes/recurring-tasks.ts` — REST routes
7. `packages/server/src/app.ts` — mount recurring task routes
8. `packages/server/src/workers/recurring-task.ts` — tick loop worker
9. `packages/server/src/index.ts` — start worker
10. `packages/server/src/repos/tasks.ts` — add recurring_id/recurring_seq to TaskRow + create
11. `packages/plugin/src/cove-task.ts` — extend cove_task tool (if exists, else in plugin handler)
