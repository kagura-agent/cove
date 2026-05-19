import { Hono } from "hono";
import type Database from "better-sqlite3";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";

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

  // Auth middleware for /api/v10/* routes (skip health check)
  if (config?.botToken) {
    app.use("/api/v10/*", async (c, next) => {
      const auth = c.req.header("Authorization");
      const token = auth?.startsWith("Bot ") ? auth.slice(4).trim() : null;
      if (token !== config.botToken) {
        return c.json({ message: "401: Unauthorized" }, 401);
      }
      await next();
    });
  }

  // Mount route modules
  app.route("/", channelRoutes(db));
  app.route("/", messagesRoutes(db, broadcast));

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
