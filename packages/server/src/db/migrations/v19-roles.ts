import type Database from "better-sqlite3";
import { DEFAULT_EVERYONE_PERMISSIONS } from "@cove/shared";

export function migrateV19(db: Database.Database): void {
  // Step 1: Create roles table (spec §1.3)
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color INTEGER NOT NULL DEFAULT 0,
      hoist INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '0',
      managed INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0,
      flags INTEGER NOT NULL DEFAULT 0,
      bot_id TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_roles_guild ON roles(guild_id);
  `);

  // Step 2: For each existing guild, create @everyone role (id = guild_id)
  const defaultPerms = DEFAULT_EVERYONE_PERMISSIONS.toString();
  const guilds = db.prepare("SELECT id FROM guilds").all() as { id: string }[];
  const insertRole = db.prepare(
    "INSERT OR IGNORE INTO roles (id, guild_id, name, position, permissions) VALUES (?, ?, ?, 0, ?)",
  );
  for (const guild of guilds) {
    insertRole.run(guild.id, guild.id, "@everyone", defaultPerms);
  }

  // Step 3: Clean orphaned role IDs from guild_members.roles
  const members = db
    .prepare("SELECT guild_id, user_id, roles FROM guild_members")
    .all() as { guild_id: string; user_id: string; roles: string }[];
  const updateRoles = db.prepare(
    "UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?",
  );
  for (const member of members) {
    const roleIds = JSON.parse(member.roles) as string[];
    if (roleIds.length === 0) continue;
    const validRoles = roleIds.filter((roleId) => {
      return !!db.prepare("SELECT 1 FROM roles WHERE id = ?").get(roleId);
    });
    if (validRoles.length !== roleIds.length) {
      updateRoles.run(
        JSON.stringify(validRoles),
        member.guild_id,
        member.user_id,
      );
    }
  }

  // Step 4: Bootstrap guild owners — if a guild has no owner, set the first human member
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
