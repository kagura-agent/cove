/**
 * Cove ChannelMessageActionAdapter — adapter object registered on the plugin.
 *
 * Pattern follows Discord's channel-actions.ts:
 * - describeMessageTool: declares supported actions
 * - resolveExecutionMode: local (send via outbound) vs gateway (rest)
 * - handleAction: lazy-loads runtime module for actual execution
 */

import type { ChannelMessageActionAdapter, ChannelMessageActionName, ChannelToolSend } from "openclaw/plugin-sdk/channel-contract";
import { extractToolSend } from "openclaw/plugin-sdk/tool-send";

/** Actions that go through the outbound durable pipeline (not handleAction). */
const LOCAL_ACTIONS: ReadonlySet<string> = new Set(["send", "thread-reply"]);

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
  // Task
  "task-create",
  "task-list",
  "task-get",
  "task-update",
];

let runtimePromise: Promise<typeof import("./message-actions.runtime.js")> | undefined;

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

  extractToolSend({ args }): ChannelToolSend | null {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action === "send") return extractToolSend(args, "send");
    if (action === "thread-reply") {
      const channelId = typeof args.channelId === "string" ? args.channelId.trim() : "";
      return channelId ? { to: `channel:${channelId}` } : null;
    }
    return null;
  },

  async handleAction(ctx) {
    runtimePromise ??= import("./message-actions.runtime.js");
    return (await runtimePromise).handleCoveMessageAction(ctx);
  },
};
