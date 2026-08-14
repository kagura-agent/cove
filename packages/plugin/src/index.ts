/**
 * Cove OpenClaw Plugin — Entry point.
 *
 * Registers the Cove channel with OpenClaw. The gateway adapter in
 * channel.ts handles WebSocket connection and inbound message dispatch.
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { coveChannelPlugin } from "./channel.js";
import { createCoveTaskTool } from "./cove-task-tool.js";
import { registerCoveAgentRunLifecycleHooks } from "./agent-run-lifecycle.js";

console.log('[cove-plugin] module loaded at', new Date().toISOString());

const entry: ReturnType<typeof defineChannelPluginEntry> = defineChannelPluginEntry({
  id: "cove",
  name: "Cove",
  description: "Connect OpenClaw to the Cove mirror world",
  plugin: coveChannelPlugin as ChannelPlugin,
  registerFull: (api) => {
    console.log('[cove] registerFull called, registrationMode:', (api as any).registrationMode);
    try {
      // OpenClaw 2026.6.8 exposes native subagent_spawned/subagent_ended hooks.
      // They are the only truthful source for sessions_spawn lifecycle state.
      registerCoveAgentRunLifecycleHooks(api as any);
      api.registerTool(
        (context) => createCoveTaskTool({ cfg: (context as any).config ?? (context as any).runtimeConfig ?? {} }),
        { names: ["cove_task"] }
      );
      console.log('[cove] cove_task tool registered successfully');
    } catch (err: any) {
      console.error('[cove] registerTool failed:', err.message);
    }
  },
});

export default entry;
