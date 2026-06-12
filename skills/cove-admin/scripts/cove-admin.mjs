#!/usr/bin/env node

/**
 * cove-admin.mjs — Manage Cove server resources via REST API.
 *
 * Usage:
 *   node cove-admin.mjs channel create --name <name> [--topic <topic>]
 *   node cove-admin.mjs channel list
 *   node cove-admin.mjs channel update --id <id> [--name <name>] [--topic <topic>]
 *   node cove-admin.mjs channel delete --id <id>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = resolve(process.env.HOME, ".openclaw/openclaw.json");
const API_VERSION = "v10";

function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  const cove = raw.channels?.cove;
  if (!cove?.token || !cove?.baseUrl || !cove?.guildId) {
    throw new Error("Missing Cove config in openclaw.json (need token, baseUrl, guildId)");
  }
  return { token: cove.token, baseUrl: cove.baseUrl, guildId: cove.guildId };
}

async function api(path, opts = {}) {
  const config = loadConfig();
  const url = `${config.baseUrl}/api/${API_VERSION}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bot ${config.token}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function channelCreate(args) {
  const nameIdx = args.indexOf("--name");
  const topicIdx = args.indexOf("--topic");
  if (nameIdx === -1 || !args[nameIdx + 1]) {
    console.error("Usage: channel create --name <name> [--topic <topic>]");
    process.exit(1);
  }
  const name = args[nameIdx + 1];
  const topic = topicIdx !== -1 ? args[topicIdx + 1] : undefined;
  const config = loadConfig();
  const body = { name };
  if (topic) body.topic = topic;
  const ch = await api(`/guilds/${config.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  console.log(`✅ Created #${ch.name} (${ch.id})`);
  if (ch.topic) console.log(`   Topic: ${ch.topic}`);
}

async function channelList() {
  const config = loadConfig();
  const channels = await api(`/guilds/${config.guildId}/channels`);
  if (!channels || channels.length === 0) {
    console.log("No channels found.");
    return;
  }
  console.log(`Channels (${channels.length}):`);
  for (const ch of channels) {
    const topic = ch.topic ? ` — ${ch.topic}` : "";
    console.log(`  #${ch.name} (${ch.id})${topic}`);
  }
}

async function channelUpdate(args) {
  const idIdx = args.indexOf("--id");
  const nameIdx = args.indexOf("--name");
  const topicIdx = args.indexOf("--topic");
  if (idIdx === -1 || !args[idIdx + 1]) {
    console.error("Usage: channel update --id <id> [--name <name>] [--topic <topic>]");
    process.exit(1);
  }
  const id = args[idIdx + 1];
  const body = {};
  if (nameIdx !== -1 && args[nameIdx + 1]) body.name = args[nameIdx + 1];
  if (topicIdx !== -1 && args[topicIdx + 1]) body.topic = args[topicIdx + 1];
  if (Object.keys(body).length === 0) {
    console.error("Nothing to update. Provide --name and/or --topic.");
    process.exit(1);
  }
  const ch = await api(`/channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  console.log(`✅ Updated #${ch.name} (${ch.id})`);
}

async function channelDelete(args) {
  const idIdx = args.indexOf("--id");
  const force = args.includes("--yes") || args.includes("--force");
  if (idIdx === -1 || !args[idIdx + 1]) {
    console.error("Usage: channel delete --id <id> [--yes|--force]");
    process.exit(1);
  }
  const id = args[idIdx + 1];
  if (!force) {
    console.error(`⚠️  This will permanently delete channel ${id}. Pass --yes or --force to confirm.`);
    process.exit(1);
  }
  await api(`/channels/${id}`, { method: "DELETE" });
  console.log(`✅ Deleted channel ${id}`);
}

const [resource, action, ...rest] = process.argv.slice(2);

try {
  if (resource === "channel" || resource === "channels") {
    switch (action) {
      case "create": await channelCreate(rest); break;
      case "list": case "ls": await channelList(); break;
      case "update": await channelUpdate(rest); break;
      case "delete": case "rm": await channelDelete(rest); break;
      default:
        console.error(`Unknown action: ${action}`);
        console.error("Available: create, list, update, delete");
        process.exit(1);
    }
  } else {
    console.error("Usage: cove-admin.mjs <resource> <action> [options]");
    console.error("Resources: channel");
    process.exit(1);
  }
} catch (err) {
  // Redact potential token leakage from error messages
  const msg = (err.message || String(err)).replace(/Bot\s+[\w-]+/g, "Bot ***");
  console.error(`❌ ${msg}`);
  process.exit(1);
}
