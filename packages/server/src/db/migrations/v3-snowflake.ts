import Database from "better-sqlite3";
import { snowflakeFromTimestamp } from "@cove/shared";
import { tableExists, hasColumn, isSnowflake } from "./util.js";

export function migrateV2ToV3(db: Database.Database): void {
  // Convert UUID-based IDs to Snowflake IDs across all tables.
  // Generate snowflakes from created_at/timestamp to preserve ordering.

  // Build old→new ID mappings per entity type to avoid cross-table key collisions
  // (e.g. a channel and user both named 'general' would overwrite each other in a shared map).
  const guildIdMap = new Map<string, string>();
  const channelIdMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const messageIdMap = new Map<string, string>();
  const inviteIdMap = new Map<string, string>();
  const pendingIdMap = new Map<string, string>();
  const now = Date.now();

  // Helper: safely query rows from a table that may or may not exist
  const safeQuery = <T>(sql: string, table: string): T[] => {
    if (!tableExists(db, table)) return [];
    return db.prepare(sql).all() as T[];
  };

  // Guilds: use created_at for snowflake timestamp
  const guilds = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM guilds", "guilds");
  for (let i = 0; i < guilds.length; i++) {
    const g = guilds[i];
    if (isSnowflake(g.id)) continue;
    guildIdMap.set(g.id, snowflakeFromTimestamp(g.created_at, i));
  }

  // Channels: look up earliest message timestamp, fall back to guild created_at, then now
  const channels = safeQuery<{ id: string; guild_id: string }>("SELECT id, guild_id FROM channels ORDER BY position ASC", "channels");
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (isSnowflake(ch.id)) continue;
    let ts = now;
    if (tableExists(db, "messages")) {
      const earliest = db.prepare("SELECT MIN(timestamp) AS t FROM messages WHERE channel_id = ?").get(ch.id) as { t: string | number | null } | undefined;
      if (earliest?.t != null) {
        const parsed = typeof earliest.t === "number" ? earliest.t : new Date(earliest.t).getTime();
        if (!isNaN(parsed)) ts = parsed;
      }
    }
    if (ts === now) {
      // Fall back to the guild's created_at
      const guild = guilds.find(g => g.id === ch.guild_id);
      if (guild?.created_at != null) {
        const parsed = typeof guild.created_at === "number" ? guild.created_at : new Date(guild.created_at).getTime();
        if (!isNaN(parsed)) ts = parsed;
      }
    }
    channelIdMap.set(ch.id, snowflakeFromTimestamp(ts, i));
  }

  // Users: use created_at
  const users = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM users", "users");
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    if (isSnowflake(u.id)) continue;
    userIdMap.set(u.id, snowflakeFromTimestamp(u.created_at, i));
  }

  // Messages: use timestamp
  const messages = safeQuery<{ id: string; timestamp: string | number }>("SELECT id, timestamp FROM messages ORDER BY timestamp ASC", "messages");
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (isSnowflake(m.id)) continue;
    messageIdMap.set(m.id, snowflakeFromTimestamp(m.timestamp, i));
  }

  // Invite codes / pending registrations: use created_at
  const invites = safeQuery<{ id: string; created_at: string | number }>("SELECT id, created_at FROM invite_codes", "invite_codes");
  for (let i = 0; i < invites.length; i++) {
    const inv = invites[i];
    if (isSnowflake(inv.id)) continue;
    inviteIdMap.set(inv.id, snowflakeFromTimestamp(inv.created_at, i));
  }

  const pendings = safeQuery<{ id: string; created_at: string | number | null }>("SELECT id, created_at FROM pending_registrations", "pending_registrations");
  for (let i = 0; i < pendings.length; i++) {
    const p = pendings[i];
    if (isSnowflake(p.id)) continue;
    pendingIdMap.set(p.id, snowflakeFromTimestamp(p.created_at ?? now, i));
  }

  // Apply the ID mappings using the correct per-table map for each column
  const update = (table: string, column: string, map: Map<string, string>) => {
    if (!tableExists(db, table) || !hasColumn(db, table, column)) return;
    const stmt = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`);
    for (const [oldId, newId] of map) {
      stmt.run(newId, oldId);
    }
  };

  // Primary keys first
  update("guilds", "id", guildIdMap);
  update("channels", "id", channelIdMap);
  update("users", "id", userIdMap);
  update("messages", "id", messageIdMap);
  update("invite_codes", "id", inviteIdMap);
  update("pending_registrations", "id", pendingIdMap);

  // Foreign keys — use the map matching the referenced entity type
  update("guilds", "owner_id", userIdMap);
  update("channels", "guild_id", guildIdMap);
  update("messages", "channel_id", channelIdMap);
  update("messages", "sender", userIdMap);
  update("messages", "author_id", userIdMap); // legacy schema used author_id instead of sender
  update("guild_members", "guild_id", guildIdMap);
  update("guild_members", "user_id", userIdMap);
  update("read_states", "user_id", userIdMap);
  update("read_states", "channel_id", channelIdMap);
  update("read_states", "last_read_message_id", messageIdMap);
  update("invite_codes", "used_by", userIdMap);

  // Convert TEXT timestamps to INTEGER (ms epoch) across all tables.
  // Old databases stored timestamps as ISO strings (e.g. '2026-06-05T02:21:13.160Z').
  const convertTimestamps = (table: string, columns: string[]) => {
    if (!tableExists(db, table)) return;
    for (const col of columns) {
      if (!hasColumn(db, table, col)) continue;
      const rows = db.prepare(`SELECT rowid, "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL`).all() as Array<{ rowid: number; [key: string]: unknown }>;
      const stmt = db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`);
      for (const row of rows) {
        const val = row[col];
        if (typeof val === "number") continue; // already integer
        if (typeof val === "string") {
          const ms = new Date(val).getTime();
          if (!isNaN(ms)) stmt.run(ms, row.rowid);
        }
      }
    }
  };

  convertTimestamps("guilds", ["created_at", "updated_at"]);
  convertTimestamps("users", ["created_at", "updated_at"]);
  convertTimestamps("messages", ["timestamp", "edited_timestamp"]);
  convertTimestamps("guild_members", ["joined_at"]);
  convertTimestamps("invite_codes", ["created_at", "used_at"]);
  convertTimestamps("pending_registrations", ["created_at"]);
}
