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
import { registerCoveAgentRunLifecycleHooks, coveAgentRunLifecycleBridge } from "./agent-run-lifecycle.js";
import { CoveUsageCollector } from "./usage-collector.js";

console.log('[cove-plugin] module loaded at', new Date().toISOString());

const usageCollector = new CoveUsageCollector(coveAgentRunLifecycleBridge, { warn: (msg) => console.warn(msg) });

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
    // Per-turn token usage tracking. `agent_end` fires on every completed turn
    // (channel turns included) and its messages carry per-call `usage` — the
    // reliable data source for token/cost (verified live). `llm_output` only
    // fires on CLI/embedded-runner paths, and `reply_payload_sending` fires
    // without usageState in this harness. The collector computes per-turn delta
    // from the cumulative message usage and attributes it to the owning Cove
    // run via the lifecycle bridge.
    try {
      if (typeof (api as any).on === "function") {
        (api as any).on("agent_end", (event: any, ctx: any) => usageCollector.onAgentEnd(event, ctx));
        console.log('[cove] agent_end usage collector registered');
      } else {
        console.warn('[cove] api.on unavailable; usage tracking disabled');
      }
    } catch (err: any) {
      console.error('[cove] usage collector registration failed:', err.message);
    }
  },
});

export default entry;
