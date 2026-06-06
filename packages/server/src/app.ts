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
import { API_PREFIX } from "@cove/shared";

export interface AppConfig {
  gatewayUrl?: string;
  oauth?: OAuthConfig;
}

const PUBLIC_PATHS = new Set(["/api/auth/google", "/api/auth/callback", "/api/auth/me", "/api/auth/pending-status", "/api/auth/logout", `${API_PREFIX}/auth/register`]);

export function createApp(
  db: Database.Database,
  repos: Repos,
  dispatcher?: GatewayDispatcher,
  config?: AppConfig,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/api/health", (c) => c.json({ status: "ok" }));

  app.route(API_PREFIX, registerRoutes(db, repos.guilds));

  if (config?.oauth) {
    app.route("/", authRoutes(db, config.oauth, repos.guilds));
  }

  // Global auth: all /api/* routes (except PUBLIC_PATHS and OPTIONS) require a valid token.
  const authMw = requireAuth(repos.users);
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const path = c.req.path.replace(/\/+$/, "") || "/";
    if (PUBLIC_PATHS.has(path)) return next();
    return authMw(c, next);
  });

  app.route(API_PREFIX, channelRoutes(repos, dispatcher));
  app.route(API_PREFIX, messagesRoutes(repos, dispatcher));
  app.route(API_PREFIX, agentRoutes(repos, dispatcher));

  const gwUrl = config?.gatewayUrl ?? "ws://localhost:3000/gateway";
  app.get(`${API_PREFIX}/gateway`, (c) => c.json({ url: gwUrl }));
  app.get(`${API_PREFIX}/gateway/bot`, (c) => c.json({
    url: gwUrl,
    shards: 1,
    session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
  }));

  app.get(`${API_PREFIX}/guilds/:guildId/presences`, (c) => {
    const guildId = c.req.param("guildId")!;
    if (!repos.guilds.exists(guildId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const userId = c.get("botUser").id;
    if (!repos.members.exists(guildId, userId)) {
      return c.json({ message: "Unknown Guild", code: 10004 }, 404);
    }
    const onlineIds = dispatcher?.getOnlineUserIds() ?? [];
    return c.json(onlineIds.map((id) => ({ user: { id }, status: "online" })));
  });

  app.get(`${API_PREFIX}/users/@me`, (c) => {
    return c.json(c.get("botUser"));
  });

  app.get(`${API_PREFIX}/users/@me/guilds`, (c) => {
    const user = c.get("botUser");
    return c.json(repos.guilds.listForUser(user.id));
  });

  return app;
}
