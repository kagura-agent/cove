/**
 * Cove OpenClaw Plugin — Entry point.
 *
 * Registers the Cove channel with OpenClaw, starts the Gateway WebSocket
 * client, and bridges inbound messages from Cove to OpenClaw.
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { coveChannelPlugin, resolveAccount, getRestClient } from "./channel.js";
import { CoveGatewayClient } from "./gateway-client.js";

let gatewayClient: CoveGatewayClient | null = null;

export default defineChannelPluginEntry({
  id: "cove",
  name: "Cove",
  description: "Connect OpenClaw to the Cove mirror world",
  plugin: coveChannelPlugin,

  registerFull(api) {
    // Start Gateway connection when the channel activates
    const cfg = api.getConfig();
    let account;
    try {
      account = resolveAccount(cfg);
    } catch {
      api.log?.("cove: no token configured, skipping gateway connection");
      return;
    }

    const wsUrl = account.baseUrl.replace(/^http/, "ws") + "/gateway";

    gatewayClient = new CoveGatewayClient({
      url: wsUrl,
      token: account.token,
    });

    gatewayClient.on("ready", (user) => {
      api.log?.(`cove: connected to gateway as ${user.username} (${user.id})`);
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

      // Dispatch inbound message to OpenClaw
      api.dispatchInbound?.({
        channel: "cove",
        conversationId: message.channel_id,
        senderId: message.author.id,
        senderName: message.author.username,
        text: message.content,
        messageId: message.id,
        timestamp: message.timestamp,
      });
    });

    gatewayClient.on("error", (err) => {
      api.log?.(`cove: gateway error: ${err.message}`);
    });

    gatewayClient.on("close", () => {
      api.log?.("cove: gateway connection closed, will reconnect...");
    });

    gatewayClient.connect();
    api.log?.(`cove: connecting to gateway at ${wsUrl}`);

    // Register cleanup on shutdown
    api.onShutdown?.(() => {
      gatewayClient?.destroy();
      gatewayClient = null;
    });
  },
});
