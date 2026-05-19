import type { Message } from "@cove/shared";

/**
 * CoveChannelAdapter — stub for OpenClaw channel integration.
 *
 * OpenClaw channels follow a plugin pattern where each channel type
 * (Discord, Zulip, Feishu, etc.) implements adapters for:
 *   - Outbound messaging (agent → channel)
 *   - Inbound messaging (channel → agent)
 *   - Account/credential management
 *   - Status reporting
 *
 * For Cove, the "channel" is a scene in the game world. Messages sent
 * to a scene are routed to the corresponding OpenClaw channel, and
 * messages from OpenClaw channels appear in their mapped scenes.
 *
 * TODO: Implement the full ChannelPlugin interface from openclaw/plugin-sdk:
 *   - ChannelOutboundAdapter: send messages from agent to scene/channel
 *   - ChannelStatusAdapter: report connection health
 *   - ChannelDirectoryAdapter: list available scenes/channels
 *   - Registration via channel plugin registry
 *
 * Reference: openclaw/src/channels/plugins/types.public.ts
 * Reference: openclaw/src/plugin-sdk/channel-core.ts (ChannelPlugin interface)
 */

/** Scene-to-channel mapping. Only core Phase 1 scenes are mapped here;
 *  additional scenes are added as features unlock. */
const SCENE_CHANNEL_MAP: Record<string, string> = {
  "home": "kagura-dm",
  "garden": "garden",
  "workshop": "github-contribution",
  "post-office": "kagura-mail",
};

export class CoveChannelAdapter {
  /**
   * Send a message from the game UI to the mapped OpenClaw channel.
   *
   * TODO: Use OpenClaw's outbound adapter to deliver to the real channel
   * (e.g., Discord #garden channel when someone talks in the Garden scene).
   */
  async sendMessage(sceneId: string, content: string): Promise<void> {
    const channel = this.mapSceneToChannel(sceneId);
    if (!channel) {
      console.warn(`[CoveAdapter] No channel mapping for scene: ${sceneId}`);
      return;
    }
    // TODO: Route message through OpenClaw channel outbound
    console.log(`[CoveAdapter] Would send to channel ${channel}: ${content}`);
  }

  /**
   * Register a handler for incoming messages from OpenClaw channels.
   *
   * TODO: Subscribe to OpenClaw inbound message events and map them
   * back to scene IDs for display in the game UI.
   */
  onMessage(_handler: (sceneId: string, message: Message) => void): void {
    // TODO: Wire up to OpenClaw's inbound message pipeline
    console.log("[CoveAdapter] Message handler registered (stub)");
  }

  /**
   * Look up which OpenClaw channel a scene maps to.
   */
  mapSceneToChannel(sceneId: string): string | undefined {
    return SCENE_CHANNEL_MAP[sceneId];
  }
}
