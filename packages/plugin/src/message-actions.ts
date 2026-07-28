/**
 * Cove ChannelMessageActionAdapter — adapter object registered on the plugin.
 *
 * Pattern follows Discord's channel-actions.ts:
 * - describeMessageTool: declares supported actions
 * - resolveExecutionMode: local (send via outbound) vs gateway (rest)
 * - handleAction: lazy-loads runtime module for actual execution
 */

import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "openclaw/plugin-sdk/channel-contract";

/** Actions that go through the outbound durable pipeline (not handleAction). */
const LOCAL_ACTIONS: ReadonlySet<string> = new Set(["send"]);

/** All actions this adapter declares support for. */
const SUPPORTED_ACTIONS: ChannelMessageActionName[] = [
  "send",
  // P0
  "react",
  "read",
  "edit",
  "delete",
  // P1
  "thread-create",
  "thread-list",
  "thread-reply",
  "channel-info",
  "channel-list",
];

export const coveMessageActionAdapter: ChannelMessageActionAdapter = {
  describeMessageTool() {
    return {
      actions: [...SUPPORTED_ACTIONS],
      capabilities: [],
    };
  },

  resolveExecutionMode({ action }) {
    return LOCAL_ACTIONS.has(action) ? "local" : "gateway";
  },

  async handleAction(ctx) {
    // Lazy-load runtime to avoid startup cost (Discord pattern)
    const { handleCoveMessageAction } = await import("./message-actions.runtime.js");
    return handleCoveMessageAction(ctx);
  },
};
