import Database from "better-sqlite3";
import { migrateV0ToV1 } from "./v1-legacy.js";
import { migrateV1ToV2 } from "./v2-read-states.js";
import { migrateV2ToV3 } from "./v3-snowflake.js";
import { migrateV3ToV4 } from "./v4-fk-constraints.js";
import { migrateV4ToV5 } from "./v5-last-message-id.js";
import { migrateV5ToV6 } from "./v6-session-ttl.js";
import { migrateV6ToV7 } from "./v7-reactions.js";
import { migrateV7ToV8 } from "./v8-webhooks.js";
import { migrateV8ToV9 } from "./v9-permissions.js";
import { migrateV9ToV10 } from "./v10-message-reference.js";
import { migrateV11 } from "./v11-mention-count.js";
import { migrateV12 } from "./v12-global-name.js";
import { migrateV13 } from "./v13-pending-global-name.js";
import { migrateV14 } from "./v14-channel-files.js";
import { migrateV15 } from "./v15-threads.js";
import { migrateV16 } from "./v16-thread-member-flags.js";
import { migrateV17 } from "./v17-attachments.js";
import { migrateV18 } from "./v18-attachments-table.js";
import { migrateV19 } from "./v19-roles.js";
import { migrateV20 } from "./v20-bootstrap-owner.js";
import { migrateV21 } from "./v21-fix-owner.js";
import { migrateV22 } from "./v22-cleanup-ghost-user.js";
import { migrateV23 } from "./v23-cleanup-ghost-luna-final.js";
import { migrateV24 } from "./v24-webhook-type.js";
import { migrateV25 } from "./v25-tasks.js";
import { migrateV26 } from "./v26-tasks-fields.js";
import { migrateV27 } from "./v27-placeholder.js";
import { migrateV28 } from "./v28-drop-is-task-thread.js";
import { migrateV29 } from "./v29-recurring-tasks.js";
import { migrateV30 } from "./v30-recurring-task-occurrence-mode.js";
import { migrateV31 } from "./v31-recurring-task-next-run-at.js";
import { migrateV32 } from "./v32-task-runs.js";
import { migrateV33 } from "./v33-agent-runs.js";
import { migrateV34 } from "./v34-agent-run-usage.js";
import { migrateV35 } from "./v35-backfill-task-id.js";
import { migrateV36 } from "./v36-drop-task-id.js";
import { migrateV37 } from "./v37-normalize-run-channel.js";
import { migrateV38 } from "./v38-tasks-thread-index.js";
import { migrateV39 } from "./v39-task-heartbeat-default-off.js";
import { migrateV40 } from "./v40-recurring-cron.js";

const LATEST_VERSION = 40;

type MigrationFn = (db: Database.Database) => void;

const migrations: Record<number, MigrationFn> = {
  1: migrateV0ToV1,
  2: migrateV1ToV2,
  3: migrateV2ToV3,
  4: migrateV3ToV4,
  5: migrateV4ToV5,
  6: migrateV5ToV6,
  7: migrateV6ToV7,
  8: migrateV7ToV8,
  9: migrateV8ToV9,
  10: migrateV9ToV10,
  11: migrateV11,
  12: migrateV12,
  13: migrateV13,
  14: migrateV14,
  15: migrateV15,
  16: migrateV16,
  17: migrateV17,
  18: migrateV18,
  19: migrateV19,
  20: migrateV20,
  21: migrateV21,
  22: migrateV22,
  23: migrateV23,
  24: migrateV24,
  25: migrateV25,
  26: migrateV26,
  27: migrateV27,
  28: migrateV28,
  29: migrateV29,
  30: migrateV30,
  31: migrateV31,
  32: migrateV32,
  33: migrateV33,
  34: migrateV34,
  35: migrateV35,
  36: migrateV36,
  37: migrateV37,
  38: migrateV38,
  39: migrateV39,
  40: migrateV40,
};

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion > LATEST_VERSION) {
    console.warn(`⚠️ Database version ${currentVersion} is newer than supported version ${LATEST_VERSION}. Skipping migrations.`);
    return;
  }
  if (currentVersion >= LATEST_VERSION) return;

  for (let v = currentVersion + 1; v <= LATEST_VERSION; v++) {
    const migration = migrations[v];
    if (!migration) {
      throw new Error(`Missing migration for version ${v}`);
    }
    console.log(`Running migration V${v - 1} → V${v}...`);
    db.transaction(() => {
      migration(db);
      db.pragma(`user_version = ${v}`);
    })();
  }
}
