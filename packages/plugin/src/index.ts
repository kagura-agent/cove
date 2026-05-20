/**
 * Cove OpenClaw Plugin — Entry point.
 *
 * Registers the Cove channel with OpenClaw, starts the Gateway WebSocket
 * client, and bridges inbound messages from Cove to OpenClaw.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { coveChannelPlugin, resolveAccount } from "./channel.js";
import { CoveGatewayClient } from "./gateway-client.js";

let gatewayClient: CoveGatewayClient | null = null;

const entry: { id: string; name: string; description: string; configSchema: any; register: (api: any) => void; channelPlugin: any; setChannelRuntime?: any } = defineChannelPluginEntry({
  id: "cove",
  name: "Cove",
  description: "Connect OpenClaw to the Cove mirror world",
  plugin: coveChannelPlugin as ChannelPlugin,

  registerFull(api) {
    // Start Gateway connection when the channel activates
    const cfg = api.config;
    let account;
    try {
      account = resolveAccount(cfg);
    } catch {
      api.logger.info("cove: no token configured, skipping gateway connection");
      return;
    }

    const wsUrl = account.baseUrl.replace(/^http/, "ws") + "/gateway";

    gatewayClient = new CoveGatewayClient({
      url: wsUrl,
      token: account.token,
    });

    gatewayClient.on("ready", (user) => {
      api.logger.info(`cove: connected to gateway as ${user.username} (${user.id})`);
    });

    gatewayClient.on("messageCreate", (message) => {
      // Self-loop prevention: skip messages from the bot itself
      if (gatewayClient?.botUser && message.author.id === gatewayClient.botUser.id) {
        return;
      }

      // Skip bot messages
      if (message.author.bot) {
        return;
      }

      // Inbound messages are handled by the channel gateway adapter.
      // When using defineChannelPluginEntry, the gateway startAccount
      // pattern handles dispatching. For now, log inbound messages.
      api.logger.info(
        `cove: inbound message from ${message.author.username} in ${message.channel_id}`,
      );
    });

    gatewayClient.on("error", (err) => {
      api.logger.error(`cove: gateway error: ${err.message}`);
    });

    gatewayClient.on("close", () => {
      api.logger.info("cove: gateway connection closed, will reconnect...");
    });

    gatewayClient.connect();
    api.logger.info(`cove: connecting to gateway at ${wsUrl}`);

    // Register cleanup on shutdown
    api.lifecycle.registerRuntimeLifecycle({
      id: "cove-gateway-cleanup",
      description: "Clean up Cove gateway WebSocket connection",
      cleanup: () => {
        gatewayClient?.destroy();
        gatewayClient = null;
      },
    });
  },
});

export default entry;
