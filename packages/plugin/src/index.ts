/**
 * Cove OpenClaw Plugin — Entry point.
 *
 * Registers the Cove channel with OpenClaw. The gateway adapter in
 * channel.ts handles WebSocket connection and inbound message dispatch.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { coveChannelPlugin } from "./channel.js";

const entry: ReturnType<typeof defineChannelPluginEntry> = defineChannelPluginEntry({
  id: "cove",
  name: "Cove",
  description: "Connect OpenClaw to the Cove mirror world",
  plugin: coveChannelPlugin as ChannelPlugin,
});

export default entry;
