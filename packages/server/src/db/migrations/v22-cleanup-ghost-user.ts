import type Database from "better-sqlite3";

export function migrateV22(db: Database.Database): void {
  // Clean up ghost "Luna" accounts created by seedUsers() + stale OAuth sessions.
  // Only run on the production guild to avoid breaking test DBs.
  const guild = db.prepare("SELECT id FROM guilds WHERE id = '1512349650185617408'").get() as { id: string } | undefined;
  if (!guild) return;

  // The correct Luna account is 1512350688875642880 (Yueying Chen / Luna Chen).
  // Delete any non-bot "Luna" username users that aren't the real account.
  db.prepare(
    "DELETE FROM guild_members WHERE user_id IN (SELECT id FROM users WHERE username = 'Luna' AND id != '1512350688875642880' AND bot = 0)"
  ).run();
  db.prepare(
    "DELETE FROM users WHERE username = 'Luna' AND id != '1512350688875642880' AND bot = 0"
  ).run();
}
