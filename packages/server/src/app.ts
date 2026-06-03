import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { Repos } from "./repos/index.js";
import { channelRoutes } from "./routes/channels.js";
import { messagesRoutes } from "./routes/messages.js";
import { agentRoutes } from "./routes/agents.js";
import { authRoutes, type OAuthConfig } from "./routes/auth.js";
import { registerRoutes } from "./routes/register.js";
import { requireAuth, type AppEnv } from "./auth.js";
import type { GatewayDispatcher } from "./ws/dispatcher.js";

export interface AppConfig {
  gatewayUrl?: string;
  oauth?: OAuthConfig;
}

const PUBLIC_PATHS = new Set(["/api/auth/google", "/api/auth/callback", "/api/auth/me", "/api/v10/auth/register"]);

export function createApp(
  db: Database.Database,
  repos: Repos,
  dispatcher?: GatewayDispatcher,
  config?: AppConfig,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.route("/", registerRoutes(db));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth));
  }

  // Global auth: all /api/* routes (except PUBLIC_PATHS and OPTIONS) require a valid token.
  const authMw = requireAuth(repos.users);
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const path = c.req.path.replace(/\/+$/, "") || "/";
    if (PUBLIC_PATHS.has(path)) return next();
    return authMw(c, next);
  });

  app.route("/", channelRoutes(repos, dispatcher));
  app.route("/", messagesRoutes(repos, dispatcher));
  app.route("/", agentRoutes(repos));

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get("/api/v10/gateway", (c) => c.json({ url: gwUrl }));

  app.get("/api/v10/guilds/:guildId/presences", (c) => {
    const onlineIds = dispatcher?.getOnlineUserIds() ?? [];
    return c.json(onlineIds.map((id) => ({ user: { id }, status: "online" })));
  });

  app.get("/api/v10/users/@me", (c) => {
    return c.json(c.get("botUser"));
  });

  app.get("/api/v10/users/@me/guilds", (c) => {
    const user = c.get("botUser");
    return c.json(repos.guilds.listForUser(user.id));
  });

  return app;
}
