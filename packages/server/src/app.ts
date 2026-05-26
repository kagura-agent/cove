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

const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/google", "/api/auth/callback", "/api/auth/me"]);

export function createApp(
  db: Database.Database,
  broadcast?: BroadcastFn,
  config?: AppConfig,
): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth));
  }

  app.use("/api/*", async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();

    const user = resolveUser(db, c.req.header("Authorization"));
    if (!user) {
      return c.json({ message: "Authentication required", code: 40001 }, 401);
    }
    return next();
  });

  app.route("/", channelRoutes(db, broadcast));
  app.route("/", messagesRoutes(db, broadcast));
  app.route("/", agentRoutes(db));

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  app.get("/api/v10/users/@me", (c) => {
    const user = resolveUser(db, c.req.header("Authorization"));
    if (user) return c.json(user);
    return c.json({ message: "Authentication required", code: 40001 }, 401);
  });

  return app;
}
