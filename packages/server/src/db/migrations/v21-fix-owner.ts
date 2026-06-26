import Database from "better-sqlite3";

export function migrateV21(db: Database.Database): void {
  // Remove the incorrect auto-promoted owner from guild members and users
  db.prepare("DELETE FROM guild_members WHERE user_id = '1512349650189811712'").run();
  db.prepare("DELETE FROM users WHERE id = '1512349650189811712'").run();

  // Set the correct owner on the guild
  db.prepare("UPDATE guilds SET owner_id = '1512350688875642880' WHERE id = '1512349650185617408'").run();
}
