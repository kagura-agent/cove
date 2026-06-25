import type Database from "better-sqlite3";

export function migrateV20(db: Database.Database): void {
  // Bootstrap guild owners — if a guild has no owner, set the first human member.
  // This fixes the chicken-and-egg where nobody can manage roles because
  // there's no guild owner to bypass permission checks.
  const ownerlessGuilds = db
    .prepare("SELECT id FROM guilds WHERE owner_id IS NULL")
    .all() as { id: string }[];
  for (const guild of ownerlessGuilds) {
    const firstHuman = db
      .prepare(
        "SELECT gm.user_id FROM guild_members gm JOIN users u ON u.id = gm.user_id WHERE gm.guild_id = ? AND u.bot = 0 ORDER BY gm.joined_at ASC LIMIT 1",
      )
      .get(guild.id) as { user_id: string } | undefined;
    if (firstHuman) {
      db.prepare("UPDATE guilds SET owner_id = ? WHERE id = ?").run(
        firstHuman.user_id,
        guild.id,
      );
    }
  }
}
