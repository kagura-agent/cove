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

const LATEST_VERSION = 18;

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
};

export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma("user_version", { simple: true }) as number;

  if (currentVersion > LATEST_VERSION) {
    throw new Error(`Database version ${currentVersion} is newer than supported version ${LATEST_VERSION}. Update the application.`);
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
