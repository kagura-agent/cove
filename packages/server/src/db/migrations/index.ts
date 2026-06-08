import Database from "better-sqlite3";
import { migrateV0ToV1 } from "./v1-legacy.js";
import { migrateV1ToV2 } from "./v2-read-states.js";
import { migrateV2ToV3 } from "./v3-snowflake.js";
import { migrateV3ToV4 } from "./v4-fk-constraints.js";
import { migrateV4ToV5 } from "./v5-last-message-id.js";
import { migrateV5ToV6 } from "./v6-session-ttl.js";

const LATEST_VERSION = 6;

type MigrationFn = (db: Database.Database) => void;

const migrations: Record<number, MigrationFn> = {
  1: migrateV0ToV1,
  2: migrateV1ToV2,
  3: migrateV2ToV3,
  4: migrateV3ToV4,
  5: migrateV4ToV5,
  6: migrateV5ToV6,
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
