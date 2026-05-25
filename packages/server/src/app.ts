import { Hono } from "hono";
import type Database from "better-sqlite3";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes, type BroadcastFn } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes, type OAuthConfig } from "./routes/auth.js";
import { resolveUser } from "./auth.js";

export interface AppConfig {
  gatewayUrl?: string;
  oauth?: OAuthConfig;
}

export function createApp(
  db: Database.Database,
  broadcast?: BroadcastFn,
  config?: AppConfig,
): Hono {
  const app = new Hono();

  app.route("/", channelRoutes(db, broadcast));
  app.route("/", messagesRoutes(db, broadcast));
  app.route("/", agentRoutes(db));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth));
  }

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  app.get("/api/v10/users/@me", (c) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (user) {
      return c.json(user);
    }
    return c.json({ id: "anonymous", username: "anonymous", bot: false });
  });

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  return app;
}
