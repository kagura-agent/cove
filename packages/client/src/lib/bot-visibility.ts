import { PermissionFlags } from "@cove/shared";

/**
 * Build the member overwrite used by the channel settings bot-visibility toggle.
 *
 * An explicit deny is required for disabled bots: removing their allow overwrite
 * would let them inherit VIEW_CHANNEL from a guild role.
 */
export function botVisibilityOverwrite(enabled: boolean) {
  return {
    type: 1,
    allow: enabled ? PermissionFlags.VIEW_CHANNEL : "0",
    deny: enabled ? "0" : PermissionFlags.VIEW_CHANNEL,
  };
}
