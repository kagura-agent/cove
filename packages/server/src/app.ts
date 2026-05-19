import { Hono } from "hono";
import type Database from "better-sqlite3";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";

/**
 * Create the Hono application with all routes mounted.
 * Separated from index.ts for testability.
 */
export function createApp(db: Database.Database, broadcast?: BroadcastFn): Hono {
  const app = new Hono();

  // Mount route modules
  app.route("/", channelRoutes(db));
  app.route("/", messagesRoutes(db, broadcast));

  // Gateway discovery (Discord-compatible)
  app.get("/api/v10/gateway", (c) =>
    c.json({ url: "ws://localhost:3000/gateway" })
  );

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

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
