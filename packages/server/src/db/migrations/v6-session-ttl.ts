import Database from "better-sqlite3";
import { addColumnIfMissing, hasColumn } from "./util.js";

export function migrateV5ToV6(db: Database.Database): void {
  // #118: Add expires_at column for session TTL
  addColumnIfMissing(db, "users", "expires_at", "INTEGER DEFAULT NULL");

  // Backfill existing human users with a 7-day grace period from their last update
  // Guard: updated_at may not exist in very old schemas migrated from legacy
  if (hasColumn(db, "users", "updated_at")) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    db.prepare(
      "UPDATE users SET expires_at = updated_at + ? WHERE bot = 0 AND expires_at IS NULL"
    ).run(SEVEN_DAYS_MS);
  }

  // Bot tokens get NULL expires_at (never expire) — already NULL by default
}
