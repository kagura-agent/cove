import { useMemo } from "react";
import { useUserStore } from "../stores/useUserStore";
import { useGuildStore } from "../stores/useGuildStore";
import { useRoleStore } from "../stores/useRoleStore";
import { useMemberStore } from "../stores/useMemberStore";
import { PermissionBits, ALL_PERMISSIONS } from "@cove/shared";

/**
 * Compute the current user's highest role position and base permissions for a guild.
 * Guild owners get ALL_PERMISSIONS and Infinity position.
 */
export function useUserPermissions(guildId: string) {
  const userId = useUserStore((s) => s.id);
  const guild = useGuildStore((s) => s.guilds[guildId]);
  const roles = useRoleStore((s) => s.roles[guildId]);
  const memberMap = useMemberStore((s) => s.membersByGuildId[guildId]);

  return useMemo(() => {
    if (!guild || !userId) {
      return { userHighestPosition: 0, userPermissions: 0n, isOwner: false };
    }

    // Guild owner bypasses everything
    if (guild.owner_id === userId) {
      return { userHighestPosition: Infinity, userPermissions: ALL_PERMISSIONS, isOwner: true };
    }

    const member = memberMap?.[userId];
    const guildRoles = roles ?? [];
    const everyoneRole = guildRoles.find((r) => r.id === guildId);
    let permissions = everyoneRole ? BigInt(everyoneRole.permissions) : 0n;
    let highestPosition = 0;

    if (member) {
      for (const roleId of member.roles) {
        const role = guildRoles.find((r) => r.id === roleId);
        if (role) {
          permissions |= BigInt(role.permissions);
          if (role.position > highestPosition) {
            highestPosition = role.position;
          }
        }
      }
    }

    // ADMINISTRATOR grants all
    if (permissions & PermissionBits.ADMINISTRATOR) {
      return { userHighestPosition: highestPosition, userPermissions: ALL_PERMISSIONS, isOwner: false };
    }

    return { userHighestPosition: highestPosition, userPermissions: permissions, isOwner: false };
  }, [guild, userId, roles, memberMap, guildId]);
}
