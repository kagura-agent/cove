#!/usr/bin/env node

/**
 * cove-webhook-send.mjs — Cross-channel webhook messenger for Cove.
 *
 * Auto-creates and caches webhooks per channel so callers only need
 * channel names (or IDs).
 *
 * Usage:
 *   node cove-webhook-send.mjs --to <channel> --from <channel> --message "text"
 *   node cove-webhook-send.mjs --to <channel> --from <channel> --message "text" --thread <threadId>
 *
 * Environment (auto-read from openclaw.json when unset):
 *   COVE_BASE   — Cove API base URL
 *   COVE_TOKEN  — Bot token
 *   COVE_GUILD  — Guild ID
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { homedir } from "node:os";

// ── CLI args ────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    to: { type: "string" },
    from: { type: "string" },
    message: { type: "string", short: "m" },
    thread: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  strict: true,
});

if (args.help || !args.to || !args.from || !args.message) {
  console.log(`Usage: node cove-webhook-send.mjs --to <channel> --from <channel> -m "message" [--thread <id>]`);
  process.exit(args.help ? 0 : 1);
}

// ── Cove env ────────────────────────────────────────────────────────
function loadCoveEnv() {
  let base = process.env.COVE_BASE;
  let token = process.env.COVE_TOKEN;
  let guild = process.env.COVE_GUILD;

  if (base && token && guild) return { base, token, guild };

  // Auto-read from openclaw.json
  const configPath = resolve(homedir(), ".openclaw/openclaw.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const cove = config?.channels?.cove;
      if (cove) {
        base = base || cove.baseUrl;
        token = token || cove.token;
        guild = guild || cove.guildId;
      }
    } catch { /* ignore parse errors */ }
  }

  if (!base || !token || !guild) {
    console.error("Missing COVE_BASE, COVE_TOKEN, or COVE_GUILD. Set env or configure openclaw.json.");
    process.exit(1);
  }
  return { base, token, guild };
}

const env = loadCoveEnv();
const API = `${env.base}/api/v10`;

// ── Webhook cache ───────────────────────────────────────────────────
const CACHE_DIR = resolve(homedir(), ".cache/cove-webhooks");
const CACHE_FILE = resolve(CACHE_DIR, "webhooks.json");

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ── API helpers ─────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${env.token}`,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${opts.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function resolveChannel(nameOrId) {
  // If it looks like a snowflake ID, use directly
  if (/^\d{17,20}$/.test(nameOrId)) return nameOrId;

  // Strip leading # if present
  const name = nameOrId.replace(/^#/, "");

  const channels = await api(`/guilds/${env.guild}/channels`);
  const ch = channels.find(
    (c) => c.name === name || c.name === name.toLowerCase()
  );
  if (!ch) throw new Error(`Channel not found: ${nameOrId}`);
  return ch.id;
}

async function getOrCreateWebhook(channelId) {
  const cache = loadCache();
  if (cache[channelId]) {
    // Validate cached webhook still exists
    try {
      const url = `${API}/webhooks/${cache[channelId].id}/${cache[channelId].token}`;
      const res = await fetch(url);
      if (res.ok) return cache[channelId];
    } catch { /* cache stale, recreate */ }
  }

  // Check existing webhooks on channel
  const existing = await api(`/channels/${channelId}/webhooks`);
  const ours = existing.find((w) => w.name === "cove-cross-channel");
  if (ours) {
    cache[channelId] = { id: ours.id, token: ours.token };
    saveCache(cache);
    return cache[channelId];
  }

  // Create new webhook
  const wh = await api(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ name: "cove-cross-channel" }),
  });
  cache[channelId] = { id: wh.id, token: wh.token };
  saveCache(cache);
  return cache[channelId];
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const toId = await resolveChannel(args.to);
  const fromName = args.from.replace(/^#/, "");

  const wh = await getOrCreateWebhook(toId);

  let url = `${API}/webhooks/${wh.id}/${wh.token}?wait=true`;
  if (args.thread) url += `&thread_id=${args.thread}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: args.message,
      username: `From #${fromName}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Webhook send failed: ${res.status} ${body}`);
    process.exit(1);
  }

  const msg = await res.json();
  console.log(`✅ Sent to #${args.to} (msg ${msg.id})`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
