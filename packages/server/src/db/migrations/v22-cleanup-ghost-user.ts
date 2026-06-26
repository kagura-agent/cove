import type Database from "better-sqlite3";

export function migrateV22(db: Database.Database): void {
  // Clean up ghost "Luna" account created when the old owner (deleted in v21)
  // triggered a re-registration via stale OAuth session.
  // The correct Luna account is 1512350688875642880.
  db.prepare("DELETE FROM guild_members WHERE user_id = '1519879788007784448'").run();
  db.prepare("DELETE FROM users WHERE id = '1519879788007784448'").run();
}
