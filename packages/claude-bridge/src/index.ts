/**
 * cove-claude-bridge — Entry point.
 *
 * Connects a Cove chat server to a local Claude Code CLI.
 * Configuration via environment variables:
 *
 *   COVE_BASE_URL      — Cove server base URL (required)
 *   COVE_BOT_TOKEN     — Bot authentication token (required)
 *   COVE_GUILD_ID      — Guild ID to scope message handling (required)
 *   CLAUDE_WORKING_DIR — Working directory for Claude processes (default: cwd)
 */

import { Bridge } from "./bridge.js";

function main(): void {
  const baseUrl = process.env.COVE_BASE_URL;
  const token = process.env.COVE_BOT_TOKEN;
  const guildId = process.env.COVE_GUILD_ID;
  const workingDir = process.env.CLAUDE_WORKING_DIR || process.cwd();

  const missing: string[] = [];
  if (!baseUrl) missing.push("COVE_BASE_URL");
  if (!token) missing.push("COVE_BOT_TOKEN");
  if (!guildId) missing.push("COVE_GUILD_ID");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("");
    console.error("Usage:");
    console.error("  COVE_BASE_URL=https://staging.cove.example.com \\");
    console.error("  COVE_BOT_TOKEN=xxx \\");
    console.error("  COVE_GUILD_ID=1234567890 \\");
    console.error("  cove-claude-bridge");
    console.error("");
    console.error("Optional:");
    console.error("  CLAUDE_WORKING_DIR=/path/to/workspace  (default: cwd)");
    process.exit(1);
  }

  const bridge = new Bridge({
    baseUrl: baseUrl!,
    token: token!,
    guildId: guildId!,
    workingDir,
  });

  // Graceful shutdown
  const shutdown = () => {
    bridge.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  bridge.start().catch((err) => {
    console.error("[bridge] Failed to start:", err);
    process.exit(1);
  });
}

main();
