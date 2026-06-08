import Database from "better-sqlite3";
import { addColumnIfMissing, hasColumn } from "./util.js";
import { SESSION_TTL_MS } from "../../config.js";

export function migrateV5ToV6(db: Database.Database): void {
  // #118: Add expires_at column for session TTL
  addColumnIfMissing(db, "users", "expires_at", "INTEGER DEFAULT NULL");

  // Backfill existing human users with a grace period from deployment time
  if (hasColumn(db, "users", "updated_at")) {
    const gracePeriod = Date.now() + SESSION_TTL_MS;
    db.prepare(
      "UPDATE users SET expires_at = ? WHERE bot = 0 AND expires_at IS NULL"
    ).run(gracePeriod);
  }

  // Index for periodic cleanup queries
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at) WHERE expires_at IS NOT NULL");

  // Bot tokens get NULL expires_at (never expire) — already NULL by default
}
