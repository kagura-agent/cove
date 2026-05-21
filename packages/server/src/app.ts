import { Hono } from "hono";
import type Database from "better-sqlite3";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";

export interface AppConfig {
  /** Static bot token for auth. If not set, auth is disabled. */
  botToken?: string;
  /** Base URL for gateway discovery. */
  gatewayUrl?: string;
}

/**
 * Create the Hono application with all routes mounted.
 * Separated from index.ts for testability.
 */
export function createApp(
  db: Database.Database,
  broadcast?: BroadcastFn,
  config?: AppConfig,
): Hono {
  const app = new Hono();

  // Discord-compatible API routes use /api/v10/* path prefix.
  // This mirrors Discord's URL versioning so that standard Discord
  // client libraries (discord.js, etc.) can connect without modification.
  // Auth: Bot token required only for game-server API calls.
  // Browser clients send userId/username in body instead.
  // No auth middleware — we check per-route where needed.

  // Mount route modules
  app.route("/", channelRoutes(db, broadcast));
  app.route("/", messagesRoutes(db, broadcast));
  app.route("/", agentRoutes(db));

  // Gateway discovery (Discord-compatible)
  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  // Bot user info (Discord-compatible)
  app.get("/api/v10/users/@me", (c) => {
    const auth = c.req.header("Authorization");
    const token = auth?.startsWith("Bot ") ? auth.slice(4).trim() : "anonymous";
    return c.json({
      id: token,
      username: token,
      bot: true,
    });
  });

  // Health check (no auth required)
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
