import type Database from "better-sqlite3";
import { generateSnowflake, type Role } from "@cove/shared";

interface RoleRow {
  id: string;
  guild_id: string;
  name: string;
  color: number;
  hoist: number;
  position: number;
  permissions: string;
  managed: number;
  mentionable: number;
  flags: number;
  bot_id: string | null;
}

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    hoist: row.hoist === 1,
    position: row.position,
    permissions: row.permissions,
    managed: row.managed === 1,
    mentionable: row.mentionable === 1,
    flags: row.flags,
    bot_id: row.bot_id,
  };
}

export class RolesRepo {
  constructor(private db: Database.Database) {}

  listByGuild(guildId: string): Role[] {
    const rows = this.db
      .prepare("SELECT * FROM roles WHERE guild_id = ? ORDER BY position ASC, id ASC")
      .all(guildId) as RoleRow[];
    return rows.map(toRole);
  }

  getById(roleId: string): Role | null {
    const row = this.db.prepare("SELECT * FROM roles WHERE id = ?").get(roleId) as RoleRow | undefined;
    return row ? toRole(row) : null;
  }

  create(
    guildId: string,
    data: { name?: string; permissions?: string; color?: number; hoist?: boolean; mentionable?: boolean },
  ): Role {
    const id = generateSnowflake();
    const maxPos = this.db
      .prepare("SELECT MAX(position) as max_pos FROM roles WHERE guild_id = ?")
      .get(guildId) as { max_pos: number | null };
    const position = (maxPos.max_pos ?? 0) + 1;

    // Default permissions: copy from @everyone role (Discord behavior)
    let permissions = data.permissions;
    if (permissions === undefined) {
      const everyone = this.getEveryoneRole(guildId);
      permissions = everyone?.permissions ?? "0";
    }

    this.db.prepare(
      `INSERT INTO roles (id, guild_id, name, color, hoist, position, permissions, managed, mentionable, flags, bot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, NULL)`
    ).run(
      id,
      guildId,
      data.name ?? "new role",
      data.color ?? 0,
      data.hoist ? 1 : 0,
      position,
      permissions,
      data.mentionable ? 1 : 0,
    );

    return {
      id,
      name: data.name ?? "new role",
      color: data.color ?? 0,
      hoist: data.hoist ?? false,
      position,
      permissions,
      managed: false,
      mentionable: data.mentionable ?? false,
      flags: 0,
      bot_id: null,
    };
  }

  update(roleId: string, data: Partial<{ name: string; permissions: string; color: number; hoist: boolean; mentionable: boolean; position: number }>): Role | null {
    const existing = this.getById(roleId);
    if (!existing) return null;

    const name = data.name ?? existing.name;
    const permissions = data.permissions ?? existing.permissions;
    const color = data.color ?? existing.color;
    const hoist = data.hoist !== undefined ? data.hoist : existing.hoist;
    const mentionable = data.mentionable !== undefined ? data.mentionable : existing.mentionable;
    const position = data.position ?? existing.position;

    this.db.prepare(
      "UPDATE roles SET name = ?, permissions = ?, color = ?, hoist = ?, mentionable = ?, position = ? WHERE id = ?"
    ).run(name, permissions, color, hoist ? 1 : 0, mentionable ? 1 : 0, position, roleId);

    return { ...existing, name, permissions, color, hoist, mentionable, position };
  }

  delete(roleId: string): boolean {
    return this.db.transaction(() => {
      // Remove role ID from guild_members.roles arrays
      const members = this.db
        .prepare(
          `SELECT guild_id, user_id, roles FROM guild_members
           WHERE roles LIKE '%' || ? || '%'`
        )
        .all(roleId) as Array<{ guild_id: string; user_id: string; roles: string }>;

      const updateStmt = this.db.prepare(
        "UPDATE guild_members SET roles = ? WHERE guild_id = ? AND user_id = ?"
      );
      for (const member of members) {
        const roleIds: string[] = JSON.parse(member.roles);
        const filtered = roleIds.filter((id) => id !== roleId);
        if (filtered.length !== roleIds.length) {
          updateStmt.run(JSON.stringify(filtered), member.guild_id, member.user_id);
        }
      }

      // Delete channel_permission_overwrites for this role
      this.db
        .prepare("DELETE FROM channel_permission_overwrites WHERE target_id = ? AND target_type = 0")
        .run(roleId);

      // Delete the role
      const result = this.db.prepare("DELETE FROM roles WHERE id = ?").run(roleId);
      return result.changes > 0;
    })();
  }

  updatePositions(guildId: string, positions: Array<{ id: string; position: number }>): Role[] {
    return this.db.transaction(() => {
      const updateStmt = this.db.prepare("UPDATE roles SET position = ? WHERE id = ? AND guild_id = ?");
      for (const { id, position } of positions) {
        updateStmt.run(position, id, guildId);
      }
      return this.listByGuild(guildId);
    })();
  }

  getEveryoneRole(guildId: string): Role | null {
    const row = this.db.prepare("SELECT * FROM roles WHERE id = ?").get(guildId) as RoleRow | undefined;
    return row ? toRole(row) : null;
  }
}
