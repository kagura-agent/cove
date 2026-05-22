import { Hono } from "hono";
import type Database from "better-sqlite3";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";

export interface AppConfig {
  /** Base URL for gateway discovery. */
  gatewayUrl?: string;
}

/** Resolve a Bot token to the user record from the DB. Returns undefined if not found. */
function resolveBot(db: Database.Database, authHeader: string | undefined): { id: string; username: string; bot: boolean } | undefined {
  if (!authHeader?.startsWith("Bot ")) return undefined;
  const token = authHeader.slice(4).trim();
  if (!token) return undefined;
  const row = db.prepare("SELECT id, username FROM users WHERE token = ?").get(token) as { id: string; username: string } | undefined;
  if (!row) return undefined;
  return { id: row.id, username: row.username, bot: true };
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

  // Mount route modules
  app.route("/", channelRoutes(db, broadcast));
  app.route("/", messagesRoutes(db, broadcast));
  app.route("/", agentRoutes(db));

  // Gateway discovery (Discord-compatible)
  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  // Bot user info (Discord-compatible) — resolve from DB via token
  app.get("/api/v10/users/@me", (c) => {
    const bot = resolveBot(db, c.req.header("Authorization"));
    if (bot) {
      return c.json(bot);
    }
    return c.json({ id: "anonymous", username: "anonymous", bot: false });
  });

  // Health check (no auth required)
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
