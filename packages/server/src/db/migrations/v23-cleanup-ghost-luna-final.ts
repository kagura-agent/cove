import type Database from "better-sqlite3";

export function migrateV23(db: Database.Database): void {
  // v22 already ran with a narrower deletion (only 1519879788007784448).
  // This catches the latest ghost + any future stragglers.
  // Only applies to the production guild.
  const guild = db.prepare("SELECT id FROM guilds WHERE id = '1512349650185617408'").get() as { id: string } | undefined;
  if (!guild) return;

  db.prepare(
    "DELETE FROM guild_members WHERE user_id IN (SELECT id FROM users WHERE username = 'Luna' AND id != '1512350688875642880' AND bot = 0)"
  ).run();
  db.prepare(
    "DELETE FROM users WHERE username = 'Luna' AND id != '1512350688875642880' AND bot = 0"
  ).run();
}
