import type { CoveGuildMember, Guild, Channel, Role, PermissionOverwrite } from "@cove/shared";
import { ALL_PERMISSIONS, PermissionBits } from "@cove/shared";

export { PermissionBits, ALL_PERMISSIONS };

const ADMINISTRATOR = PermissionBits.ADMINISTRATOR;

/**
 * Compute base (guild-level) permissions for a member.
 * Matches Discord's algorithm exactly.
 */
export function computeBasePermissions(
  member: CoveGuildMember,
  guild: Guild,
  roles: Role[],
): bigint {
  // Guild owner has all permissions
  if (guild.owner_id === member.user.id) {
    return ALL_PERMISSIONS;
  }

  // Start with @everyone role permissions
  const everyoneRole = roles.find((r) => r.id === guild.id);
  let permissions = everyoneRole ? BigInt(everyoneRole.permissions) : 0n;

  // OR permissions from all member's roles
  for (const roleId of member.roles) {
    const role = roles.find((r) => r.id === roleId);
    if (role) {
      permissions |= BigInt(role.permissions);
    }
  }

  // ADMINISTRATOR bypasses everything
  if (permissions & ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  return permissions;
}

/**
 * Apply channel-level permission overwrites.
 * Matches Discord's documented algorithm exactly.
 */
export function computeOverwrites(
  basePermissions: bigint,
  member: CoveGuildMember,
  _channel: Channel,
  guildId: string,
  overwrites: PermissionOverwrite[],
): bigint {
  // ADMINISTRATOR bypasses channel overwrites
  if (basePermissions & ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  let permissions = basePermissions;

  // Step 1: Apply @everyone role overwrite
  const everyoneOverwrite = overwrites.find((o) => o.id === guildId);
  if (everyoneOverwrite) {
    permissions &= ~BigInt(everyoneOverwrite.deny);
    permissions |= BigInt(everyoneOverwrite.allow);
  }

  // Step 2: Apply role-specific overwrites (combined)
  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const roleId of member.roles) {
    const overwrite = overwrites.find((o) => o.id === roleId && o.type === 0);
    if (overwrite) {
      roleAllow |= BigInt(overwrite.allow);
      roleDeny |= BigInt(overwrite.deny);
    }
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  // Step 3: Apply member-specific overwrite
  const memberOverwrite = overwrites.find((o) => o.id === member.user.id && o.type === 1);
  if (memberOverwrite) {
    permissions &= ~BigInt(memberOverwrite.deny);
    permissions |= BigInt(memberOverwrite.allow);
  }

  return permissions;
}

/**
 * Compute final permissions for a member in a specific channel.
 * Combines base permissions with channel overwrites.
 */
export function computePermissions(
  member: CoveGuildMember,
  channel: Channel,
  guild: Guild,
  roles: Role[],
  overwrites: PermissionOverwrite[],
): bigint {
  const base = computeBasePermissions(member, guild, roles);
  return computeOverwrites(base, member, channel, guild.id, overwrites);
}
