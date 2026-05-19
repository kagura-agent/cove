import { Hono } from "hono";
import type Database from "better-sqlite3";
import { scenesRoutes } from "./routes/scenes.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";

/**
 * Create the Hono application with all routes mounted.
 * Separated from index.ts for testability.
 */
export function createApp(db: Database.Database, broadcast?: BroadcastFn): Hono {
  const app = new Hono();

  // Mount route modules
  app.route("/", scenesRoutes(db));
  app.route("/", messagesRoutes(db, broadcast));

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
