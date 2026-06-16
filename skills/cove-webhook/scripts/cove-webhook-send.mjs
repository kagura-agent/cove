#!/usr/bin/env node

/**
 * cove-webhook-send.mjs — Send cross-channel messages in Cove via webhook.
 *
 * Usage:
 *   node cove-webhook-send.mjs --to <channel> --from <channel> --message <text>
 *
 * Reads Cove config (token, baseUrl, guildId) from ~/.openclaw/openclaw.json.
 * Caches webhook credentials locally to avoid re-creating on every call.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const CACHE_PATH = resolve(process.env.HOME, ".openclaw/workspace-ruantang/.cove-webhooks.json");
const CONFIG_PATH = resolve(process.env.HOME, ".openclaw/openclaw.json");

function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const cove = raw.channels?.cove;
  if (!cove?.token || !cove?.baseUrl || !cove?.guildId) {
    throw new Error("Missing Cove config in openclaw.json (need token, baseUrl, guildId)");
  }
  return { token: cove.token, baseUrl: cove.baseUrl, guildId: cove.guildId };
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(readFileSync(CACHE_PATH, "utf-8")); } catch { return {}; }
}

function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function apiRequest(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || 5);
    console.error(`Rate limited. Retry after ${retryAfter}s`);
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function resolveChannelId(baseUrl, token, guildId, channelName) {
  const channels = await apiRequest(`${baseUrl}/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const match = channels.find(
    (ch) => ch.name === channelName || ch.id === channelName
  );
  if (!match) {
    const available = channels.map((ch) => ch.name).join(", ");
    throw new Error(`Channel "${channelName}" not found. Available: ${available}`);
  }
  return match.id;
}

async function getOrCreateWebhook(baseUrl, token, channelId, cache) {
  // Check cache
  if (cache[channelId]) {
    // Verify cached webhook still exists
    try {
      await apiRequest(
        `${baseUrl}/api/v10/webhooks/${cache[channelId].id}/${cache[channelId].token}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "" }) }
      );
    } catch (e) {
      if (e.message.includes("404") || e.message.includes("Unknown Webhook")) {
        delete cache[channelId];
      } else if (e.message.includes("400")) {
        // Validation error means webhook exists (empty content rejected)
        return cache[channelId];
      } else {
        throw e;
      }
    }
  }

  if (cache[channelId]) return cache[channelId];

  // Create new webhook
  const webhook = await apiRequest(`${baseUrl}/api/v10/channels/${channelId}/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Cross-Channel" }),
  });

  cache[channelId] = { id: webhook.id, token: webhook.token };
  saveCache(cache);
  return cache[channelId];
}

async function executeWebhook(baseUrl, webhookId, webhookToken, content, username, replyTo, threadId) {
  const queryParams = new URLSearchParams({ wait: "true" });
  if (threadId) queryParams.append("thread_id", threadId);

  const body = { content, username };
  if (replyTo) body.reply_to = { id: replyTo };

  return apiRequest(`${baseUrl}/api/v10/webhooks/${webhookId}/${webhookToken}?${queryParams}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function resolveTargetRoute(baseUrl, token, targetId) {
  const channel = await apiRequest(`${baseUrl}/api/v10/channels/${targetId}`, {
    headers: { Authorization: `Bot ${token}` },
  });

  // If it's a thread (types 10, 11, 12) and has a parent, return parent as target and thread as threadId
  if ([10, 11, 12].includes(channel.type) && channel.parent_id) {
    return { targetChannelId: channel.parent_id, threadId: targetId };
  }

  return { targetChannelId: targetId, threadId: null };
}

async function main() {
  const { values } = parseArgs({
    options: {
      to: { type: "string" },
      "to-id": { type: "string" },
      from: { type: "string" },
      message: { type: "string" },
      "reply-to": { type: "string" },
    },
  });

  if ((!values.to && !values["to-id"]) || !values.message) {
    console.error("Usage: cove-webhook-send.mjs --to <channel> [--to-id <id>] --from <channel> --message <text> [--reply-to <channel-id>]");
    process.exit(1);
  }

  const config = loadConfig();
  const cache = loadCache();

  let targetId;
  if (values["to-id"]) {
    targetId = values["to-id"];
  } else {
    targetId = await resolveChannelId(config.baseUrl, config.token, config.guildId, values.to);
  }

  let fromName = values.from || null;
  const replyTo = values["reply-to"] || null;

  // Auto-resolve fromName from reply-to channel if not provided
  if (!fromName && replyTo) {
    try {
      const ch = await apiRequest(`${config.baseUrl}/api/v10/channels/${replyTo}`, {
        headers: { Authorization: `Bot ${config.token}` },
      });
      fromName = ch.name || replyTo;
    } catch {
      fromName = replyTo;
    }
  }
  if (!fromName) fromName = "unknown";

  // Resolve target route (handles threads)
  const { targetChannelId, threadId } = await resolveTargetRoute(config.baseUrl, config.token, targetId);

  const webhook = await getOrCreateWebhook(config.baseUrl, config.token, targetChannelId, cache);
  const msg = await executeWebhook(
    config.baseUrl,
    webhook.id,
    webhook.token,
    values.message,
    `From #${fromName}`,
    replyTo,
    threadId
  );

  console.log(`✅ Sent to #${values.to || targetId} (From #${fromName})`);
  console.log(`   Message ID: ${msg.id}`);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
