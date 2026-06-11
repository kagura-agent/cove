import type Database from "better-sqlite3";
import type { PermissionOverwrite } from "@cove/shared";

interface OverwriteRow {
  channel_id: string;
  target_id: string;
  target_type: number;
  allow: string;
  deny: string;
}

function toOverwrite(row: OverwriteRow): PermissionOverwrite {
  return {
    id: row.target_id,
    type: row.target_type,
    allow: row.allow,
    deny: row.deny,
  };
}

export class PermissionsRepo {
  constructor(private db: Database.Database) {}

  listByChannel(channelId: string): PermissionOverwrite[] {
    const rows = this.db
      .prepare("SELECT * FROM channel_permission_overwrites WHERE channel_id = ?")
      .all(channelId) as OverwriteRow[];
    return rows.map(toOverwrite);
  }

  upsert(
    channelId: string,
    targetId: string,
    targetType: number,
    allow: string,
    deny: string,
  ): PermissionOverwrite {
    this.db
      .prepare(
        `INSERT INTO channel_permission_overwrites (channel_id, target_id, target_type, allow, deny)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (channel_id, target_id)
         DO UPDATE SET target_type = excluded.target_type, allow = excluded.allow, deny = excluded.deny`,
      )
      .run(channelId, targetId, targetType, allow, deny);
    return { id: targetId, type: targetType, allow, deny };
  }

  remove(channelId: string, targetId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM channel_permission_overwrites WHERE channel_id = ? AND target_id = ?")
      .run(channelId, targetId);
    return result.changes > 0;
  }

  hasPermission(channelId: string, targetId: string, permissionBit: bigint): boolean {
    const row = this.db
      .prepare("SELECT allow, deny FROM channel_permission_overwrites WHERE channel_id = ? AND target_id = ?")
      .get(channelId, targetId) as { allow: string; deny: string } | undefined;
    if (!row) return false;
    const allow = BigInt(row.allow);
    const deny = BigInt(row.deny);
    return (allow & permissionBit) !== 0n && (deny & permissionBit) === 0n;
  }
}
